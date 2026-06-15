import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { DockMode } from "../../lib/use-desktop-layout";
import {
  getFlexPreset,
  loadFlexSecondaryPinned,
  saveFlexSecondaryPinned,
  saveFlexSplitRatio,
  WIDGET_LABELS,
  type CanvasWidgetId,
  type FlexibleScope,
} from "../../lib/flexible-desktop";
import { PaneDivider } from "../PaneDivider";
import { usePaneResize } from "../../lib/use-pane-resize";
import { FlexibleWidgetFrame } from "./FlexibleWidgetFrame";

type Props = {
  scope: FlexibleScope;
  dockMode: DockMode;
  widgets: Partial<Record<CanvasWidgetId, ReactNode>>;
};

export function FlexibleCanvas({ scope, dockMode, widgets }: Props) {
  const preset = useMemo(() => getFlexPreset(dockMode), [dockMode]);
  const containerRef = useRef<HTMLDivElement>(null);

  const [secondaryPinned, setSecondaryPinnedState] = useState(() =>
    loadFlexSecondaryPinned(scope, dockMode, preset),
  );

  useEffect(() => {
    setSecondaryPinnedState(loadFlexSecondaryPinned(scope, dockMode, preset));
  }, [scope, dockMode, preset]);

  const setSecondaryPinned = useCallback(
    (pinned: boolean) => {
      setSecondaryPinnedState(pinned);
      saveFlexSecondaryPinned(scope, dockMode, pinned);
    },
    [scope, dockMode],
  );

  const {
    value: primaryRatio,
    valueRef: primaryRatioRef,
    beginDrag,
    onDividerPointerMove,
    endDrag,
    nudgeRatio,
    persist,
  } = usePaneResize({
    storageKey: `openx.flex.${scope}.${dockMode}.ratio`,
    defaultRatio: preset.defaultSplitRatio,
    minRatio: preset.minPrimaryRatio,
    maxRatio: preset.maxPrimaryRatio,
  });

  const onDividerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onDividerPointerMove(e, containerRef.current);
    },
    [onDividerPointerMove],
  );

  const onDividerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      beginDrag(e, containerRef.current);
    },
    [beginDrag],
  );

  const onDividerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      nudgeRatio(e.key === "ArrowLeft" ? -0.03 : 0.03);
      persist();
      saveFlexSplitRatio(scope, dockMode, primaryRatioRef.current);
    },
    [nudgeRatio, persist, scope, dockMode, primaryRatioRef],
  );

  const onDividerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endDrag(e);
      saveFlexSplitRatio(scope, dockMode, primaryRatioRef.current);
    },
    [endDrag, scope, dockMode, primaryRatioRef],
  );

  const primaryContent = widgets[preset.primary];
  const secondaryId = preset.secondary;
  const secondaryContent =
    secondaryId && secondaryPinned ? widgets[secondaryId] : null;
  const showSplit = Boolean(secondaryContent && secondaryId);

  if (!primaryContent) {
    return <p className="empty-hint">当前桌面暂无内容。</p>;
  }

  if (!showSplit) {
    return (
      <div className="flexible-canvas flexible-canvas-single">
        <FlexibleWidgetFrame title={WIDGET_LABELS[preset.primary]}>
          {primaryContent}
        </FlexibleWidgetFrame>
        {secondaryId && widgets[secondaryId] ? (
          <div className="flexible-canvas-unpinned-hint">
            <span>{WIDGET_LABELS[secondaryId]} 已收起。</span>
            <button
              type="button"
              className="btn compact"
              onClick={() => setSecondaryPinned(true)}
            >
              固定 {WIDGET_LABELS[secondaryId]}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const leftFr = Math.max(1, Math.round(primaryRatio * 1000));
  const rightFr = Math.max(1, Math.round((1 - primaryRatio) * 1000));

  return (
    <div
      ref={containerRef}
      className="flexible-canvas flexible-canvas-split"
      style={
        {
          gridTemplateColumns: `minmax(0, ${leftFr}fr) var(--pane-divider-hit) minmax(0, ${rightFr}fr)`,
        } as CSSProperties
      }
    >
      <FlexibleWidgetFrame title={WIDGET_LABELS[preset.primary]}>
        {primaryContent}
      </FlexibleWidgetFrame>
      <PaneDivider
        ariaLabel={`调整${WIDGET_LABELS[preset.primary]}与${WIDGET_LABELS[secondaryId!]}宽度`}
        ariaValueNow={Math.round(primaryRatio * 100)}
        ariaValueMin={Math.round(preset.minPrimaryRatio * 100)}
        ariaValueMax={Math.round(preset.maxPrimaryRatio * 100)}
        onPointerDown={onDividerDown}
        onPointerMove={onDividerMove}
        onPointerUp={onDividerUp}
        onPointerCancel={onDividerUp}
        onKeyDown={onDividerKeyDown}
      />
      <FlexibleWidgetFrame
        title={WIDGET_LABELS[secondaryId!]}
        pinnable
        pinned={secondaryPinned}
        onPinChange={setSecondaryPinned}
      >
        {secondaryContent}
      </FlexibleWidgetFrame>
    </div>
  );
}
