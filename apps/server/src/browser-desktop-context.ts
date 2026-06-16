import {
  extWidgetId,
  oxspSlotLabel,
  SYSTEM_MAIN_CONVERSATION_ID,
  type PinDesktopScope,
} from "@openx/shared";
import { isWidgetPinnedInWorkspace } from "@openx/shared";
import { getDesktopBundle } from "./desktop-service.js";
import { browserDomSnapshot, browserNetworkLog, ensureBrowserSession } from "./browser-session.js";

const DOM_TEXT_LIMIT = 4_000;
const NETWORK_TAIL = 12;

export function pinDesktopScopeForConversation(conversationId: string): PinDesktopScope {
  return conversationId === SYSTEM_MAIN_CONVERSATION_ID ? "console" : "conversation";
}

/** 已 Pin 的 browser 槽 → 工头 LLM 可读文本（DOM + 网络摘要） */
export async function buildBrowserDesktopContext(scope: PinDesktopScope): Promise<string | undefined> {
  const bundle = getDesktopBundle(scope);
  const pinnedBrowserSlots = bundle.catalog.slots.filter((slot) => {
    if (slot.config.kind !== "browser") return false;
    return isWidgetPinnedInWorkspace(bundle.workspace, extWidgetId(slot.id));
  });
  if (pinnedBrowserSlots.length === 0) return undefined;

  const sections: string[] = [
    "## 浏览器拓展槽（工头实时可见）",
    "以下内容为当前 Pin 在桌面上的 CDP 浏览器快照；用户与你在同一页面视觉对齐。",
    "操控：POST /api/desktop/slots/:slotId/command（navigate / browser_click / browser_type / browser_screenshot / browser_dom / browser_network）。",
  ];

  for (const slot of pinnedBrowserSlots) {
    const cfg = slot.config;
    if (cfg.kind !== "browser") continue;
    const sessionId = cfg.sessionId ?? slot.id;
    const startUrl = cfg.startUrl;
    try {
      await ensureBrowserSession(sessionId, startUrl);
    } catch {
      sections.push(`### ${oxspSlotLabel(slot)} (${slot.id})`, "（浏览器会话未就绪）", "");
      continue;
    }
    const dom = await browserDomSnapshot(sessionId);
    const network = browserNetworkLog(sessionId);
    sections.push(
      `### ${oxspSlotLabel(slot)} · slotId=${slot.id} · session=${sessionId}`,
      `URL: ${dom.url || startUrl || "(空)"}`,
      `Title: ${dom.title || "(无标题)"}`,
    );
    if (dom.text.trim()) {
      const text =
        dom.text.length > DOM_TEXT_LIMIT
          ? `${dom.text.slice(0, DOM_TEXT_LIMIT)}\n…(截断 ${dom.text.length - DOM_TEXT_LIMIT} 字)`
          : dom.text;
      sections.push("", "#### 页面文本", text);
    }
    if (dom.links.length > 0) {
      sections.push(
        "",
        "#### 链接（前 8）",
        dom.links
          .slice(0, 8)
          .map((l) => `- ${l.text || "(无文字)"} → ${l.href}`)
          .join("\n"),
      );
    }
    if (dom.inputs.length > 0) {
      sections.push(
        "",
        "#### 表单控件（前 6）",
        dom.inputs
          .slice(0, 6)
          .map((i) => `- ${i.tag}${i.type ? `[${i.type}]` : ""} name=${i.name || "-"} placeholder=${i.placeholder || "-"}`)
          .join("\n"),
      );
    }
    if (network.length > 0) {
      const tail = network.slice(-NETWORK_TAIL);
      sections.push(
        "",
        `#### 最近网络请求（${network.length} 条，末 ${tail.length} 条）`,
        tail
          .map(
            (e) =>
              `- [${new Date(e.ts).toISOString()}] ${e.method} ${e.status ?? "-"} ${e.mimeType ?? ""} ${e.url.slice(0, 160)}`,
          )
          .join("\n"),
      );
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}
