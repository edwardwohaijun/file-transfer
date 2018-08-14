package pagemanager
import (
	"fmt"
	"github.com/globalsign/mgo"
	"github.com/globalsign/mgo/bson"
	"net/http"
	"os"
	"strconv"
	"io"
	"regexp"
	"github.com/gorilla/websocket"
	"github.com/edwardwohaijun/file-transfer/internal/generate"
	"encoding/json"
	"html/template"
	"github.com/edwardwohaijun/file-transfer/internal/config"
	"path/filepath"
	"path"
	"strings"
	"time"
	"errors"
	"log"
)

// New is the constructor of pageManager, returns a pagemanager ptr
func New(tpl *template.Template) *pageManager {
	pm := &pageManager{
		Pages: make(map[pageId]*Page),
		removePage: make(chan pageId),
		periodicSweep: time.NewTicker(time.Second * 10).C, // todo: decrease to 10m before getting online
		Tpl: tpl,
	}
	return pm
}

// cleanup is a method of pagemanager, it'll be invoked at specified interval to do some expired page cleanup job, like:
// remove the expired pages in mgo, remove those files on filesystem.
func (pm *pageManager) cleanup(){
	session := pm.Session.Copy()
	defer session.Close()
	c := session.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)

	expiredPages := bson.M{"expiresAt": bson.M{"$lt": time.Now()}}
	var expiredPageIDs []struct{ Id string `bson:"pageId"` }
	if err := c.Find(expiredPages).Select(bson.M{"pageId": 1}).All(&expiredPageIDs); err != nil {
		log.Print("err getting expired pages: \n", err)
		return
	}

	if len(expiredPageIDs) == 0 {
		return
	}

	c.RemoveAll(expiredPages)
	for idx := range expiredPageIDs {
		os.RemoveAll(filepath.Join(config.Values.UploadDir, expiredPageIDs[idx].Id))
	}
}

func (pm *pageManager) Run(){
	for {
		select {
		case pId := <-pm.removePage:
			pm.lock.Lock()
			delete(pm.Pages, pId)
			pm.lock.Unlock()

		case <-pm.periodicSweep:
			go pm.cleanup()
		}
	}
}

// handleUserJoin is a method of pagemanager, it's called in pagemanager's serveHTTP() when a new websocket client connected.
// it first check whether the page(with the pageId) exists in pagemanager, if yes: send the user data to page.sendUserData method, and return.
// if not, create a new page, insert it into pagemanager, then check whether the pageId exists in mgo,
// if yes: read the page data, copy 2 important fields: Files, ExpiresAt to the new page object.
// if not: insert the new page data into mgo.
// finally, call run() on new page object.
func (pm *pageManager) handleUserJoin(u *User) error {
	pm.lock.Lock()
	page, ok := pm.Pages[u.Page.Id]
	if ok { // page exists, join now
		pm.lock.Unlock()
		if ok := page.sendUserData(u, true); !ok {
			return errors.New("page expired")
		}
		return nil
	}

	page = NewPage(u.Page.Id)
	pm.Pages[page.Id] = page
	pm.lock.Unlock()
	page.pageManager = pm

	// page not exist in pm, check it in mgo
	session := pm.Session.Copy()
	defer session.Close()
	c := session.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)
	// it's better to do an atomic findOrInsert. If exist, get the doc back(I need to grab the files fields) , if not, insert a new doc(an empty page object).
	// https://docs.mongodb.com/manual/reference/method/db.collection.findOneAndUpdate
	// findOneAndUpdate can do what I want, unfortunately, mgo hasn't implement this API, I have to do an insert first to check whether the doc exists. If yes, then do another find().
	// potential data race
	if err := c.Insert(&page); err != nil && mgo.IsDup(err) {
		p := &Page{Id: page.Id} // you can't pass page obj to c.Find().One(&page), that would cause all channels on page to be nil if a successful Find() was made:
		// because page fields were overwritten by data in mgo doc, those channel fields were nil by default.
		if errFind := c.Find(bson.M{"pageId": page.Id}).One(&p); errFind != nil { // "doc not found" is also an error
			return errors.New("page not found or expired")
		}
		page.Files = p.Files
		page.ExpiresAt = p.ExpiresAt
		for i := range page.Files {
			page.Files[i].Uploaded = true
		}
	} else if err == nil { // page written successfully

	} else { // other kind of error
		return err
	}

	timeLeft := page.ExpiresAt.Sub(time.Now())
	if timeLeft.Seconds() <= 3 { // nothing you can do with 3 seconds left
		return errors.New("page expired")
	}

	go page.run(timeLeft)
	if ok := page.sendUserData(u, true); !ok {
		return errors.New("page expired")
	}
	return nil
}

