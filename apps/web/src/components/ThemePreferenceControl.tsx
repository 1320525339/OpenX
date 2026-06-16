import type { ThemePreference } from "../lib/theme";

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "geek", label: "极客" },
  { id: "system", label: "跟随系统" },
];

type Props = {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
};

export function ThemePreferenceControl({ value, onChange }: Props) {
  return (
    <div className="theme-preference-row">
      <span className="theme-preference-label">外观</span>
      <div className="theme-segment" role="radiogroup" aria-label="外观主题">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={value === opt.id}
            className={`theme-segment-btn${value === opt.id ? " active" : ""}`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
