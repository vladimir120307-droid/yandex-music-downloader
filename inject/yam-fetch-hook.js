// MAIN-world fetch hook для music.yandex.*
// Перехватывает реальные вызовы страницы к api.music.yandex.net и забирает
// Authorization-токен. Дальше расширение использует его для скачивания.
//
// Manifest подключает этот файл с world: "MAIN" и run_at: "document_start",
// чтобы хук установился ДО первого fetch страницы.

(function () {
  if (window.__YMD_FETCH_HOOK__) return;
  window.__YMD_FETCH_HOOK__ = true;

  const API_HOST = 'api.music.yandex.net';
  let lastReported = '';

  function reportToken(token, source) {
    if (!token || token === lastReported) return;
    if (typeof token !== 'string' || token.length < 20) return;
    lastReported = token;
    try {
      window.postMessage({ type: 'ymd-yam-fetch-token', token, source }, '*');
    } catch {}
  }

  function extractFromAuthValue(v) {
    if (typeof v !== 'string') return '';
    const m = v.match(/(?:OAuth|Bearer)\s+([A-Za-z0-9_.\-]+)/i);
    return m ? m[1].trim() : '';
  }

  function extractFromHeaders(headers) {
    try {
      if (!headers) return '';
      if (headers instanceof Headers) return extractFromAuthValue(headers.get('Authorization') || headers.get('authorization') || '');
      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (Array.isArray(pair) && pair[0] && pair[0].toLowerCase() === 'authorization') {
            return extractFromAuthValue(pair[1]);
          }
        }
        return '';
      }
      if (typeof headers === 'object') {
        for (const k in headers) {
          if (k.toLowerCase() === 'authorization') return extractFromAuthValue(headers[k]);
        }
      }
    } catch {}
    return '';
  }

  // 1) window.fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        let url = '';
        let requestHeaders = null;
        if (typeof input === 'string') url = input;
        else if (input && input.url) { url = input.url; requestHeaders = input.headers; }
        if (url && url.indexOf(API_HOST) !== -1) {
          const t = extractFromHeaders((init && init.headers) || requestHeaders);
          if (t) reportToken(t, 'fetch');
        }
      } catch {}
      return origFetch.apply(this, arguments);
    };
  }

  // 2) XMLHttpRequest — пишем url в _ymdUrl при open(), забираем токен в setRequestHeader()
  try {
    const X = XMLHttpRequest.prototype;
    const origOpen = X.open;
    const origSetHeader = X.setRequestHeader;
    X.open = function (method, url) {
      try { this._ymdUrl = url; } catch {}
      return origOpen.apply(this, arguments);
    };
    X.setRequestHeader = function (name, value) {
      try {
        if (typeof name === 'string' && name.toLowerCase() === 'authorization' &&
            this._ymdUrl && this._ymdUrl.indexOf(API_HOST) !== -1) {
          const t = extractFromAuthValue(value);
          if (t) reportToken(t, 'xhr');
        }
      } catch {}
      return origSetHeader.apply(this, arguments);
    };
  } catch {}
})();