// getPage returns the page object with the passed pageId
func (pm *pageManager) getPage(pId pageId) *Page {
	pm.lock.Lock()
	if page, ok := pm.Pages[pId]; ok {
		pm.lock.Unlock()
		return page
	}
	pm.lock.Unlock()
	return nil
}

// newPageId returns a pageId string which is 24 characters long,
// first 6 is a 36-based int64 value of timestamp, remaining 18 is randomly generated alpha-numeric string
func newPageId() string {
	nowStampStr := strconv.FormatInt(time.Now().Unix(), 36) // seconds elapsed since EPOCH in base36 format, 6 characters long
	return nowStampStr + generate.RandomString(PageIdLength - len(nowStampStr))
}

// validatePageId check pageId's validity: string length, valid timestamp of first 6 characters, whether expired against now().
var isPageId = regexp.MustCompile("^[a-zA-Z0-9]{" + strconv.Itoa(PageIdLength) + "}$")
func validatePageId(pId string) bool {
	if !isPageId.MatchString(pId) {
		return false
	}

	pageIdStamp, err := strconv.ParseInt(pId[:6], 36, 64)
	if err != nil {
		return false
	}

	now := time.Now()
	if  now.Unix() >= pageIdStamp && now.Unix() < pageIdStamp + int64(config.Values.Duration.Seconds()) {
		return true
	}
	return false
}

