package main

import (
	"net/http"
	"log"
	"html/template"
	"github.com/edwardwohaijun/file-transfer/internal/pagemanager"
	"github.com/globalsign/mgo"
	"time"
	"path/filepath"
	"os"
	"fmt"
	"github.com/edwardwohaijun/file-transfer/internal/config"
	"strconv"
)

var tpl *template.Template
func init(){
	cwd, _ := os.Getwd()
	tpl = template.Must(template.ParseFiles(
		filepath.Join(cwd, "internal/webtemplates/fileManager.html"),
		filepath.Join(cwd, "internal/webtemplates/pageNotFound.html"),
	))
}

func main(){
	mongoDBDialInfo := &mgo.DialInfo{
		Addrs:    []string{config.Values.MgoHost},
		Timeout:  60 * time.Second,
		Database: config.Values.MgoDBName,
		Username: config.Values.MgoUsername,
		Password: config.Values.MgoPassword,
	}
	mongoSession, err := mgo.DialWithInfo(mongoDBDialInfo)
	if err != nil {
		log.Fatalf("mongoDB session creation failed: %s\n", err)
	}
	defer mongoSession.Close()
	mongoSession.SetMode(mgo.Monotonic, true)
	index := mgo.Index{
		Key: []string{"pageId"},
		Unique: true,
		DropDups:   true,
		Background: true,
		Sparse:     true,
	}
	filesCollection := mongoSession.DB(config.Values.MgoDBName).C(config.Values.MgoCollectionName)
	if err = filesCollection.EnsureIndex(index); err != nil {
		fmt.Print("EnsureIndex failed: ", err)
		log.Fatal(err)
	}

	var pm = pagemanager.New(tpl)
	pm.Session = mongoSession
	go pm.Run()
	log.Fatal( http.ListenAndServe(":" + strconv.Itoa(config.Values.ServerPort), pm))
}
