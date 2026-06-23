# 高校资料 QQBot

一个面向 NapCat 的自然语言高校资料助手。用户不用记命令，直接在 QQ 里问“安大宿舍怎么样”“西电能点外卖吗”“南航校园网咋样”，机器人会识别学校和主题，从 CollegesChat 问卷资料中检索内容，再调用 OpenAI-compatible API 生成适合 QQ 阅读的回复。

## 功能

- NapCat / OneBot v11 反向 WebSocket 接入。
- 自然语言学校和主题识别，支持“安大”“西电”“南航”等默认别名。
- 同步并解析 CollegesChat `generated` 分支的 `docs/universities/*.md`。
- SQLite 本地索引，包含学校、问题、回答、问卷 ID 和来源链接。
- OpenAI-compatible LLM 客户端，可配置 sub2api 源站、API Key 和模型名。
- WebUI 管理后台：仪表盘、模型配置、自然语言策略、数据同步、别名、调试台、日志。

## 快速开始

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run sync:data
npm.cmd run build
npm.cmd start
```

默认 WebUI 地址：

```text
http://127.0.0.1:8787
```

NapCat 反向 WebSocket 地址：

```text
ws://127.0.0.1:8787/onebot/v11/ws
```

在 NapCat WebUI 里进入网络配置，新建 WebSocket 客户端，填入上面的地址即可。如果设置了 `ONEBOT_ACCESS_TOKEN`，NapCat 侧也需要配置相同 token。

## Linux 部署

服务器需要 Node.js 24+、git、npm 和 systemd。克隆仓库后运行：

```bash
chmod +x scripts/deploy.sh
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh
```

脚本会安装依赖、同步高校数据、构建 WebUI、创建 systemd 服务并启动。默认服务名是 `myqqbot`，默认端口是 `8787`。

常用参数：

```bash
sudo SERVICE_NAME=myqqbot APP_DIR=/opt/myqqbot APP_PORT=8787 scripts/deploy.sh
sudo NODE_BIN=/usr/local/bin/node APP_DIR=/opt/myqqbot scripts/deploy.sh
sudo SKIP_DATA_SYNC=1 scripts/deploy.sh
sudo SKIP_SYSTEMD=1 scripts/deploy.sh
```

部署后编辑：

```bash
sudo nano /opt/myqqbot/.env
sudo systemctl restart myqqbot
```

查看运行状态：

```bash
systemctl status myqqbot
journalctl -u myqqbot -f
```

## 模型配置

`.env` 或 WebUI 中都可以设置：

```env
LLM_BASE_URL=https://你的-sub2api站/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=gpt-5.5
```

模型名不写死，只要你的源站兼容 `/v1/chat/completions` 即可。

## 开发

```powershell
npm.cmd run dev:server
npm.cmd run dev:web
```

开发时 Vite 会把 `/api` 和 `/onebot` 代理到后端。

## 验证

```powershell
npm.cmd test
npm.cmd run build
```

## 数据来源与提示

高校资料来自 [CollegesChat/university-information](https://github.com/CollegesChat/university-information) 的问卷生成文档。机器人回复会提示“数据来自 CollegesChat 问卷，仅供参考”，不会把问卷内容包装成官方结论。
