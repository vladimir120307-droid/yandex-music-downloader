// Music Downloader — Popup v3.0

document.addEventListener('DOMContentLoaded', () => {
  const noTrackEl = document.getElementById('no-track');
  const trackInfoEl = document.getElementById('current-track');
  const titleEl = document.getElementById('track-title');
  const artistEl = document.getElementById('track-artist');
  const downloadBtn = document.getElementById('download-btn');
  const statusEl = document.getElementById('status');
  const saveAsToggle = document.getElementById('save-as-toggle');
  const urlInput = document.getElementById('url-input');
  const urlHint = document.getElementById('url-hint');
  const pasteBtn = document.getElementById('paste-btn');
  const pasteProgress = document.getElementById('paste-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // ═══ Save As toggle ═══
  chrome.storage.local.get('saveAs', (data) => { saveAsToggle.checked = !!data.saveAs; });
  saveAsToggle.addEventListener('change', () => {
    chrome.storage.local.set({ saveAs: saveAsToggle.checked });
  });

  // ═══ Current track (Yandex only, via content script) ═══
  chrome.runtime.sendMessage({ action: 'getCurrentTrack' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp?.success && resp.trackId) {
      noTrackEl.style.display = 'none';
      trackInfoEl.style.display = 'flex';
      titleEl.textContent = resp.title || 'Трек #' + resp.trackId;
      artistEl.textContent = resp.artist || '—';
    }
  });

  downloadBtn.addEventListener('click', () => {
    downloadBtn.classList.add('loading');
    statusEl.style.display = 'none';
    chrome.runtime.sendMessage({ action: 'dlCurrentTrack' }, (resp) => {
      downloadBtn.classList.remove('loading');
      if (chrome.runtime.lastError) { showStatus('Перезагрузите страницу (F5)', 'error'); return; }
      if (resp?.success) showStatus('✓ ' + (resp.filename || 'Скачивание начато'), 'success');
      else showStatus(resp?.error || 'Ошибка скачивания', 'error');
    });
  });

  // ═══ Paste URL flow ═══
  let detectTimeout = null;
  urlInput.addEventListener('input', () => {
    clearTimeout(detectTimeout);
    const url = urlInput.value.trim();
    if (!url) { urlHint.textContent = ''; urlHint.className = 'url-hint'; return; }
    detectTimeout = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'detectUrl', url }, (resp) => {
        if (resp?.success) {
          urlHint.textContent = `${resp.displayName} · ${typeLabel(resp.type)}`;
          urlHint.className = 'url-hint ok';
        } else {
          urlHint.textContent = 'Сервис не распознан';
          urlHint.className = 'url-hint warn';
        }
      });
    }, 200);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pasteBtn.click();
  });

  pasteBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) { showStatus('Вставьте ссылку', 'error'); return; }
    statusEl.style.display = 'none';
    pasteBtn.disabled = true;
    pasteBtn.textContent = 'Скачиваю…';
    pasteProgress.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Получаю треки…';
    chrome.runtime.sendMessage({ action: 'pasteDownload', url }, (resp) => {
      pasteBtn.disabled = false;
      pasteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Скачать';
      if (chrome.runtime.lastError) { showStatus('Ошибка: ' + chrome.runtime.lastError.message, 'error'); return; }
      if (resp?.success) showStatus(`✓ Скачано ${resp.downloaded}/${resp.total}`, 'success');
      else showStatus(resp?.error || 'Ошибка скачивания', 'error');
    });
  });

  // Progress messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'pasteProgress') return;
    if (msg.status === 'starting') {
      progressText.textContent = `${msg.service} · загружаю…`;
      progressFill.style.width = '5%';
    } else if (msg.status === 'progress') {
      const pct = Math.round((msg.current / msg.total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = `${msg.current}/${msg.total} · ${msg.title || ''}`.slice(0, 80);
    } else if (msg.status === 'done') {
      progressFill.style.width = '100%';
      progressText.textContent = `Готово: ${msg.downloaded}/${msg.total}`;
    } else if (msg.status === 'error') {
      progressText.textContent = msg.message || 'Ошибка';
    }
  });

  function typeLabel(type) {
    switch (type) {
      case 'track': return 'трек';
      case 'album': return 'альбом';
      case 'playlist': return 'плейлист';
      case 'discography': return 'дискография';
      default: return type;
    }
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    statusEl.style.display = 'block';
  }
});
