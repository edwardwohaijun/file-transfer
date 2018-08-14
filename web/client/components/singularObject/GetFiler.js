let Filer = require('simple-filer');

let MyFiler = (function(){
  let filer = null;
  function createFiler(){
    filer = new Filer({});
    return filer;
  }

  return {
    getFiler: function(){
      if (!filer) {filer = createFiler();}
      return filer;
    }
  };
})();

export default MyFiler;
