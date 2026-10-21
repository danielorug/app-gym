import { useSyncExternalStore } from 'react';

function current(): string {
  return location.hash.replace(/^#\/?/, '');
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

/** Ruta actual como segmentos: "#/sesion/abc" → ["sesion", "abc"]. */
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, current);
  return hash.split('/').filter(Boolean).map(decodeURIComponent);
}

export function navigate(path: string, { replace = false } = {}) {
  const url = '#/' + path.replace(/^\/+/, '');
  if (replace) {
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = url;
  }
  window.scrollTo(0, 0);
}

export function goBack(fallback: string) {
  if (history.state !== null || history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}
