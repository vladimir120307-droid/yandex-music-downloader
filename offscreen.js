// Offscreen document — единственная задача: превратить байты в blob: URL.
// MV3 service worker НЕ имеет URL.createObjectURL, а data: URL имеет лимит
// (~немного МБ) — большие FLAC через него не качаются. Offscreen-документ это
// обычный DOM-контекст, тут createObjectURL работает для файлов любого размера.

const blobUrls = new Map();  // id → url (чтобы потом revoke)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.action === 'makeBlobUrl') {
    try {
      // msg.bytes приходит как обычный массив/Uint8Array (структурированное
      // клонирование). Собираем Blob и отдаём blob: URL.
      const u8 = msg.bytes instanceof Uint8Array ? msg.bytes : new Uint8Array(msg.bytes);
      const blob = new Blob([u8], { type: msg.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      blobUrls.set(msg.id, url);
      sendResponse({ ok: true, url });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
    return true;
  }

  if (msg.action === 'revokeBlobUrl') {
    const url = blobUrls.get(msg.id);
    if (url) { try { URL.revokeObjectURL(url); } catch {} blobUrls.delete(msg.id); }
    sendResponse({ ok: true });
    return true;
  }
});
