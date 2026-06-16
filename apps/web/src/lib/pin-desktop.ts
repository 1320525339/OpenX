/** HyperOS 柔性桌面：固定 3 等宽列，可空位 / 垂直叠放 / 拉宽占 2 列 / 拖拽换位 */

export type PinDockWidgetId = "chat" | "tasks" | "kanban" | "detail";
export type PinWebWidgetId = `web:${string}`;
export type PinExtWidgetId = `ext:${string}`;
export type PinWidgetId = PinDockWidgetId | PinWebWidgetId | PinExtWidgetId;

export function isWebWidgetId(id: PinWidgetId): id is PinWebWidgetId {
  return id.startsWith("web:");
}

export function isExtWidgetId(id: PinWidgetId): id is PinExtWidgetId {
  return id.startsWith("ext:") && id.length > 4;
}

export function isDockWidgetId(id: PinWidgetId): id is PinDockWidgetId {
  return !isWebWidgetId(id) && !isExtWidgetId(id);
}

export function webWidgetId(cardId: string): PinWebWidgetId {
  return `web:${cardId}`;
}

export function extWidgetId(slotId: string): PinExtWidgetId {
  return `ext:${slotId}`;
}

export function webCardIdFromSlot(id: PinWebWidgetId): string {
  return id.slice(4);
}

export function extSlotIdFromWidget(id: PinExtWidgetId): string {
  return id.slice(4);
}

export function slotIdFromWidget(widget: PinWidgetId): string | null {
  if (isExtWidgetId(widget)) return extSlotIdFromWidget(widget);
  if (isWebWidgetId(widget)) return webCardIdFromSlot(widget);
  return null;
}

export type PinDesktopScope = "console" | "conversation";

export const MAX_PIN_COLUMNS = 3;

export type PinColumnSlots<T> = [T, T, T];

export type PinDesktopLayout = {
  /** 三列固定槽位，null 表示逻辑空位（呈现可折叠，不保留灰框） */
  cols: PinColumnSlots<PinWidgetId | null>;
  /** wide[i]=true 时 cols[i] 横跨第 i 与 i+1 列（仅 i=0 或 1 有效） */
  wide: PinColumnSlots<boolean>;
  /** split[i]=true 时 cols[i] 为上卡，splitBottom[i] 为下卡（各占 50% 高） */
  split: PinColumnSlots<boolean>;
  splitBottom: PinColumnSlots<PinWidgetId | null>;
};

/** @deprecated 旧版左对齐槽位，仅用于迁移 */
export type PinSlots = PinColumnSlots<PinWidgetId | null>;

export const PIN_WIDGET_LABELS: Record<PinDockWidgetId, string> = {
  chat: "对话",
  tasks: "任务",
  kanban: "看板",
  detail: "详细任务",
};

export const PIN_DOCK_ITEMS: { id: PinDockWidgetId; label: string; icon: string }[] = [
  { id: "chat", label: "对话", icon: "💬" },
  { id: "tasks", label: "任务", icon: "📋" },
  { id: "kanban", label: "看板", icon: "📊" },
  { id: "detail", label: "详细任务", icon: "📄" },
];

export type PinSegment =
  | { kind: "empty"; col: number }
  | { kind: "widget"; col: number; colspan: 1 | 2; widget: PinWidgetId }
  | { kind: "stack"; col: number; top: PinWidgetId; bottom: PinWidgetId };

const STORAGE_KEY = "openx.pinDesktop.layout";
const LEGACY_STORAGE_KEY = "openx.pinDesktop.slots";

function layoutKey(scope: PinDesktopScope): string {
  return `${STORAGE_KEY}.${scope}`;
}

function legacyKey(scope: PinDesktopScope): string {
  return `${LEGACY_STORAGE_KEY}.${scope}`;
}

const DOCK_WIDGET_SET = new Set<PinDockWidgetId>(["chat", "tasks", "kanban", "detail"]);

/** 底栏可固定的面板（不含网页拓展卡） */
export const DOCK_PIN_WIDGETS = DOCK_WIDGET_SET;

function isValidSlotWidget(w: PinWidgetId | null | undefined): w is PinWidgetId {
  if (!w) return false;
  if (isWebWidgetId(w) || isExtWidgetId(w)) return w.length > 4;
  return DOCK_WIDGET_SET.has(w);
}

export function slotWidgetLabel(widget: PinWidgetId, title?: string): string {
  if (isWebWidgetId(widget) || isExtWidgetId(widget)) return title?.trim() || "拓展槽";
  return PIN_WIDGET_LABELS[widget];
}

