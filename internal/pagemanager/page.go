package pagemanager

import (
	"fmt"
	"net/http"
	"os"
	"io"
	"github.com/globalsign/mgo/bson"
	"errors"
	"time"
	"bytes"
	"github.com/edwardwohaijun/file-transfer/internal/config"
	"strconv"
	"strings"
	"path/filepath"
)

// progress value get updated and broadcast to clients every 5%
const progressStep = 5
// FileUploadProgress is a io.Writer, passed to io.Copy() when client is uploading a file,
// it serves 2 purposes: to calculate the uploaded bytes(return error if exceeded maximum allowed filesize), to broadcast the progress value to all clients
type FileUploadProgress struct {
	FileId fileId `json:"fileId"`
	FileSize int64 `json:"-"` // this is not the real filesize but request.ContentLength which include other overhead(multipart boundary string, fieldName/fieldValue)
	UploadedBytes int64 `json:"-"`
	threshold int64 `json:"-"` // broadcast the progress value to all clients when uploadedBytes exceeded this value
	MIME string `json:"MIME,omitempty"` // when upload succeeded(progress hits 1), server pass this field with the new value detected by http.DetectContentType
	Progress float32 `json:"progress"`
	broadcastProgress func(m *Message) bool
}

func (up *FileUploadProgress) Write(p []byte) (int, error) {
	n := len(p)
	up.UploadedBytes += int64(n)
	if up.UploadedBytes > config.Values.MaxFileSize {
		return n, errors.New("max allowed fileSize exceeded")
	}
	if up.UploadedBytes < up.threshold {
		return n, nil
	}

	up.threshold += up.FileSize / progressStep
	up.broadcastProgress(&Message{
		Type: UploadProgressMsg,
		Content: FileUploadProgress{
			FileId: up.FileId,
			Progress: float32(float64(up.UploadedBytes) / float64(up.FileSize)),
		},
	})
	return n, nil
}

// findFileIndex take fileId as argument, return its index in page.Files slice, -1 if not found.
// This function assume to be called inside page.Lock.lock() and page.lock.Unlock()
func (p *Page) findFileIndex(fId fileId) int {
	idx := -1
	for i := range p.Files {
		if p.Files[i].Id == fId {
			idx = i
			break
		}
	}
	return idx
}

// addFiles is called in PUT method of pagemanager.serveHTTP, it appends files slice to page.Files slice if the total file count doesn't exceed limit, then broadcast the NewFileMsg to all peers.
// Those files objects are just appended into page object, not saved in mgo until they are truly uploaded successfully, which is the job of updateFile method.
func (p *Page) addFiles(fileReq *newFilesRequest) error {
	maxUpload := config.Values.MaxUpload
	var broadcastMsg *Message
	p.lock.Lock()
	if len(fileReq.FileList) + len(p.Files) > maxUpload {
		p.lock.Unlock()
		return errors.New("单页面最多允许上传" + strconv.Itoa(maxUpload) + "个文件, P2P传输无此限制.")
	}
	p.Files = append(p.Files, fileReq.FileList...)
	p.lock.Unlock()
	broadcastMsg = &Message{
		Type: NewFileMsg,
		Content: fileReq.FileList,
		Ignore: fileReq.SenderId,
	}
	if ok := p.sendMsgData(broadcastMsg); ok {
		return nil
	} else {
		return errors.New("page closed")
	}
}

