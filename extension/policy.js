// Shared by the isolated content script and extension service worker.
// These exact origins are the only pages allowed to request native opening.
globalThis.cloePolicy = (() => {
  const appOrigins = new Set([
    'https://teams.microsoft.com',
    'https://teams.cloud.microsoft',
    'https://outlook.office.com',
    'https://outlook.office365.com',
    'https://outlook.cloud.microsoft',
    'https://outlook.live.com',
  ]);
  const internalOrigins = new Set([
    ...appOrigins,
    'https://login.microsoftonline.com',
    'https://login.microsoft.com',
    'https://login.live.com',
  ]);
  function parse(value) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }
  return Object.freeze({
    isCalendarFrame(value) {
      const url = parse(value);
      return !!url && url.origin === 'https://outlook.office.com' &&
        /^\/hosted\/calendar(?:\/|$)/.test(url.pathname);
    },
    isAllowedPage(value) {
      const url = parse(value);
      return !!url && appOrigins.has(url.origin);
    },
    externalUrl(value) {
      const url = parse(value);
      return url && !internalOrigins.has(url.origin) ? url.href : null;
    },
  });
})();
