import { HermesChatDiffFence } from "../vendor-seams/hermes/chat-diff-fence";

type Props = {
  code: string;
};

/** Markdown ```diff 围栏 — Hermes AgentMarkdown DiffView seam */
export function MarkdownDiffBlock({ code }: Props) {
  return (
    <div className="chat-md-diff">
      <HermesChatDiffFence code={code} />
    </div>
  );
}
