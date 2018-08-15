package config

import (
	"flag"
	"time"
	"fmt"
	"strconv"
	"log"
	"path/filepath"
	"os"
	"regexp"
	"strings"
	"golang.org/x/sys/unix"
	"runtime"
	"encoding/json"
)

type stunServers struct {
	Url string `json:"url,omitempty"`
	Username string `json:"username,omitempty"`
	Credential string `json:"credential,omitempty"`
}
type rtcConfig struct {
	IceServers []stunServers `json:"iceServers,omitempty"`
}

type option struct {
	ServerPort int

	// there might be multiple instances running on dedicated DBs/collections
	MgoHost string
	MgoUsername string
	MgoPassword string
	MgoDBName string
	MgoCollectionName string

	MaxUpload int
	MaxFileSize int64
	Duration time.Duration // 20m, 1h, 1d
	UrlRootPath string // http://www.example.com/transfer, the "transfer" part in URL, you can specify other string, no leading/trailing slash
	WebRoot string
	UploadDir string
	WebrtcConfig string // this value should be of type rtcConfig, but you can't pass an object as cmdline argument,
	// besides, the value is passed down to client in JSON string format. Thus, this field serve the purpose of checking data validity
	// you should JSON.stringify the rtcConfig object(like the following) as string then pass as value of webrtcConfig argument
	// {iceServers: [{url: 'stun:stun.l.google.com:19302'}, {url: 'turn:SERVERIP:PORT', credential: 'secret', username: 'username'}, ...]}
}
var Values = &option{}

func init (){
	var serverPort = flag.Int("serverPort", 9090, "server port, default is '9090'")
	var mgoHost = flag.String("mgoHost", "127.0.0.1:27017", "mongoDB hostname/IP and port, default is '127.0.0.1:27017'")
	var mgoUsername = flag.String("mgoUsername", "", "mongoDB username, default is empty")
	var mgoPassword = flag.String("mgoPassword", "", "mongoDB password, default is empty")
	var mgoDBName = flag.String("mgoDBName", "filetransfer", "mongoDB databas name, default is 'filetransfer'")
	var mgoCollectionName = flag.String("mgoCollectionName", "files", "mongoDB collection name, default is 'files'")

	var maxUpload = flag.Int("maxUpload", 5, "The maximum allowed number of files, default is 5")
	var maxFileSize = flag.String("maxFileSize", "20M", "The maximum allowed single filesize, default is '20M'")
	var duration = flag.String("duration", "30m", "How long uploaded files exist in server, default is 30m, allowed units are: m(minute), h(hour), d(day)")
	var urlRootPath = flag.String("urlRootPath", "", "The path following your domain, 'transfer' in 'http://www.example.com/transfer', default is empty")
	var webRoot = flag.String("webRoot", "web", "The directory to serve web static files, default is 'web' in current working directory")
	var uploadDir = flag.String("uploadDir", "upload", "The directory to save the uploaded files, default is 'upload', relative directory is assumed to be in current working directory")
	var webrtcConfig = flag.String("webrtcConfig", "", "the list of iceServers to be passed to client to help them make P2P connection, must be passed as JSON string, default is empty")

	flag.Parse()

	// validate server port
	if *serverPort < 0 || *serverPort >= 1<<16 {
		log.Fatalf("invalid server port '%d', valid range is: 0 ~ 65535", *serverPort)
	}
	Values.ServerPort = *serverPort

	Values.MgoHost = *mgoHost
	Values.MgoUsername = *mgoUsername
	Values.MgoPassword = *mgoPassword
	Values.MgoDBName = *mgoDBName
	Values.MgoCollectionName = *mgoCollectionName

	Values.MaxUpload = *maxUpload

	 // validate maxFileSize
	 var isValidFileSize = regexp.MustCompile("^(?i)([1-9][0-9]*)m$")
	 validSizeStr := isValidFileSize.FindStringSubmatch(*maxFileSize)
	 if maxSize, err := strconv.ParseInt(validSizeStr[1], 10, 64); err != nil {
		 log.Fatalf("invalid maxFileSize '%s'", *maxFileSize)
	} else {
		 Values.MaxFileSize = maxSize << 20
	 }

	// validate duration
	var isValidDuration = regexp.MustCompile("^([1-9][0-9]*)([mhd])$")
	durationStr := isValidDuration.FindStringSubmatch(*duration)
	quantityStr, unit := durationStr[1], durationStr[2]
	quantity, err := strconv.Atoi(quantityStr)
	if err != nil {
		log.Fatalf("invalid duration argument '%s'", *duration)
	}
	switch unit {
	case "m":
		Values.Duration = time.Duration(quantity) * time.Minute
	case "h":
		Values.Duration = time.Duration(quantity) * time.Hour
	case "d":
		Values.Duration = time.Duration(quantity * 24) * time.Hour
	default:
		log.Fatalf("invalid duration argument '%s'", *duration)
	}

	// normalise urlRootPath
	*urlRootPath = strings.Trim(*urlRootPath, "/")
	if *urlRootPath != "" {
		Values.UrlRootPath = "/" + *urlRootPath // the final urlPath is either: "", or "/abc", or "/abc/xyz"
	}

	// validate webRoot
	*webRoot, err = filepath.Abs(filepath.Join(*webRoot, "public"))
	// if 'web' is passed, we need to check whether 'web/public' exist and is a directory
	if err != nil {
		log.Fatalf("err reading webRoot directory '%s': %s\n", *webRoot, err)
	}
	webRootInfo, err := os.Stat(*webRoot)
	if err != nil {
		log.Fatalf("err reading webRoot directory stat '%s': %s\n", *webRoot, err)
	}
	if !webRootInfo.Mode().IsDir() {
		log.Fatalf("webRoot '%s' is not a directory\n", *webRoot)
	}
	Values.WebRoot = *webRoot

	// validate uploadDir
	*uploadDir, err = filepath.Abs(*uploadDir)
	if err != nil {
		log.Fatalf("err reading uploadDir '%s': %s\n", *uploadDir, err)
	}
	fileInfo, err := os.Stat(*uploadDir) // only one error would occur: *PathError which probably means: doesn't exist, or has no permission to read
	if err != nil {
		log.Fatalf("err reading uploadDir stat '%s': %s\n", *uploadDir, err)
	}
	if !fileInfo.Mode().IsDir() {
		log.Fatalf("uploadDir '%s' is not a directory\n", *uploadDir)
	}

	fmt.Println("OS", runtime.GOOS)
	runningOS := runtime.GOOS
	// run "go tool dist list -json" to get a list of supported OS
	if runningOS == "linux" || runningOS == "darwin" || runningOS == "freebsd" || runningOS == "solaris" || runningOS == "openbsd" || runningOS == "netbsd" {
		if unix.Access(*uploadDir, unix.W_OK) != nil { // for windows user, you are on you own to check folder writability
			log.Fatalf("uploadDir '%s' is not writable\n", *uploadDir)
		}
	}
	Values.UploadDir = *uploadDir

	// validate webrtcConfig
	if *webrtcConfig == "" {
		Values.WebrtcConfig = ""
		fmt.Printf("config.option value: %+v\n", Values)
		return
	}
	config := &rtcConfig{}
	if err := json.Unmarshal([]byte(*webrtcConfig), config); err != nil {
		log.Fatalf("invalid webrtcConfig argument")
	}
	Values.WebrtcConfig = *webrtcConfig

	fmt.Printf("config.option value: %+v\n", Values)
}
