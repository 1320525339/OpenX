/** 句读符后额外停顿，增强老式打字机节奏 */
const PUNCTUATION_RE = /[，。！？；：、,.!?;:\n]/;

export type TypewriterStepInput = {
  visible: number;
  targetLength: number;
  deltaMs: number;
  charsPerSecond: number;
  backlogBoost: boolean;
};

export function typewriterCharsPerStep({
  visible,
  targetLength,
  deltaMs,
  charsPerSecond,
  backlogBoost,
}: TypewriterStepInput): number {
  if (visible >= targetLength || deltaMs <= 0) return 0;
  const backlog = targetLength - visible;
  let cps = charsPerSecond;
  if (backlogBoost) {
    if (backlog > 120) cps *= 3;
    else if (backlog > 48) cps *= 2;
    else if (backlog > 16) cps *= 1.45;
  }
  return Math.max(1, Math.floor((deltaMs / 1000) * cps));
}

export function typewriterPauseAfterChar(char: string | undefined): number {
  if (!char) return 0;
  if (char === "\n") return 35;
  return PUNCTUATION_RE.test(char) ? 18 : 0;
}

export function advanceTypewriterVisible(
  visible: number,
  targetText: string,
  deltaMs: number,
  options: { charsPerSecond: number; backlogBoost: boolean; pauseMs: number },
): { next: number; remainingPauseMs: number } {
  if (visible >= targetText.length) {
    return { next: visible, remainingPauseMs: options.pauseMs };
  }
  if (options.pauseMs > 0) {
    const consumed = Math.min(options.pauseMs, deltaMs);
    return { next: visible, remainingPauseMs: options.pauseMs - consumed };
  }

  const chars = typewriterCharsPerStep({
    visible,
    targetLength: targetText.length,
    deltaMs,
    charsPerSecond: options.charsPerSecond,
    backlogBoost: options.backlogBoost,
  });
  const next = Math.min(targetText.length, visible + chars);
  const lastChar = next > visible ? targetText[next - 1] : undefined;
  const pause = typewriterPauseAfterChar(lastChar);
  return { next, remainingPauseMs: pause };
}
