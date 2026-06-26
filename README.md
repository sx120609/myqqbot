# 高校资料 QQBot

一个面向 NapCat 的自然语言高校资料助手。用户不用记命令，直接在 QQ 里问“安大宿舍怎么样”“西电能点外卖吗”“南航校园网咋样”，机器人会识别学校和主题，从 CollegesChat 问卷资料中检索内容，再调用 OpenAI-compatible API 生成适合 QQ 阅读的回复。

## 功能

- NapCat / OneBot v11 反向 WebSocket 接入。
- 自然语言学校和主题识别，支持“安大”“西电”“南航”等默认别名。
- 同步并解析 CollegesChat `generated` 分支的 `docs/universities/*.md`。
- 可按需同步神人高校网学校画像，补充城市、标签、地址、占地、评分等结构化信息，并缓存变化学校的评论。
- SQLite 本地索引，包含学校、问题、回答、问卷 ID 和来源链接。
- OpenAI-compatible LLM 客户端，可配置 sub2api 源站、API Key 和模型名。
- 支持 QQ 图片消息，会把图片传给支持视觉能力的模型进行回复。
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

如果 NapCat 反向 WebSocket 看起来还连着，但 QQ 实际掉登录了，可以在 WebUI 仪表盘的“NapCat 运维”里配置 NapCat 启动器地址和 WebUI Key。启动器默认地址通常是 `http://127.0.0.1:6099`，MyQQBot 后端会按 NapCat WebUI 的登录流程用 key 换取临时 Credential，然后调用 `/api/QQLogin/CheckLoginStatus` 判断 QQ 是否真的在线，调用 `/api/QQLogin/RestartNapCat` 触发启动器重启。重启完成后可直接打开扫码页重新登录。若没有使用启动器，也可以填写兜底重启命令，例如 `systemctl restart napcat`、`docker restart napcat` 或 `pm2 restart napcat`。

## Linux 部署

服务器需要 Node.js 24+、git、npm 和 systemd。脚本默认使用 `https://gh.lizmt.cn/CollegesChat/university-information.git` 同步高校数据，适合国内服务器。克隆仓库后运行：

```bash
chmod +x scripts/deploy.sh
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh install
```

脚本会安装依赖、同步高校数据、构建 WebUI、创建 systemd 服务并启动。默认服务名是 `myqqbot`，默认端口是 `8787`。

以后更新程序直接运行：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh update
```

`update` 默认只更新程序代码、依赖、构建产物并重启服务，不会重新同步 3000 多份高校数据。需要连数据一起同步时再显式开启：

```bash
sudo APP_DIR=/opt/myqqbot SYNC_DATA_ON_UPDATE=1 scripts/deploy.sh update
```

如果已经在 `/opt/myqqbot` 目录内，也可以：

```bash
sudo ./scripts/deploy.sh update
```

常用参数：

```bash
sudo SERVICE_NAME=myqqbot APP_DIR=/opt/myqqbot APP_PORT=8787 scripts/deploy.sh install
sudo NODE_BIN=/usr/local/bin/node APP_DIR=/opt/myqqbot scripts/deploy.sh install
sudo APP_DIR=/opt/myqqbot SKIP_DATA_SYNC=1 scripts/deploy.sh update
sudo APP_DIR=/opt/myqqbot SKIP_SYSTEMD=1 scripts/deploy.sh update
```

高校数据不会在普通 `update` 时重复拉取。手动同步：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync
```

同步脚本会检查 CollegesChat 数据 commit，如果没变化会直接跳过解析和入库。需要强制重建索引时：

```bash
sudo APP_DIR=/opt/myqqbot FORCE_DATA_SYNC=1 scripts/deploy.sh sync
```

同步一批神人高校网学校画像：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-srgaoxiao
```

第一次部署后可以全量同步一次神人高校网学校画像。它使用分页列表接口拉取学校基础档案并按学校名写入本地缓存；如果发现某校评论数变化，或本地还没有该校评论缓存，会刷新该校评论缓存：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-srgaoxiao-full
```

