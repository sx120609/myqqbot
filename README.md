# 高校资料 QQBot

一个面向 NapCat 的自然语言高校资料助手。用户不用记命令，直接在 QQ 里问“安大宿舍怎么样”“西电能点外卖吗”“南航校园网咋样”，机器人会识别学校和主题，从 CollegesChat 问卷资料中检索内容，再调用 OpenAI-compatible API 生成适合 QQ 阅读的回复。

## 功能

- NapCat / OneBot v11 反向 WebSocket 接入。
- 自然语言学校和主题识别，支持“安大”“西电”“南航”等默认别名。
- 同步并解析 CollegesChat `generated` 分支的 `docs/universities/*.md`。
- 可按需同步神人高校网学校画像，补充城市、标签、地址、占地、评分等结构化信息，并缓存变化学校的评论。
- 可按需同步招生数据。掌上高考接口容易限流，新增官方来源通路，江苏第一版支持从江苏省教育考试院官方投档线 PDF 入库院校线。
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

同步江苏省教育考试院官方投档线。默认读取江苏省近三年普通类本科批次平行志愿投档线，并结合当年逐分段表写入最低位次；Bot 回答投档线时会优先使用同年同省同科类位次，分数只作辅助参考。

```bash
cd /opt/myqqbot
sudo npm run sync:jiangsu-official
sudo npm run sync:jiangsu-official -- --query=南京大学
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-jiangsu-official --query=东南大学
```

也可以指定新的江苏省考试院官方页面或 PDF：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-jiangsu-official --year=2025 --subject=物理类 --page-url=https://www.jseea.cn/...
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-jiangsu-official --year=2025 --subject=历史类 --pdf-url=https://www.jseea.cn/...pdf
```

同步已适配江苏高校官网的 2026 江苏招生计划，不请求掌上高考。当前内置来源包含苏州大学、江苏大学、南京理工大学；其中既支持高校官网 HTML 表格，也支持学校官网公开 JSON 接口。

```bash
cd /opt/myqqbot
sudo npm run sync:jiangsu-official-plans
sudo npm run sync:jiangsu-official-plans -- --query=南京理工大学
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-jiangsu-official-plans --query=江苏大学
```

导入 [xuefeng-agent](https://github.com/ziqihe10-droid/xuefeng-agent) 附带的历史投档线 SQLite 缓存。这个数据源主要补 2024-2025 历史分数/位次，导入到独立来源 `xuefeng_agent`，不会请求掌上高考，因此不受 1069 限流影响。首次运行会把 `admission_clean.db.gz` 下载并解压到 `data/xuefeng-agent/`；如果国内服务器下载慢，可以手动传 `--url` 镜像地址，或先下载解压后用 `--db` 指向本地 SQLite。

```bash
cd /opt/myqqbot
sudo npm run sync:xuefeng-agent
sudo npm run sync:xuefeng-agent -- --query=南京大学 --provinces=江苏,浙江 --years=2024,2025
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-xuefeng-agent --limit=50000 --offset=0
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-xuefeng-agent --url=https://gh.lizmt.cn/https://github.com/ziqihe10-droid/xuefeng-agent/raw/main/admission_clean.db.gz
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-xuefeng-agent --db=/opt/myqqbot/data/xuefeng-agent/admission_clean.db
```

WebUI 的“招生数据”页也提供“导入雪峰 Agent 历史库”按钮。注意：该上游仓库采用 AGPLv3 协议，且数据仍应按第三方缓存处理；对外回答会继续提示最终以省考试院和学校招生网为准。

同步一批掌上高考招生数据，默认抓 2026 招生计划汇总和 2023-2025 历史分数线。这个源站容易限流，建议按后台补库方式慢慢跑：每批 1 所学校、请求间隔 180 秒、每批源站请求预算 1 次、跳过已有覆盖。专业招生计划明细请求量更大，默认关闭，需要时加 `--plan-details` 或在 WebUI 打开。

```bash
cd /opt/myqqbot
sudo npm run sync:gaokao-cn -- --limit=1 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
```

也可以用部署脚本直接跑：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --limit=1 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
```

