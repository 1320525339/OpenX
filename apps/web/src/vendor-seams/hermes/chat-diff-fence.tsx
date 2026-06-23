/**
 * 来源：vendors/hermes-desktop/src/renderer/src/components/AgentMarkdown.tsx · DiffView
 * Markdown ```diff 围栏：前缀行着色，无 gutter / hljs。
 */
export function HermesChatDiffFence({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        if (line.startsWith("--- ") || line.startsWith("+++ ")) return null;
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";
        else if (line.startsWith("-")) cls += " chat-diff-remove";
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";
        return (
          <div key={i} className={cls}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}
