/**
 * The folder the app is served from, without a trailing slash: "" at the root, "/test" when built
 * with VITE_BASE_PATH=/test/ (e.g. https://example.org/test). Every absolute URL the app builds —
 * API calls, download links, QR / form links, the service worker — goes through these helpers.
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** "/api/boards/1/export.csv" → "/test/api/boards/1/export.csv". `path` starts with "/". */
export const apiUrl = (path: string): string => `${BASE}/api${path}`;

/** Absolute in-app URL for sharing (QR codes, form links). `path` starts with "/". */
export const appLink = (path: string): string => `${window.location.origin}${BASE}${path}`;
