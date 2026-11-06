export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_KEY = 'integrar-theme';
// Executado inline no <head>, antes da primeira pintura: evita o "flash" de tema errado.
// Resolve a preferência salva (ou a do sistema) em data-theme e acompanha mudanças do sistema.
export const themeBootScript = `(function(){var d=document.documentElement,m=window.matchMedia('(prefers-color-scheme: dark)');function apply(){var p='system';try{p=localStorage.getItem('${THEME_KEY}')||'system'}catch(e){}if(p!=='light'&&p!=='dark')p='system';d.dataset.themePref=p;d.dataset.theme=p==='dark'||(p==='system'&&m.matches)?'dark':'light'}apply();window.__applyTheme=apply;try{m.addEventListener('change',apply)}catch(e){}})();`;
export function readThemePreference(): ThemePreference {
  const p = document.documentElement.dataset.themePref;
  return p === 'light' || p === 'dark' ? p : 'system';
}
let transitionTimer: ReturnType<typeof setTimeout> | undefined;
export function setThemePreference(p: ThemePreference) {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 400);
  try {
    if (p === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, p);
  } catch {}
  const apply = (window as unknown as { __applyTheme?: () => void }).__applyTheme;
  if (apply) apply();
  else {
    document.documentElement.dataset.themePref = p;
    document.documentElement.dataset.theme =
      p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light';
  }
}
