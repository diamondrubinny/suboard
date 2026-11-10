/**
 * Picks the design system theme (data-theme on <html>):
 * `contrast` when the accessibility toolbar asks for it, else `dark` when the OS prefers it, else `light`.
 */
let contrast = false;
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyTheme(): void {
  const theme = contrast ? 'contrast' : media?.matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

export function setHighContrast(on: boolean): void {
  contrast = on;
  applyTheme();
}

export function initTheme(): void {
  media?.addEventListener('change', applyTheme);
  applyTheme();
}