常用筛选和续跑：

```bash
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --query=中国药科大学 --provinces=四川,河南 --limit=1 --max-source-requests=1
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --plans-only --plan-years=2026 --limit=1 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --plans-only --plan-details --plan-years=2026 --limit=1 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --scores-only --score-years=2025,2024,2023 --offset=20 --limit=1 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --plans-only --loop --max-batches=10 --limit=1 --batch-delay-ms=1800000 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --plans-only --limit=1 --request-delay-ms=180000 --max-source-requests=1 --skip-existing
sudo APP_DIR=/opt/myqqbot scripts/deploy.sh sync-gaokao-cn --plans-only --skip-existing --loop --limit=1
```

每批结束会打印 `next offset` 和下一批命令。`--loop` 多批同步默认每批间隔 30 分钟，也可以用 `--batch-delay-ms` 调整。WebUI 的“招生数据”页也可以开启掌上高考定期同步、调整同步年份、省份范围、每批学校数、每轮批次数、批次间隔毫秒、请求间隔毫秒、每批请求预算、限流冷却分钟、是否同步专业计划、跳过已有覆盖、失败重试次数，并查看映射、失败日志和按年份/省份聚合的最大覆盖缺口。长期全站补数据建议开启“跳过已有覆盖”，程序会分别判断计划汇总、专业计划、院校线、专业线是否已有本地数据，已覆盖的接口不再请求源站。每批请求预算默认 1，预算用完会主动暂停当前批次并保留 offset，不算源站错误；下一轮会从同一 offset 继续，并跳过已经入库的接口。普通网络/源站临时错误会按失败重试次数延迟重试，默认第一次等待 30 分钟，之后指数退避；若源站返回 `1069 / 访问太过频繁`，程序会停止当前批次并保留 offset，且不会走失败重试，定时同步、手动同步和 QQ 问答临时补数都会进入共享冷却，默认 1440 分钟。国内机器建议请求间隔保持 180000 毫秒以上，生产环境即使误填更低也会自动抬到 180000 毫秒；每批请求预算低于 1 会自动按 1 处理，不再支持无限请求。需要加速时优先缩小省份、年份或关闭专业计划/专业线，不建议提高每批学校数。

Bot 遇到“近三年分数线、最低位次、专业录取分”等问题时，会优先查询 2023-2025 历史分数，同时补充当前招生计划年份的数据作为报考参考；如果用户明确问招生计划或多校对比，则按用户指定年份范围抓计划。普通实时补数默认只抓计划汇总，专业计划明细只有在用户问到具体专业，或后台打开“定期同步专业计划/同步专业计划”时才会请求，避免无意义地触发掌上高考限流。

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

高校生活资料来自 [CollegesChat/university-information](https://github.com/CollegesChat/university-information) 的问卷生成文档。院校定位可补充 [神人高校网](https://srgaoxiao.cn/) 的公开学校画像缓存，用于城市、标签、校区、占地、建校年份和聚合评分等信息；评论只在定期同步发现变化时缓存，或聊天时由 LLM 判断确实需要后实时拉取当前学校少量评论。招生计划、历年录取分和最低位次可补充 [掌上高考](https://www.gaokao.cn/) 的第三方聚合数据；历史投档线也可以导入 [xuefeng-agent](https://github.com/ziqihe10-droid/xuefeng-agent) 附带的 SQLite 缓存作为第三方历史数据补充。所有神人数据都不用于模型训练。机器人会优先引用问卷资料总结宿舍、食堂、校园网、管理等生活体验。回复会提示“院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考”，不会把问卷内容包装成官方结论，也不会把常识补充伪装成该校确定事实。招生相关回答会提醒最终以省考试院和学校招生网为准。
