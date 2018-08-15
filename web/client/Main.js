import React, {Component} from 'react';
import {fromJS} from 'immutable';
import {getReadableFileSizeString, getReadableTimeDuration} from "./utilities/common";
//import {COLOR_CONNECTED, COLOR_NOT_CONNECTED} from './constants'
import MySocket from './components/singularObject/GetSocket'
import MyFiler from './components/singularObject/GetFiler'
import PeerList from './PeerList'
import FileList from './FileList'
import UploadManager from "./utilities/UploadManager";

import '../public/stylesheets/style.css'

/*
)
var msgType = make([]string, 9)
 func init(){
	 msgType[NewUserMsg] = "NewUserMsg"                      0
	msgType[RemoveUserMsg] = "RemoveUserMsg"                 1
	msgType[RenameUserMsg] = "RenameUserMsg"                 2
	msgType[NewFileMsg] = "NewFileMsg"                       3
	msgType[RemoveFileMsg] = "RemoveFileMsg"                 4
	msgType[InitMsg] = "InitMsg"                             5
	msgType[ChatMsg] = "ChatMsg"                             6
	msgType[SignalingMsg] = "SignalingMsg"                   7
	msgType[UploadProgressMsg] = "UploadProgressMsg"         8
 }
 write a function to get indexID from string name
 */

 let clock = (
     <svg xmlns="http://www.w3.org/2000/svg" width="21.36" height="20.56" style={{fill: "currentColor", display: "inline-block"}}>
       <path d="M4.6 20.172l1.1-1.905.659.38-1.1 1.905zM14.781 18.65l.659-.38 1.1 1.905-.659.38z"/>
       <path d="M10.93 1.89V.76h1.51V0H8.66v.76h1.51v1.13a8.66 8.66 0 1 0 .76 0zm-.38 16.54a7.91 7.91 0 1 1 7.91-7.92 7.92 7.92 0 0 1-7.91 7.93z"/>
       <path d="M10.17 6.4v4l-1.88 1.87.53.53 2-2a.38.38 0 0 0 .11-.27V6.4zM10.17 3.39h.76v1.13h-.76zM7.23 4.04l-.33.19-.33.19.67 1.15.65-.38-.66-1.15zM4.045 7.23l.38-.658 1.152.665-.38.658zM3.39 10.17h1.13v.76H3.39zM4.039 13.874l1.152-.664.38.658-1.152.665zM6.574 16.672l.665-1.152.658.38-.665 1.152zM10.17 16.58h.76v1.13h-.76zM13.204 15.899l.658-.38.665 1.151-.658.38zM15.584 13.79l.38-.662 1.157.665-.38.662zM16.58 10.17h1.13v.76h-1.13zM15.587 7.275l1.153-.663.378.659-1.153.663zM13.205 5.192l.665-1.152.658.38-.665 1.152zM6.3 1.24a3 3 0 0 0-4.3 0L1.24 2a3 3 0 0 0 0 4.3.38.38 0 0 0 .53 0L6.3 1.77a.38.38 0 0 0 0-.53zM1.53 5.47a2.29 2.29 0 0 1 .24-2.95l.76-.76a2.29 2.29 0 0 1 2.95-.24zM19.83 2l-.76-.76a3 3 0 0 0-4.3 0 .38.38 0 0 0 0 .53L19.3 6.3a.38.38 0 0 0 .53 0 3 3 0 0 0 0-4.3zm-.28 3.48l-4-3.94a2.29 2.29 0 0 1 2.95.24l.76.76a2.29 2.29 0 0 1 .29 2.93zM.76 12.43H0c0 .11 0 2.88 1.71 3.73l.29-.67C.78 14.85.76 12.46.76 12.43zM0 10.93h.76v.76H0zM20.65 7.69l-.65.45s1 1.43.32 4.21l.73.18c.83-3.16-.35-4.78-.4-4.84zM19.622 13.783l.376-.75.68.34-.376.75z"/>
     </svg>
 );

let msgType = [];

