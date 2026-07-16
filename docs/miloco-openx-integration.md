# Miloco × OpenX 接入指南



OpenX 使用**内置 Pi Agent** 控制 Miloco，无需 Cursor 或 OpenClaw。

**启用**：在 `~/.openx/.env` 设置 `OPENX_MILOCO=1` 后重启 server（`scripts/setup-miloco-integration.mjs` 会自动写入）。未设置时集成默认关闭。

## 架构

### 主动控制（OpenX → Miloco）

```
用户 → OpenX Goal (pi) → Miloco Skills → WSL miloco-cli → Miloco Backend (:1810)
                ↘ OXSP 拓展槽 → Miloco Dashboard
```

### 主动事件（Miloco → OpenX）

```
摄像头/感知引擎 → Miloco AgentDispatcher → POST /api/miloco/webhook
       → OpenX IntegrationRun（自动化）→ 可选升级 Goal（需确认时）
       → 默认 HTTP 202 + runId；get_trace 查询；wait=true 可同步等待
```

Layer B 诊断为**后台缓存**：`GET /api/miloco/layer-b` 立即返回；`POST /api/miloco/layer-b/refresh` 触发重探测。



## 前置条件



1. **OpenX** 已安装并运行：`pnpm dev`（API `http://127.0.0.1:3921`）

2. **WSL Ubuntu** 中已安装 Miloco：

   ```bash

   miloco-cli service start

   miloco-cli config set model.omni.api_key sk-xxx

   miloco-cli account bind

   ```

3. **Miloco 源码** 在 `d:\Miloco`（或设置 `OPENX_MILOCO_SKILLS_SRC`）



## 一键接入



```bash

# 确保 OpenX server 已启动

node scripts/setup-miloco-integration.mjs



# 强制重新同步 Skills + 添加 Dashboard 卡片

node scripts/setup-miloco-integration.mjs --force --add-card



# 同步后配置 WSL Miloco 回调 OpenX webhook

node scripts/setup-miloco-integration.mjs --connect-wsl

```



## Windows 侧调用 Miloco



Pi 通过包装脚本调用 WSL 中的 `miloco-cli`：



```powershell

.\scripts\miloco-wsl.ps1 device list

.\scripts\miloco-wsl.ps1 service status

.\scripts\miloco-wsl.ps1 device control <did> on true

```



## 启用 Skills（含主动闭环）



| Skill | 用途 |

|-------|------|

| `miloco-devices` | 设备查询与控制 |

| `miloco-miot-scope` | 感知范围管理 |

| `miloco-miot-admin` | 服务状态与运维 |

| `miloco-notify` | 主动通知（TTS / IM / 推送） |

| `miloco-perception` | 感知上下文查询 |

### 批次三 Skills（家庭档案 / 巡检 / 习惯）

| Skill | 用途 |
|-------|------|
| `miloco-home-profile` | 家庭档案直写与管理 |
| `miloco-perception-digest` | 感知日志摘要（cron） |
| `miloco-home-patrol` | 家庭巡检（cron） |
| `miloco-home-observe` / `promote` / `prune` | home-dreaming 三步（cron） |
| `miloco-habit-suggest` | 习惯洞察 → 推荐建任务 |

共 **16** 个 Skills 同步安装（`MILOCO_SYNC_SKILL_IDS`）。家庭 Cron 需 `OPENX_MILOCO_HOME_CRON_WATCH=1`。

### 批次二 Skills

| Skill | 用途 |
|-------|------|
| `miloco-create-task` | 创建/管理 rule、schedule、record 任务 |
| `miloco-terminate-task` | 终止任务 |
| `miloco-miot-identity` | 家庭成员档案 CRUD |
| `miloco-miot-identity-register` | 身份样本注册（需摄像头/附件） |

共 **16** 个 Skills 同步安装（含批次一/二/三），默认绑定给 `pi`。

### Web UI 面板

OpenX 网页：**设置 → 工具 → Miloco**，可一键：

- 同步 / 强制同步 Skills
- 配置 WSL webhook（支持 NAT 网关 IP）
- 添加 Miloco Dashboard 拓展槽
- 查看 Layer B 诊断、启用/停用摄像头 scope
- 家庭 Cron 状态与手动触发 digest/patrol
- 感知事件时间线与 `openx-miloco-events` Goal 列表



## 四宫格卡片



在 Pin Desktop 底栏选择 **Miloco 面板** 模板，或运行：



```bash

node scripts/setup-miloco-integration.mjs --add-card

```



默认 URL：`http://127.0.0.1:1810/`



## API



| 方法 | 路径 | 说明 |

|------|------|------|

