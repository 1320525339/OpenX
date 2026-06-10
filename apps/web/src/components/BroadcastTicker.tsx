type Props = {
  messages: string[];
};

export function BroadcastTicker({ messages }: Props) {
  const fallback = "欢迎使用 OpenX — 工头层控制台";
  const text = messages.length > 0 ? messages.join("  ◆  ") : fallback;
  const latest = messages[messages.length - 1] ?? fallback;

  return (
    <div
      className="broadcast-bar"
      role="region"
      aria-label="工头播报"
      title={text}
    >
      <span className="broadcast-ticker" aria-hidden="true">
        {text}
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {latest}
      </span>
    </div>
  );
}
