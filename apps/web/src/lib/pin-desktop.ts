/** HyperOS 柔性桌面：固定 3 等宽列，可空位 / 垂直叠放 / 拉宽卡 / 拖拽换位 */

export type PinDockWidgetId = "chat" | "tasks" | "detail" | "evidence";

/** 旧布局中的看板槽位 → 任务台 */
export function migrateLegacyDockWidget(
  widget: PinWidgetId | null | undefined,
): PinWidgetId | null {
  if (!widget) return null;
  if ((widget as string) === "kanban") return "tasks";
  return widget;
}

/** 内置 React 面板 componentId → 底栏 widget */
export function resolveBuiltinDockWidget(componentId: string): PinDockWidgetId {
  if (componentId === "kanban") return "tasks";
  return componentId as PinDockWidgetId;
}
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
  /** wide[0] 为第 1 栏跨 2 栏；wide[0]+wide[2] 为第 1 栏跨 3 栏；wide[1] 为第 2 栏跨 2 栏；任意卡片经 setWidgetSpan 均可占满 3 格 */
  wide: PinColumnSlots<boolean>;
  /** split[i]=true 时 cols[i] 为上卡，splitBottom[i] 为下卡（各占 50% 高） */
  split: PinColumnSlots<boolean>;
  splitBottom: PinColumnSlots<PinWidgetId | null>;
};

/** @deprecated 旧版左对齐槽位，仅用于迁移 */
export type PinSlots = PinColumnSlots<PinWidgetId | null>;

export const PIN_WIDGET_LABELS: Record<PinDockWidgetId, string> = {
  chat: "AI 会话",
  tasks: "任务台",
  detail: "任务详情",
  evidence: "交付证据",
};

export const PIN_DOCK_ITEMS: { id: PinDockWidgetId; label: string; icon: string }[] = [
  { id: "chat", label: "AI 会话", icon: "💬" },
  { id: "tasks", label: "任务台", icon: "📋" },
  { id: "detail", label: "任务详情", icon: "📄" },
  { id: "evidence", label: "交付证据", icon: "📦" },
];

export type PinSegment =
  | { kind: "empty"; col: number }
  | { kind: "widget"; col: number; colspan: 1 | 2 | 3; widget: PinWidgetId }
  | { kind: "stack"; col: number; top: PinWidgetId; bottom: PinWidgetId };

const STORAGE_KEY = "openx.pinDesktop.layout";
const LEGACY_STORAGE_KEY = "openx.pinDesktop.slots";

function layoutKey(scope: PinDesktopScope): string {
  return `${STORAGE_KEY}.${scope}`;
}

function legacyKey(scope: PinDesktopScope): string {
  return `${LEGACY_STORAGE_KEY}.${scope}`;
}

const DOCK_WIDGET_SET = new Set<PinDockWidgetId>(["chat", "tasks", "detail", "evidence"]);

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
  if (col === 2 && layout.wide[0] && layout.wide[2]) return true;
  if (col === 2 && layout.wide[1]) return true;
  return false;
}

export function columnSpan(layout: PinDesktopLayout, col: number): 1 | 2 | 3 {
  if (col === 0 && layout.wide[0] && layout.wide[2]) return 3;
  if (col < 2 && layout.wide[col]) return 2;
  return 1;
}

export function normalizeLayout(layout: PinDesktopLayout): PinDesktopLayout {
  const cols: PinDesktopLayout["cols"] = [null, null, null];
  const wide: PinDesktopLayout["wide"] = [false, false, false];
  const split: PinDesktopLayout["split"] = [false, false, false];
  const splitBottom: PinDesktopLayout["splitBottom"] = [null, null, null];
  const seen = new Set<PinWidgetId>();

  const take = (w: PinWidgetId | null | undefined): PinWidgetId | null => {
    const migrated = migrateLegacyDockWidget(w);
    if (migrated && isValidSlotWidget(migrated) && !seen.has(migrated)) {
      seen.add(migrated);
      return migrated;
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
  if (wide[0] && layout.wide[2]) wide[2] = true;

  if (wide[0]) {
    cols[1] = null;
    wide[1] = false;
    split[0] = false;
    splitBottom[0] = null;
    split[1] = false;
    splitBottom[1] = null;
    if (wide[2]) {
      split[2] = false;
      splitBottom[2] = null;
    }
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
      if (i === 2 && wide[0] && wide[2]) {
        /* span-3：col2 被 col0 吞并，保留 wide[2] 标记 */
      } else {
        wide[i] = false;
        split[i] = false;
        splitBottom[i] = null;
      }
    }
    if (wide[i] && i !== 2) {
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

export function compactPinLayout(layout: PinDesktopLayout): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  const next = emptyPinLayout();
  let cursor = 0;

  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (isColumnMerged(norm, col)) continue;
    const widget = norm.cols[col];
    if (!widget || cursor >= MAX_PIN_COLUMNS) continue;

    if (norm.split[col] && norm.splitBottom[col]) {
      next.cols[cursor] = widget;
      next.split[cursor] = true;
      next.splitBottom[cursor] = norm.splitBottom[col];
      cursor += 1;
      continue;
    }

    const colspan = columnSpan(norm, col);
    next.cols[cursor] = widget;
    if (colspan >= 2 && cursor < MAX_PIN_COLUMNS - 1) {
      next.wide[cursor] = true;
      if (colspan === 3) next.wide[2] = true;
      cursor += colspan;
    } else {
      cursor += 1;
    }
  }

  return normalizeLayout(next);
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
      const colspan = columnSpan(norm, col);
      segs.push({ kind: "widget", col, colspan, widget });
      if (colspan > 1) col += colspan - 1;
    } else if (includeEmpty) {
      segs.push({ kind: "empty", col });
    }
  }

  return segs;
}