| GET | `/api/miloco/status` | 集成状态（含 webhook 信息） |

| POST | `/api/miloco/setup` | 同步 Skills + 绑定 pi + 生成 token |

| GET | `/api/miloco/webhook` | Webhook 健康探针 |

| POST | `/api/miloco/webhook` | Miloco 入站 agent webhook |



## 主动事件 Webhook



### 契约



Miloco 后端通过 `agent.webhook_url` 向 OpenX 发送 POST 请求：



**请求**



```json

{

  "action": "agent",

  "payload": {

    "message": "[感知引擎]事件提醒：...",

    "sessionKey": "agent:main:miloco-suggest",

    "lane": "miloco-suggest",

    "traceId": "uuid",

    "idempotencyKey": "uuid",

    "timeoutMs": 180000

  }

}

```



**响应**（HTTP 200）



```json

{

  "code": 0,

  "message": "ok",

  "data": {

    "runId": "<goalId>",

    "status": "ok"

  }

}

```



- `status` 取值：`ok` | `error` | `timeout`

- 鉴权：`Authorization: Bearer <token>`（token 存于 `~/.openx/miloco-webhook.token` 或环境变量 `OPENX_MILOCO_WEBHOOK_TOKEN`）

- 次要 action `get_trace`：`{ "action": "get_trace", "payload": { "runId": "..." } }` → `data.status`: `done` | `in_progress` | `unknown`



### lane 与事件类型



| lane | 含义 |

|------|------|

| `miloco-interactive` | 语音指令 / 新设备绑定 |

| `miloco-rule` | 规则触发 |

| `miloco-suggest` | 感知建议 |



### 配置 Miloco 回调 OpenX



**方式 1：一键脚本（推荐）**



```powershell

.\scripts\miloco-connect-wsl.ps1

# 或

node scripts/setup-miloco-integration.mjs --connect-wsl

```



**方式 2：手动（WSL 内）**



```bash

miloco-cli config set agent.webhook_url http://127.0.0.1:3921/api/miloco/webhook

miloco-cli config set agent.auth_bearer <token-from-~/.openx/miloco-webhook.token>

```



### WSL ↔ Windows 网络



- **WSL2 镜像网络**（推荐）：配置 `%USERPROFILE%\.wslconfig` 后执行 `wsl --shutdown`

- **NAT 模式**：WSL 无法访问 `127.0.0.1` 上的 OpenX。需 `HOST=0.0.0.0 pnpm dev`，再用 `miloco-connect-wsl.ps1 -WebhookHost <网关IP>`（网关：`ip route show default | cut -d' ' -f3`）



### 故障排查



| 现象 | 可能原因 | 处理 |

|------|----------|------|

| HTTP 401 | Bearer token 不匹配 | 重新运行 `setup-miloco-integration.mjs` 后 `miloco-connect-wsl.ps1` |

| status=timeout | Pi 执行超时 | 检查 Pi/LLM 配置；测试时用 `OPENX_MOCK_PI=1` |

| Miloco 连接失败 | WSL 无法访问 Windows 端口 | 检查网络模式，换主机 IP |

| 重复 Goal | 传输重试 | OpenX 已按 `idempotencyKey` 去重 |



Webhook 收到的事件会在系统会话 `openx-miloco-events`（标题「Miloco 感知事件」）中创建 Goal。



## 健康检查 Workflow



```bash

POST /api/operator/workflows/miloco_health_check/run

```



## 冒烟测试（Mock Pi）

```bash
# Mock Pi 模式启动 server
OPENX_MOCK_PI=1 pnpm dev

# 另开终端
pnpm miloco:e2e
```

## 真机联调（Layer A 自动化）

验证 **真实 Pi + WSL miloco-cli**（非 Mock）：

### 1. WSL 安装 Miloco

```powershell
.\scripts\wsl-install-miloco.ps1
# 或跳过安装仅修复 CRLF：.\scripts\wsl-install-miloco.ps1 -SkipInstall
```

WSL 内最小配置：

```bash
miloco-cli config set model.omni.api_key <API Key>
miloco-cli account bind
miloco-cli service start
miloco-cli doctor
```

### 2. OpenX 真实 Pi

```bash
# 不得设置 OPENX_MOCK_PI=1
pnpm dev

pnpm miloco:setup
pnpm miloco:connect
```

### 3. Preflight + Live E2E

