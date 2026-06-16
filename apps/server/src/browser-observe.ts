/** 页内查找（browserface 式 window.find） */
export async function runBrowserFind(
  page: import("puppeteer-core").Page,
  query: string,
  direction: "next" | "prev" = "next",
  fromStart = false,
): Promise<{ current: number; total: number; found: boolean }> {
  return page.evaluate(
    (q, dir, restart) => {
      if (!q.trim()) return { current: 0, total: 0, found: false };
      if (restart) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
      }
      const found = (
        window as unknown as {
          find: (
            query: string,
            caseSensitive: boolean,
            backwards: boolean,
            wrapAround: boolean,
            wholeWord: boolean,
            searchInFrames: boolean,
            showDialog: boolean,
          ) => boolean;
        }
      ).find(q, false, dir === "prev", true, false, true, restart);
      return { current: found ? 1 : 0, total: found ? 1 : 0, found };
    },
    query,
    direction,
    fromStart,
  );
}

export async function runBrowserFindStop(page: import("puppeteer-core").Page): Promise<void> {
  await page.evaluate(() => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
  });
}

export type BrowserDomSnapshot = {
  url: string;
  title: string;
  text: string;
  links: { text: string; href: string }[];
  inputs: { tag: string; type: string; name: string; placeholder: string }[];
};

export async function captureBrowserDom(page: import("puppeteer-core").Page): Promise<BrowserDomSnapshot> {
  return page.evaluate(() => {
    const links = [...document.querySelectorAll("a[href]")]
      .slice(0, 40)
      .map((a) => ({
        text: (a.textContent ?? "").trim().slice(0, 120),
        href: (a as HTMLAnchorElement).href,
      }));
    const inputs = [...document.querySelectorAll("input,textarea,select")]
      .slice(0, 30)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? "",
        name: (el as HTMLInputElement).name ?? "",
        placeholder: (el as HTMLInputElement).placeholder ?? "",
      }));
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").slice(0, 12_000),
      links,
      inputs,
    };
  });
}

export type BrowserNetworkEntry = {
  id: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  ts: number;
};

export function createNetworkLog(max = 80): {
  entries: BrowserNetworkEntry[];
  push(entry: BrowserNetworkEntry): void;
  list(): BrowserNetworkEntry[];
} {
  const entries: BrowserNetworkEntry[] = [];
  return {
    entries,
    push(entry) {
      entries.push(entry);
      if (entries.length > max) entries.shift();
    },
    list() {
      return [...entries];
    },
  };
}
