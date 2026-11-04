/** Example-only preference handling; the widget itself never writes app storage. */
export type DemoTheme = 'light' | 'dark';
const storageKey = 'prismdeck-theme';

function explicitTheme(): DemoTheme | undefined {
  const query = new URL(location.href).searchParams.get('theme');
  if (query === 'light' || query === 'dark') return query;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* Preferences are optional when storage is unavailable. */ }
  return undefined;
}

export function getDemoTheme(): DemoTheme {
  return explicitTheme() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyDemoTheme(theme: DemoTheme, remember = true): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#101010');
  if (!remember) return;
  try { localStorage.setItem(storageKey, theme); } catch { /* Keep the page usable without storage. */ }
  const url = new URL(location.href);
  url.searchParams.set('theme', theme);
  history.replaceState(history.state, '', url);
}

/** Follow the operating system until the visitor explicitly chooses a theme. */
export function watchSystemTheme(onChange: (theme: DemoTheme) => void): () => void {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const change = () => { if (!explicitTheme()) onChange(getDemoTheme()); };
  preference.addEventListener('change', change);
  return () => preference.removeEventListener('change', change);
}