```powershell
pnpm miloco:preflight    # OpenX + WSL + webhook 连通性
pnpm miloco:live         # 安全 payload webhook + 真实 Pi 执行
pnpm miloco:smoke        # notify push + device list Goal（路线 3）
pnpm miloco:batch2-smoke # task list CLI + 任务/成员只读 Goal（批次二）
pnpm miloco:batch3-smoke # home-profile list CLI + 家庭档案只读 Goal（批次三）
pnpm miloco:batch3-cron-smoke # 手动触发 perception-digest cron Goal
pnpm miloco:habit-suggest-smoke # habit-suggest 状态机 API
pnpm miloco:layer-b-preflight # Layer B 软件检查 + 可选 watch
pnpm miloco:presence     # 手动触发一次设备在线监测轮询（路线 1）
```

### Smoke Test（路线 3）

前置条件：OpenX 以真实 Pi 运行（不得设置 `OPENX_MOCK_PI=1`）、米家账号已绑定、当前家庭为 `645001069854`（仙女的城堡）。

```powershell
pnpm miloco:smoke
```

脚本依次执行：

1. `miloco-cli notify push`（经 `miloco-wsl.ps1`）验证米家 App 推送
2. 创建并执行 Pi Goal：列出设备并标注 online/offline，重点说明路由器与循环扇

环境变量：`MILOCO_SMOKE_TIMEOUT_MS`（默认 180000）、`OPENX_BASE_URL`。

### 批次二 Smoke Test

前置条件同路线 3；需先 `pnpm miloco:setup` 同步 9 个 Skills。

```powershell
pnpm miloco:batch2-smoke
```

脚本依次：`GET /api/miloco/status` 断言 batch2 安装绑定 → `task list` CLI → Pi 只读 Goal（task list + person list）。

环境变量：`MILOCO_BATCH2_SMOKE_TIMEOUT_MS`（默认 180000）。

### 设备在线监测（路线 1）

监测米家设备的 **MIoT online 属性**（非摄像头 VLM、非物理在场感知）。手机若不在米家设备列表中则无法直接监测；加入米家后可将 did 写入 `~/.openx/miloco-presence.json`。

默认监测 did（可在配置中覆盖）：

- 路由器 `miwifi.445f4142-8bd5-950c-85ba-f214c379c34f`
- 循环扇 `993802700`、床头灯 `461044985`、空调 `656877257`

启用方式：

```powershell
$env:OPENX_MILOCO_PRESENCE_WATCH="1"
$env:HOST="0.0.0.0"
pnpm dev
```

首次轮询仅建立 baseline，不触发通知；之后每 5 分钟（`OPENX_MILOCO_PRESENCE_INTERVAL_MS`）轮询一次，状态变化时通过 Pi + `miloco-notify` 推送。

```powershell
pnpm miloco:presence              # 手动触发一次轮询
curl http://127.0.0.1:3921/api/miloco/presence
```

配置文件：`~/.openx/miloco-presence.json`；状态文件：`~/.openx/miloco-device-presence-state.json`。

环境变量：

- `OPENX_E2E_TIMEOUT_MS` — Goal 轮询超时（默认 300000）
- `OPENX_MILOCO_WEBHOOK_TIMEOUT_MS` — webhook `timeoutMs`（默认 300000）

### Layer B 手动全链路（摄像头）

Layer B = 真实摄像头感知 → Miloco Dispatcher → OpenX webhook → Pi Goal。

**Web UI**：设置 → 工具 → **Miloco** 页签（集成状态、WSL webhook、摄像头 scope、感知事件 Goal 列表）。

**CLI 诊断与监听：**

```powershell
curl http://127.0.0.1:3921/api/miloco/layer-b   # 摄像头 + webhook + omni 检查
pnpm miloco:layer-b-preflight                    # 软件检查 + 等待感知 Goal
pnpm miloco:layer-b                              # 仅轮询 openx-miloco-events 等待新 Goal
```

API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/miloco/layer-b` | Layer B 诊断（摄像头 scope、webhook、omni key、Pi） |
| GET | `/api/miloco/events` | 感知事件 Goal 列表（`?lane=miloco-interactive` 可过滤） |
| GET | `/api/miloco/home-cron` | 家庭 Cron watchdog 状态 |
| POST | `/api/miloco/home-cron/trigger` | 手动触发 cron（body: `{ name }`） |
| POST | `/api/miloco/habit-suggest` | 习惯建议状态机（body: `{ action, ... }`） |
| POST | `/api/miloco/im-push` | IM 推送适配（body: `{ text }`） |
| POST | `/api/miloco/connect-wsl` | 配置 WSL webhook（body: `{ webhookHost? }`） |
| POST | `/api/miloco/add-card` | 添加工头台 Miloco Dashboard 拓展槽 |
| POST | `/api/miloco/layer-b/cameras/enable` | 启用摄像头感知（body: `{ dids: [] }`） |
| POST | `/api/miloco/layer-b/cameras/disable` | 停用摄像头感知 |

Miloco 无 CLI 注入 Dispatcher 的 API，真实感知需人工触发：

1. 在 Web UI Miloco 页签确认 Layer B 检查项与摄像头「就绪」（in_use + online + connected）
2. 确认 Dashboard `http://127.0.0.1:1810/` 可访问并有画面
3. 对摄像头说话或等待感知 suggest/rule 事件
4. 在 OpenX 查看 `openx-miloco-events` 会话是否出现新 Goal（Web UI 或 `pnpm miloco:layer-b`）
5. 可选：`miloco-cli notify push --text "联调测试"` 验证米家推送（不走感知 webhook）

