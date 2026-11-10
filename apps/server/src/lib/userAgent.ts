/**
 * Coarse "browser · OS" label from a User-Agent string, for the active-sessions list only. Not used for
 * any security decision (User-Agent is client-controlled).
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'דפדפן לא מזוהה';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /SamsungBrowser\//.test(ua)
          ? 'Samsung Internet'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (!browser && !os) return 'דפדפן לא מזוהה';
  return [browser ?? 'דפדפן', os].filter(Boolean).join(' · ');
}
