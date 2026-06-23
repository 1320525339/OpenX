# Pin Desktop 统一交互规范

> 适用范围：`apps/web` 的 Smart Cabin / Console / Conversation Pin Desktop。本文用于统一卡片拖拽、Dock 拖入、接缝 resize、叠放与拓展槽行为，后续实现以此为准。

## 1. 目标

Pin Desktop 是一个三列固定空间桌面，不是自动瀑布流。用户应该形成稳定心智：

- **卡片拖拽**用于重排当前桌面。
- **Dock 拖入**用于把新卡片安装到桌面。
- **接缝拖拽**用于改变卡片宽度。
- **上/下区叠放**用于把两个单列卡片合成上下分屏。
- **中区落点**始终表达“替换当前占位关系”，但替换规则必须随来源明确展示。

交互优先级：稳定、可预期、少隐式规则。宁可少一种操作，也不要同一视觉反馈产生两种无提示结果。

## 2. 基础模型

### 2.1 列与 span

桌面固定为 3 个逻辑列：`0 / 1 / 2`。

| 状态 | 含义 |
| --- | --- |
| `wide[0] = true` | 第 1 列卡片跨 2 列 |
| `wide[0] = true && wide[2] = true` | 第 1 列卡片跨 3 列 |
| `wide[1] = true` | 第 2 列卡片跨 2 列 |

span-3 时，`cols[2]` 中的卡片可以被保留但隐藏；缩回 span-2 时必须恢复显示。禁止因为 normalize 或远端同步清空可恢复卡片。

### 2.2 空间原则

- Unpin 后不自动左压缩，空列保留。
- 拖拽时空列必须可见，推荐渲染真实 empty cell，而不是只有绝对定位 overlay。
- 拓展槽只出现在未合并的空列，不能覆盖被 span-3 暂时隐藏的卡片。

## 3. 状态机

任何时刻只能存在一种主动交互。

```text
Idle
  ├─ card header pointerdown → PendingCardDrag
  │    └─ move >= 4px → CardDragging → pointerup commit
  ├─ dock item pointerdown → PendingDockDrag
  │    └─ move >= 4px → DockDragging → pointerup commit
  └─ seam pointerdown → PendingResize
       └─ move >= 4px → Resizing → pointerup commit
```

规则：

- `Resizing` 时禁止启动卡片拖拽。
- `CardDragging` / `DockDragging` 时隐藏或禁用 seam。
- pointer cancel / escape / 组件卸载必须清理 body class、pointer capture、interval / observer。
- 点击按钮、输入框、菜单时不得触发卡片拖拽。

## 4. Drop 语义

### 4.1 来源类型

所有拖放统一进入一个提交函数，显式携带来源：

```ts
type PinDropSource = "canvas" | "dock";
```

| 来源 | 用户心智 | 已占用中区默认行为 |
| --- | --- | --- |
| `canvas` | 重排桌面 | 交换 column bundle |
| `dock` | 安装新卡片 | 替换目标卡片，目标回 Dock |

这两个行为可以不同，但 UI 必须不同：

- `canvas` 中区文案：`交换位置`
- `dock` 中区文案：`替换此卡片`

如果 UI 无法区分文案，则实现必须统一为同一种行为，优先选择“交换”。

### 4.2 Drop zone

目标列分为三段：

| 区域 | 命名 | 行为 |
| --- | --- | --- |
| 上 1/3 | `stack-above` | 拖入卡片置顶，目标卡片置底 |
| 中 1/3 | `replace` | 按来源执行交换或替换 |
| 下 1/3 | `stack-below` | 目标卡片置顶，拖入卡片置底 |

stack 只适用于目标列为单列、未 wide、未 merged、且有一个主卡片的场景。

以下场景强制 `replace`：

- 目标为空列。
- 目标是 wide 卡。
- 目标是 merged 列。
- 目标列已经是 split 且没有可挤出的空列。

### 4.3 Dwell 规则

为了避免快速拖过时误叠放，允许 dwell 后启用 stack：

- 默认 dwell：`150ms`。
- dwell 前可显示三段预览，但上/下区标记为“停留后叠放”。
- dwell 后上/下区变为可提交。
- 中区 `replace` 不需要 dwell。

禁止出现“文案说可叠放，但 release 后交换”的状态。

### 4.4 同列拖拽

同列 release：

- 单卡列：无操作。
- split 列：
  - top 拖到底区：交换上下行。
  - bottom 拖到上区：交换上下行。
  - 中区：无操作。

## 5. 命中检测

### 5.1 宽卡 anchor 归并

指针落在 wide 卡的视觉矩形内时，目标列必须归并为该卡 anchor 列。

示例：

- col0 span-2 卡片右半段，不应命中 col1。
- col0 span-3 任意位置，不应命中 col1 / col2。
- col1 span-2 卡片右半段，不应命中 col2。

实现优先级：

1. 先按 DOM rect 命中当前可见卡片，拿到 widget anchor col。
2. 找不到可见卡片时，再使用 `columnFromPointer`。
3. 若算出的列是 merged 列，回退到 merged owner anchor。

### 5.2 cell rect

Drop zone 的 Y 轴判定必须基于视觉卡片 rect，而不是 merged 空列 rect。空列可使用 empty cell rect。

## 6. Resize 语义

### 6.1 接缝是唯一 resize 入口