export function emptyPinLayout(): PinDesktopLayout {
  return {
    cols: [null, null, null],
    wide: [false, false, false],
    split: [false, false, false],
    splitBottom: [null, null, null],
  };
}

/** 该列是否被左侧 wide 吞并（不单独渲染） */
export function isColumnMerged(layout: PinDesktopLayout, col: number): boolean {
  if (col === 1 && layout.wide[0]) return true;
  if (col === 2 && layout.wide[1]) return true;
  return false;
}

export function normalizeLayout(layout: PinDesktopLayout): PinDesktopLayout {
  const cols: PinDesktopLayout["cols"] = [null, null, null];
  const wide: PinDesktopLayout["wide"] = [false, false, false];
  const split: PinDesktopLayout["split"] = [false, false, false];
  const splitBottom: PinDesktopLayout["splitBottom"] = [null, null, null];
  const seen = new Set<PinWidgetId>();

  const take = (w: PinWidgetId | null | undefined): PinWidgetId | null => {
    if (w && isValidSlotWidget(w) && !seen.has(w)) {
      seen.add(w);
      return w;
    }
    return null;
  };

  for (let i = 0; i < MAX_PIN_COLUMNS; i++) {
    cols[i] = take(layout.cols[i]);
    const bottom = layout.split?.[i] ? take(layout.splitBottom?.[i]) : null;
    if (cols[i] && bottom) {
      split[i] = true;
      splitBottom[i] = bottom;
    }
  }

  if (cols[0] && layout.wide[0]) wide[0] = true;
  if (cols[1] && layout.wide[1] && !wide[0]) wide[1] = true;

  if (wide[0]) {
    cols[1] = null;
    wide[1] = false;
    split[0] = false;
    splitBottom[0] = null;
    split[1] = false;
    splitBottom[1] = null;
  }
  if (wide[1]) {
    cols[2] = null;
    split[1] = false;
    splitBottom[1] = null;
    split[2] = false;
    splitBottom[2] = null;
  }

  for (let i = 0; i < MAX_PIN_COLUMNS; i++) {
    if (!cols[i]) {
      wide[i] = false;
      split[i] = false;
      splitBottom[i] = null;
    }
    if (wide[i]) {
      split[i] = false;
      splitBottom[i] = null;
    }
    if (split[i] && (!cols[i] || !splitBottom[i])) {
      split[i] = false;
      if (!cols[i] && splitBottom[i]) {
        cols[i] = splitBottom[i];
        splitBottom[i] = null;
      } else {
        splitBottom[i] = null;
      }
    }
  }

  return { cols, wide, split, splitBottom };
}

/** 将布局展开为渲染段；默认仅含 widget，includeEmpty 时在拖拽态展示空位 */
export function buildPinSegments(
  layout: PinDesktopLayout,
  opts?: { includeEmpty?: boolean },
): PinSegment[] {
  const includeEmpty = opts?.includeEmpty ?? false;
  const norm = normalizeLayout(layout);
  const segs: PinSegment[] = [];

  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (isColumnMerged(norm, col)) continue;
    if (norm.split[col] && norm.cols[col] && norm.splitBottom[col]) {
      segs.push({
        kind: "stack",
        col,
        top: norm.cols[col]!,
        bottom: norm.splitBottom[col]!,
      });
      continue;
    }
    const widget = norm.cols[col];
    if (widget) {
      const colspan: 1 | 2 = col < 2 && norm.wide[col] ? 2 : 1;
      segs.push({ kind: "widget", col, colspan, widget });
      if (colspan === 2) col += 1;
    } else if (includeEmpty) {
      segs.push({ kind: "empty", col });
    }
  }

  return segs;
}

/** 当前布局中的空列（不含被 wide 吞并的列） */
export function getEmptyColumns(layout: PinDesktopLayout): number[] {
  const norm = normalizeLayout(layout);
  const empty: number[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (isColumnMerged(norm, col)) continue;
    if (norm.cols[col] === null) empty.push(col);
  }
  return empty;
}

/** 拓展槽列：始终位于「有内容卡片数 + 1」的位置（0 基）；满页或该列已占用则 null */
export function extensionSlotColumn(layout: PinDesktopLayout): number | null {
  const norm = normalizeLayout(layout);
  const widgetCount = pinnedWidgets(norm).length;
  if (widgetCount >= MAX_PIN_COLUMNS) return null;

  let col = widgetCount;
  while (col < MAX_PIN_COLUMNS) {
    if (isColumnMerged(norm, col)) {
      col += 1;
      continue;
    }
    if (norm.cols[col] == null) return col;
    return null;
  }
  return null;
}

