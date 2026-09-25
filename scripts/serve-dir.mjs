// Serves a folder over http on 127.0.0.1 (the Mac CI test's update feed).
//   node scripts/serve-dir.mjs <dir> <port>
import http from 'http'
import fs from 'fs'
import path from 'path'

const dir = path.resolve(process.argv[2] || '.')
const port = Number(process.argv[3] || 8765)
http
  .createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, '127.0.0.1', () => console.log('serving', dir, 'on', port))