/** 当前布局中的空列（不含被 wide 吞并的列） */
export function getEmptyColumns(layout: PinDesktopLayout): number[] {
  const norm = normalizeLayout(layout);
  const occupied = new Set<number>();
  for (const seg of buildPinSegments(norm)) {
    if (seg.kind !== "widget") continue;
    for (let c = seg.col; c < seg.col + seg.colspan; c++) {
      occupied.add(c);
    }
  }
  const empty: number[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (occupied.has(col)) continue;
    if (isColumnMerged(norm, col)) continue;
    if (norm.cols[col] === null) empty.push(col);
  }
  return empty;
}

/** 拓展槽列：默认取第一个空列；多页非末页时可填满所有空列 */
export function extensionSlotColumns(
  layout: PinDesktopLayout,
  opts?: { fillAllEmpty?: boolean },
): number[] {
  const empty = getEmptyColumns(layout);
  if (empty.length === 0) return [];
  return opts?.fillAllEmpty ? empty : [empty[0]!];
}

/** 拓展槽列：按空间布局取第一个空列（与渲染一致，不用 compact） */
export function extensionSlotColumn(layout: PinDesktopLayout): number | null {
  return extensionSlotColumns(layout)[0] ?? null;
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
    if (isColumnMerged(norm, col)) continue;
    if (norm.cols[col] === widget) return col;
    if (norm.split[col] && norm.splitBottom[col] === widget) return col;
  }
  return null;
}

/** 卡片锚点列（同 widgetColumn） */
export function widgetAnchorColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): number | null {
  return widgetColumn(layout, widget);
}

/** 卡片当前占用的列跨度 */
export function widgetColumnSpan(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): 1 | 2 | 3 {
  const anchor = widgetColumn(layout, widget);
  if (anchor == null) return 1;
  return columnSpan(normalizeLayout(layout), anchor);
}

/** 任意卡片最多可拉伸占满 3 格 */
export const MAX_WIDGET_SPAN = 3 as const;

/** 将卡片移到指定锚点列（单列，不含 wide），被挤占的卡片挪到首个空列 */
export function repackWidgetToColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  targetCol: number,
): PinDesktopLayout {
  if (targetCol < 0 || targetCol > 2) return layout;
  const norm = normalizeLayout(layout);
  const fromCol = widgetColumn(norm, widget);
  if (fromCol == null || fromCol === targetCol) return norm;
  if (isColumnMerged(norm, targetCol)) return norm;

  const occupant = norm.cols[targetCol];
  let base = unpinWidget(norm, widget);
  if (occupant && occupant !== widget) {
    base = unpinWidget(base, occupant);
  }

  const cols = [...base.cols] as PinDesktopLayout["cols"];
  cols[targetCol] = widget;
  if (occupant && occupant !== widget) {
    const probe = normalizeLayout({ ...base, cols, wide: [false, false, false] });
    const emptyCol = firstEmptyColumn(probe);
    if (emptyCol == null) return norm;
    cols[emptyCol] = occupant;
  }

  return normalizeLayout({
    ...base,
    cols,
    wide: [false, false, false],
  });
}

