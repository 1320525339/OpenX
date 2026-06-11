import type { ExecutorInfo } from "../api";
import { buildExecutorOptions } from "../lib/executors";

type Props = {
  value: string;
  onChange: (id: string) => void;
  executors: ExecutorInfo[];
  includeAuto?: boolean;
  disabled?: boolean;
  label?: string;
  recommendedId?: string;
  recommendReason?: string;
};

export function ExecutorPicker({
  value,
  onChange,
  executors,
  includeAuto = true,
  disabled,
  label = "执行器",
  recommendedId,
  recommendReason,
}: Props) {
  const options = buildExecutorOptions(executors, includeAuto);
  const selected = options.find((o) => o.id === value) ?? options[0];

  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <select
        className="mech-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id} disabled={!opt.selectable}>
            {opt.label}
            {opt.id === recommendedId && opt.id !== value ? "（推荐）" : ""}
            {!opt.available && opt.bootstrappable ? "（未在线·自动自举）" : ""}
            {!opt.selectable ? "（不可用）" : ""}
          </option>
        ))}
      </select>
      {recommendedId && recommendedId !== value && recommendReason && (
        <p className="settings-hint tools-exec-recommend">
          建议改用 <button type="button" className="btn linkish compact" onClick={() => onChange(recommendedId)}>
            {recommendedId}
          </button>
          ：{recommendReason}
        </p>
      )}
      {selected?.hint && (
        <p className="settings-hint" style={{ marginTop: "0.35rem" }}>
          {selected.hint}
        </p>
      )}
    </div>
  );
}
