# Introduction
A simple file transfer web app with support of P2P. Backend is written in Golang, frontend with React.

# Features
* P2P file transfer is implemented using [simple-filer](https://github.com/edwardwohaijun/simple-filer/), a webRTC tool also written by me :smiley:
* upload progress is broadcast to all online users
* page and all its files are auto expired and deleted after specified duration

Here is a running screenshot:

![running screesnshot](https://raw.githubusercontent.com/edwardwohaijun/file-transfer/master/screenshot.gif)

# Prerequisites
* Go(>= 1.9.2)
* MongoDB(>= 3.2)
* Chrome browser for P2P file transfer

# Build
```bash
mkdir $GOPATH/src/github.com/edwardwohaijun
cd $GOPATH/src/github.com/edwardwohaijun
git clone https://github.com/edwardwohaijun/file-transfer
cd file-transfer
go build -o filetransferd cmd/filetransferd/main.go

cd web
npm run install
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

# License

This project is licensed under the [MIT License](/LICENSE).
