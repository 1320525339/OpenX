import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

type Props = {
  content: string;
  className?: string;
};

let mermaidReady = false;

function ensureMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
  });
  mermaidReady = true;
}

export function ClarifyMermaidPreview({ content, className }: Props) {
  const reactId = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    ensureMermaid();
    setFailed(false);
    const renderId = `clarify-mmd-${reactId}-${Date.now()}`;

    void mermaid
      .render(renderId, content)
      .then(({ svg }) => {
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [content, reactId]);

  if (failed) {
    return (
      <pre className={`chat-clarify-preview chat-clarify-preview-mermaid${className ? ` ${className}` : ""}`}>
        <code>{content}</code>
      </pre>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`chat-clarify-preview chat-clarify-mermaid${className ? ` ${className}` : ""}`}
      aria-label="示意图"
    />
  );
}
