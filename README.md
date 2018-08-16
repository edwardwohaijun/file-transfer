# Introduction
A simple file transfer web app with support of P2P. Backend is written in Golang, frontend with React.

# Features
* P2P file transfer is implemented using [simple-filer](https://github.com/edwardwohaijun/simple-filer/), a webRTC tool also written by me :smiley:
* upload progress is broadcast to all online users
* page and all its files are auto expired and deleted after specified duration

# How to use
I have deployed this app on my server, please go to
[https://worksphere.cn/transfer](https://worksphere.cn/transfer).
You'll be redirected to another page with the URL like this: `https://worksphere.cn/transfer/pdhwhwdwny84x1qvzig3xg0z`

On this page, you can upload 4 files at most(each file 5M at most), send the page URL to your friends.
You don't need to wait for the upload to finish, then send the URL. Your friends will see the upload progress as you do.
Each page will expire after 20 minutes, after that, all files are removed, and the page URL is no longer valid.

This is a personal site with limited network bandwidth and storage, don't expect too much from the server performance.
However, if you and your friends are both online at he same time, you can try the P2P transfer(Chrome browser only) which copy the file between your browsers without going through server.
The number of files and file size you can transfer in P2P mode is only limited by your computer hard drive.
But P2P connection is not guaranteed to work 100%.

Here is a running screenshot:

![running screesnshot](https://raw.githubusercontent.com/edwardwohaijun/file-transfer/master/screenshot.gif)

# Prerequisites
* Go(>= 1.9.2)
* MongoDB(>= 3.2)
* Chrome browser for P2P file transfer
* NodeJS(>=6.5) for client side JavaScript bundling

# Build
```bash
go get github.com/edwardwohaijun/file-transfer/cmd/filetransferd
cd $GOPATH/src/github.com/edwardwohaijun/file-transfer/
go build -o filetransferd cmd/filetransferd/main.go

cd web
npm install
npm run build (for development environment)
npm run ship (for production environment)
```

# Deployment
* use supervisord: consult init/filetransferd.conf
* manually: just move the `filetransferd` binary and `web/` directory(only `public` subdirectory is needed) to wherever you seem fit.

The absolute `web` directory need to be passed as `-webRoot` argument when run the binary, for example:
```bash
filetransferd -webRoot /var/www/filetransferd/web
```
# command arguments(case matters)
* `serverPort` default is `9090`.
* `mgoHost` mongoDB host IP and port, default is `127.0.0.1:27017`.
* `mgoUsername` mongoDB username, default is empty.
* `mgoPassword` mongoDB password, default is empty.
* `mgoDBName` mongoDB database name, default is `filetransfer`.
* `mgoCollectionName` mongoDB collection name, default is `files`.
* `maxUpload` the maximum allowed number of upload files, default is 5.
* `maxFileSize` the maximum allowed single filesize, default is 20M, only allowed unit is `megabyte`, `10m`, `20M` are all valid.
* `duration` how long uploaded files exist on server, default is 30m, allowed units are: m(minute), h(hour), d(day).
* `urlRootPath` the path following your domain(or IP), for example: `transfer` in http://www.example.com/transfer, default is empty.
* `webRoot` the directory to serve web static files, default is `web` in current working directory.
* `uploadDir` the directory to save the uploaded files, default is `upload`, relative directory is assumed to be inside current working directory.
* `webrtcConfig` the iceServer list to help both parties make P2P connection, you need to pass the argument in quoted JSON string, default is empty.

Examples:
```bash
filetransferd -serverPort 9090 -maxUpload 5 -maxFileSize 20M -duration 30m -urlRootPath abc/xyz/ -webRoot ./web -uploadDir ./upload
-webrtcConfig '{"iceServers":[{"urls":"stun:stun.l.google.com:19302"},{"urls":"stun:global.stun.twilio.com:3478?transport=udp"}]}'
```
You can run multiple app instances, but they must at least have different `serverPort` and `urlRootPath`.
Go to http://127.0.0.1:9090/, if you want to experience the P2P file transfer, open 2 tabs.

If you have Nginx(>= 1.7.11) running in front, let it handle the `webRoot` directory for better performance.
Copy the `web/public` folder to where Nginx can access (like `/var/www/webApp/transfer/`), and edit Nginx config file, like the following:
```
# in server block
location /transfer/public {
    alias /var/www/webApp/transfer/web/public/;
}
location /transfer {
    proxy_pass http://127.0.0.1:9090;
    proxy_request_buffering off;
    proxy_redirect off;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded_Proto $scheme;
}
```

The P2P feature works pretty well in small office and local network, you can adjust the `maxUpload`, `maxFileSize` to meet your needs.
It only takes you less than 2 minutes to `go get` the code, build, deploy the web app, :stuck_out_tongue_winking_eye:.

# License

This project is licensed under the [MIT License](/LICENSE).
