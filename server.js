import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { handleConnection } from './services/wsHandler.js';
import logger from './services/logger.js';

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

// 优雅关闭
process.on('SIGINT', async () => {
  logger.info('接收到中断信号，正在关闭服务...');
  await logger.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('接收到终止信号，正在关闭服务...');
  await logger.shutdown();
  process.exit(0);
});

// 启动服务器
server.listen(config.server.port, config.server.host, () => {
  logger.info(`服务器运行在 http://${config.server.host}:${config.server.port}`);
  logger.info('WebSocket服务已启用在同一端口');
  logger.info('Azure语音识别服务已启用');
  logger.info(`使用的区域: ${config.speech.region}`);
});