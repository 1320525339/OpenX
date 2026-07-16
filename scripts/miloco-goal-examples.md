# Miloco Pi 目标示例（OpenX）

在 OpenX 中创建目标，执行器选 **Pi**，并确保已启用 Miloco Skills。

## 健康检查

**标题**：Miloco 健康检查  
**验收**：输出 service status、账号绑定状态、Dashboard 可达性  
**执行说明**：

```
1. 运行 scripts/miloco-wsl.ps1 service status
2. 运行 scripts/miloco-wsl.ps1 account status
3. 若服务未运行，提示用户先在 WSL 执行 miloco-cli service start
4. 用 curl 或 Invoke-WebRequest 检查 http://127.0.0.1:1810/ 是否可达
5. 汇总中文报告
```

## 设备查询

**标题**：查询米家设备列表  
**验收**：返回设备列表摘要（房间、名称、在线状态）  
**执行说明**：

```
加载 miloco-devices skill，执行 device list，按房间整理结果回复用户。
使用 scripts/miloco-wsl.ps1 包装所有 miloco-cli 命令。
```

## 设备查询（smoke test 推荐）

**标题**：查询米家设备列表（smoke）  
**验收**：返回设备列表摘要（房间、名称、在线状态），重点标注路由器与循环扇  
**执行说明**：

```
加载 miloco-devices 与 miloco-miot-scope skill。
通过 scripts/miloco-wsl.ps1 执行 device list，按房间整理结果。
重点汇报路由器（miwifi.*）与循环扇（993802700）的 did 与 online/offline 状态。
不要控制任何设备。
```

## 状态变化通知

**标题**：设备上线/离线提醒  
**验收**：通过 miloco-notify 向用户推送简短中文提醒  
**执行说明**：

```
收到设备在线状态变化事件后：
1. 用 miloco-notify 选择合适渠道（米家 App 推送）发送简短中文提醒
2. 可选：执行 device list 列出同家庭其他 offline 设备
3. 不要执行危险控制操作
```

## 任务与成员只读查询（batch2 smoke）

**标题**：查询 Miloco 任务与家庭成员（只读）  
**验收**：返回 task list 与 person list 摘要，未执行写操作  
**执行说明**：

```
加载 miloco-create-task 与 miloco-miot-identity skill。
通过 scripts/miloco-wsl.ps1 执行 task list 与 person list。
用中文汇总；禁止 create/delete/register 等写操作。
```

## 创建定时提醒（需用户确认）

**标题**：创建每日喝水提醒  
**验收**：向用户确认任务内容与时间后，成功创建 schedule 类任务并回报 task id  
**执行说明**：

```
加载 miloco-create-task skill。
先向用户确认提醒文案、时间与重复规则，再执行创建。
创建成功后用 miloco-notify 可选发送确认推送。
```

## 家庭成员查询

**标题**：查看家庭成员列表  
**验收**：返回 person list 摘要（姓名、角色、样本概况）  
**执行说明**：

```
加载 miloco-miot-identity skill。
执行 person list，用中文整理成员列表。
不涉及 identity register 或样本录入。
```

## 设备控制（需确认）

**标题**：关闭客厅灯  
**验收**：执行前向用户确认目标设备，成功后回报状态  
**执行说明**：

```
加载 miloco-devices skill。
先 device list 定位客厅灯 did，向用户确认后再 control。
```
