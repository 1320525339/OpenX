import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";

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
  pre: ({ children, ...props }) => (
    <pre className="chat-md-pre" {...props}>
      {children}
    </pre>
  ),
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

  return (
    <div className={`chat-markdown${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