卡片边缘 handle 不再作为交互入口。代码与 CSS 中遗留 edge handle 应删除或隔离为 deprecated。

### 6.2 档位

| 接缝 | 可提交档位 |
| --- | --- |
| col0 右接缝 | span 1 / 2 / 3 |
| col1 右接缝 | span 1 / 2 |

预览和提交必须使用同一套档位判断。拖拽过程中可以连续跟手，但必须同时显示当前将提交的档位；更推荐预览直接吸附到档位，避免 release 跳变。

### 6.3 扩宽与挤出

扩宽优先“挤出邻卡到空列”，而不是直接吞掉邻卡。

规则：

- span-2 扩宽时，如果被覆盖列有卡片，必须先寻找覆盖范围外的空列。
- 无空列时本次 resize 不提交，并给出失败反馈。
- span-3 可暂时隐藏 col2 卡片，但必须保留 `cols[2]` 以便缩回恢复。

### 6.4 失败反馈

布局函数不应只返回原 layout 表示失败。交互层需要知道失败原因：

```ts
type LayoutCommitResult =
  | { ok: true; layout: PinDesktopLayout }
  | { ok: false; layout: PinDesktopLayout; reason: "no-empty-slot" | "invalid-target" };
```

UI 反馈：

- seam 轻微 shake。
- 显示短提示：`没有空位可展开`。
- 不持久化无变化 layout。

## 7. Dock 行为

### 7.1 点击

Dock item 点击：

- 未 pin：pin 到当前页第一个空列。
- 已 pin：unpin。

点击不得触发拖拽，除非移动超过阈值。

### 7.2 拖入

Dock 拖入支持：

- 空列：安装到该列。
- 单列卡片上区/下区：叠放。
- 中区：替换或交换，按第 4.1 节来源语义。

Dock 拖入未 pin 卡片时，应先创建 pin，再执行同一套 drop commit。不要维护第二套布局提交逻辑。

### 7.3 扩展卡片

拓展槽创建后得到 `ext:*` widget id，与内置 widget 使用相同 drop / resize / unpin 规则。删除扩展卡片时必须同时移除 catalog 和所有页面引用。

## 8. 视觉反馈

### 8.1 拖拽

- 源卡片保留占位，避免布局突然坍缩。
- Drag overlay 跟随指针，但不参与命中。
- 目标列必须有明确边框。
- stack 区必须显示上/中/下区域状态。

### 8.2 Resize

- seam hover 时显示可拖拽热区。
- resize 中禁用 grid transition。
- 当前档位应有视觉标记，例如 `1列 / 2列 / 全宽`。
- 失败时使用 shake / toast，而不是静默还原。

### 8.3 空列

拖拽中空列应显示“放到这里”。非拖拽时可以只显示拓展槽。

## 9. 实现约束

### 9.1 单一提交入口

目标结构：

```ts
applyPinDropCommit({
  layout,
  widget,
  toCol,
  zone,
  source,
})
```

禁止继续让以下两个函数承载不同核心语义：

- `applyPinDropIntent`
- `placePinWidgetAtDrop`

它们可以保留为 wrapper，但必须调用同一核心函数。

### 9.2 单一 gap 来源

JS 不应硬编码与 CSS 重复的 `8px`。使用其中一种：

- CSS custom property：`--pin-grid-gap: 8px`
- 或运行时读取 `getComputedStyle(grid).gap`

### 9.3 去除轮询

Drop target 不应依赖固定 `80ms` interval。改为：

- `pointermove` 时重算。
- `ResizeObserver` 监听 grid / cell rect 变化。
- `overCol` / `zoneEnabled` 状态变化后重算一次。

### 9.4 删除遗留 resize API

以下内容如无调用方，应删除：

- `computeResizePreview`
- `resolveWideFromResizePointer`
- `seamForWidgetLeftEdge`
- `seamForWidgetRightEdge`
- `.pin-desktop-edge-handle`
- 未使用的 `setWide` hook 暴露

## 10. 推荐改造顺序

1. 统一 drop commit 入口，补齐 source 文案差异。
2. 修复 wide / merged 命中归并。
3. 把 canvas drag 与 dock drag 的 drop target 逻辑抽成共享 hook。
4. 去掉 80ms polling，改为事件 + observer。
5. resize 预览与提交使用同一档位，失败返回结构化原因。
6. 清理遗留 edge resize 代码。
7. 简化第三列-only seam 模型，减少 `leftCol` 与 widget 实际列不一致的 special case。

## 11. 验收清单

### Drop

- 卡片拖到另一个卡片中区，文案与行为一致。
- Dock 拖到另一个卡片中区，文案与行为一致。
- 快速划过目标列不会误叠放。
- 停留后拖到上/下区可以稳定叠放。
- 拖到 wide 卡任意视觉位置，目标都是 wide 卡 anchor。

### Resize

- col0 可稳定 1→2→3→2→1。
- col1 可稳定 1→2→1。
- 第三列-only 卡片可 1→2→1 并回到第三列。
- span-3 缩回 span-2 后，第三列隐藏卡片恢复。
- 无空位扩宽时有反馈，不静默失败。

### Persistence

- 刷新后 layout 不被 compact。
- SSE 同步不清掉 span-3 下隐藏的第三列卡片。
- 多页切换后当前页交互状态不泄漏。