/** 统一设置卡片列跨度（1/2/3），任意锚点均可扩至全宽 3 格 */
export function setWidgetSpan(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  span: 1 | 2 | 3,
): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  const anchor = widgetColumn(norm, widget);
  if (anchor == null) return norm;

  const current = widgetColumnSpan(norm, widget);
  if (span === current) return norm;

  if (span === 1) {
    if (current === 1) return norm;
    if (anchor === 0) return setPinSpan(norm, 0, 1);
    if (anchor === 1 && norm.wide[1]) return shrinkCol1WideToSingle(norm);
    if (anchor === 2 && norm.wide[1] && norm.cols[1] === widget) {
      return shrinkCol1WideToSingle(norm);
    }
    return norm;
  }

  if (span === 3) {
    const base = anchor === 0 ? norm : repackWidgetToColumn(norm, widget, 0);
    if (widgetColumn(base, widget) !== 0) return norm;
    return setPinSpan(base, 0, 3);
  }

  if (span === 2) {
    if (anchor === 0 && current === 3) return shrinkCol0Span3To2(norm);
    if (anchor === 0) return setPinSpan(norm, 0, 2);
    if (anchor === 1) return setPinSpan(norm, 1, 2);
    const base = repackWidgetToColumn(norm, widget, 1);
    if (widgetColumn(base, widget) !== 1) return norm;
    return setPinSpan(base, 1, 2);
  }

  return norm;
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
        return compactPinLayout({
          cols: [
            p.cols?.[0] ?? null,
            p.cols?.[1] ?? null,
            p.cols?.[2] ?? null,
          ],
          wide: [
            Boolean(p.wide?.[0]),
            Boolean(p.wide?.[1]),
            Boolean(p.wide?.[2]),
          ],
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
        return compactPinLayout({
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

/** 设置拉宽跨度：1 / 2 / 3 列；任意锚点经 setWidgetSpan 均可扩至全宽 */
export function setPinSpan(
  layout: PinDesktopLayout,
  col: number,
  span: 1 | 2 | 3,
): PinDesktopLayout {
  if (col < 0 || col > 1) return layout;
  const norm = normalizeLayout(layout);
  if (!norm.cols[col]) return norm;

  if (col === 1 && span === 3) {
    return setWidgetSpan(norm, norm.cols[1]!, 3);
  }

  const currentSpan = columnSpan(norm, col);
  if (col === 0 && currentSpan === 3 && span === 2) {
    return shrinkCol0Span3To2(norm);
  }

  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const split = [...norm.split] as PinDesktopLayout["split"];
  const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];

  if (span === 1) {
    const nextWide = [false, false, false] as PinDesktopLayout["wide"];
    if (
      col === 0 &&
      columnSpan(norm, 0) >= 2 &&
      !cols[1] &&
      cols[2] &&
      !norm.wide[1]
    ) {
      cols[1] = cols[2];
      cols[2] = null;
    }
    return normalizeLayout({ ...norm, cols, wide: nextWide, split, splitBottom });
  }

  const mergedCols: number[] = [];
  for (let c = col + 1; c < col + span; c++) mergedCols.push(c);
  if (col === 0 && span === 3) mergedCols.push(2);

  const displaced: PinWidgetId[] = [];
  for (const c of mergedCols) {
    if (col === 0 && span === 3 && c === 2 && cols[c]) continue;
    if (cols[c]) displaced.push(cols[c]!);
    cols[c] = null;
    split[c] = false;
    splitBottom[c] = null;
  }

  if (span < 3 && displaced.length > 0) {
    const reserved = new Set<number>([col, ...mergedCols]);
    const emptySlots: number[] = [];
    for (let c = 0; c < MAX_PIN_COLUMNS; c++) {
      if (reserved.has(c)) continue;
      if (cols[c] === null && !split[c]) emptySlots.push(c);
    }
    if (displaced.length > emptySlots.length) return norm;
    displaced.forEach((widget, index) => {
      cols[emptySlots[index]!] = widget;
    });
  }

  const nextWide = [false, false, false] as PinDesktopLayout["wide"];
  nextWide[col] = true;
  split[col] = false;
  splitBottom[col] = null;
  if (col === 0) {
    nextWide[1] = false;
    split[1] = false;
    splitBottom[1] = null;
  }
  if (col === 0 && span === 3) {
    nextWide[2] = true;
    if (!cols[2]) {
      split[2] = false;
      splitBottom[2] = null;
    }
  }

  return normalizeLayout({ cols, wide: nextWide, split, splitBottom });
}

/** 第一栏 span-3 缩回 span-2：清 wide[2]，保留第三栏卡片 */
export function shrinkCol0Span3To2(layout: PinDesktopLayout): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  if (columnSpan(norm, 0) !== 3) return norm;
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const split = [...norm.split] as PinDesktopLayout["split"];
  const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];
  cols[1] = null;
  split[0] = false;
  splitBottom[0] = null;
  split[1] = false;
  splitBottom[1] = null;
  if (norm.cols[2]) {
    split[2] = false;
    splitBottom[2] = null;
  }
  const wide = [true, false, false] as PinDesktopLayout["wide"];
  return normalizeLayout({ ...norm, cols, wide, split, splitBottom });
}

/** 第二栏宽卡缩回单列：第一栏为空时保留在中列，便于恢复 110 */
export function shrinkCol1WideToSingle(layout: PinDesktopLayout): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  if (!norm.wide[1] || !norm.cols[1]) return norm;
  const widget = norm.cols[1]!;
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const wide = [false, false, false] as PinDesktopLayout["wide"];
  cols[1] = widget;
  cols[2] = null;
  return normalizeLayout({ ...norm, cols, wide });
}

/** 设置拉宽：占 2 列时优先挤走邻卡，无空位则不扩宽 */
export function setPinWide(
  layout: PinDesktopLayout,
  col: number,
  wide: boolean,
): PinDesktopLayout {
  return setPinSpan(layout, col, wide ? 2 : 1);
}

/** 拉宽时会被挤占的相邻列卡片（无空位可挤时扩宽会失败） */
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
  if (col < 0 || col > 2) return false;
  const norm = normalizeLayout(layout);
  if (isColumnMerged(norm, col)) return false;
  return norm.cols[col] != null;
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