## 语音交互（Layer B + miloco-interactive）

客厅用户对摄像头说话（无需「嘿小爱同学」），由 Miloco Omni 判定 `needs_response=true`，经 `miloco-interactive` lane 回调 OpenX，Pi 控家并以音箱 TTS 回复。

### 数据流

```
摄像头+麦 → Miloco Omni ASR → needs_response → dispatcher(miloco-interactive)
  → POST OpenX /api/miloco/webhook → Pi Goal → miloco-devices / miloco-notify(play-text)
```

### Miloco 侧：恢复语音链路

上游曾在 `response_parser.py` 临时强制 `needs_response=false`。本地部署需恢复：

```python
needs_response=bool(item.get("needs_response", False))
```

修改后重启 WSL Miloco 服务。回滚：改回 `needs_response=False` 并重启。

### OpenX 侧：交互处置

- `lane=miloco-interactive` 时 Goal 使用专用 executionPrompt（禁止默认 `execute-text-directive`）
- 30s 内同房间同「语音指令」自动去重
- Web UI 感知事件面板可按 lane 过滤（含「语音/交互」）

### 验收命令

```powershell
pnpm miloco:layer-b-preflight              # Layer B 软件 + 可选 watch
pnpm miloco:interactive-smoke              # 模拟语音 webhook → Goal
pnpm miloco:interactive-wsl-smoke          # WSL 网络路径验收（与 Miloco dispatcher 同路）
```

真机：对启用感知的摄像头说控制句（「打开客厅灯」）或查询句（「现在几点了」），确认 OpenX 出现 `[Miloco] 语音/交互` Goal，且音箱 TTS 有反馈。

### 能力边界（语音）

- **支持**：摄像头语音 → OpenX/Pi 听懂并控家 + 音箱 `play-text` 回复
- **支持**：OpenX 主动 TTS/自动化（suggest/rule/cron，与语音输入无关）
- **不支持**：劫持小爱「嘿小爱同学」唤醒链（ASR 在小米云端，无官方 API）
- **不推荐默认**：`execute-text-directive`（代发小爱指令，大脑仍是小爱）

### 延迟调优（可选）

Miloco `dispatcher.turn_wait_timeout_ms` 默认 180000ms。交互体验可尝试降至 60000ms（`settings.yaml`），观察 Pi 超时率后再调整。

## 能力边界



- **支持**：OpenX 通过 Pi + Skills 查询/控制米家设备
- **支持**：Miloco 感知/规则/建议主动回调 OpenX，自动创建 Goal 由 Pi 处置（含 miloco-notify 播报）
- **支持**：Layer A 真机联调脚本（`pnpm miloco:live`）
- **支持**：Smoke test（`pnpm miloco:smoke`：notify + 设备查询 Goal）
- **支持**：批次二 Skills（`pnpm miloco:batch2-smoke`：任务/身份只读验证）
- **支持**：批次三 Skills + 家庭 Cron（`OPENX_MILOCO_HOME_CRON_WATCH=1`，`pnpm miloco:batch3-smoke`）
- **支持**：习惯建议 API（`pnpm miloco:habit-suggest-smoke`）
- **支持**：语音交互 smoke（`pnpm miloco:interactive-smoke`：模拟 miloco-interactive webhook）
- **支持**：Layer B 验收（`pnpm miloco:layer-b-preflight`：软件检查 + watch）
- **支持**：Web UI Miloco 面板（设置 → 工具 → Miloco，含感知事件时间线）
- **支持**：Layer B 诊断 API 与 `pnpm miloco:layer-b` 监听脚本
- **支持**：设备在线监测 watchdog（`OPENX_MILOCO_PRESENCE_WATCH=1`，默认 5 分钟轮询）
- **可选**：create-task 真机写操作（`MILOCO_CREATE_TASK_SMOKE_CONFIRM=1 pnpm miloco:create-task-smoke`）
- **Layer B 阻塞项**：摄像头需同 LAN 在线且 `connected=true`（硬件/网络）

