let MySocket = (function(){
  let paths = location.pathname.split("/");
    if (paths[paths.length - 1] === "") {
    paths.length = paths.length - 1 // in case the last part is empty
  }

  let pageId = paths[paths.length - 1];
  paths.length = paths.length - 1; // remove the last part(pageId),
  let protocol = location.protocol === "https:" ? "wss://" : "ws://";
  let wsURL = protocol + location.host + paths.join("/") + "/ws?pageId=" + pageId;
  let socket = null;
  function createSocket(){
    socket = new WebSocket(wsURL);
    return socket;
  }

  return {
    getSocket: function(){
      if (!socket) {socket = createSocket();} // todo: what if creation failed, need to notify caller
      return socket;
    }
  };
})();

export default MySocket;