let redirect = () => {
  let paths = location.pathname.split("/");
  if (paths[paths.length - 1] === "") {
    paths.length = paths.length - 1 // in case the last part is empty
  }

  paths.length = paths.length - 1; // remove the pageId
  location.replace(paths.join("/") + "/404")
};

let filer = MyFiler.getFiler();
class Main extends Component {
  constructor(props) {
    super(props);
    this.state = {
      profile: fromJS({}),
      peerList: fromJS([]),
      selectedPeerId: "",
      fileList: fromJS([]),
      chatList: fromJS([]),
    };
    this.nickname = "";
    this.config = {};
    this.uploader = new UploadManager("", ""); // this ctor needs 2 arguments: fieldName of fileId and <input type="file">,
    // but these 2 values can only be acquired in DidMount of child component FileList. So, pass empty string here, let FileList to fill them in.
  }

  msgHandler = evt => {
    try {
      let data = JSON.parse(evt.data);
      switch (data.type) { // todo: make a array with index as msgType, value as handler, no need for clumsy switch.
        case 0: this.addPeer(data.content); break;
        case 1: this.removePeer(data.content); break;
        case 2: this.renamePeer(data.content); break;
        case 3: this.addFiles(data.content); break;
        case 4: this.removeFile(data.content); break;
        case 5: this.init(data.content); break;
        case 6: console.log("not implemented msg type: ", msgType[data.type]); break;
        case 7: this.handleSignaling(data.content); break;
        case 8: this.updateUploadProgress(data.content); break;
        default: console.log("unknown msgType: ", data.type)
      }
    } catch(e){
      console.log('err parsing json: ', e)
    }
  };

  componentDidMount() {
    this.pageExpiresEle = document.getElementById("page-expires-in");

    this.socket = MySocket.getSocket();
    this.socket.onmessage = this.msgHandler;

    if (filer.isFileSystemAPIsupported){
      this.fileSystemQuotaLabel = document.getElementById("filesystem-quota");
      filer.FileSystemQuota()
          .then(this.updateQuota)
          .catch(err => console.log("err checking quota: ", err))
    }

    filer.signalingChannel = this.socket;
    filer.on("connect", peerId => {
      this.setP2PconnectionFlag(peerId, true);
    });

    filer.on("error/peer", err => {
      switch (err.code) {
        case "ERR_PEER_CLOSED":
        case "ERR_PEER_ERROR":
        case "ERR_PEER_CONNECTION_FAILED":
          console.log("err/peer: ", err);
          this.setP2PconnectionFlag(err.peerID, false);
      }
    });

    filer.on("error/file", err => { // todo: show errMsg on page
      console.log("err/file: ", err)
    });

    filer.on("task", ({fileID, fileName, fileSize, fileType}) => {
      let file = {id: fileID, name: fileName, size: fileSize, MIME: fileType, mode: "P2P", status: "transferring"};
      this.setState({
        fileList: this.state.fileList.push(fromJS(file))
      })
    });

    filer.on("progress", ({fileID, progress, fileName, fileURL}) => {
      let fileIdx = this.state.fileList.findIndex(f => f.get("id") === fileID);
      if (fileIdx === -1) { return }

      let fileList = this.state.fileList;
      let file = fileList.get(fileIdx);
      file = file.set("progress", progress).set("status", "transferring");
      fileList = fileList.set(fileIdx, file);
      if (progress === 1){
        if (fileURL) { // receiver
          file = file.set("status", "received").set("URL", fileURL);
          filer.FileSystemQuota()
              .then(this.updateQuota)
              .catch(err => console.log("err checking quota: ", err))

        } else { // sender
          file = file.set("status", "sent")
        }
        fileList = fileList.set(fileIdx, file)
      }
      this.setState({ fileList: fileList })
    });
  }

