import React, {Component} from 'react';
import axios from 'axios';
import {randomString, getReadableFileSizeString} from "./utilities/common";

let fileIdFieldName = "";
let filesForUploadFieldName = "";

class FileList extends Component {
  constructor(props) {
    super(props);
    this.state = { };
    this.candidateFiles = []; // those have been selected(files argument of onChange event), but not uploaded.
  } // once 'upload' button is clicked, this array is cleared.

  componentDidMount = () => {
    let form = document.getElementsByTagName("form")[0]; // todo: use ID to get form
    let fields = form.querySelectorAll(".upload-field");
    fields.forEach(f => {
      switch (f.type.toLowerCase()) {
        case "hidden":
          fileIdFieldName = f.id; break;
        case "file":
          filesForUploadFieldName = f.id;
          f.addEventListener("change", this.addFiles);
          break;
      }
    });
    this.uploadButton = form.querySelector('a');
    this.uploadButton.addEventListener("click", this.upload);
    this.uploadMsgEle = form.querySelector("#upload-msg");

    let fileListContainer = document.getElementById("fileList-container");
    fileListContainer.insertBefore(form, fileListContainer.childNodes[0]);
    this.props.uploader.fileIdFieldName = fileIdFieldName;
    this.props.uploader.filesForUploadFieldName = filesForUploadFieldName;
  };

  // addFiles add those files in "onChange evt.target.files", set their status to "idle", then push into this.state.fileList by calling "this.props.addFiles",
  // they are also pushed into this.candidateFiles with the file object attached. this.Uploader works on this.candidateFiles.
  // When files are first added, their status is "idle", only visible in your local computer.
  // Inside axios.PUT() request's success cb, their status is "pending",
  // when receiving "UploadProgress" via websocket, their status is "uploading", if UploadProgress value is 1, their status is "uploaded"
  addFiles = evt => {
    this.uploadButton.classList.remove("not-allowed");
    let newFiles = [];
    let fileObj;

    let files = evt.target.files;
    Array.prototype.forEach.call(files, f => {
      fileObj = {id: randomString(12), name: f.name, size: f.size, MIME: f.type, progress: 0, mode: "Public", status: "idle", uploaded: false};
      newFiles.push(fileObj);
    });
    this.props.addFiles(newFiles);

    newFiles.forEach((f, idx) => {
      f.file = files[idx];
      this.candidateFiles.push(f)
    })
  };

  removeFile = evt => {
    let tr = evt.target.closest("tr");
    let transferMode = tr.querySelector(".transfer-mode").innerHTML;
    let fileId = tr.id;
    if (transferMode === "P2P"){
      this.props.removeFile(fileId);
      return
    }

    let idx = this.candidateFiles.findIndex(f => f.id === fileId);
    if ( idx !== -1 ){
      this.candidateFiles.splice(idx, 1);
      if (this.candidateFiles.length === 0){
        this.uploadButton.classList.add("not-allowed") // for empty candidateFile, there is no file to upload
      }
      this.props.removeFile(fileId);
      return // to-be-removed-file exists in candidateFiles, means it hasn't been broadcast to other peers, no need to run axios.delete().
    }

    this.props.removeFile(fileId); // already in the process of uploading, or uploaded
    // axios.delete(location.pathname + "/" + fileId, {data: {senderId: this.props.profile.id}});
    axios({
        url: location.pathname + "/" + fileId, // todo: better to append "userId" field, so server can ignore the senderId when broadcasting the removeFileMsg
        method: 'DELETE',
      }).then().catch();
  };

