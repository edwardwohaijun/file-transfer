import React, {Component} from 'react';
import MySocket from './components/singularObject/GetSocket';
import MyFiler from './components/singularObject/GetFiler'

const NOT_CONNECTED = "#9E9E9E";
const CONNECTED = "#3b99fc";

let filer = MyFiler.getFiler();
class PeerList extends Component {
  constructor(props) {
    super(props);
    this.state = {
      fileSelected: false,
      socketConnected: false,
    };
  }

  componentDidMount = () => {
    this.socket = MySocket.getSocket();
    this.socket.onopen = evt => {
      this.setState({ socketConnected: true })
    };
    this.socket.onclose = evt => { // todo: better to retry connection periodically after close
      this.socket = null;
      this.setState({ socketConnected: false });
    };

    this.fileEle = document.getElementById("P2P-file");
  };

  sendFile = () => {
    let file = this.fileEle.files;
    if (this.props.selectedPeerId !== "" && file.length === 1){
      filer.send(this.props.selectedPeerId, file[0])
    }
  };

  toggleHelpTip = evt => {
    let helpDiv = evt.target.parentNode.querySelector(".help-tip");
    if (helpDiv.classList.contains("show")){
      helpDiv.classList.remove("show")
    } else {
      helpDiv.classList.add("show")
    }
  };

  selectFile = evt => { // onChange fired, even no file selected, and closing Finder would cause length of evt.target.files to be zero,
    let label = evt.target.nextElementSibling;

    if (evt.target.files.length === 0){
      label.querySelector('span').innerHTML = "Choose a file";
      this.setState({fileSelected: false})
    } else {
      label.querySelector('span').innerHTML = evt.target.files[0].name;
      this.setState({fileSelected: true})
    }
  };

  removeAllP2Pfiles = () => {
    this.props.removeAllP2Pfiles();
    filer.removeAllFiles()
        .then(filer.FileSystemQuota)
        .then(this.props.updateQuota)
        .catch(err => {
          console.log("err removing all P2P files: ", err)
        });
  };

