import { useEffect, useMemo, useState } from "react";
import {
  CLARIFY_FREEFORM_ANSWER_ID,
  clarifyQuestionAllowsFreeform,
  isClarifyQuestionAnswered,
  isClarifyQuestionVisible,
  type ClarifyAnswerAnnotation,
  type ClarifyAnswerValue,
  type CoachClarifyPayload,
  type CoachClarifyPreview,
} from "@openx/shared";
import { ChatMarkdown } from "../lib/chat-markdown";
import { ChatSanitizedHtml } from "../lib/chat-sanitized-html";
import { useMatchMedia } from "../lib/use-match-media";
import { ClarifyMermaidPreview } from "./ClarifyMermaidPreview";

type Props = {
  clarify: CoachClarifyPayload;
  loading?: boolean;
  onSubmit: (
    answers: Record<string, ClarifyAnswerValue>,
    annotations?: Record<string, ClarifyAnswerAnnotation>,
  ) => void;
  onDismiss: () => void;
};

function ClarifyPreview({ preview }: { preview: CoachClarifyPreview }) {
  if (preview.format === "html") {
    return (
      <ChatSanitizedHtml
        html={preview.content}
        className="chat-clarify-preview chat-clarify-preview-html"
      />
    );
  }
  if (preview.format === "markdown") {
    return (
      <div className="chat-clarify-preview">
        <ChatMarkdown text={preview.content} />
      </div>
    );
  }
  if (preview.format === "mermaid") {
    return <ClarifyMermaidPreview content={preview.content} />;
  }
  return (
    <p className="chat-clarify-preview chat-clarify-preview-text">{preview.content}</p>
  );
}

