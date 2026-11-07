// Проверка расширения в настоящем Chrome: без него регрессии вроде «Без названия»
// (обсуждение #12) и 403 на треке по ссылке (#62) доходили до людей незамеченными.
//
//   node tests/e2e.mjs          — всё
//   node tests/e2e.mjs local    — только то, что не ходит к Яндексу и GitHub
//   node tests/e2e.mjs api      — только запросы к живому API (его же гоняет healthcheck.yml)
//
// Обычный Chrome с версии 137 не принимает --load-extension, поэтому расширение
// загружается через CDP (Extensions.loadUnpacked) в чистый временный профиль.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUP = process.argv[2] || 'all';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));

// Трек и альбом, на которых проверяем API
const TRACK_ID = '152453654';
const ALBUM_ID = '42555963';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (!found) throw new Error('Chrome не найден, укажите путь в CHROME_BIN');
  return found;
}

class Browser {
  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ymd-e2e-'));
    this.downloads = path.join(this.root, 'downloads');
    this.seq = 0;
    this.pending = new Map();
  }

  async start() {
    const profile = path.join(this.root, 'profile');
    fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
    fs.mkdirSync(this.downloads);
    fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
      download: { default_directory: this.downloads, prompt_for_download: false, directory_upgrade: true },
    }));
    this.proc = spawn(findChrome(), [
      `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--headless=new',
      ...(process.env.CI ? ['--no-sandbox'] : []),
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

    let buf = '';
    this.proc.stdio[4].on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    });

    const { id } = await this.send('Extensions.loadUnpacked', { path: EXT_DIR });
    this.extId = id;
    for (let i = 0; i < 50 && !this.worker; i++) {
      const { targetInfos } = await this.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
      if (sw) this.worker = (await this.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
      else await sleep(200);
    }
    if (!this.worker) throw new Error('service worker расширения не запустился');
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }

  async eval(expression, sessionId = this.worker) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  async openPopup() {
    const { targetId } = await this.send('Target.createTarget', { url: `chrome-extension://${this.extId}/popup.html` });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await sleep(800);
    return { targetId, sessionId };
  }

  downloadedFiles() {
    if (!fs.existsSync(this.downloads)) return [];
    return fs.readdirSync(this.downloads, { recursive: true })
      .filter((f) => fs.statSync(path.join(this.downloads, f)).isFile())
      .filter((f) => !/\.(crdownload|tmp)$/.test(f))
      .map((f) => f.split(path.sep).join('/'))
      .sort();
  }

  async waitForFiles(count) {
    for (let i = 0; i < 80 && this.downloadedFiles().length < count; i++) await sleep(250);
    return this.downloadedFiles();
  }

  async stop() {
    this.proc?.kill();
    await sleep(500);
    try { fs.rmSync(this.root, { recursive: true, force: true }); } catch {}
  }
}

// Несколько мегабайт «MP3»: заголовок кадра MPEG и нули. Номер делает data: URL уникальным.
const FAKE_MP3 = `(n) => {
  const b = new Uint8Array(3 * 1024 * 1024);
  for (let o = 0; o < b.length; o += 418) { b[o] = 0xFF; b[o+1] = 0xFB; b[o+2] = 0x90; b[o+3] = 0x64; }
  b[100] = n;
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return 'data:audio/mpeg;base64,' + btoa(s);
}`;

