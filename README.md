# 智能语音助手

一个基于WebSocket的实时语音对话系统，集成了语音识别、大语言模型和语音合成功能。

![GitHub stars](https://img.shields.io/github/stars/chicogong/conversational-agents?style=social)
![GitHub forks](https://img.shields.io/github/forks/chicogong/conversational-agents?style=social)
![License](https://img.shields.io/github/license/chicogong/conversational-agents)

## ✨ 功能特点

- 🎤 实时语音识别：支持连续语音识别，自动断句
- 🤖 智能对话：集成大语言模型，提供智能对话能力
- 🔊 语音合成：将AI回复转换为自然语音
- 🚀 实时交互：支持打断和实时响应
- 🎨 美观界面：现代化的聊天界面设计
- 📱 响应式设计：适配不同设备屏幕

## 🛠️ 技术栈

- 前端：HTML5, CSS3, JavaScript, WebSocket, Web Audio API
- 后端：Node.js, Express
- 语音识别：Azure Speech Service
- 大语言模型：OpenAI API
- 语音合成：Azure Text-to-Speech

## 📦 安装与配置

### 环境要求

- Node.js 16+
- npm 或 yarn
- Azure Speech Service 订阅
- OpenAI API 密钥

### 安装步骤

1. 克隆仓库：
```bash
git clone https://github.com/chicogong/conversational-agens.git
cd conversational-agent
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
创建 `.env` 文件并添加以下配置：
```env
# Azure Speech Service
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=your_azure_region

# OpenAI
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=your_openai_base_url
OPENAI_MODEL=gpt-3.5-turbo
```

4. 启动服务：
```bash
npm start
```

5. 访问应用：
打开浏览器访问 `http://localhost:8080`

## 🔌 协议设计

### WebSocket 消息格式

#### 客户端到服务器
```json
{
  "type": "audio",
  "data": "Base64编码的音频数据"
}
```

#### 服务器到客户端
```json
// 语音识别结果
{
  "type": "transcription",
  "text": "识别的文本内容"
}

// LLM响应
{
  "type": "llmResponse",
  "text": "AI回复内容"
}

// TTS音频数据
{
  "type": "audioData",
  "data": "Base64编码的音频数据"
}

// 中断信号
{
  "type": "interrupt"
}

// 错误信息
{
  "type": "error",
  "message": "错误描述"
}
```

### 性能指标

- ASR延迟：< 300ms
- LLM首token延迟：< 300ms
- TTS首帧延迟：< 300ms
- 端到端延迟：< 1000ms

## 🚀 扩展功能

### 1. 多语言支持
- 支持多种语言的语音识别和合成
- 自动检测用户语言
- 跨语言对话能力

### 2. 上下文管理
- 对话历史记录
- 上下文感知
- 个性化对话风格

### 3. 高级功能
- 情感识别
- 语音情感合成
- 多轮对话优化
- 知识库集成

## 📅 后续计划

### 短期计划
- [ ] 添加对话历史记录
- [ ] 添加错误重试机制
- [ ] 接入更多LLM提供商
- [ ] 接入更多TTS（Minimax等）提供商
- [ ] 增加协议的扩展性
- [ ] 接入MCP扩展工具调用
- [ ] 接入A2A协议实现多Agent等
- [ ] 优化打断速度
- [ ] 增加Agent状态、会话状态回调

### 中期计划
- [ ] 添加语音情感识别
- [ ] 添加用户认证系统
- [ ] 接入更多的ASR
- [ ] 接入嵌入式设备ESP32
- [ ] 优化语音识别准确率
- [ ] 支持多语言识别、切换

### 长期计划
- [ ] 支持自定义语音模型
- [ ] 实现多模态交互
- [ ] 构建知识图谱
- [ ] 开发移动端应用

## 🤝 贡献指南

欢迎提交 Pull Request 或创建 Issue！

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [Azure Speech Service](https://azure.microsoft.com/services/cognitive-services/speech-services/)
- [OpenAI](https://openai.com/)

## 📞 联系方式

- 项目维护者：[chicogong](https://github.com/chicogong)
- 邮箱：chicogong@tencent.com

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/chicogong">chicogong</a></sub>
</div> 