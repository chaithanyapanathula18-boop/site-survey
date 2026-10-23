// Which address the app should be served from.

// Sign-in with redirect needs the page and the auth handler on the same origin, and the Firebase
// config names PROJECT.firebaseapp.com as the auth domain. So PROJECT.web.app moves over to
// PROJECT.firebaseapp.com. Preview channels (PROJECT--channel-xyz.web.app) have no firebaseapp.com
// twin, so they are never redirected.
export function hostingRedirectTarget(loc) {
  const m = /^([a-z0-9-]+)\.web\.app$/i.exec(loc.hostname || '');
  if (!m || m[1].includes('--')) return null;
  return `https://${m[1]}.firebaseapp.com${loc.pathname || '/'}${loc.search || ''}${loc.hash || ''}`;
}
