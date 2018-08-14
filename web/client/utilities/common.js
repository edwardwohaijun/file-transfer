export function randomNumber(min, max){
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

function makeStr(len) {
  len = len || 12; // 12 characters long by default
  let text = "";
  let possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < len; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
function dec2hex (dec) {
  return ('0' + dec.toString(16)).substr(-2)
}
export function randomString(len){
  let arr = new Uint8Array((len || 12) / 2); // 12 characters long by default
  if (window.crypto){
    window.crypto.getRandomValues(arr);
    return Array.from(arr, dec2hex).join('')
  } else {
    return makeStr(len)
  }
}

export function getReadableFileSizeString(fileSizeInBytes) {
  let i = -1;
  let byteUnits = [' kB', ' MB', ' GB', ' TB', 'PB', 'EB', 'ZB', 'YB'];
  do {
    fileSizeInBytes = fileSizeInBytes / 1024;
    i++;
  } while (fileSizeInBytes > 1024);
  return Math.max(fileSizeInBytes, 0.1).toFixed(1) + byteUnits[i];
}

// credit: https://stackoverflow.com/questions/13903897/javascript-return-number-of-days-hours-minutes-seconds-between-two-dates
let unit =  ['year',   'month', 'week', 'day', 'hour', 'minute', 'second'];
let value = [ 31536000, 2592000, 604800, 86400, 3600,   60,       1];
export function getReadableTimeDuration(totalMilliseconds) {
  let totalSeconds = Math.round( totalMilliseconds / 1000 );
  let result = [];
  let resultStr = "";

  for (let i = 0; i < value.length; i++) {
    result[i] = Math.floor(totalSeconds / value[i]);
    totalSeconds -= result[i] * value[i];

    if (totalSeconds < 0){
      return {array: [0, 0, 0, 0, 0, 0, 0], string: "BOOM"}
    }

    if (result[i] !== 0) {
      resultStr += result[i] + " " + unit[i] + " "
    }
  }
  return { array: result, string: resultStr }
}
