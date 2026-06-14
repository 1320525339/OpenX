/** 从浏览器自动读取时区与 locale，随对话请求静默附带（用户无需配置） */
export function readClientTimeContext(): {
  clientTimezone?: string;
  clientLocale?: string;
} {
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    return {
      clientTimezone: opts.timeZone || undefined,
      clientLocale: opts.locale?.replace(/_/g, "-") || undefined,
    };
  } catch {
    return {};
  }
}
