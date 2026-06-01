// Ремукс FLAC-в-MP4 → нативный .flac БЕЗ ffmpeg (чистый JS, в браузере).
// Яндекс отдаёт lossless как FLAC-аудиопоток в MP4-контейнере. Здесь мы
// извлекаем STREAMINFO + FLAC-фреймы (точно по таблицам stsz/stco/stsc, без
// padding между chunk'ами) и переупаковываем в нативный FLAC-контейнер.
// Проверено: MD5 аудио-потока бит-в-бит совпадает с ffmpeg -c:a copy.
//
// Бонус: вшивает VORBIS_COMMENT (теги) + PICTURE (обложку) — нативно.

(function () {
  function rd32(b, o) { return (b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function eq4(b, o, s) { return b[o] === s.charCodeAt(0) && b[o + 1] === s.charCodeAt(1) && b[o + 2] === s.charCodeAt(2) && b[o + 3] === s.charCodeAt(3); }
  function be32a(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function le32a(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

  function concat(arrs) {
    let n = 0; for (const a of arrs) n += a.length;
    const out = new Uint8Array(n); let p = 0;
    for (const a of arrs) { out.set(a, p); p += a.length; }
    return out;
  }

  // Найти первое вхождение box-сигнатуры начиная с offset (для нашего случая
  // один аудио-trak, этого достаточно). Возвращает индекс байта типа.
  function findSig(b, sig, from) {
    const a = sig.charCodeAt(0), c = sig.charCodeAt(1), d = sig.charCodeAt(2), e = sig.charCodeAt(3);
    for (let i = from || 0; i + 4 <= b.length; i++) {
      if (b[i] === a && b[i + 1] === c && b[i + 2] === d && b[i + 3] === e) return i;
    }
    return -1;
  }

  // Извлечь STREAMINFO (38 байт: header+34) из dfLa
  function extractStreamInfo(b) {
    const dfla = findSig(b, 'dfLa', 0);
    if (dfla < 0) return null;
    const si = dfla + 4 + 4;            // 'dfLa' + version/flags(4)
    if (b[si] === undefined) return null;
    const bsz = (b[si + 1] << 16) | (b[si + 2] << 8) | b[si + 3];  // 3-byte size
    const block = b.slice(si, si + 4 + bsz);
    if ((block[0] & 0x7f) !== 0) return null;  // должен быть STREAMINFO (type 0)
    return block;  // [type/last][size3][34 bytes data]
  }

  // Парсинг таблицы: возвращает {dataStart, count, entrySize}
  function parseTable(b, sig) {
    const i = findSig(b, sig, 0);
    if (i < 0) return null;
    const ds = i + 4 + 4;  // sig + version/flags(4)
    return { sig, pos: i, dataStart: ds };
  }

  // Извлечь FLAC-фреймы точно по таблицам (без padding между chunk'ами)
  function extractFrames(b) {
    // stsz
    const stszI = findSig(b, 'stsz', 0);
    if (stszI < 0) return null;
    let ds = stszI + 4 + 4;
    const uniformSize = rd32(b, ds);
    const count = rd32(b, ds + 4);
    const sizes = new Array(count);
    if (uniformSize === 0) {
      for (let j = 0; j < count; j++) sizes[j] = rd32(b, ds + 8 + j * 4);
    } else {
      for (let j = 0; j < count; j++) sizes[j] = uniformSize;
    }

    // stco (32-bit chunk offsets)
    const stcoI = findSig(b, 'stco', 0);
    let chunkOffsets;
    if (stcoI >= 0) {
      ds = stcoI + 4 + 4;
      const cc = rd32(b, ds);
      chunkOffsets = new Array(cc);
      for (let j = 0; j < cc; j++) chunkOffsets[j] = rd32(b, ds + 4 + j * 4);
    } else {
      // co64 (64-bit)
      const co64I = findSig(b, 'co64', 0);
      if (co64I < 0) return null;
      ds = co64I + 4 + 4;
      const cc = rd32(b, ds);
      chunkOffsets = new Array(cc);
      for (let j = 0; j < cc; j++) {
        chunkOffsets[j] = rd32(b, ds + 4 + j * 8) * 0x100000000 + rd32(b, ds + 8 + j * 8);
      }
    }
    const ccount = chunkOffsets.length;

    // stsc (sample-to-chunk)
    const stscI = findSig(b, 'stsc', 0);
    if (stscI < 0) return null;
    ds = stscI + 4 + 4;
    const sc = rd32(b, ds);
    const stsc = [];
    for (let j = 0; j < sc; j++) {
      const fc = rd32(b, ds + 4 + j * 12);
      const spc = rd32(b, ds + 8 + j * 12);
      stsc.push([fc, spc]);
    }
    // samples-per-chunk для каждого chunk (1-based)
    const spcPerChunk = new Array(ccount + 1).fill(0);
    for (let idx = 0; idx < stsc.length; idx++) {
      const fc = stsc[idx][0];
      const spc = stsc[idx][1];
      const nextFc = (idx + 1 < stsc.length) ? stsc[idx + 1][0] : ccount + 1;
      for (let c = fc; c < nextFc && c <= ccount; c++) spcPerChunk[c] = spc;
    }

    // Собираем фреймы
    let totalLen = 0;
    for (let j = 0; j < count; j++) totalLen += sizes[j];
    const frames = new Uint8Array(totalLen);
    let fp = 0, sampleIdx = 0;
    for (let c = 1; c <= ccount; c++) {
      let off = chunkOffsets[c - 1];
      const spc = spcPerChunk[c];
      for (let k = 0; k < spc && sampleIdx < count; k++) {
        const sz = sizes[sampleIdx];
        frames.set(b.subarray(off, off + sz), fp);
        fp += sz; off += sz; sampleIdx++;
      }
    }
    return frames.subarray(0, fp);
  }

  function vorbisCommentBlock(opts, isLast) {
    const enc = new TextEncoder();
    const vendor = enc.encode('YMD');
    const comments = [];
    const add = (k, v) => { if (v) comments.push(enc.encode(k + '=' + String(v))); };
    add('TITLE', opts.title); add('ARTIST', opts.artist);
    add('ALBUM', opts.album); add('DATE', opts.year);
    add('LYRICS', opts.lyrics);  // несинхронный текст (стандартное поле)
    const parts = [le32a(vendor.length), vendor, le32a(comments.length)];
    for (const c of comments) { parts.push(le32a(c.length)); parts.push(c); }
    const payload = concat(parts.map(x => x instanceof Uint8Array ? x : new Uint8Array(x)));
    const header = new Uint8Array([(isLast ? 0x80 : 0) | 4, (payload.length >> 16) & 255, (payload.length >> 8) & 255, payload.length & 255]);
    return concat([header, payload]);
  }

  function pictureBlock(cover, mime, isLast) {
    const enc = new TextEncoder();
    const mimeB = enc.encode(mime || 'image/jpeg');
    const descB = new Uint8Array(0);
    const payload = concat([
      new Uint8Array(be32a(3)),         // picture type 3 = front cover
      new Uint8Array(be32a(mimeB.length)), mimeB,
      new Uint8Array(be32a(descB.length)), descB,
      new Uint8Array(be32a(0)),         // width (0 = unknown)
      new Uint8Array(be32a(0)),         // height
      new Uint8Array(be32a(0)),         // color depth
      new Uint8Array(be32a(0)),         // colors used
      new Uint8Array(be32a(cover.length)), cover,
    ]);
    const len = payload.length;
    const header = new Uint8Array([(isLast ? 0x80 : 0) | 6, (len >> 16) & 255, (len >> 8) & 255, len & 255]);
    return concat([header, payload]);
  }

  // Главная функция: MP4(FLAC) bytes → нативный FLAC bytes. Бросает при проблеме.
  function remux(mp4Bytes, opts) {
    opts = opts || {};
    const streaminfo = extractStreamInfo(mp4Bytes);
    if (!streaminfo) throw new Error('STREAMINFO (dfLa) не найден — не FLAC-в-MP4');
    const frames = extractFrames(mp4Bytes);
    if (!frames || !frames.length) throw new Error('FLAC-фреймы не извлечены');

    const si = new Uint8Array(streaminfo);
    si[0] = si[0] & 0x7f;  // снять last-флаг (после STREAMINFO идут блоки/фреймы)

    const out = [new Uint8Array([0x66, 0x4c, 0x61, 0x43])]; // 'fLaC'
    const meta = [];
    meta.push({ kind: 'streaminfo', bytes: si });
    if (opts.title || opts.artist || opts.album || opts.year || opts.lyrics) {
      meta.push({ kind: 'vorbis', bytes: vorbisCommentBlock(opts, false) });
    }
    if (opts.cover) {
      meta.push({ kind: 'picture', bytes: pictureBlock(opts.cover, opts.coverMime, false) });
    }
    // выставить last-флаг на последнем metadata-блоке
    for (let i = 0; i < meta.length; i++) {
      const isLast = (i === meta.length - 1);
      const bb = meta[i].bytes;
      if (isLast) bb[0] |= 0x80; else bb[0] &= 0x7f;
      out.push(bb);
    }
    out.push(frames);
    return concat(out);
  }

  globalThis.YMD_FLACREMUX = { remux };
})();