// removeFile remove the file in page.Files slice with the passed fileId.
// If the file is uploaded successfully, remove it in mgo and os filesystem.
func (p *Page) removeFile(fId fileId) error {
	var broadcastMsg *Message
	fileUploaded := false
	p.lock.Lock()
	if idx := p.findFileIndex(fId); idx != -1 {
		fileUploaded = p.Files[idx].Uploaded
		p.Files = append(p.Files[:idx], p.Files[idx + 1:]...)
		broadcastMsg = &Message{
			Type: RemoveFileMsg,
			Content: fId,
		}
	} else {
		p.lock.Unlock()
		return nil
	}
	p.lock.Unlock()

	if fileUploaded {
		session := p.pageManager.Session.Copy()
		defer session.Close()
		c := session.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)
		if err := c.Update(bson.M{"pageId": p.Id}, bson.M{"$pull": bson.M{"files": bson.M{"id": fId}}}); err != nil {
			fmt.Println("err removing file in files array of page document: ", p.Id)
		}
	}

	// file could be removed by Alice during uploading initiated by Bob, thus cause false fileUploaded, and a partially saved file in filesystem
	filePath := filepath.Join(config.Values.UploadDir, string(p.Id), string(fId))
	if err := os.Remove(filePath); err != nil {
		fmt.Println("err removing file: ", filePath)
	}

	if ok := p.sendMsgData(broadcastMsg); ok {
		return nil
	} else {
		return errors.New("page closed")
	}
	return nil
}

// updateFile is called in page.HandleUpload() when the file is uploaded successfully, it update file's actual MIME, actual size, Uploaded flag(true), and save them in mgo
func (p *Page) updateFile(file *File) error { // bad naming
	var broadcastMsg *Message
	p.lock.Lock()
	if idx := p.findFileIndex(file.Id); idx != -1 {
		p.Files[idx].Uploaded = true
		p.Files[idx].MIME = file.MIME
		p.Files[idx].Size = file.Size
		broadcastMsg = &Message{
			Type: UploadProgressMsg,
			Content: FileUploadProgress{
				FileId: file.Id,
				Progress: 1,
				MIME:file.MIME,
			},
		}
	} else {
		p.lock.Unlock()
		return errors.New("file not found")
	}
	p.lock.Unlock()

	session := p.pageManager.Session.Copy()
	defer session.Close()
	fileInfo := bson.M{"id": file.Id, "name": file.Name, "size": file.Size, "MIME": file.MIME}
	c := session.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)
	if _, err := c.Upsert(bson.M{"pageId": p.Id}, bson.M{"$push": bson.M{"files": fileInfo}}); err != nil {
		return errors.New("err upserting fileObject in mgo")
	}

	if ok := p.sendMsgData(broadcastMsg); ok {
		return nil
	} else {
		return errors.New("page closed")
	}
}

// saveFile save the data in Reader, write it into a file with the string argument specifying the filepath.
func saveFile(dstFilePath string, src io.Reader) error {
	dstFile, err := os.OpenFile(dstFilePath, os.O_WRONLY|os.O_CREATE, 0644)
	defer dstFile.Close()
	if err != nil {
		return errors.New("failed to create file: " + dstFilePath)
	}

	if _, err := io.Copy(dstFile, src); err != nil { // client could remove the file during upload process, that would cause io.Copy error
		return errors.New("io.Copy err") // todo: remove the partially saved file.
	}
	return nil
}