function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: ожидалось ${e}, получено ${a}`);
}

const LOCAL_TESTS = {
  async 'один трек сохраняется под своим именем (#12)'(b) {
    await b.eval(`downloadAndTag({ url: (${FAKE_MP3})(0), codec: 'mp3', filename: 'Артист - Песня.mp3', title: 'Песня', artist: 'Артист' })`);
    assertEqual(await b.waitForFiles(1), ['Артист - Песня.mp3'], 'файлы');
  },

  async 'параллельная загрузка альбома не путает имена'(b) {
    await b.eval(`const mk = ${FAKE_MP3}; Promise.all([1, 2, 3].map((n) => downloadAndTag({
      url: mk(n), codec: 'mp3', filename: 'Альбом/0' + n + ' - Песня ' + n + '.mp3', title: 'Песня ' + n, artist: 'Артист' }))).then(() => true)`);
    assertEqual(await b.waitForFiles(3), ['Альбом/01 - Песня 1.mp3', 'Альбом/02 - Песня 2.mp3', 'Альбом/03 - Песня 3.mp3'], 'файлы');
  },

  async 'почти пустой ответ сервера — ошибка, а не битый файл'(b) {
    const msg = await b.eval(`downloadAndTag({ url: 'data:audio/mpeg;base64,AAAA', codec: 'mp3', filename: 'x.mp3' }).then(() => 'сохранилось', (e) => e.message)`);
    if (!msg.includes('пустым')) throw new Error('ожидалась ошибка про пустой файл, получено: ' + msg);
    assertEqual(b.downloadedFiles(), [], 'файлы');
  },

  async 'сравнение версий'(b) {
    const cases = [
      ['3.14.0', '3.13.2', true], ['3.13.2', '3.14.0', false], ['3.14.0', '3.14.0', false],
      ['3.10.0', '3.9.2', true], ['v4.0.0', '3.99.99', true], ['3.14', '3.14.0', false],
      // Четвёртое число — пересборка десктопа, расширение не дёргаем
      ['3.14.0.1', '3.14.0', false], ['3.14.1.0', '3.14.0', true],
    ];
    for (const [latest, current, expected] of cases) {
      assertEqual(await b.eval(`YMD.update.isNewer(${JSON.stringify(latest)}, ${JSON.stringify(current)})`), expected, `${latest} новее ${current}`);
    }
  },

  async 'попап показывает настоящую версию и уведомление о новой'(b) {
    const setUpdate = (version) => b.eval(`chrome.storage.local.set({ ymdUpdate: { checkedAt: Date.now(), version: '${version}', url: 'https://example.com/new.zip' } }).then(() => YMD.update.refreshBadge()).then(() => true)`);
    const read = (s) => b.eval(`JSON.stringify({
      display: document.getElementById('update-banner').style.display,
      version: document.getElementById('update-version').textContent,
      link: document.getElementById('update-link').href,
      footer: document.getElementById('footer-version').textContent })`, s).then(JSON.parse);
    const badge = () => b.eval(`chrome.action.getBadgeText({})`);

    // Новой версии нет — баннер скрыт
    await setUpdate(MANIFEST.version);
    let popup = await b.openPopup();
    let st = await read(popup.sessionId);
    assertEqual(st.display, 'none', 'баннер без обновления');
    assertEqual(st.footer, 'v' + MANIFEST.version, 'версия в футере');
    await b.send('Target.closeTarget', { targetId: popup.targetId });

    // Вышла новая — баннер и значок
    await setUpdate('99.1.2');
    assertEqual(await badge(), 'NEW', 'значок');
    popup = await b.openPopup();
    st = await read(popup.sessionId);
    assertEqual([st.display, st.version, st.link], ['block', '99.1.2', 'https://example.com/new.zip'], 'баннер');

    // «Не напоминать» — до следующей версии
    await b.eval(`document.getElementById('update-dismiss').click(); new Promise((r) => setTimeout(() => r(true), 300))`, popup.sessionId);
    assertEqual(await badge(), '', 'значок после «не напоминать»');
    await b.send('Target.closeTarget', { targetId: popup.targetId });
    popup = await b.openPopup();
    assertEqual((await read(popup.sessionId)).display, 'none', 'баннер после «не напоминать»');
    await b.send('Target.closeTarget', { targetId: popup.targetId });

    await setUpdate('99.1.3');
    assertEqual(await badge(), 'NEW', 'значок для следующей версии');
  },
};

const API_TESTS = {
  async 'трек по ссылке /album/X/track/Y (#62)'(b) {
    const n = await b.eval(`(async () => { const s = YMD.registry.get('yandex');
      const t = await s.listTracks(s.parseUrl('https://music.yandex.ru/album/${ALBUM_ID}/track/${TRACK_ID}'));
      if (!t[0].title || !t[0].artist) throw new Error('пустые метаданные: ' + JSON.stringify(t[0]));
      return t.length; })()`);
    assertEqual(n, 1, 'треков');
  },

  async 'трек по ссылке /track/Y'(b) {
    const n = await b.eval(`(async () => { const s = YMD.registry.get('yandex');
      return (await s.listTracks(s.parseUrl('https://music.yandex.ru/track/${TRACK_ID}'))).length; })()`);
    assertEqual(n, 1, 'треков');
  },

  async 'альбом'(b) {
    const n = await b.eval(`(async () => { const s = YMD.registry.get('yandex');
      return (await s.listTracks(s.parseUrl('https://music.yandex.ru/album/${ALBUM_ID}'))).length; })()`);
    if (!n) throw new Error('в альбоме нет треков');
  },

  async 'ссылка на аудио: download-info отвечает как раньше'(b) {
    const fields = await b.eval(`(async () => {
      const r = await fetch('https://api.music.yandex.net/tracks/${TRACK_ID}/download-info', {
        headers: { Accept: 'application/json', 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = (await r.json()).result;
      if (!list.length) throw new Error('пустой список');
      return Object.keys(list[0]).filter((k) => ['codec', 'bitrateInKbps', 'downloadInfoUrl'].includes(k)).sort();
    })()`);
    assertEqual(fields, ['bitrateInKbps', 'codec', 'downloadInfoUrl'], 'поля');
  },

  async 'GitHub отдаёт данные для проверки обновлений'(b) {
    const u = await b.eval(`YMD.update.check(true).then(() => chrome.storage.local.get('ymdUpdate')).then((d) => d.ymdUpdate)`);
    // Лимит анонимных запросов к GitHub на общих IP раннеров быстро кончается: это не поломка
    if (!u.version) return 'пропущено: GitHub не ответил (лимит запросов)';
    if (!/^\d+\.\d+\.\d+$/.test(u.version)) throw new Error('странная версия: ' + u.version);
    if (!/^https:\/\/github\.com\/.+\.zip$/.test(u.url)) throw new Error('странная ссылка: ' + u.url);
  },
};

async function run() {
  const tests = { ...(GROUP !== 'api' ? LOCAL_TESTS : {}), ...(GROUP !== 'local' ? API_TESTS : {}) };
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    // Свой браузер на каждый тест: папка загрузок и хранилище не должны пересекаться
    const browser = new Browser();
    try {
      await browser.start();
      const note = await Promise.race([
        fn(browser),
        sleep(90000).then(() => { throw new Error('таймаут 90 с'); }),
      ]);
      console.log(`ok    ${name}${note ? ` (${note})` : ''}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    } finally {
      await browser.stop();
    }
  }
  console.log(`\n${Object.keys(tests).length - failed} из ${Object.keys(tests).length} прошло`);
  process.exit(failed ? 1 : 0);
}

run();