/** 逻辑 3 列 grid 轨道：始终三等分固定槽位（空位不折叠，避免两卡平分） */
export function buildLogicalGridTemplate(
  _layout?: PinDesktopLayout,
  _opts?: { showEmptyColumns?: boolean },
): string {
  return "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)";
}

export function widgetColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): number | null {
  const norm = normalizeLayout(layout);
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (norm.cols[col] === widget) return col;
    if (norm.split[col] && norm.splitBottom[col] === widget) return col;
  }
  return null;
}

/** 底栏拖拽落点：已 Pin 则换位/挪动；未 Pin 先填入再落到目标列（仅整列交换，带 zone 请用 placePinWidgetAtDrop） */
export function placePinWidgetAtColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  toCol: number,
): PinDesktopLayout {
  if (toCol < 0 || toCol > 2) return layout;

  let norm = normalizeLayout(layout);
  let fromCol = widgetColumn(norm, widget);

  if (fromCol === toCol) return norm;

  if (fromCol == null) {
    norm = togglePinWidget(norm, widget);
    fromCol = widgetColumn(norm, widget);
    if (fromCol == null || fromCol === toCol) return norm;
  }

  return swapPinColumns(norm, fromCol, toCol);
}

export function loadPinLayout(scope: PinDesktopScope): PinDesktopLayout {
  try {
    const raw = localStorage.getItem(layoutKey(scope));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && "cols" in parsed) {
        const p = parsed as PinDesktopLayout;
        return normalizeLayout({
          cols: [
            p.cols?.[0] ?? null,
            p.cols?.[1] ?? null,
            p.cols?.[2] ?? null,
          ],
          wide: [Boolean(p.wide?.[0]), Boolean(p.wide?.[1]), false],
          split: [
            Boolean(p.split?.[0]),
            Boolean(p.split?.[1]),
            Boolean(p.split?.[2]),
          ],
          splitBottom: [
            p.splitBottom?.[0] ?? null,
            p.splitBottom?.[1] ?? null,
            p.splitBottom?.[2] ?? null,
          ],
        });
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const legacy = localStorage.getItem(legacyKey(scope));
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      if (Array.isArray(parsed) && parsed.length === 3) {
        return normalizeLayout({
          ...emptyPinLayout(),
          cols: [parsed[0] ?? null, parsed[1] ?? null, parsed[2] ?? null],
        });
      }
    }
  } catch {
    /* ignore */
  }

  return emptyPinLayout();
}

export function savePinLayout(scope: PinDesktopScope, layout: PinDesktopLayout): void {
  try {
    const norm = normalizeLayout(layout);
    localStorage.setItem(layoutKey(scope), JSON.stringify(norm));
  } catch {
    /* ignore */
  }
}

export function pinnedWidgets(layout: PinDesktopLayout): PinWidgetId[] {
  const norm = normalizeLayout(layout);
  const out: PinWidgetId[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (norm.cols[col]) out.push(norm.cols[col]!);
    if (norm.split[col] && norm.splitBottom[col]) out.push(norm.splitBottom[col]!);
  }
  return out;
}

export function isWidgetPinned(layout: PinDesktopLayout, widget: PinWidgetId): boolean {
  return widgetColumn(normalizeLayout(layout), widget) != null;
}

function firstEmptyColumn(layout: PinDesktopLayout): number | null {
  const norm = normalizeLayout(layout);
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (isColumnMerged(norm, col)) continue;
    if (norm.cols[col] === null) return col;
  }
  return null;
}

/** 将槽位 Pin 到指定列（若已 Pin 则先移出原列） */
export function pinSlotAtColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  toCol: number,
): PinDesktopLayout {
  if (toCol < 0 || toCol > 2) return layout;
  let norm = normalizeLayout(layout);
  if (isColumnMerged(norm, toCol)) return norm;

  const fromCol = widgetColumn(norm, widget);
  if (fromCol === toCol) return norm;

  if (fromCol != null) {
    norm = unpinWidget(norm, widget);
  }

  if (norm.cols[toCol] != null) return norm;

  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  cols[toCol] = widget;
  return normalizeLayout({ ...norm, cols });
}

/** 底栏 Pin/Unpin：填入首个空列；当前页满时由 workspace 翻页承载 */
export function togglePinWidget(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  if (isWidgetPinned(norm, widget)) {
    const cols = [...norm.cols] as PinDesktopLayout["cols"];
    const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];
    const split = [...norm.split] as PinDesktopLayout["split"];
    for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
      if (cols[col] === widget) {
        if (split[col] && splitBottom[col]) {
          cols[col] = splitBottom[col];
          splitBottom[col] = null;
          split[col] = false;
        } else {
          cols[col] = null;
        }
        continue;
      }
      if (splitBottom[col] === widget) {
        splitBottom[col] = null;
        split[col] = false;
      }
    }
    return normalizeLayout({ ...norm, cols, split, splitBottom });
  }

  const emptyCol = firstEmptyColumn(norm);
  if (emptyCol == null) return norm;

  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  cols[emptyCol] = widget;
  return normalizeLayout({ ...norm, cols });
}