// HandleUpload use reader.NextPart() to read the file data wrapped in multi-part request format.
// The request only has 2 part: fileId and actual file data.
// When saving the file data, it use io.TeeReader to call FileUploadProgress.Write() to calculate uploaded bytes and broadcast the progress to all peers.
func (p *Page) HandleUpload(w http.ResponseWriter, r *http.Request, pageId string) {
	uploadDir := filepath.Join(config.Values.UploadDir, pageId)
	if _, err := os.Stat(uploadDir); os.IsNotExist(err) {
		if err := os.Mkdir(uploadDir, 0755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	progress := FileUploadProgress{
		FileId: "",
		FileSize: r.ContentLength, // contentLength include the actual filesize, boundary length and other overhead, but no big deal in this case
		UploadedBytes: 0,
		threshold: r.ContentLength / progressStep,
		Progress: 0,
		broadcastProgress: p.sendMsgData,
	}
	file := &File{} // file.Id is filled in first iteration(extract the fileId field in first part),
	// file.Name/MIME are filled at the beginning of 2nd iteration(extract the filesForUpload field in 2nd part),
	// file.Size is filled at the end of 2nd iteration when the whole upload is done(by calculating the uploaded bytes in the above progress Writer object)

	for {
		part, err := reader.NextPart()
		if err != nil && err != io.EOF {
			http.Error(w, "", http.StatusInternalServerError)
			return
		} else if err == io.EOF {
			break
		}

		// to read the fileId in first part, and save it into progress.FileId and file.Id
		if part.FormName() == fileIdFieldName {
			buf := make([]byte, fileIdLength)
			if n, err := part.Read(buf); err != nil && err != io.EOF {
				http.Error(w, "err reading fileId", http.StatusInternalServerError)
				return
			} else if n == fileIdLength && err == io.EOF {
				progress.FileId = fileId(buf)
				file.Id = fileId(buf)
				continue // fileId is the first part(file data is the 2nd part), we are done with the first part, continue the 2nd part
			} else {
				http.Error(w, "Invalid fileId", http.StatusBadRequest)
				return
			}
		}

		file.Name = part.FileName()
		if file.Name == "" {
			http.Error(w, "invalid filename", http.StatusBadRequest)
			return
		}

		// although fileId exists in part, but may not in Page object, the fileId might be forged by client. File object is saved in Page obj in HandlePUT method.
		p.lock.Lock()
		if fileIdx := p.findFileIndex(file.Id); fileIdx == -1 {
			p.lock.Unlock()
			http.Error(w, "invalid fileId", http.StatusBadRequest)
			return
		}
		p.lock.Unlock()

		if part.FormName() != filesForUploadFieldName {
			http.Error(w, "no fileId or file data found", http.StatusBadRequest)
			return
		}

		dstFilePath := filepath.Join(uploadDir, string(progress.FileId))
		MIMEbuf := make([]byte, 512)
		if n, err := part.Read(MIMEbuf); err != nil && err != io.EOF {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		} else if err == io.EOF{ // file size smaller than 512 bytes
			file.MIME = http.DetectContentType(MIMEbuf)
			file.Size = int64(n)
			file.Uploaded = true
			bufReader := bytes.NewReader(MIMEbuf[:n])
			if err := saveFile(dstFilePath, bufReader); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if err := p.updateFile(file); err != nil {
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusCreated)
			return
		}

		// progress value got updated every 5%, the first 5% might take a while to show, during which users might get confused, why nothing happens.
		// Thus, we notify users uploading just started by showing a 0%.
		progress.broadcastProgress(&Message{
			Type: UploadProgressMsg,
			Content: FileUploadProgress{
				FileId: progress.FileId,
				Progress: 0,
			},
		})

		// fileSize bigger than 512 bytes
		file.MIME = http.DetectContentType(MIMEbuf)
		progress.UploadedBytes = int64(512) // we have already read the first 512 bytes when detecting the MIME type.
		mReader := io.MultiReader(bytes.NewReader(MIMEbuf), io.TeeReader(part, &progress))
		if err := saveFile(dstFilePath, mReader); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		file.Uploaded = true
		file.Size = progress.UploadedBytes
		if err := p.updateFile(file); err != nil {
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		break // there are only 2 fields need to be processed in multipart req: fileId and file data(order matters)
	}
	jsonResponse(w, http.StatusCreated, "created")
}

// NewPage returns a *Page object, it only get called in pagemanager.handleUserJoin() when a new user(connect via websocket) want to join a page,
// and pagemanager found the page doesn't exist yet, thus create the page.
func NewPage(pid pageId) *Page {
	page := &Page{
		Id: pid,
		Users: make([]*User, 0),
		Files: make([]*File, 0, config.Values.MaxUpload),
		forward: make(chan *Message, 8), // busy channel, better have a buffer
		join: make(chan *User, 4),
		leave: make(chan *User, 4),
		closed: make(chan struct{}), // when page expired, this channel is closed in page.run(), each msg sending to other channels need to check closeness of this channel before proceed
		ExpiresAt: time.Now().Local().Add(config.Values.Duration),
	}
	return page
}

// those are the message types passed between server/client through websocket or HTTP req/res
const (
	NewUserMsg messageType = iota
	RemoveUserMsg
	RenameUserMsg
	NewFileMsg
	RemoveFileMsg
	InitMsg
	ChatMsg
	SignalingMsg
	UploadProgressMsg
)
var msgType = make([]string, 9)
func init(){
	msgType[NewUserMsg] = "NewUserMsg"
	msgType[RemoveUserMsg] = "RemoveUserMsg"
	msgType[RenameUserMsg] = "RenameUserMsg"
	msgType[NewFileMsg] = "NewFileMsg"
	msgType[RemoveFileMsg] = "RemoveFileMsg"
	msgType[InitMsg] = "InitMsg"
	msgType[ChatMsg] = "ChatMsg"
	msgType[SignalingMsg] = "SignalingMsg"
	msgType[UploadProgressMsg] = "UploadProgressMsg"
}

// AddUser add the user into current page object after successfully sending the initMsg(user profile, peerList, fileList, etc)
func (p *Page) AddUser(u *User) error {
	args := config.Values
	initMsg := initMessage{
		MessageTypeList: msgType,
		Profile: u,
		PeerList: p.Users,
		FileList: p.Files,
		MaxUploadCount: args.MaxUpload,
		MaxFileSize: args.MaxFileSize,
		WebRTCconfig: args.WebrtcConfig,
		ExpiresAt: p.ExpiresAt, // todo: it's better to send expire value in seconds rather than a date, and let client calculate the remaining seconds
		// client time might not be in sync with server, remaining seconds is more accurate
	}
	msg := Message{
		Type:InitMsg,
		Content: initMsg,
	}

	if err := u.Socket.WriteJSON(msg); err != nil { // this is the first msg sent to user after creation, if failed, no need to add this user into Page.
		return errors.New("fail to send init websocket msg from the newly created user obj: " + err.Error())
	}

	// AddUser is called in "case user := <-p.join: " of page.run(), and inside sendMsgData(), there is another "p.forward <- msg", which is another channel receive case of page.run().
	// To avoid deadlock, sendMsgData() muse run in another goroutine.
	// sendMsgData has boolean return value indicating whether the msg got sent or not(equally means: page expired or not).
	// thus, it's better to call all the following code based on the return value, but AddUser also need a synchronous return value.
	// Even sendMsgData failed(due to page expiration), all clients would get closed, user.writePump/readPump would exit, no big deal.
	go p.sendMsgData(&Message{
		Type:NewUserMsg,
		Content: u,
		Ignore: u.Id,
	})

	u.Page = p
	p.Users = append(p.Users, u) // no need to do page.lock(), because addUser is invoked only in different case of page.run()
	go u.writePump()
	go u.readPump()
	return nil
}

// RemoveUser remove the user from current page. The returned boolean value indicates whether this is the last user and there is no incoming new user.
// In other word, is it safe also to remove the page from the page manager object?
func (p *Page) RemoveUser(uId userId) bool {
	idx := -1
	for i := range p.Users {
		if p.Users[i].Id == uId {
			idx = i
			break
		}
	}
	if idx != -1 {
		p.Users = append(p.Users[:idx], p.Users[idx + 1:]...) // no need to do page.lock(), user join/leave are handled in different channel case of page.run.
	}
	if len(p.Users) != 0 {
		go p.sendMsgData(&Message{
			Type:RemoveUserMsg,
			Content: uId,
		})
		return false
	}

	// when userJoin and userLeave are coming at the same time, page.run() would randomly pick one to handle,
	// in case userLeave is picked, we need to check whether there is a incoming userJoin in another channel case.
	select { // thus, we need to do a last check.
	case user := <-p.join: // There is indeed a new user joining the page at this moment
		if err := p.AddUser(user); err != nil {
			return true // failure to add newUser is considered the same as no newUser, safe to delete the page object from pageManager obj
		}
		return false
	default: // no user coming in, safe to remove the page from pageManager
		return true
	}
}

// sendUserData is a wrapper of sending *User to page.join, or page.leave channel,
// it return false if channel "page.closed" is closed, true if data is sent successfully.
func (p *Page) sendUserData(u *User, isJoin bool) bool{
	var userChan chan *User
	if isJoin {
		userChan = p.join
	} else {
		userChan = p.leave
	}

	select { // this construct is a direct copy from https://go101.org/article/channel-closing.html
	case <- p.closed:
		return false
	default:
	}

	select {
	case <- p.closed:
		return false
	case userChan <- u: // when userChan is blocked(kind of busy), and p.closed is NOT closed, which one would get picked??????????
		return true
	}
}

// sendMsgData is a wrapper of sending *Message to page.forward channel,
// it returns false if channel "page.closed" is closed, true if msg is sent successfully.
func (p *Page) sendMsgData(m *Message) bool{
	select {
	case <- p.closed:
		return false
	default:
	}

	select {
	case <-p.closed:
		return false
	case p.forward <- m:
		return true
	}
}

// cleanUp remove the corresponding page document in mgo, remove all the files and their parent directory
func (p *Page) cleanUp(pId pageId){
	session := p.pageManager.Session.Copy()
	c := session.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)
	if err := c.Remove(bson.M{"pageId": pId}); err != nil {
		fmt.Printf("err removing pageId: %s in mgo: ", pId)
	}
	session.Close()

	if err := os.RemoveAll(filepath.Join(config.Values.UploadDir, string(pId))); err != nil {
		fmt.Println("removeAll err: ", err)
	}
}

func (p *Page) run(expiresAfter time.Duration) {
	for {
		select {
		case <-time.After(expiresAfter):
			go func(){ // Socket.close() would trigger "p.leave <- user" behind the scene, which is another select case of page.run(),
				for i := range p.Users { // run another goroutine to avoid deadlock.
					p.Users[i].Socket.Close() // after all user socket closed, "<-p.leave" select case would close page.closed channel, exit page.run
				}
			}()
			go p.cleanUp(p.Id)

		case user := <-p.join:
			p.AddUser(user)

		case user := <-p.leave:
			if safeToRemovePage := p.RemoveUser(user.Id); safeToRemovePage {
				close(p.closed)
				p.pageManager.removePage <- p.Id
				fmt.Println("exiting page.run with ID: ", p.Id)
				return
			}

		case message := <-p.forward:
			if message == nil {
				continue
			}

			if message.Type == SignalingMsg {
				signaling, ok := message.Content.(*SignalingData)
				if !ok {
					continue
				}
				for i := range p.Users {
					if p.Users[i].Id == userId(signaling.To) {
						p.Users[i].PeerMsg <- message
						break
					}
				}
				continue
			}

			if message.Type == RenameUserMsg {
				newNameData, ok := message.Content.(map[string]interface{})
				if !ok {
					continue
				}

				var uId string
				var newName string
				if uId, ok = newNameData["id"].(string); !ok {
					continue
				}
				if newName, ok = newNameData["name"].(string); !ok {
					continue
				}
				newName = strings.TrimSpace(newName)
				runes := []rune(newName)
				if len(runes) == 0 {
					continue
				}

				charCount := 12
				if charCount > len(runes){
					charCount = len(runes)
				}
				safeNewName := string(runes[0:charCount])
				for i := range p.Users {
					if p.Users[i].Id == userId(uId) {
						p.Users[i].Name = safeNewName
					} else {
						p.Users[i].PeerMsg <- message // todo: newName in message is still the original value, not truncated
					}
				}
				continue
			}

			for i := range p.Users {
				if message.Ignore == p.Users[i].Id {
					continue
				}
				select {
				case p.Users[i].PeerMsg <- message:
				default:
					// delete(p.Users, user.Id)
					// how to tell whether the user obj is gone or the channel is blocked temporarily
				}
			}
		}
	}
}