只同步某个学校或控制数量：

```bash
cd /opt/myqqbot
sudo SRGAOXIAO_SYNC_QUERY='中国药科大学' SRGAOXIAO_SYNC_LIMIT=1 npm run sync:srgaoxiao
sudo SRGAOXIAO_SYNC_LIMIT=50 npm run sync:srgaoxiao
sudo SRGAOXIAO_SYNC_ALL=1 SRGAOXIAO_PAGE_SIZE=100 SRGAOXIAO_REVIEW_MAX_PAGES=20 npm run sync:srgaoxiao
```

WebUI 的“高校数据”页可以直接开启和调整应用内自动同步，包括 CollegesChat 主数据同步间隔、神人高校全站画像同步间隔、评论每校最多页数。应用内自动同步设置保存在 SQLite 中，不需要 root 权限。

当前产品主线只做院校介绍和校园生活资料，不再默认处理分数线、位次、招生计划、专业组和志愿冲稳保问题。机器人仍保留“雪峰 Agent”式分析方法：先给院校定位和明确结论，再讲专业倾向、城市、生活体验、适合人群和风险点。仓库里保留了早期招生数据相关脚本和表结构，作为历史实验能力封存，不作为 QQBot 默认问答入口。

如需定期更新高校数据，可启用 systemd 定时器，默认每天 `03:40` 附近执行一次：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh enable-sync-timer
systemctl list-timers | grep myqqbot
```

修改时间：

```bash
sudo APP_DIR=/opt/myqqbot SYNC_TIMER_CALENDAR='04:30' scripts/deploy.sh enable-sync-timer
```

关闭定时同步：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh disable-sync-timer
```

如需定期更新神人高校画像，可启用独立 systemd 定时器，默认每天 `04:20` 附近全站扫描一次学校画像，并在评论数变化时刷新该校评论缓存：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh enable-srgaoxiao-timer
systemctl list-timers | grep srgaoxiao
```

修改时间或评论页数上限：

```bash
sudo APP_DIR=/opt/myqqbot SRGAOXIAO_TIMER_CALENDAR='04:20' SRGAOXIAO_TIMER_REVIEW_MAX_PAGES=20 scripts/deploy.sh enable-srgaoxiao-timer
```

关闭画像定时同步：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh disable-srgaoxiao-timer
```

如果你的服务器已经生成过旧 `.env`，更新脚本会把默认 GitHub 数据源自动迁移到 `gh.lizmt.cn` 镜像。也可以手动确认：

```bash
grep DATA_REPO_URL /opt/myqqbot/.env
```

部署后编辑：

```bash
sudo nano /opt/myqqbot/.env
sudo systemctl restart myqqbot
```

查看运行状态：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh status
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh logs
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh restart
```

## 模型配置

`.env` 或 WebUI 中都可以设置：

```env
LLM_BASE_URL=https://你的-sub2api站/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=gpt-5.5
```

模型名不写死，只要你的源站兼容 `/v1/chat/completions` 即可。

QQ 回复图片顶部文案可在 WebUI 的“自然语言设置”里修改，也可以通过 `.env` 设置：

```env
ONEBOT_REPLY_IMAGE_TITLE=高校资料助手
ONEBOT_REPLY_IMAGE_BADGE=AI 生成回复
```

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

高校生活资料来自 [CollegesChat/university-information](https://github.com/CollegesChat/university-information) 的问卷生成文档。院校定位可补充 [神人高校网](https://srgaoxiao.cn/) 的公开学校画像缓存，用于城市、标签、校区、占地、建校年份和聚合评分等信息；评论只在定期同步发现变化时缓存，或聊天时由 LLM 判断确实需要后实时拉取当前学校少量评论。所有神人数据都不用于模型训练。机器人会优先引用问卷资料总结宿舍、食堂、校园网、管理等生活体验。回复会提示“院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考”，不会把问卷内容包装成官方结论，也不会把常识补充伪装成该校确定事实。
