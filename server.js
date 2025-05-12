import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { handleConnection } from './services/wsHandler.js';

// 设置目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express和WebSocket设置
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 处理WebSocket连接
wss.on('connection', handleConnection);

// 启动服务器
server.listen(config.server.port, config.server.host, () => {
  console.log(`[服务器] 服务器运行在 http://${config.server.host}:${config.server.port}`);
  console.log('[服务器] WebSocket服务已启用在同一端口');
  console.log('[服务器] Azure语音识别服务已启用');
  console.log('[服务器] 使用的区域:', config.speech.region);
});