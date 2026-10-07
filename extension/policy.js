// Shared by the isolated content script and extension service worker.
// These exact origins are the only pages allowed to request native opening.
globalThis.cloePolicy = (() => {
  const teamsOrigins = new Set([
    'https://teams.microsoft.com',
    'https://teams.cloud.microsoft',
  ]);
  const internalOrigins = new Set([
    ...teamsOrigins,
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
    isTeamsPage(value) {
      const url = parse(value);
      return !!url && teamsOrigins.has(url.origin);
    },
    externalUrl(value) {
      const url = parse(value);
      return url && !internalOrigins.has(url.origin) ? url.href : null;
    },
  });
})();
