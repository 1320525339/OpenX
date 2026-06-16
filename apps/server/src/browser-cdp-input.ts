import type {
  BrowserClientAction,
  BrowserModifierKey,
  BrowserMouseButton,
  BrowserScreenshotMessage,
} from "@openx/shared";

export function modifiersToCdpBits(mods: BrowserModifierKey[] | undefined): number {
  if (!mods?.length) return 0;
  let bits = 0;
  for (const mod of mods) {
    if (mod === "Alt") bits |= 1;
    if (mod === "Control") bits |= 2;
    if (mod === "Meta") bits |= 4;
    if (mod === "Shift") bits |= 8;
  }
  return bits;
}

export function cdpMouseButton(button: BrowserMouseButton | undefined): "left" | "middle" | "right" {
  if (button === "middle") return "middle";
  if (button === "right") return "right";
  return "left";
}

export function cdpButtonsMask(buttons: BrowserMouseButton[] | undefined): number {
  if (!buttons?.length) return 0;
  let mask = 0;
  if (buttons.includes("left")) mask |= 1;
  if (buttons.includes("right")) mask |= 2;
  if (buttons.includes("middle")) mask |= 4;
  return mask;
}

export function clampViewportPoint(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.min(width - 1, Math.max(0, Math.round(x))),
    y: Math.min(height - 1, Math.max(0, Math.round(y))),
  };
}

export function legacyClickAction(x: number, y: number): BrowserClientAction {
  return { type: "click", x, y, button: "left", clickCount: 1 };
}

export function toScreenshotMessage(input: {
  data: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  frame: number;
  url: string;
  mock: boolean;
}): BrowserScreenshotMessage {
  return {
    type: "screenshot",
    encoding: "base64",
    format: "jpeg",
    data: input.data,
    width: input.width,
    height: input.height,
    deviceScaleFactor: input.deviceScaleFactor,
    frame: input.frame,
    capturedAt: Date.now(),
    url: input.url,
    mock: input.mock,
  };
}
