// Yandex Music Downloader — Background v2.0

const capturedAudio = {};

const AUDIO_PATTERNS = ['/get-mp3/', '/get-music-mp3/', '/rmusic/', '/music/'];
const AUDIO_TYPES = ['media', 'xmlhttprequest', 'other'];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const isAudio = AUDIO_PATTERNS.some(p => url.includes(p)) ||
      url.match(/\.(mp3|aac|m4a|opus|ogg)(\?|$)/i) ||
      (url.includes('storage.mds.yandex.net') && AUDIO_TYPES.includes(details.type));
    if (!isAudio) return;
    const tabId = details.tabId;
    if (tabId < 0) return;
    if (!capturedAudio[tabId]) capturedAudio[tabId] = [];
    capturedAudio[tabId].unshift({ url, timestamp: Date.now() });
    if (capturedAudio[tabId].length > 20) capturedAudio[tabId] = capturedAudio[tabId].slice(0, 20);
    console.log(`[YMD] Captured audio (tab ${tabId}):`, url.substring(0, 100));
  },
  { urls: ['*://*.storage.mds.yandex.net/*', '*://storage.mds.yandex.net/*', '*://*.strm.yandex.net/*'], types: ['media', 'xmlhttprequest', 'other'] }
);

chrome.tabs.onRemoved.addListener((tabId) => { delete capturedAudio[tabId]; });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'getCapturedAudio') {
    const tabId = message.tabId || sender.tab?.id;
    const urls = capturedAudio[tabId] || [];
    const fresh = urls.filter(u => Date.now() - u.timestamp < 5 * 60 * 1000);
    if (fresh.length > 0) {
      sendResponse({ success: true, url: fresh[0].url, count: fresh.length });
    } else {
      sendResponse({ success: false, error: 'Нет перехваченных URL. Переключите трек.' });
    }
    return true;
  }

  if (message.action === 'download') {
    const url = message.url;
    const filename = message.filename || 'track.mp3';
    chrome.storage.local.get('saveAs', (data) => {
      const saveAs = !!data.saveAs;
      chrome.downloads.download({ url, filename, saveAs }, (downloadId) => {
        if (chrome.runtime.lastError) {
          if (saveAs) {
            chrome.downloads.download({ url, saveAs: true }, (id2) => {
              if (chrome.runtime.lastError) sendResponse({ success: false, error: chrome.runtime.lastError.message });
              else sendResponse({ success: true, downloadId: id2 });
            });
          } else {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          }
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
    });
    return true;
  }

  if (message.action === 'getCurrentTrack') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.url?.includes('music.yandex')) { sendResponse({ success: false, error: 'Откройте music.yandex' }); return; }
      chrome.tabs.sendMessage(tab.id, { action: 'getPlayerInfo' }, (resp) => {
        if (chrome.runtime.lastError) sendResponse({ success: false, error: 'Перезагрузите страницу (F5)' });
        else sendResponse(resp || { success: false });
      });
    });
    return true;
  }

  if (message.action === 'dlCurrentTrack') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.url?.includes('music.yandex')) { sendResponse({ success: false, error: 'Откройте music.yandex' }); return; }
      chrome.tabs.sendMessage(tab.id, { action: 'dlCurrentTrack' }, (resp) => {
        if (chrome.runtime.lastError) sendResponse({ success: false, error: 'Перезагрузите страницу (F5)' });
        else sendResponse(resp || { success: false });
      });
    });
    return true;
  }
});
