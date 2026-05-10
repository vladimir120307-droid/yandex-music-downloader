// Core — service registry + shared utils
(function () {
  const services = {};

  globalThis.YMD = globalThis.YMD || {};

  globalThis.YMD.registry = {
    register(svc) {
      if (!svc || !svc.name) throw new Error('Service must have a name');
      services[svc.name] = svc;
    },
    get(name) { return services[name] || null; },
    all() { return Object.values(services); },

    // Detect service from a URL
    detectByUrl(url) {
      for (const svc of Object.values(services)) {
        try {
          const parsed = svc.parseUrl?.(url);
          if (parsed) return { service: svc, parsed };
        } catch { /* try next */ }
      }
      return null;
    },

    // Detect service from current hostname (for in-page)
    detectByHost(hostname) {
      for (const svc of Object.values(services)) {
        const domains = svc.domains || [];
        if (domains.some(d => hostname === d || hostname.endsWith('.' + d))) return svc;
      }
      return null;
    },
  };

  globalThis.YMD.utils = {
    sanitize(s) {
      return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 200);
    },
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

    makeFilename(artist, title, ext) {
      const u = globalThis.YMD.utils;
      const a = u.sanitize(artist), t = u.sanitize(title);
      const e = (ext || 'mp3').replace(/^\./, '');
      if (a && t) return `${a} - ${t}.${e}`;
      if (t) return `${t}.${e}`;
      return `track.${e}`;
    },
  };
})();