  render(){
    let socketConnected = this.state.socketConnected;
    return (
        <div style={{width: "265", height: '100%'}}>
          <fieldset id="profile-section" style={{position: "relative"}}>
            <legend id="legend-profile" onMouseOver={this.toggleHelpTip} onMouseLeave={this.toggleHelpTip}>My profile</legend>
             <div className="help-tip arrow-down">
               userID和昵称是随机生成, 你可以修改昵称, 以方便该页面上的其他用户正确的识别你.
             </div>
            <div style={{marginBottom: "16px", marginTop: "4px"}}>
              <span style={{color: socketConnected ? CONNECTED : NOT_CONNECTED}}>nickname</span>
              <input type="text" id="profile-nickname" name="profile-nickname" maxLength={12}
                     value={this.props.profile.get("name") || ""} onChange={this.props.onRename}
                     onBlur={this.props.sendRenameMsg} style={{float: "right", width: "110px", fontSize: "14px"}} />
            </div>
            <div style={{marginBottom: "8px"}}>
              <span style={{color: socketConnected ? CONNECTED : NOT_CONNECTED}}>ID {!socketConnected ? "(offline)" : ""}</span>
              <span style={{float: "right", width: "110px"}}>{this.props.profile.get("id")}</span>
            </div>
          </fieldset>

          {
            !filer.isFileSystemAPIsupported ? <div style={{margin: "8px 0"}}>请使用Chrome浏览器实现P2P文件高速传输.</div> :
                <fieldset id="filesystem-quota" style={{position: "relative"}}>
                  <legend id="legend-chromeFS" onMouseOver={this.toggleHelpTip} onMouseLeave={this.toggleHelpTip}>Chrome filesystem space</legend>
                  <div className="help-tip arrow-down">
                    请确保通过P2P接受的文件总大小不超过剩余空间, 一旦保存到本地后, 立刻删除. 或点击下面的按钮, 一次性全部删除.
                    <br/>通过P2P方式接受的文件, 其大小和个数仅受限于你的硬盘大小, 在局域网中更是高速便捷.
                  </div>
                  <div className="filesystem-total" style={{marginBottom: "8px", marginTop: "4px"}}/>
                  <div className="filesystem-used" style={{marginBottom: "8px"}}/>
                  <div className="filesystem-available" style={{marginBottom: "8px"}}/>

                  <div style={{margin: "0 auto", width: "150px"}}>
                    <a href="javascript:void(0)" onClick={this.removeAllP2Pfiles} style={{position: "static", marginTop: "8px"}}
                       className="button" id="button-clear-all-chrome-file">
                      remove all files
                    </a>
                  </div>
                </fieldset>
          }

          <div style={{width: "100%"}}>
          <input className="P2P-transfer-field input-file" type="file" onChange={this.selectFile} id="P2P-file" name="P2P-file" />
          <label htmlFor="P2P-file">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512.001 512.001">
              <path d="M509.532 34.999a8.166 8.166 0 0 0-8.658-1.764L5.213 225.734a8.17 8.17 0 0 0-1.054 14.734l102.719 57.875 35.651 174.259a8.162 8.162 0 0 0 1.633 3.615c1.256 1.571 3.037 2.668 5.113 3a8.292 8.292 0 0 0 1.306.104 8.119 8.119 0 0 0 4.295-1.228 8.02 8.02 0 0 0 1.525-1.221l77.323-77.52a8.171 8.171 0 0 0-11.57-11.54l-60.739 60.894 13.124-112.394 185.495 101.814a8.157 8.157 0 0 0 6.435.614 8.15 8.15 0 0 0 4.72-3.961c.212-.404.382-.8.517-1.202L511.521 43.608a8.17 8.17 0 0 0-1.989-8.609zm-482.3 199.713L432.364 77.371l-318.521 206.14-86.611-48.799zm135.488 82.224a8.173 8.173 0 0 0-2.143 2.621 8.143 8.143 0 0 0-.879 2.986L148.365 419.6l-25.107-122.718L398.363 118.84 162.72 316.936zm196.787 102.259l-177.284-97.307L485.928 66.574 359.507 419.195z"/>
            </svg>
            <span>Choose a file</span>
          </label>
          <a href="javascript:void(0)" onClick={this.sendFile} style={{marginLeft: "8px"}} className={"button " + (this.state.fileSelected && this.props.selectedPeerId !== "" ? "" : "not-allowed")}
             id="button-send-file">send</a>
          </div>

          <form id="form-peer-list">
            <fieldset style={{margin: "0", position: "relative"}}>
              <legend id="legend-peerList" onMouseOver={this.toggleHelpTip} onMouseLeave={this.toggleHelpTip}>Select a peer to send file</legend>
              <div className="help-tip arrow-down">
                P2P传输仅支持Chrome浏览器.
                <br/>将该页面的URL地址发给你的好友们, 在页面过期前打开, 他们的昵称就会出现在下面的列表上, 选中后即可发送文件.
                <br/>P2P传输必须发送和接受方同时在线, 且不能保证100%的情况下都能建立连接, 好友昵称呈灰色说明P2P连接失败.
              </div>
              {
              this.props.peers.map((p, idx) => {
                let p2pConnected = p.get("P2Pconnected");
                return (
                    <div key={p.get("id")} style={{marginTop:"4px"}}>
                      <input type="radio" id={p.get("id")} className={p2pConnected ? "" : "not-allowed"} name="peerName" value={p.get("id")} disabled={!p2pConnected}
                             onChange={this.props.onSelectPeer} checked={this.props.selectedPeerId === p.get("id")}/>
                      <label htmlFor={p.get("id")} className={p2pConnected ? "" : "not-allowed"} style={{color: p2pConnected ? CONNECTED : NOT_CONNECTED, marginLeft: "16px"}}>{p.get("name")}</label>
                    </div>
                )})
            }
          </fieldset>
        </form>
        </div>
    )
  }
}

export default PeerList;
