import React, {Component} from 'react';
import ReactDOM from 'react-dom'
import {fromJS} from 'immutable';
import EmojiPicker from 'emoji-picker-react';
import DOMPurify from 'dompurify';
import sanitizeConfig from './utilities/sanitizeConfig';
import linkify from './utilities/linkify';

import {TAB_LABEL_HEIGHT, FLOAT_WINDOW_HEADER_HEIGHT, CHAT_INPUT_BOX_HEIGHT, CHAT_WINDOW_HEIGHT} from './constants/constants';

import MySocket from './components/common/GetSocket';
import Tabs from './components/Tabs';
import Tab from './components/Tab';
import {randomString} from './utilities/common';

import '../public/stylesheets/emoji.scss';

// I don't want to install the heavy emojione lib to do the replace
let emojiToImg = /:([\dabcdef]{3,5}|[\dabcdef]{3,5}-[\dabcdef]{3,5}):/gm; // match :1f1e6-1f1f1: OR :1f1e6:
let newlineToBr = /(?:\r\n|\r|\n)/g; // replace newline to <br />
let removeSpace = /^\s+|\s+$/g; // replace leading, ending space/new-line

let downArrow = (
    <svg xmlns="http://www.w3.org/2000/svg" id='toggle-chat-window-btn' transform='rotate(180)' className='svg-button' width="25.42" height="14" style={{transform: '.8s ease-in-out'}}>
      <path d="M25.16.26a.9.9 0 0 0-1.27 0L12.72 11.45 1.53.26A.9.9 0 0 0 .26 1.53l11.8 11.8a.88.88 0 0 0 .64.26.91.91 0 0 0 .64-.26l11.8-11.8a.88.88 0 0 0 .02-1.27z" pointerEvents='none'/>
    </svg>
);
let emojiIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" id='emoji-button' className='svg-button' width="24" height="24">
      <circle cx="12" cy="12" r="12" fill="#ffc10e" pointerEvents='none'/>
      <path d="M4.12 12a7.88 7.88 0 0 0 15.76 0H4.12z" fill="#333" pointerEvents='none'/>
      <path d="M7.62 15.13a4.38 4.38 0 0 0 8.76 0H7.62z" fill="#ca2027" pointerEvents='none'/>
      <circle cx="8.35" cy="7.86" r="1.88" fill="#333" pointerEvents='none'/>
      <circle cx="15.48" cy="7.86" r="1.88" fill="#333" pointerEvents='none'/>
    </svg>
);

