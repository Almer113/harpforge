// Installing HarpForge as an app: the service worker (dist/sw.js, see src/pwa/sw.js) keeps
// a copy of the app so it opens offline. Only in a build (the dev server always serves
// fresh files), and only where the browser allows one: https, or this computer itself.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const start = () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // (No copy kept: the app still works online, as before.)
    });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