  updateQuota = ({usedBytes, grantedBytes}) => {
    let divTotal = this.fileSystemQuotaLabel.querySelector(".filesystem-total");
    let divUsed = this.fileSystemQuotaLabel.querySelector(".filesystem-used");
    let divAvail = this.fileSystemQuotaLabel.querySelector(".filesystem-available");
    divTotal.innerHTML = "<span style='color: #3b99fc'>total: </span>" + "<span style='float: right; width: 110px'>" + getReadableFileSizeString(grantedBytes) + "</span>";
    divUsed.innerHTML = "<span style='color: #3b99fc'>used: </span>" + "<span style='float: right; width: 110px'>" + getReadableFileSizeString(usedBytes) + " (" + ( Math.round(100*(usedBytes/grantedBytes)) + " %)") + "</span>";
    divAvail.innerHTML = "<span style='color: #3b99fc'>available: </span>" + "<span style='float: right; width: 110px'>" + getReadableFileSizeString(grantedBytes - usedBytes) + " (" + ( Math.round(100*(grantedBytes - usedBytes)/grantedBytes) + " %)") + "</span>";
  };

  init = data => {
    data.fileList.forEach(f => {
      f.progress = f.uploaded ? 1: 0;
      f.status = f.uploaded ? "uploaded" : "pending";
      f.mode = "Public"
    });

    msgType = data.messageTypeList;
    this.nickname = data.profile.name;

    filer.myID = data.profile.id;
    let rtc = null;
    try {
      rtc = JSON.parse(data.webRTCconfig);
    } catch(e){

    }
    filer._webrtcConfig = rtc;

    this.config = {
      expiresAt: data.expiresAt,
      maxUploadCount: data.maxUploadCount,
      maxFileSize: data.maxFileSize,
    };

    this.intervalID = setInterval(this.updateExpireDuration, 3000);
    this.updateExpireDuration();

    this.setState({
      profile: fromJS(data.profile),
      peerList: fromJS(data.peerList),
      fileList: fromJS(data.fileList),
    });
  };

  updateExpireDuration = () => {
    let duration = new Date(this.config.expiresAt) - new Date();
    if (duration <= 0) {
      clearInterval(this.intervalID);
      redirect();
      return
    }

    let expiresArray = getReadableTimeDuration(duration);
    if (expiresArray.string === "" || expiresArray.string === "BOOM") {
      clearInterval(this.intervalID);
      redirect();
      return
    }
    this.pageExpiresEle.innerText = "Page expires in " + expiresArray.string;
  };

  setP2PconnectionFlag = (peerId, isConnected) => {
    let peerIdx = this.state.peerList.findIndex(p => p.get("id") === peerId);
    if (peerIdx !== -1){
      this.setState({
        peerList: this.state.peerList.setIn([peerIdx, "P2Pconnected"], isConnected)
      })
    }
  };

  handleSignaling = data => {
    if (filer.isFileSystemAPIsupported){
      filer.handleSignaling(data);
    }
  };

  addPeer = peer => {
    this.setState({
      peerList: this.state.peerList.push(fromJS(peer))
    });
    if (filer.isFileSystemAPIsupported){
      filer.createConnection(peer.id) // todo: use a random timeout value to createConnection, otherwise, answerer would get a burst of many createConnection requests.
    }
  };

  removePeer = peerId => {
    let idx = this.state.peerList.findIndex(p => p.get('id') === peerId);
    if (idx !== -1){
      if (peerId === this.state.selectedPeerId) {
        this.setState({
          peerList: this.state.peerList.delete(idx),
          selectedPeerId: ""
        })
      } else {
        this.setState({
          peerList: this.state.peerList.delete(idx),
        })
      }
    }
  };

  // called when receiving renamePeer msg via websocket
  renamePeer = ({id, name}) => {
    let peerIdx = this.state.peerList.findIndex(p => p.get("id") === id);
    if (peerIdx !== -1){
      this.setState({
        peerList: this.state.peerList.setIn([peerIdx, "name"], name)
      })
    }
  };

  onSelectPeer = evt => this.setState({ selectedPeerId: evt.target.value });

  addFiles = files => {
    let fileList = this.state.fileList;
    files.forEach(f => {
      f.status = f.status || "pending"; // addFiles is call in 2 places: when websocket received a msg of type "NewFileMsg", the file object in msg has no status props, thus add 'pending'.
      // also get called in FileList component, when user click the "Choose files" button, causing onChange evt. These files are local candidates, their info are not broadcast to other peers,
      // their status are set to "idle" by the caller.
      f.mode = "Public";
      fileList = fileList.push(fromJS(f))
    });
    this.setState({ fileList: fileList })
  };