// download is invoked in pagemanager.serveHTTP when receiving a GET /pageId/fileId request
func (pm *pageManager) Download(pId pageId, fId fileId, w http.ResponseWriter){
	p := &Page{}
	session := pm.Session.Copy()
	c := session.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)
	if errFind := c.Find(bson.M{"pageId": pId}).One(p); errFind != nil {
		session.Close()
		w.WriteHeader(http.StatusNotFound) // document not found is also an error
		return
	}
	session.Close()

	idx := p.findFileIndex(fId) // we don't need lock(), this page object is created temporarily, it has nothing to do with pagemanager, no other goroutine would access it.
	if idx == -1 {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	file, err := os.Open(filepath.Join(config.Values.UploadDir, string(pId), string(fId)))
	defer file.Close()
	if err != nil {
		fmt.Println("err opening page/file: ", pId, "/", fId)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Disposition", "attachment; filename=" + p.Files[idx].Name);
	w.Header().Set("Content-Type", p.Files[idx].MIME)
	w.Header().Set("Content-Length", strconv.FormatInt(p.Files[idx].Size, 10))
	if _, err := io.Copy(w, file); err != nil && err != io.EOF {
		fmt.Println("err reading page/file: ", pId, "/", fId)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

var tplData = map[string]string{
	"FileIdFieldName": fileIdFieldName,
	"FilesForUploadFieldName": filesForUploadFieldName,
	"UrlRootPath": config.Values.UrlRootPath,
	"Host": "",
}

// ShiftPath is only called in pagemanager.serveHTTP(), it split the req URL "/abc/xyz/123" into 2 parts: "abc", "/xyz/123"
// serveHTTP use this as a simple route matcher
func ShiftPath(p string) (head, tail string) {
	p = path.Clean("/" + p)
	i := strings.Index(p[1:], "/") + 1
	if i <= 0 {
		return p[1:], "/"
	}
	return p[1:i], p[i:]
}

// If there is a Nginx proxy server running in front of this app, let Nginx handle the static files instead.
var fs = http.FileServer(http.Dir(config.Values.WebRoot))
func (pm *pageManager) ServeHTTP(w http.ResponseWriter, r *http.Request){
	if !strings.HasPrefix(path.Join(r.URL.Path, "/"), path.Join(config.Values.UrlRootPath, "/")) { // the path.Join(..) make sure /abcDEF doesn't match /abc
		if err := pm.Tpl.ExecuteTemplate(w, "pageNotFound", tplData["UrlRootPath"]); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
		}
		return
	}

	var head string
	r.URL.Path = r.URL.Path[len(config.Values.UrlRootPath):] // strip off the "urlRootPath" part in http://www.example.com/urlRootPath/****
	head, r.URL.Path = ShiftPath(r.URL.Path)

	switch {
	case head == "": {
		http.Redirect(w, r, path.Join("/", config.Values.UrlRootPath, newPageId()), http.StatusTemporaryRedirect)
	}
	case head == "public": fs.ServeHTTP(w, r)
	case head == "404": {
		if err := pm.Tpl.ExecuteTemplate(w, "pageNotFound", tplData["UrlRootPath"]); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
		}
	}

	case head == "ws": {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			fmt.Println("err upgrading to ws: ", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		pId := r.URL.Query().Get("pageId")
		if !validatePageId(pId) {
			conn.Close()
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		newUser := NewUser(pageId(pId), conn)
		if err := pm.handleUserJoin(newUser); err != nil { // only one kind of error: page expired
			conn.Close()
			w.WriteHeader(http.StatusBadRequest)
			return
		}
	}

	case validatePageId(head) :
		var fId string
		fId, r.URL.Path = ShiftPath(r.URL.Path)
		switch r.Method {
		case http.MethodGet:
			if fId == "" {
				tplData["Host"] = r.Host
				if err := pm.Tpl.ExecuteTemplate(w, "fileManager", tplData); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
				}
				return
			}
			pm.Download(pageId(head), fileId(fId), w)

		case http.MethodPost:
			page := pm.getPage(pageId(head))
			if page != nil {
				page.HandleUpload(w, r, head) // this function will call http.Error() when necessary, thus don't w.WriteHeader again.
				return
			}
			w.WriteHeader(http.StatusUnauthorized)

		case http.MethodPut: // users send the fileInfo data, {name: ***, size: ***, MIME: ***}. page.HandleFile() append them into page.Files slice.
			page := pm.getPage(pageId(head))
			if page == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			newFilesReq := &newFilesRequest{
				FileList: make([]*File, 0, config.Values.MaxUpload),
			}
			if err := json.NewDecoder(r.Body).Decode(newFilesReq); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			for i := range newFilesReq.FileList{
				newFilesReq.FileList[i].Uploaded = false
				newFilesReq.FileList[i].Id = fileId(generate.RandomString(fileIdLength)) // fileId must be generated by server, then send back to clients
			}
			if err := page.addFiles(newFilesReq); err != nil { // addFiles() append files to page.Files slice, then broadcast the newFile msg to all peers.
				http.Error(w, err.Error(), http.StatusBadRequest) // error could be: maxFileUpload reached, page expired.
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(newFilesReq.FileList); err != nil {
				w.WriteHeader(http.StatusInternalServerError)
			} // when requester received this response, he/she will upload the file immediately.

		case http.MethodDelete:
			if len(fId) != fileIdLength {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			page := pm.getPage(pageId(head))
			if page == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if err := page.removeFile(fileId(fId)); err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			 w.WriteHeader(http.StatusOK)

		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	default:
		if err := pm.Tpl.ExecuteTemplate(w, "pageNotFound", tplData["UrlRootPath"]); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
		}
	}
}