  upload = () => { // todo: once "upload" clicked, disable it(and <input file>) and all idle files can't be removed, until PUT has response
    let publicFiles = this.props.files.filter(f => f.get("mode") === "Public");
    if (this.props.fileConfig.maxUploadCount < publicFiles.size) {
      this.showServerMsg("单个页面最多允许上传" + this.props.fileConfig.maxUploadCount + "个文件, P2P传输无此限制.", 10000);
      return
    }

    let isFileTooBig = false;
    publicFiles.forEach(f => {
      if (f.get("size") > 8000 * 1024 * 1024){
      // if (f.get("size") > this.props.fileConfig.maxFileSize){ // todo::::::::?????????????????*************#####################&&&&&&&&&&&&&
        isFileTooBig = true;
        this.showServerMsg("文件\"" + f.get("name") + "\"大小超过" + getReadableFileSizeString(this.props.fileConfig.maxFileSize), 8000); // todo: 限制文件名长度.
        return false // List.forEach of immutableJS would return immediately if any cb returns false.
      }
    });

    if (isFileTooBig) { return }
    if (this.candidateFiles.length === 0){ return }

    this.uploadButton.classList.add("not-allowed");
    let fileList = [];
    let file;
    this.candidateFiles.forEach(f => {
      file = {name: f.name, size: f.size, MIME: f.MIME};
      fileList.push(file)
    });
    // after server receiving the fileStat, server rename the id with new value, then broadcast to all clients, next time sender use this new fileStat to upload
    // no need to append the fileId in form data, perfect.

    axios.put(location.pathname, {fileList, senderId: this.props.profile.get("id")})
        .then(res => {
          this.props.updateFiles(res.data);
          res.data.forEach((f, idx) => { // res.data has the new fileId generated by server, we need to update the local one.
            this.candidateFiles[idx].id = f.id
          });
          this.props.uploader.addTask(this.candidateFiles); // potential bug: res.data 中不包括 file obj, 而是在addTask中, 通过实现获取的<input file> 的id获取到实际file obj
          this.candidateFiles = []; // you can't do: this.candidateFiles.length = 0; uploader.addTask() still need these data.
        })
        .catch(err => {
          this.showServerMsg(err.response.data, 10000)
        })
  };

  showServerMsg = (msg, duration) => {
    this.uploadMsgEle.querySelector("span").innerText = msg; // err.response.data;
    this.uploadMsgEle.classList.add("show");

    setTimeout(() => {
      this.uploadMsgEle.classList.remove("show")
    }, duration)
  };

  download = evt => {
    let tr = evt.target.closest("tr");
    let fileId = tr.id;
    let fileName = tr.querySelector(".file-name");
    let transferMode = tr.querySelector(".transfer-mode").innerHTML;
    if (transferMode === "P2P") {
      let fileIdx = this.props.files.findIndex(f => f.get("id") === fileId);
      if (fileIdx === -1){ return }

      let fileURL = this.props.files.getIn([fileIdx, "URL"]);
      let link = document.createElement('a'); // factor out this block into a function
      link.href = fileURL;
      link.setAttribute("download", fileName.textContent);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return
    }

    axios({
      url: location.pathname + "/" + fileId,
      method: 'GET',
      responseType: 'blob',
    }).then((response) => {
      let MIME = tr.querySelector(".MIME-type");
      let blob = new Blob([response.data], {type: MIME.textContent}),
          url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName.textContent);
      document.body.appendChild(link);
      link.click();
      link.remove()
    });
  };

// todo: disable upload button if candidate is empty
  render(){
    return (
        <div id="fileList-container" style={{width: "900px", marginLeft: "35px", marginTop: "8px", height: '100%'}}>
          <table>
            <thead>
            <tr>
              <th className="file-idx" >#</th>
              <th className="file-name" >name</th>
              <th className="file-size">size</th>
              <th className="MIME-type">type</th>
              <th className="transfer-mode" >mode</th>{/* (P2P, public) */}
              <th className="file-status">status</th>{/* (transferring, idle/pending/uploading/uploaded) */}
              <th className="file-action">action</th>
            </tr>
            </thead>
            <tbody>
            {
              this.props.files.map((f, idx) => {
                let status = f.get("status");
                if ( status === "uploading" || status === "transferring") { // former is for public upload, latter is for P2P transfer
                  status = Math.round(f.get("progress") * 100) + ' %'
                }

                let fileName = f.get("name");
                if ((f.get("uploaded")) || (f.get("mode") === "P2P" && f.get("URL"))) {
                  fileName = <span style={{cursor: "pointer", color: "blue"}} onClick={this.download} >{f.get("name")}</span>
                }
                return (
                    <tr key={f.get('id')} id={f.get("id")}>
                      <td className="file-idx" >{idx + 1}</td>
                      <td className="file-name" >{fileName}</td>
                      <td className="file-size" >{getReadableFileSizeString(f.get('size'))}</td>
                      <td className="MIME-type" >{f.get('MIME')}</td>
                      <td className="transfer-mode" >{f.get("mode")}</td>
                      <td className="file-status" >{status}</td>
                      <td className="file-action" >{<span style={{cursor: "pointer", color: "blue"}} onClick={this.removeFile}>remove</span>}</td>
                    </tr>
                )})
            }
            </tbody>
          </table>
        </div>
    )
  }
}

export default FileList;