  // when clicking "upload", a PUT request(with fileList of idle files) is sent, only after receiving 200 and a fileList(with new fileId attached) will the upload begin.
  // updateFiles is called inside PUT success callback: to update the fileId and other fields of those idle files in this.state.fileList(actually, I just replace them with new list)
  updateFiles = fileList => {
    let activeFileList = this.state.fileList.filter(f => f.get("status") !== "idle"); // save the non-idle files
    fileList.forEach(f => { // those previously idle files are replaced with new fileList
      f.status = "pending";
      f.mode = "Public";
      activeFileList = activeFileList.push(fromJS(f))
    });
    this.setState({ fileList: activeFileList })
  };

  removeFile = fileId => {
    let fileList = this.state.fileList;
    let fileIdx = fileList.findIndex(f => f.get('id') === fileId);
    if (fileIdx === -1) { return }

    if (fileList.getIn([fileIdx, "mode"]) !== "P2P") { // only 2 modes: P2P, Public
      this.uploader.removeTaskItem(fileId); // I was uploading a file, another user might remove it, and I would receive a removeFileMsg, so I need to call .removeTaskItem()
    } else {
      filer.FileSystemQuota()  // it's better to only check receiver's quota, but when file is transferring, there is no way to check who is sender/receiver
          .then(this.updateQuota)
          .catch(err => console.log("err checking quota: ", err));

      filer.removeTask(fileId)
    }
    this.setState({ fileList: fileList.delete(fileIdx) })
  };
  removeAllP2Pfiles = () => {
    let nonP2PfileList = this.state.fileList.filter(f => f.get("mode") !== "P2P");
    if ( this.state.fileList.size - nonP2PfileList.size === 0){
      return
    }
    this.setState({fileList: nonP2PfileList})
  };

  updateUploadProgress = data => {
    let fileList = this.state.fileList;
    let idx = fileList.findIndex(f => f.get('id') === data.fileId);
    if (idx !== -1){
      let file = fileList.get(idx);
      file = file.set("progress", data.progress).set("status", "uploading");
      if (data.progress === 1){
        file = file.set("uploaded", true).set("MIME", data.MIME).set("status", "uploaded")
      }
      fileList = fileList.update(idx, f => file);
      this.setState({ fileList: fileList})
    }
  };

  // called by PeerList component
  onRename = evt => {
    this.setState({ profile: this.state.profile.set("name", evt.target.value)})
  };
  sendRenameMsg = evt => {
    let newName = evt.target.value.trim().substring(0, 12);
    if (newName === ""){
      newName = this.nickname
    } else {
      this.nickname = newName;
      let myId = this.state.profile.get("id");
      this.socket.send(JSON.stringify(
          {
            type: 2,
            content: { id: myId, name: newName},
            ignore: myId
          }
      ));
    }

    this.setState({profile: this.state.profile.set("name", newName)});
  };

  render() {
    return (
        <div>
          <div style={{display: "flex"}}>
            <PeerList peers={this.state.peerList} profile={this.state.profile} onRename={this.onRename} sendRenameMsg={this.sendRenameMsg}
                      onSelectPeer={this.onSelectPeer} selectedPeerId={this.state.selectedPeerId} updateQuota={this.updateQuota} removeAllP2Pfiles={this.removeAllP2Pfiles}/>
            <FileList files={this.state.fileList} addFiles={this.addFiles} removeFile={this.removeFile} fileConfig={this.config}
                      uploader={this.uploader} updateFiles={this.updateFiles} profile={this.state.profile} />
          </div>

          <div style={{position: "fixed", bottom: "0", width: "1200px"}}>
            <div style={{display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#3b99fc", color: "#FFF", bottom: "0", margin: "0 auto",  width: "320px", height: "40px", borderRadius: "4px"}}>
              {clock}
              <div id="page-expires-in" style={{display: "inline-block", marginLeft: "10px", color: "currentColor"}} />
            </div>
          </div>
        </div>
    )}
}

export default Main;
