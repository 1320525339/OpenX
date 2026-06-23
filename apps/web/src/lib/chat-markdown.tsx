import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { MarkdownDiffBlock } from "../components/MarkdownDiffBlock";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details",
    "summary",
    "mark",
    "del",
    "ins",
    "sub",
    "sup",
    "kbd",
    "hr",
    "figure",
    "figcaption",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel", "title"],
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    p: [...(defaultSchema.attributes?.p ?? []), "className"],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "src",
      "alt",
      "title",
      "width",
      "height",
      "loading",
    ],
    td: [...(defaultSchema.attributes?.td ?? []), "align"],
    th: [...(defaultSchema.attributes?.th ?? []), "align"],
    details: [...(defaultSchema.attributes?.details ?? []), "open"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "tel"],
    src: ["http", "https"],
  },
};

function extractFenceCode(children: ReactNode): { lang: string; code: string } | null {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const el = child as ReactElement<{ className?: string; children?: ReactNode }>;
  const className = el.props.className ?? "";
  const langMatch = /language-(\w+)/.exec(className);
  const lang = langMatch?.[1] ?? "";
  const code = String(el.props.children ?? "").replace(/\n$/, "");
  return { lang, code };
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      {...props}
    >
      {children}
    </a>
  ),
  pre: ({ children, ...props }) => {
    const fence = extractFenceCode(children);
    if (fence?.lang === "diff") {
      return <MarkdownDiffBlock code={fence.code} />;
    }
    return (
      <pre className="chat-md-pre" {...props}>
        {children}
      </pre>
    );
  },
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes("language-"));
    return (
      <code className={isBlock ? className : "chat-md-code"} {...props}>
        {children}
      </code>
    );
  },
  table: ({ children, ...props }) => (
    <div className="chat-md-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

/** 工头常用「· / • / ・」行首符号 → GFM 列表，避免圆点贴边、缩进错乱 */
export function normalizeMarkdownBullets(text: string): string {
  return text.replace(/^([ \t]*)[·•・]\s+/gm, "$1- ");
}

type Props = {
  text: string;
  className?: string;
  /** 流式阶段用纯文本，避免半截 Markdown/HTML 闪烁 */
  plain?: boolean;
};

export function ChatPlainText({ text, className }: Props) {
  return (
    <div className={`chat-plain-text${className ? ` ${className}` : ""}`}>{text}</div>
  );
}

export function ChatMarkdown({ text, className, plain }: Props) {
  if (plain) {
    return <ChatPlainText text={text} className={className} />;
  }

  const markdown = normalizeMarkdownBullets(text);

  return (
    <div className={`chat-markdown${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
