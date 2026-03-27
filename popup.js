// Yandex Music Downloader — Popup v2.0

document.addEventListener('DOMContentLoaded', () => {
  const noTrackEl = document.getElementById('no-track');
  const trackInfoEl = document.getElementById('current-track');
  const titleEl = document.getElementById('track-title');
  const artistEl = document.getElementById('track-artist');
  const downloadBtn = document.getElementById('download-btn');
  const statusEl = document.getElementById('status');
  const saveAsToggle = document.getElementById('save-as-toggle');

  chrome.storage.local.get('saveAs', (data) => {
    saveAsToggle.checked = !!data.saveAs;
  });
  saveAsToggle.addEventListener('change', () => {
    chrome.storage.local.set({ saveAs: saveAsToggle.checked });
  });

  chrome.runtime.sendMessage({ action: 'getCurrentTrack' }, (resp) => {
    if (chrome.runtime.lastError) {
      noTrackEl.innerHTML = '<p>Перезагрузите страницу Яндекс Музыки (F5)</p>';
      return;
    }
    if (resp?.success && resp.trackId) {
      noTrackEl.style.display = 'none';
      trackInfoEl.style.display = 'flex';
      titleEl.textContent = resp.title || 'Трек #' + resp.trackId;
      artistEl.textContent = resp.artist || '—';
    } else {
      noTrackEl.innerHTML = '<p>Откройте <strong>Яндекс Музыку</strong> и включите трек</p>';
    }
  });

  downloadBtn.addEventListener('click', () => {
    downloadBtn.classList.add('loading');
    statusEl.style.display = 'none';

    chrome.runtime.sendMessage({ action: 'dlCurrentTrack' }, (resp) => {
      downloadBtn.classList.remove('loading');
      if (chrome.runtime.lastError) {
        showStatus('Перезагрузите страницу (F5)', 'error');
        return;
      }
      if (resp?.success) {
        showStatus('✓ ' + (resp.filename || 'Скачивание начато'), 'success');
      } else {
        showStatus(resp?.error || 'Ошибка скачивания', 'error');
      }
    });
  });

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    statusEl.style.display = 'block';
  }
});
