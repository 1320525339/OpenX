import { useState } from "react";
import type { McpServerConfig } from "@openx/shared";
import { api } from "../../api";

type Props = {
  servers: McpServerConfig[];
  onSaved: (servers: McpServerConfig[]) => void;
};

export function ToolsMcpTab({ servers, onSaved }: Props) {
  const [local, setLocal] = useState(servers);
  const [saving, setSaving] = useState(false);

  const addRow = () => {
    setLocal((prev) => [
      ...prev,
      {
        id: `mcp-${Date.now()}`,
        name: "新 MCP",
        command: "npx",
        args: [],
        enabled: true,
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.putMcp(local);
      onSaved(res.servers);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tools-section">
      <p className="settings-hint">
        配置 MCP Server，派单给 ACP 施工队时会传入已启用的条目。对话栏 MCP 选择与此处 id 对齐。
      </p>
      <div className="tools-mcp-list">
        {local.map((row, i) => (
          <div key={row.id} className="tools-mcp-row">
            <label className="form-label">ID</label>
            <input
              className="field-input"
              value={row.id}
              onChange={(e) => {
                const v = e.target.value;
                setLocal((prev) =>
                  prev.map((r, j) => (j === i ? { ...r, id: v } : r)),
                );
              }}
            />
            <label className="form-label">名称</label>
            <input
              className="field-input"
              value={row.name}
              onChange={(e) => {
                const v = e.target.value;
                setLocal((prev) =>
                  prev.map((r, j) => (j === i ? { ...r, name: v } : r)),
                );
              }}
            />
            <label className="form-label">命令</label>
            <input
              className="field-input"
              value={row.command}
              onChange={(e) => {
                const v = e.target.value;
                setLocal((prev) =>
                  prev.map((r, j) => (j === i ? { ...r, command: v } : r)),
                );
              }}
            />
            <label className="form-label">参数（空格分隔）</label>
            <input
              className="field-input"
              value={row.args.join(" ")}
              onChange={(e) => {
                const args = e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [];
                setLocal((prev) =>
                  prev.map((r, j) => (j === i ? { ...r, args } : r)),
                );
              }}
            />
            <label className="mech-switch">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setLocal((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, enabled } : r)),
                  );
                }}
              />
              启用
            </label>
          </div>
        ))}
      </div>
      <div className="tools-tab-toolbar-actions">
        <button type="button" className="btn" onClick={addRow}>
          ＋ 添加 MCP
        </button>
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存 MCP 配置"}
        </button>
      </div>
    </div>
  );
}