export function unpinWidget(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): PinDesktopLayout {
  if (!isWidgetPinned(layout, widget)) return layout;
  const norm = normalizeLayout(layout);
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];
  const split = [...norm.split] as PinDesktopLayout["split"];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (cols[col] === widget) {
      if (split[col] && splitBottom[col]) {
        cols[col] = splitBottom[col];
        splitBottom[col] = null;
        split[col] = false;
      } else {
        cols[col] = null;
      }
      continue;
    }
    if (splitBottom[col] === widget) {
      splitBottom[col] = null;
      split[col] = false;
    }
  }
  return normalizeLayout({ ...norm, cols, split, splitBottom });
}

/** 拖拽：交换两列内容（含空位），并规范化 wide */
export function swapPinColumns(
  layout: PinDesktopLayout,
  fromCol: number,
  toCol: number,
): PinDesktopLayout {
  if (fromCol === toCol || fromCol < 0 || toCol < 0 || fromCol > 2 || toCol > 2) {
    return layout;
  }

  const norm = normalizeLayout(layout);
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const wide = [...norm.wide] as PinDesktopLayout["wide"];
  const split = [...norm.split] as PinDesktopLayout["split"];
  const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];

  const tmpCol = cols[fromCol];
  cols[fromCol] = cols[toCol];
  cols[toCol] = tmpCol;

  const tmpWide = wide[fromCol];
  wide[fromCol] = wide[toCol];
  wide[toCol] = tmpWide;
  wide[2] = false;

  const tmpSplit = split[fromCol];
  split[fromCol] = split[toCol];
  split[toCol] = tmpSplit;

  const tmpBottom = splitBottom[fromCol];
  splitBottom[fromCol] = splitBottom[toCol];
  splitBottom[toCol] = tmpBottom;

  return normalizeLayout({ cols, wide, split, splitBottom });
}

/** 设置拉宽：占 2 列时吞并右侧相邻列（移除该卡片） */
export function setPinWide(
  layout: PinDesktopLayout,
  col: number,
  wide: boolean,
): PinDesktopLayout {
  if (col < 0 || col > 1) return layout;
  const norm = normalizeLayout(layout);
  if (!norm.cols[col]) return norm;

  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const nextWide = [...norm.wide] as PinDesktopLayout["wide"];
  const split = [...norm.split] as PinDesktopLayout["split"];
  const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];
  nextWide[col] = wide;
  nextWide[2] = false;

  if (wide) {
    cols[col + 1] = null;
    if (col === 0) nextWide[1] = false;
    split[col] = false;
    splitBottom[col] = null;
  }

  return normalizeLayout({ cols, wide: nextWide, split, splitBottom });
}

/** 拉宽时会从桌面移除的相邻卡片 */
export function widgetConsumedByWide(
  layout: PinDesktopLayout,
  col: number,
): PinWidgetId | null {
  if (col < 0 || col > 1) return null;
  const norm = normalizeLayout(layout);
  if (norm.wide[col]) return null;
  return norm.cols[col + 1];
}

/** 该列是否可左右拉伸（含吞并邻卡 / 缩回单列） */
export function canResizeAtCol(layout: PinDesktopLayout, col: number): boolean {
  if (col < 0 || col > 1) return false;
  return normalizeLayout(layout).cols[col] != null;
}

/** @deprecated 用手动切换；拉伸场景请用 setPinWide */
export function togglePinWide(layout: PinDesktopLayout, col: number): PinDesktopLayout {
  if (col < 0 || col > 1) return layout;
  const norm = normalizeLayout(layout);
  return setPinWide(layout, col, !norm.wide[col]);
}

export function canToggleWide(layout: PinDesktopLayout, col: number): boolean {
  if (col < 0 || col > 1) return false;
  const norm = normalizeLayout(layout);
  return norm.cols[col] != null;
}

/** @deprecated 兼容旧 hook 命名 */
export function loadPinSlots(scope: PinDesktopScope): PinSlots {
  return loadPinLayout(scope).cols;
}

/** @deprecated */
export function savePinSlots(scope: PinDesktopScope, slots: PinSlots): void {
  savePinLayout(scope, { ...emptyPinLayout(), cols: slots });
}
