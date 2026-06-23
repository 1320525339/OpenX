import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ChatThreadItem } from "../lib/chat-thread";
import {
  chatTurnAnchorId,
  hasMoreColdHistory,
  planTranscriptZones,
  type ChatTurnGroup,
} from "../lib/chat-transcript-zones";
import {
  readChatTranscriptPrefs,
  saveChatTranscriptPrefs,
} from "../lib/chat-transcript-prefs";

export type ChatThreadRenderOptions = {
  anchorId?: string;
};

type Props = {
  items: ChatThreadItem[];
  renderItem: (item: ChatThreadItem, opts?: ChatThreadRenderOptions) => ReactNode;
  tail?: ReactNode;
};

function WarmTurnCard({
  group,
  items,
  expanded,
  onToggle,
  renderItem,
}: {
  group: ChatTurnGroup;
  items: ChatThreadItem[];
  expanded: boolean;
  onToggle: () => void;
  renderItem: Props["renderItem"];
}) {
  const slice = items.slice(group.startIdx, group.endIdx);
  return (
    <div className="chat-warm-turn">
      <button type="button" className="chat-warm-turn-toggle" onClick={onToggle}>
        <span className="chat-warm-turn-question">{group.anchorText}</span>
        {group.preview ? (
          <span className="chat-warm-turn-preview">{group.preview}</span>
        ) : null}
        <span className="chat-warm-turn-meta">
          {group.itemCount} 项 · {expanded ? "收起" : "展开"}
        </span>
      </button>
      {expanded ? (
        <div className="chat-warm-turn-body">
          {slice.map((item) => {
            const anchorId =
              item.kind === "message" && item.message.role === "user"
                ? chatTurnAnchorId(group.anchorKey)
                : undefined;
            return (
              <div key={item.key} id={anchorId}>
                {renderItem(item, anchorId ? { anchorId } : undefined)}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ChatThreadViewport({ items, renderItem, tail }: Props) {
  const [warmPagesLoaded, setWarmPagesLoaded] = useState(1);
  const [expandedWarm, setExpandedWarm] = useState<Set<number>>(new Set());
  const [prefs, setPrefs] = useState(readChatTranscriptPrefs);

  const plan = useMemo(
    () =>
      planTranscriptZones(items, {
        hotTurns: prefs.hotTurns,
        warmPagesLoaded,
        warmPageSize: prefs.warmPageSize,
      }),
    [items, warmPagesLoaded, prefs.hotTurns, prefs.warmPageSize],
  );

  const showLoadMore = hasMoreColdHistory(
    items,
    warmPagesLoaded,
    prefs.warmPageSize,
    prefs.hotTurns,
  );

  const toggleWarm = (turn: number) => {
    setExpandedWarm((prev) => {
      const next = new Set(prev);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  };

  return (
    <div className="chat-thread-viewport">
      <details className="chat-transcript-prefs">
        <summary className="chat-transcript-prefs-summary">对话性能</summary>
        <div className="chat-transcript-prefs-body">
          <label className="chat-transcript-pref">
            <span>热区轮数</span>
            <input
              type="number"
              min={5}
              max={60}
              value={prefs.hotTurns}
              onChange={(e) => {
                const next = saveChatTranscriptPrefs({ hotTurns: Number(e.target.value) });
                setPrefs(next);
                setWarmPagesLoaded(1);
              }}
            />
          </label>
          <label className="chat-transcript-pref">
            <span>冷区分页</span>
            <input
              type="number"
              min={5}
              max={40}
              value={prefs.warmPageSize}
              onChange={(e) => {
                const next = saveChatTranscriptPrefs({ warmPageSize: Number(e.target.value) });
                setPrefs(next);
                setWarmPagesLoaded(1);
              }}
            />
          </label>
        </div>
      </details>
      {showLoadMore && (
        <div className="chat-cold-load">
          <button
            type="button"
            className="btn compact linkish"
            onClick={() => setWarmPagesLoaded((n) => n + 1)}
          >
            加载更早对话（{plan.coldGroups.length + plan.warmGroups.length} 轮摘要）
          </button>
        </div>
      )}
      {plan.warmGroups.map((group) => (
        <WarmTurnCard
          key={`warm-${group.turn}-${group.anchorKey}`}
          group={group}
          items={items}
          expanded={expandedWarm.has(group.turn)}
          onToggle={() => toggleWarm(group.turn)}
          renderItem={renderItem}
        />
      ))}
      {plan.hotItems.map((item) => {
        const anchorId =
          item.kind === "message" && item.message.role === "user"
            ? chatTurnAnchorId(item.key)
            : undefined;
        return (
          <div key={item.key} id={anchorId}>
            {renderItem(item, anchorId ? { anchorId } : undefined)}
          </div>
        );
      })}
      {tail}
    </div>
  );
}
