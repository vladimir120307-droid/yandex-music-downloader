// Минимальный ID3v2.3 writer для embed обложки + базовых тегов в MP3.
// Достаточно для того чтобы Winamp/foobar/AIMP/VLC/Apple Music/Windows Media
// показывали title/artist/album/cover.
//
// Структура ID3v2.3:
//   "ID3" + ver(0x03,0x00) + flags(1B) + size(4B syncsafe)
//   + frames: TIT2/TPE1/TALB/TDRC (text) и APIC (cover)
//
// Используется в background.js — Web Crypto API + TextEncoder доступны там.

(function () {
  function concat(...arrs) {
    let total = 0;
    for (const a of arrs) total += a.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
  }

  function be32(n) {
    return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }

  function syncsafe32(n) {
    return new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
  }

  function asciiBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0x7f;
    return out;
  }

  // UTF-16LE с BOM + двойной нулевой терминатор. В ID3v2.3 это encoding 0x01.
  // ID3v2.3 НЕ поддерживает UTF-8 (0x03) — Windows Explorer такие теги
  // игнорирует. UTF-16 — единственный способ записать кириллицу в 2.3.
  function utf16leWithBom(str) {
    const s = String(str);
    const out = new Uint8Array(2 + s.length * 2 + 2);
    out[0] = 0xff; out[1] = 0xfe;  // BOM (little-endian)
    let p = 2;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[p++] = c & 0xff;
      out[p++] = (c >> 8) & 0xff;
    }
    out[p++] = 0x00; out[p++] = 0x00;  // terminator
    return out;
  }

  function textFrame(id, text) {
    if (!text) return new Uint8Array(0);
    // encoding 0x01 = UTF-16 with BOM (валидно в ID3v2.3)
    const body = concat(new Uint8Array([0x01]), utf16leWithBom(text));
    const head = concat(asciiBytes(id), be32(body.length), new Uint8Array([0, 0]));
    return concat(head, body);
  }

  function apicFrame(imageBytes, mime) {
    // APIC: encoding 0x00 (ISO-8859-1) — description пустой, mime это ASCII,
    // так максимально совместимо. Picture data от encoding не зависит.
    const body = concat(
      new Uint8Array([0x00]),                  // text encoding ISO-8859-1
      asciiBytes(mime || 'image/jpeg'),        // MIME (ASCII)
      new Uint8Array([0x00]),                  // MIME terminator
      new Uint8Array([0x03]),                  // picture type: 3 = cover (front)
      new Uint8Array([0x00]),                  // empty description terminator
      imageBytes,
    );
    const head = concat(asciiBytes('APIC'), be32(body.length), new Uint8Array([0, 0]));
    return concat(head, body);
  }

  // USLT — несинхронный текст песни. body: [enc][lang 3][descriptor+term][lyrics]
  function usltFrame(lyrics) {
    // encoding 0x01 (UTF-16) для кириллицы. descriptor пустой = BOM+терминатор.
    const body = concat(
      new Uint8Array([0x01]),                 // UTF-16 encoding
      asciiBytes('rus'),                       // language (ISO-639-2)
      new Uint8Array([0xff, 0xfe, 0x00, 0x00]),// пустой descriptor: BOM + UTF-16 terminator
      utf16leWithBom(lyrics),                  // сам текст
    );
    const head = concat(asciiBytes('USLT'), be32(body.length), new Uint8Array([0, 0]));
    return concat(head, body);
  }

  function buildID3v2(opts) {
    // opts: { title, artist, album, year, cover (Uint8Array), coverMime, lyrics }
    const frames = [];
    if (opts.title)  frames.push(textFrame('TIT2', opts.title));
    if (opts.artist) frames.push(textFrame('TPE1', opts.artist));
    if (opts.album)  frames.push(textFrame('TALB', opts.album));
    if (opts.year)   frames.push(textFrame('TDRC', String(opts.year)));
    if (opts.lyrics) frames.push(usltFrame(opts.lyrics));
    if (opts.cover)  frames.push(apicFrame(opts.cover, opts.coverMime || 'image/jpeg'));

    const body = concat(...frames);
    const enc = new TextEncoder();
    const header = concat(
      enc.encode('ID3'),
      new Uint8Array([0x03, 0x00]),  // version 2.3.0
      new Uint8Array([0x00]),         // flags
      syncsafe32(body.length),
    );
    return concat(header, body);
  }

  function stripExistingID3v2(mp3Bytes) {
    // Если в начале mp3 уже есть ID3v2 — вырезаем, чтобы не было дубликатов
    if (mp3Bytes.length < 10) return mp3Bytes;
    if (mp3Bytes[0] === 0x49 && mp3Bytes[1] === 0x44 && mp3Bytes[2] === 0x33) {
      const size = ((mp3Bytes[6] & 0x7f) << 21) |
                   ((mp3Bytes[7] & 0x7f) << 14) |
                   ((mp3Bytes[8] & 0x7f) << 7) |
                    (mp3Bytes[9] & 0x7f);
      return mp3Bytes.subarray(10 + size);
    }
    return mp3Bytes;
  }

  function prependID3v2ToMP3(mp3Bytes, tagBytes) {
    const clean = stripExistingID3v2(mp3Bytes);
    return concat(tagBytes, clean);
  }

  globalThis.YMD_ID3 = { buildID3v2, prependID3v2ToMP3 };
})();
