import axios from 'axios';
const CancelToken = axios.CancelToken;

function UploadManager(fileIdFieldName, filesForUploadFieldName){
  this.fileIdFieldName = fileIdFieldName; // backend uses multipart.Reader to process upload request, each request(multipart/form-data encoded) contains 2 fields: "fileId" and "filesForUpload"
  this.filesForUploadFieldName = filesForUploadFieldName; // client-side need these 2 field's name and their values to compose a formData

  this.queue = []; // uploading task is composed of many sequential file uploading, each task is pushed into queue array, and is also being processed sequentially.
  this.removeList = {}; // fileId as key, isRemoved(boolean) as value. Each Promise task consult this value before proceed. Set would be a better option.
  this.uploading = false; // todo: remove this field, use the below uploadingField is enough, check its id for null
  this.uploadingFileId = {}; //save the fileId and the associated cancel function of current uploading file
}

//UploadManager.prototype = new EventEmitter(); // just emit error, like badRequest of upload req, then caller(fileList component) could show the result on page.
UploadManager.prototype.constructor = UploadManager;
UploadManager.prototype.removeTaskItem = function(fileId){
  this.removeList[fileId] = true;
  if (this.uploadingFileId.id === fileId) {
    this.uploadingFileId.cancel("canceling the uploading job")
  }
};

UploadManager.prototype.addTask = function(task) {
  let promiseTask = task.map(t => { // one token one request, if all request share the same token, upon a request canceled, all remaining requests are rejected.
    let {token, cancel} = CancelToken.source();
    let config = {
      headers: {'Content-Type': 'multipart/form-data'},
      cancelToken: token
    };
    let formData = new FormData();
    formData.append(this.fileIdFieldName, t.id); // order matters for this 2 append operations
    formData.append(this.filesForUploadFieldName, t.file);
    return () => {
      if (this.removeList[t.id]) { // once Array.reduce is running, no way to stop/skip/remove one item, use this trick to skip the current task if removed by users
        this.uploadingFileId = {};
        return Promise.resolve() // one upload item removed, let the remaining upload continue
      }
      this.uploadingFileId = {id: t.id, cancel: cancel};
      return axios.post(location.pathname, formData, config)
          .catch(err => {
            console.log("err: ", err);
            if (axios.isCancel(err)) {
              console.log("request canceled, ", err.message)
            }
            this.uploadingFileId = {};
            console.log("err uploading file(id/name): (", t.id, "/", t.file.name, "), ", err);
            return Promise.resolve() // one failed upload shouldn't break the promise chain
          })
    }
  });

  promiseTask.push(() => { // this function has to be pushed to the end of promise task to signal the ending of current task.
    this.uploading = false;
    this.uploadingFileId = {};
    this.run()
  });

  this.queue.push(promiseTask);
  this.run()
};

UploadManager.prototype.run = function() {
  if (this.uploading || this.queue.length === 0) {
    return
  }
  // todo: clear this.removeList. when can I clear this list?

  this.uploading = true;
  let task = this.queue.shift();
  task.reduce((p, fn) => p.then(fn), Promise.resolve());
  // you can't put the following 2 lines here, the item in promiseTask array is asynchronous call, the following line would run immediately
  // you should instead wrap them in a function and push to the promiseTask as the last item.
  //this.uploading = false;
  //this.run()
};

export default UploadManager
