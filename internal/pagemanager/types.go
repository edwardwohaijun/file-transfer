package pagemanager

import (
	"time"
	"github.com/gorilla/websocket"
	"github.com/globalsign/mgo"
	"net/http"
	"html/template"
	"fmt"
	"sync"
)

type pageId string
type userId string
type fileId string
//type messageId string
type messageType int

const (
	PageIdLength = 6 + 18 // 6 for 36-based int64 value of timestamp, 18 for random alpha-numeric string
	userIdLength = 12
	fileIdLength = 16
	fileIdFieldName = "fileId" // when client is uploading file, it needs 2 field name in formData: "fileId" and "filesForUpload", which are needed by HTTP.post handler
	filesForUploadFieldName = "filesForUpload" // these 2 constants are passed in template.execute(), and extracted by client.
)

type pageManager struct {
	lock        sync.Mutex
	Pages map[pageId]*Page
	removePage chan pageId // when the last user on page left, this page need to be removed.
	periodicSweep <-chan time.Time // remove expired page in mgo, their files in filesystem at specified interval

	Session *mgo.Session
	Tpl *template.Template
}

// type JSONResponse struct { }
func jsonResponse(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	fmt.Fprint(w, message)
}

type Page struct {
	lock sync.Mutex
	Id pageId `bson:"pageId" json:"pageId"`
	Users []*User `bson:"-" json:"-"` // when marshaling, skip Users field, otherwise infinite loop would occur: Page has users, which has page, which has user, ...
	Files []*File `bson:"files" json:"-"`
	pageManager *pageManager

	forward chan *Message
	join chan *User
	leave chan *User
	closed chan struct{} // when page expired, page.Run() would close this channel then exit, other goroutines try to read it before send data to forward/join/leave.

	ExpiresAt time.Time `bson:"expiresAt" json:"expiresAt"`
}

type User struct {
	Id userId `json:"id"`
	Name string `json:"name"`
	Page *Page `json:"-"` // when marshaling, skip Page field, otherwise, infinite loop would occur. User has page, which has users, which has page, ....
	Socket *websocket.Conn `json:"-"`
	PeerMsg chan *Message `json:"-"`
}

type FileSize float64
type File struct {
	Id fileId `bson:"id" json:"id"`
	Name string `bson:"name" json:"name"`
	Size int64 `bson:"size" json:"size"`
	MIME string `bson:"MIME" json:"MIME"`
	Uploaded bool `bson:"-" json:"uploaded"` // only the uploaded files info are saved in mgo.
}
type newFilesRequest struct{ // users send a PUT request to server with this object(in JSON), server append the fileList to page.Files, then responds with 200,
	FileList []*File `json:"fileList"` // and broadcast the newFileMsg to all peers except the sender
	SenderId userId `json:"senderId"`
}
type removeFileReq struct {
	FileId fileId `json:"fileId"`
	SenderId userId `json:"senderId"`
}

type Message struct { // bad naming
	Type messageType `json:"type"`
	//Id messageId `json:"id,omitempty"`
	//From userId `json:"from,omitempty"`
	//To bson.ObjectId `json:"to,omitempty"`
	Ignore userId `json:"ignore"`
	Content interface{} `json:"content,omitempty"`
	SentAt time.Time `json:"-,omitempty"`
}

// upon connected, this msg would be sent to user via websocket
type initMessage struct {
	MessageTypeList []string `json:"messageTypeList"`
	Profile *User `json:"profile"`
	PeerList []*User `json:"peerList"`
	FileList []*File `json:"fileList"`
	MaxUploadCount int `json:"maxUploadCount"`
	MaxFileSize int64 `json:"maxFileSize"`
	WebRTCconfig string `json:"webRTCconfig"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// simple-filer need this data to be exchanged between 2 peers before they can talk to each other directly
type SignalingData struct {
	MsgType string `json:"msgType"`
	From string `json:"from"`
	To string `json:"to"`
	SignalingData interface{} `json:"signalingData"`
}