class Chat extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tabIdx: 0,
      emojiBox: false,
      msg: fromJS([]),
      profile: fromJS({}),
      recentMsg: fromJS({}), // {userID: {nickname: ...., content: ..., sentAt: ...}}
    };
  }

  switchTab = idx => {
    if (idx === this.state.tabIdx) return;

    this.setState({tabIdx: idx})
  };

  componentDidMount = () => {
    this.socket = MySocket.getSocket();
    this.socket.on('/chat/init', data => this.setState({
      msg: fromJS(data.msg),
      profile: fromJS(data.profile),
      recentMsg: fromJS(data.members),
      contactInfo: data.contactInfo,
    }));

    this.socket.on('/chat/new-msg', msg => {
      let recentMsg = this.state.recentMsg;
      if (!msg.sysMsg) {
        recentMsg = this.state.recentMsg.set(msg.fromID, fromJS({nickname: msg.fromNickname, content: msg.content, sentAt: msg.sentAt}))
      }

      this.setState({
        msg: this.state.msg.push(fromJS(msg)),
        recentMsg: recentMsg
      })
    });

    this.socket.on('/chat/new-member', mem => {
      this.setState({recentMsg: this.state.recentMsg.set(mem.id, fromJS({nickname: mem.nickname}))})
    });

    this.socket.on('/chat/member-leave', memID => {
      this.setState({recentMsg: this.state.recentMsg.delete(memID)}) // it's safe to delete an non-existing key
    });

    this.socket.on('/chat/rename', ({id, name}) => { // fired when OTHER people change their name
      this.setState({
        recentMsg: this.state.recentMsg.setIn([id, 'nickname'], name)
      })
    });

    this.textInput.focus();
  };

  componentDidUpdate(prevProps, prevState) {
    if (this.state.tabIdx === 0){
      this.scrollToBottom();
      //this.textInput.focus();
    }
  }

  scrollToBottom = () => {
    const messageList = this.msgList;
    const scrollHeight = messageList.scrollHeight;
    const height = messageList.clientHeight;
    const maxScrollTop = scrollHeight - height;
    ReactDOM.findDOMNode(messageList).scrollTop = maxScrollTop > 0 ? maxScrollTop : 0;
  };

  onEmojiPick = (emojiCode) => {
    const caretPosition = this.textInput.selectionStart;
    this.textInput.value = this.textInput.value.substring(0, caretPosition) + ' :' + emojiCode + ': ' + this.textInput.value.substr(caretPosition);
    this.textInput.focus();
    this.toggleEmoji();
  };
  toggleEmoji = () => {
    this.setState({emojiBox: !this.state.emojiBox})
  };

  chatWindowOnClick = evt => { // close emoji window when clicked inside chat window but outside emoji-picker
    if (!evt.target.closest('.emoji-picker') && this.state.emojiBox){
      this.setState({emojiBox: false})
    }

    if (this.chatWindow.style.zIndex !== '10'){
      this.chatWindow.style.zIndex = '10';
      document.getElementById('attribute-window').style.zIndex = '8';
      if (this.textInput){
        this.textInput.focus()
      }
    }
  };

  toggleChatWindow = evt => {
    let target = evt.target;
    if (target.nodeName.toLowerCase() === 'button'){ // "toggle-chat-window" is the svg icon, but the enclosing button could also get the click evt
      target = target.children[0];
    }

    let chatWindow = this.chatWindow;
    if (chatWindow.classList.contains('collapse')){
      target.style.webkitTransform = "rotate(0deg)";
      target.style.transform = "rotate(0deg)";
      chatWindow.classList.remove('collapse');
      if (this.textInput){
        this.textInput.focus()
      }
    } else {
      target.style.webkitTransform = "rotate(180deg)";
      target.style.transform = "rotate(180deg)";
      chatWindow.classList.add('collapse');
      if (this.state.emojiBox){
        this.setState({emojiBox: false})
      }
    }
  };

  sendMsg = evt => {
    if (evt.key === "Enter" && evt.shiftKey){
      return false;
    }

    if (evt.key === "Enter") {
      let content = this.textInput.value.substring(0, 300).replace(removeSpace, ''); // restrict the content length to 300 chars. Better to notify users if truncated
      content = DOMPurify.sanitize(content, sanitizeConfig);
      if (content === '') {
        this.textInput.value = '';
        evt.preventDefault();
        return false
      }

      let now = new Date();

      if (content.substring(0, 8) === '/rename '){
        let newName = content.substring(8).substr(0, 12).trim(); // max name length: 12
        this.socket.emit('/chat/rename', newName);
        this.setState({
          profile: this.state.profile.set('nickname', newName),
          recentMsg: this.state.recentMsg.setIn([this.state.profile.get('id'), 'nickname'], newName),
          msg: this.state.msg.push(fromJS({
            msgID: randomString(20),
            fromNickname: 'system',
            fromID: 'systemID',
            content: 'you renamed to "' + newName + '".',
            sysMsg: true,
            sentAt: now,
          }))
        });
        this.textInput.value = '';
        evt.preventDefault();
        return;
      }

      if (content.substring(0, 5) === '/help'){
        this.socket.emit('/help');
        this.textInput.value = '';
        evt.preventDefault();
        return;
      }

      content = linkify(content).replace(emojiToImg, '<img class="emoji-img" client="//cdn.jsdelivr.net/emojione/assets/3.0/png/32/$1.png">')
          .replace(newlineToBr, '<br />'); // this is gonna break sooner or later

      let newMsg = {
        msgID: randomString(20),
        fromNickname: this.state.profile.get('nickname'),
        fromID: this.state.profile.get('id'),
        content: content,
        sentAt: now,
      };
      this.setState({
        msg: this.state.msg.push(fromJS(newMsg)),
        recentMsg: this.state.recentMsg.set(this.state.profile.get('id'), fromJS({nickname: this.state.profile.get('nickname'), content, sentAt: now}))
      });
      this.socket.emit('/chat/new-msg', newMsg);
      this.textInput.value = '';
      evt.preventDefault(); // disable the newline after pressing RET
    }

  };

  render(){
    let lastMsg;
    if (this.chatWindow && this.chatWindow.classList.contains('collapse')){// this.chatWindow exist only after mounted
      lastMsg = this.state.msg.last();
    }
    return (
      <div id='chat-window' className='collapse' ref={chat => this.chatWindow = chat} onClick={this.chatWindowOnClick}
           style={{position: 'fixed', right: '0px', bottom: '0px', width: '380px',
             backgroundColor: '#F6F6F6', border: '1px solid gray', borderRadius: '4px'}}>
        <div id="chat-window-header" style={{display: 'flex', justifyContent: 'space-between', height: FLOAT_WINDOW_HEADER_HEIGHT + 'px'}}>
          <div style={{margin: '4px 8px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
            {lastMsg ? `${lastMsg.get('fromNickname')}: ${lastMsg.get('content')}` : null}
          </div>
          <button onClick={this.toggleChatWindow} className='toggle-window-button'>{downArrow}</button>
        </div>

        <Tabs id='chat-window-body' defaultActiveTabIndex={0} activeTabIdx={this.state.tabIdx} switchTab={this.switchTab} height={CHAT_WINDOW_HEIGHT}>
          <Tab isActive={true} label='Chat' tabIndex={0} >
            <div>
              {/* -10 is for offsetting some padding */}
              <section id="msg-list" ref={msgList => this.msgList = msgList}
                       style={{height: (CHAT_WINDOW_HEIGHT - CHAT_INPUT_BOX_HEIGHT - TAB_LABEL_HEIGHT - 10) + 'px', width: '100%',
                       margin: '0 auto', overflow: 'auto', borderBottom: '1px solid darkgray'}}>
                {
                  this.state.msg.map(m => {
                    if (m.get('sysMsg')) {
                      return (<div key={m.get('msgID')} className='from-system-container'>
                        <h3 className='from-system-msg'>system notice ({new Date(m.get('sentAt')).toTimeString().split(' ')[0]})</h3>
                        <p dangerouslySetInnerHTML={{ __html: m.get('content')}} />
                      </div>)
                    } else{
                      let isMyMsg = m.get('fromID') === this.state.profile.get('id'),
                          msgSenderCls = isMyMsg ? 'my-msg' : 'their-msg',
                          msgContainerCls = isMyMsg ? 'from-me' : 'from-them';
                      return (
                          <div key={m.get('msgID')}>
                            <div className="clear" />
                            <div className={'msg-sender-name ' + msgSenderCls}>{m.get('fromNickname')}</div>
                            <div className={'msg-container ' + msgContainerCls}>
                              <p dangerouslySetInnerHTML={{ __html: m.get('content') }} />
                            </div>
                          </div>
                      )
                    }
                  })
                }
              </section>

              <div id="msg-input-container" style={{height: CHAT_INPUT_BOX_HEIGHT + 'px', width: '100%'}}>
                {!this.state.emojiBox ? null : <EmojiPicker onEmojiClick={this.onEmojiPick} disableDiversityPicker/>}
                <button onClick={this.toggleEmoji} className='button' style={{border: 'none', backgroundColor: '#f6f6f6', marginTop: '8px'}}>{emojiIcon}</button>
                <div>
                  <textarea id='chat-input-box' rows="3" onKeyDown={this.sendMsg} ref={textInput => {this.textInput = textInput}}
                            style={{width: '94%', outline: 'none', resize: 'none', fontSize: '1.5em', backgroundColor: '#fafafa',
                              margin: '8px', border: '1px solid darkgray', borderRadius: '4px'}}
                  />
                </div>
              </div>
            </div>
          </Tab>

          <Tab label={`Members(${this.state.recentMsg.size})`} tabIndex={1}>
            <MemList recentMsg={this.state.recentMsg} myID={this.state.profile.get('id')}/>
          </Tab>

          <Tab label='Contact me' tabIndex={2}>
            <p style={{fontSize:'14px', color: '#757575', lineHeight: '1.7em', margin: '18px 12px'}} dangerouslySetInnerHTML={{ __html: this.state.contactInfo}} />
          </Tab>
        </Tabs>

      </div>
    )
  }
}

export default Chat;

const MemList = props => {
  let me = props.recentMsg.get(props.myID);
  let mySentAt = me.get('sentAt') || '';
  if (mySentAt){
    mySentAt = new Date(mySentAt).toTimeString().split(' ')[0];
  }
  return (
      <div>
        <table id='mem-list' >
          <thead>
          <tr>
            <th>nickname</th>
            <th >recent msg</th>
            <th>sent at</th>
          </tr>
          </thead>
          <tbody>
          {
            <tr>
              <td >{me.get('nickname')}</td>
              <td>{me.get('content')}</td>
              <td>{mySentAt}</td>
            </tr>
          }
          {
              props.recentMsg.entrySeq().map(m => {
                let uID = m[0], msg = m[1];
                if (uID === props.myID) return null;

                let theirSentAt = msg.get('sentAt') || '';
                if (theirSentAt) {
                  theirSentAt = new Date(theirSentAt).toTimeString().split(' ')[0]
                }
                return (
                    <tr key={uID}>
                      <td>{msg.get('nickname')}</td>
                      <td>{msg.get('content')}</td>
                      <td>{theirSentAt}</td>
                    </tr>
                )
              })
          }
          </tbody>
        </table>
      </div>
  )
};
