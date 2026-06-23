import { useCallback, useEffect, useMemo, useState } from "react";
import type { KnowledgeEntry, KnowledgeSourceRef } from "@openx/shared";
import { api } from "../api";

type Mode = "project" | "global";

type Props = {
  mode: Mode;
  projectId?: string;
  projectName?: string;
  /** 嵌入首页/项目页时使用 */
  embedded?: boolean;
};

const SOURCE_STATUS_LABELS: Record<KnowledgeSourceRef["status"], string> = {
  pending: "等待",
  indexing: "导入中",
  ready: "已就绪",
  error: "失败",
};

function formatEntryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function entryPreview(content: string, max = 220): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}…`;
}

export function KnowledgeSpacePanel({
  mode,
  projectId,
  projectName,
  embedded = false,
}: Props) {
  const [sources, setSources] = useState<KnowledgeSourceRef[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [uriDraft, setUriDraft] = useState("");
  const [importingSource, setImportingSource] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === "global") return "全局知识库";
    return `${projectName ?? "项目"} · 知识库`;
  }, [mode, projectName]);

  const subtitle = useMemo(() => {
    if (mode === "global") {
      return "添加路径后自动导入并生成摘要；全局对话可引用此列表。";
    }
    return "添加路径后自动导入并生成摘要；本项目对话可引用此列表。";
  }, [mode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "global") {
        const [srcRes, knowledgeRes] = await Promise.all([
          api.getGlobalKnowledgeSources(),
          api.getGlobalKnowledge(),
        ]);
        setSources(srcRes.sources);
        setEntries(knowledgeRes.entries);
      } else if (projectId) {
        const res = await api.getProjectKnowledge(projectId);
        setSources(res.sources ?? []);
        setEntries(res.entries ?? []);
      } else {
        setSources([]);
        setEntries([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addSource = async () => {
    const uri = uriDraft.trim();
    if (!uri) {
      setError("请填写路径");
      return;
    }
    setImportingSource(true);
    setError(null);
    setStatus(null);
    try {
      const body = { uri };
      if (mode === "global") {
        await api.createGlobalKnowledgeSource(body);
      } else if (projectId) {
        await api.createProjectKnowledgeSource(projectId, body);
      }
      setUriDraft("");
      setStatus("已添加，正在导入并生成摘要…");
      await load();
      setStatus("知识已导入");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingSource(false);
    }
  };

  const reindexSource = async (sourceId: string) => {
    setImportingSource(true);
    setError(null);
    try {
      if (mode === "global") {
        await api.reindexGlobalKnowledgeSource(sourceId);
      } else if (projectId) {
        await api.reindexProjectKnowledgeSource(projectId, sourceId);
      }
      setStatus("已刷新");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingSource(false);
    }
  };

  const removeSource = async (sourceId: string) => {
    setImportingSource(true);
    setError(null);
    try {
      if (mode === "global") {
        await api.deleteGlobalKnowledgeSource(sourceId);
      } else if (projectId) {
        await api.deleteProjectKnowledgeSource(projectId, sourceId);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingSource(false);
    }
  };

  return (
    <section
      className={`knowledge-space-panel${embedded ? " knowledge-space-panel-embedded" : ""}`}
    >
      <div className="knowledge-space-head">
        <div>
          <h3 className="knowledge-space-title">{title}</h3>
          <p className="knowledge-space-subtitle">{subtitle}</p>
        </div>
      </div>

      {loading ? <p className="dashboard-muted">加载中…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {status ? <p className="settings-saved">{status}</p> : null}

      <div className="knowledge-space-section">
        <div className="knowledge-add-row">
          <input
            className="input knowledge-add-uri"
            placeholder="路径，如 D:\docs\react 或 https://react.dev"
            value={uriDraft}
            onChange={(e) => setUriDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addSource();
            }}
          />
          <button
            type="button"
            className="btn compact primary"
            disabled={importingSource}
            onClick={() => void addSource()}
          >
            {importingSource ? "处理中…" : "添加"}
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="dashboard-muted">还没有知识来源，添加路径开始。</p>
        ) : (
          <ul className="knowledge-entry-list">
            {sources.map((source) => (
              <li key={source.id} className="knowledge-entry-item">
                <div className="knowledge-entry-meta">
                  <strong>{source.label}</strong>
                  <span>{SOURCE_STATUS_LABELS[source.status]}</span>
                </div>
                <pre className="knowledge-entry-preview">{source.uri}</pre>
                {source.error ? <p className="form-error">{source.error}</p> : null}
                <div className="knowledge-entry-actions">
                  <button
                    type="button"
                    className="btn compact"
                    disabled={importingSource}
                    onClick={() => void reindexSource(source.id)}
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    className="btn compact"
                    disabled={importingSource}
                    onClick={() => void removeSource(source.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="knowledge-space-section">
        <h4 className="knowledge-space-section-head">已导入条目</h4>
        {entries.length === 0 ? (
          <p className="dashboard-muted">暂无知识条目，导入来源后会在此显示摘要预览。</p>
        ) : (
          <ul className="knowledge-entry-list">
            {entries.map((entry) => (
              <li key={entry.id} className="knowledge-entry-item">
                <div className="knowledge-entry-meta">
                  <strong>{entry.title}</strong>
                  <span>{entry.source}</span>
                  <span>{formatEntryTime(entry.updatedAt)}</span>
                </div>
                {entry.sourceUri ? (
                  <p className="knowledge-entry-meta">
                    <span>来源：{entry.sourceUri}</span>
                  </p>
                ) : null}
                <p className="knowledge-entry-preview">{entryPreview(entry.content)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
