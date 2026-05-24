# Как помочь проекту

Спасибо что зашёл сюда! Любая помощь приветствуется — баг-репорт, новый сервис, фикс, улучшение README.

## Что сейчас полезно

- **Сообщить о баге.** Открой [issue](../../issues/new/choose) с шаблоном «Bug report». Скриншот + версия браузера/Windows + ссылка на которой не работает.
- **Запросить новый сервис.** «Хочу скачивать с XXX». Открой issue с шаблоном «Feature request».
- **Добавить новый адаптер.** См. ниже «Архитектура адаптеров».

## Как присылать PR

1. Форкни репо
2. Создай ветку: `git checkout -b feature/название` или `fix/что-чинишь`
3. Сделай изменения, попробуй проверить локально
4. Открой PR в `main`. CI (`Sanity checks`) должен быть зелёным — это требование защиты ветки
5. Опиши в PR что меняешь и зачем

Коммиты на русском, короткие, без conventional-commits префиксов (см. историю).

## Архитектура адаптеров (для нового сервиса)

### В расширении

Создай файл `services/тут.js` с экспортом `globalThis.YMD.registry.register({...})`:

```js
globalThis.YMD.registry.register({
  name: 'тут',
  displayName: 'TUT',
  domains: ['tut.com'],
  parseUrl(url) { /* return {type, ...} or null */ },
  async listTracks(parsed) { /* return [track] */ },
  async getAudioUrl(track, ctx) { /* return mp3 URL */ },
  getFilename(track) { /* return 'name.mp3' */ },
});
```

Пропиши `services/тут.js` в `manifest.json` (в `content_scripts.js` и в `importScripts` `background.js`), плюс домен в `host_permissions`.

### В десктопе

Дополни логику в `desktop/core.py` — добавь ветку `_run_тут()` по аналогии с `_run_yandex_music()`. Или (если сервис покрывается yt-dlp) — ничего не делай, yt-dlp его и так умеет.

## DRM-сервисы (Spotify, Apple Music, Tidal, Deezer)

**PR'ы с DRM-bypass не принимаются.** Причины:
- Технически: работающих L3 Widevine bypass'ов в открытом доступе нет с 2022 года.
- Юридически: репо снесут по DMCA.

Поддержка этих сервисов через **YouTube-matching** (как `spotdl`) — приветствуется.

## Лицензия

MIT, см. [LICENSE](LICENSE). Контрибьютя — соглашаешься.
