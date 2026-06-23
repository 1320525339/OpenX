import type { MouseEvent } from "react";
import type { ThemePreference } from "../lib/theme";
import type { ThemeTransitionRequest } from "../lib/use-theme-ripple";

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "geek", label: "极客" },
  { id: "system", label: "跟随系统" },
];

type Props = {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
  onChangeWithRipple?: (request: ThemeTransitionRequest) => void;
};

export function ThemePreferenceControl({ value, onChange, onChangeWithRipple }: Props) {
  const handleClick = (next: ThemePreference, event: MouseEvent<HTMLButtonElement>) => {
    if (onChangeWithRipple) {
      onChangeWithRipple({
        preference: next,
        originX: event.clientX,
        originY: event.clientY,
      });
      return;
    }
    onChange(next);
  };

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
            onClick={(e) => handleClick(opt.id, e)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
