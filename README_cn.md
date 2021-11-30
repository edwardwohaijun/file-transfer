# 简介
简单, 易用的文件传输平台(支持P2P高速传输超大文件). 后端使用Golang, 前端React.

# 特点
* P2P文件传输功能使用 [simple-filer](https://github.com/edwardwohaijun/simple-filer/)(一个JavaScript库), 这也是本人写的一个webRTC工具 :smiley:
* 所有在线用户都能看到文件上传进度.
* 过了失效期后, 页面上的文件自动删除.

# 如何使用
该应用已经部署在我的个人网站上[https://ewo.xyz/transfer](https://ewo.xyz/transfer).
你可以前往体验一下(会被跳转到另外一个URL, 类似于: `https://ewo.xyz/transfer/pdhwhwdwny84x1qvzig3xg0z`)

在新页面上, 你最多允许上传4个文件(每个最大5M), 你只需将该页面地址发给你的好友即可.
你无需等待文件上传完毕后, 再发URL, 你的好友和你一样, 都能实时看到文件的上传进度.
每个页面20分钟后自动失效, 此时URL也不存在, 所有页面上的文件自动被删除.

由于这是个个人网站, 带宽和磁盘空间都有限, 上传/下载的速度不会太快.
但, 如果你和你的好友同时在线, 你们可以体验一下P2P传输(只支持Chrome浏览器), 文件数据不经过服务器, 而是直接在2个浏览器之间传输.
此时, 传输的文件个数和大小没有限制, 只要接受方硬盘足够大, 10G也可以传.
但, P2P连接并非100%的情况下都能建立, 只要一方位于比较严格的防火墙背后, 连接就会失败.

这是演示效果图:

![running screesnshot](https://raw.githubusercontent.com/edwardwohaijun/file-transfer/master/screenshot.gif)

# 安装的前提条件
* Go(>= 1.9.2)
* MongoDB(>= 3.2)
* P2P传输功能必须使用Chrome 浏览器
* NodeJS(>=6.5) 用于客户端JavaScript文件打包

# 编译
```bash
go get github.com/edwardwohaijun/file-transfer/cmd/filetransferd
cd $GOPATH/src/github.com/edwardwohaijun/file-transfer/
go build -o filetransferd cmd/filetransferd/main.go # 当前目录下生成`filetransferd`可执行文件

cd web
npm install
npm run build (用于开发环境)
npm run ship (用于生产环境)
cd ..
```

# 部署
一旦编译和打包成功后, 直接执行`./filetransferd`, 打开Chrome浏览器, 访问 http://127.0.0.1:9090/ 即可, 虽然有10几个参数, 但都有默认值. 如果希望作为后台进程长期运行, 则:
* 使用supervisord实现开机自启动(内容尚未准备好)
* 手动: 将编译后的可执行文件 `filetransferd` 和 `web/` 目录(打包后的静态JavaScript和CSS文件所在目录, 但只有用到其内的 `public` 这个子目录), 挪到你认为合适的地方.
如`filetransferd`移动到`/opt/filetransferd`, `web/`目录挪到 `/var/www/filetransfer/`下.

此时执行`filetransfer的`的时候, `web`目录的绝对路径需要作为参数`-webRoot`传递, 如:
```bash
filetransferd -webRoot /var/www/filetransfer/web
```
# 命令行参数(大小写敏感)
* `serverPort` 端口号, 默认是 `9090`.
* `mgoHost` mongoDB 主机IP和端口号, 默认是 `127.0.0.1:27017`.
* `mgoUsername` mongoDB 用户名, 默认是空.
* `mgoPassword` mongoDB 密码, 默认是空.
* `mgoDBName` mongoDB 数据库名, 默认是 `filetransfer`.
* `mgoCollectionName` mongoDB collection 名称, 默认是 `files`.
* `maxUpload` 一个页面最多允许上传的文件个数, 默认是 5.
* `maxFileSize` 单个文件允许的大小, 默认是 20M, 只接受`M`, `m` 作为文件大小单位, `10m`, `20M` 都是合法的.
* `duration` 页面有效期, 默认是 30m(分钟), 允许的时间单位是 m(分钟), h(小时), d(天).
* `urlRootPath` 紧随域名(或IP)后面的路径, 如: http://www.example.com/transfer, 中的 `transfer` 部分, 默认是空.
* `webRoot` 存放打包后的静态JavaScript和CSS文件的所在路径, 默认是当前目录下的 `web`.
* `uploadDir` 文件上传后所存放的目录, 默认是当前目录下的 `upload`.
* `webrtcConfig` 用于给客户端建立P2P连接时所需的`iceServer`列表, 必须以JSON string格式传递, 默认是空.

示例(参数是大小写敏感):
```bash
./filetransferd -serverPort 9090 -maxUpload 5 -maxFileSize 20M -duration 30m -urlRootPath abc/xyz/ -webRoot ./web -uploadDir ./upload
-webrtcConfig '{"iceServers":[{"urls":"stun:stun.l.google.com:19302"},{"urls":"stun:global.stun.twilio.com:3478?transport=udp"}]}'
```
打开Chrome, 进入 http://127.0.0.1:9090/abc/xyz, 如果想体验P2P传输, 打开多个tabs页即可.
你可以运行多个实例, 只需赋予不同的端口号即可. 不同的实例可以有不同的文件上传路径, 页面失效期, 最多上传文件个数.

如果你的运行环境中有Nginx(>= 1.7.11)在前端作为reverse proxy server, 你可以让Nginx来处理静态JavaScript文件以获取更好的性能.
将 `web/public` 目录挪到 Nginx 可以访问的地方, 如: `/var/www/filetransfer/`下, 并且修改Nginx的配置文件, 如:
```
# in server block
location /abc/xyz/public {
    alias /var/www/filetransfer/web/public/;
}
location /abc/xyz {
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

同时, 不要忘记在http(or server or location) directive中添加如下规则. 默认,nginx只允许1M的文件上传.
```
client_max_body_size 5M;
```


# License

This project is licensed under the [MIT License](/LICENSE).
