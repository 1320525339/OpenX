import { ChatMarkdown } from "./chat-markdown";

/** 经 rehype-sanitize 的 HTML 片段（用于澄清 intro / preview） */
export function ChatSanitizedHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ChatMarkdown text={html} />
    </div>
  );
}