export function ChatClarifyCard({ clarify, loading, onSubmit, onDismiss }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, ClarifyAnswerValue>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const questions = clarify.questions;

  const visibleEntries = useMemo(
    () =>
      questions
        .map((q, i) => ({ q, i }))
        .filter(({ i }) => isClarifyQuestionVisible(questions, i, answers)),
    [questions, answers],
  );

  useEffect(() => {
    if (!visibleEntries.some((e) => e.i === activeIndex)) {
      setActiveIndex(visibleEntries[0]?.i ?? 0);
    }
  }, [visibleEntries, activeIndex]);

  const activeQuestion = questions[activeIndex] ?? questions[0];
  const multiTab = visibleEntries.length > 1;
  const annotationsForCheck = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(notes)
          .filter(([, note]) => note.trim())
          .map(([id, note]) => [id, { notes: note.trim() }]),
      ),
    [notes],
  );

  const selectedPreview = useMemo(() => {
    if (!activeQuestion?.options?.length) return undefined;
    const raw = answers[activeQuestion.id];
    const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const id of ids) {
      const opt = activeQuestion.options.find((o) => o.id === id);
      if (opt?.preview) return opt.preview;
    }
    const recommended = activeQuestion.options.find((o) => o.recommended);
    return recommended?.preview;
  }, [activeQuestion, answers]);

  const setSingleAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleMultiAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => {
      const raw = prev[questionId];
      const current = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [questionId]: next };
    });
  };

  const canSubmit = useMemo(() => {
    return questions.every((q, i) =>
      isClarifyQuestionAnswered(q, questions, i, answers, annotationsForCheck),
    );
  }, [questions, answers, annotationsForCheck]);

  const widePreview = useMatchMedia("(min-width: 720px)");

  const handleSubmit = () => {
    const payload: Record<string, ClarifyAnswerValue> = { ...answers };
    const annotations: Record<string, ClarifyAnswerAnnotation> = {
      ...annotationsForCheck,
    };
    for (const q of questions) {
      const note = notes[q.id]?.trim();
      if (note) annotations[q.id] = { notes: note };
      if (
        clarifyQuestionAllowsFreeform(q) &&
        note &&
        payload[q.id] == null &&
        !q.options?.length
      ) {
        payload[q.id] = CLARIFY_FREEFORM_ANSWER_ID;
      }
    }
    onSubmit(payload, Object.keys(annotations).length ? annotations : undefined);
  };

  const questionBody = activeQuestion ? (
    <>
      <p className="chat-clarify-prompt">{activeQuestion.prompt}</p>

      {activeQuestion.options?.length ? (
        <div className="chat-clarify-options">
          {activeQuestion.options.map((opt) => {
            const raw = answers[activeQuestion.id];
            const checked = activeQuestion.multiSelect
              ? Array.isArray(raw) && raw.includes(opt.id)
              : raw === opt.id;
            return (
              <label
                key={opt.id}
                className={`chat-clarify-option${checked ? " selected" : ""}${opt.recommended ? " recommended" : ""}`}
              >
                <input
                  type={activeQuestion.multiSelect ? "checkbox" : "radio"}
                  name={`clarify-${activeQuestion.id}`}
                  checked={checked}
                  disabled={loading}
                  onChange={() =>
                    activeQuestion.multiSelect
                      ? toggleMultiAnswer(activeQuestion.id, opt.id)
                      : setSingleAnswer(activeQuestion.id, opt.id)
                  }
                />
                <span className="chat-clarify-option-label">
                  {opt.label}
                  {opt.recommended ? (
                    <span className="chat-clarify-tag">推荐</span>
                  ) : null}
                </span>
                {opt.description ? (
                  <span className="chat-clarify-option-desc">{opt.description}</span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}

      {clarifyQuestionAllowsFreeform(activeQuestion) ? (
        <label className="chat-clarify-notes">
          <span className="chat-clarify-field-label">
            {activeQuestion.options?.length ? "补充说明（可选）" : "请说明你的偏好"}
          </span>
          <textarea
            className="chat-clarify-textarea"
            rows={2}
            disabled={loading}
            value={notes[activeQuestion.id] ?? ""}
            onChange={(e) =>
              setNotes((prev) => ({ ...prev, [activeQuestion.id]: e.target.value }))
            }
            placeholder="自由补充你的偏好或约束…"
          />
        </label>
      ) : null}
    </>
  ) : null;

  return (
    <article className="chat-clarify" aria-label="澄清问题">
      <header className="chat-clarify-head">
        <span className="chat-clarify-label">澄清</span>
        {clarify.title ? (
          <strong className="chat-clarify-title">{clarify.title}</strong>
        ) : null}
      </header>

      {clarify.introHtml ? (
        <ChatSanitizedHtml html={clarify.introHtml} className="chat-clarify-intro" />
      ) : null}

      {multiTab ? (
        <div className="chat-clarify-tabs" role="tablist">
          {visibleEntries.map(({ q, i }) => {
            const answered = isClarifyQuestionAnswered(
              q,
              questions,
              i,
              answers,
              annotationsForCheck,
            );
            const marker = answered ? "✓" : "○";
            return (
              <button
                key={q.id}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                className={`chat-clarify-tab${i === activeIndex ? " active" : ""}${answered ? " done" : ""}`}
                onClick={() => setActiveIndex(i)}
                title={q.prompt}
              >
                <span className="chat-clarify-tab-marker" aria-hidden="true">
                  {marker}
                </span>
                {i + 1}. {q.prompt.length > 16 ? `${q.prompt.slice(0, 16)}…` : q.prompt}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="chat-clarify-layout">
        <div className="chat-clarify-main">
          {questionBody}
          {selectedPreview && !widePreview ? (
            <div className="chat-clarify-preview-inline">
              <ClarifyPreview preview={selectedPreview} />
            </div>
          ) : null}
        </div>
        {selectedPreview && widePreview ? (
          <aside className="chat-clarify-preview-side" aria-label="选项预览">
            <span className="chat-clarify-preview-side-label">预览</span>
            <ClarifyPreview preview={selectedPreview} />
          </aside>
        ) : null}
      </div>

      <footer className="chat-clarify-actions">
        <button
          type="button"
          className="btn primary"
          disabled={loading || !canSubmit}
          onClick={handleSubmit}
        >
          {loading ? "提交中…" : "确认并继续"}
        </button>
        <button type="button" className="btn" disabled={loading} onClick={onDismiss}>
          跳过
        </button>
      </footer>
    </article>
  );
}
