import log4js from 'log4js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '../logs');

// 创建日志目录（如果不存在）
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err) {
  console.error('创建日志目录失败:', err);
}

// 简化的log4js配置
log4js.configure({
  appenders: {
    console: { type: 'console' },
    file: { 
      type: 'dateFile', 
      filename: path.join(logsDir, 'app.log'),
      pattern: '.yyyy-MM-dd',
      compress: true,
      maxLogSize: 10485760
    }
  },
  categories: {
    default: { appenders: ['console', 'file'], level: 'debug' }
  }
});

// 简单的日志记录器
const logger = log4js.getLogger();

// 添加关闭方法
logger.shutdown = () => {
  return new Promise((resolve) => {
    log4js.shutdown(() => {
      resolve();
    });
  });
};

export default logger; 