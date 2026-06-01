// Вставка обложки (covr) и тегов в MP4/M4A контейнер.
// Яндекс отдаёт FLAC-в-MP4, и чтобы обложка сохранялась в .m4a (расширение),
// надо добавить iTunes-style metadata atoms в moov>udta>meta>ilst.
//
// Сложность: moov у Яндекса идёт ДО mdat, поэтому добавление байтов в moov
// сдвигает аудио в mdat → надо пропатчить таблицы смещений stco/co64.
//
// Реализация максимально оборонительная: при любой неожиданной структуре
// бросаем — вызывающий код сохранит оригинальный файл без обложки.

(function () {
  function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function rd32(b, o) { return (b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function str4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

  function concat(arrs) {
    let n = 0; for (const a of arrs) n += a.length;
    const out = new Uint8Array(n); let p = 0;
    for (const a of arrs) { out.set(a, p); p += a.length; }
    return out;
  }

  // Найти прямых детей box'а в диапазоне [start, end)
  function children(b, start, end) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = rd32(b, p);
      const type = str4(b, p + 4);
      let hdr = 8;
      if (size === 1) { // 64-bit
        // старшие 32 бита смещения должны быть 0 для наших размеров
        size = rd32(b, p + 8) * 0x100000000 + rd32(b, p + 12);
        hdr = 16;
      }
      if (size < hdr || p + size > end) break;
      out.push({ type, start: p, size, dataStart: p + hdr, dataEnd: p + size, hdr });
      p += size;
    }
    return out;
  }

  function findChild(b, parent, type) {
    return children(b, parent.dataStart, parent.dataEnd).find(c => c.type === type) || null;
  }

  // iTunes data-atom: [size][type='data'][4 typeflag][4 reserved=0][payload]
  function dataAtom(typeFlag, payload) {
    const size = 16 + payload.length;
    return concat([
      new Uint8Array(be32(size)),
      new Uint8Array([0x64, 0x61, 0x74, 0x61]), // 'data'
      new Uint8Array(be32(typeFlag)),           // 0=binary,1=utf8,13=jpeg,14=png
      new Uint8Array([0, 0, 0, 0]),             // reserved (locale)
      payload,
    ]);
  }

  // metadata atom: [size][type='covr'/'©nam'/...][data atom]
  function metaItem(type4, dataAtomBytes) {
    const size = 8 + dataAtomBytes.length;
    const t = new Uint8Array(4);
    for (let i = 0; i < 4; i++) t[i] = type4.charCodeAt(i) & 0xff;
    return concat([new Uint8Array(be32(size)), t, dataAtomBytes]);
  }

  function utf8(str) { return new TextEncoder().encode(String(str)); }

  // Построить ilst-payload (набор metadata items)
  function buildIlstItems(opts) {
    const items = [];
    if (opts.title)  items.push(metaItem('©nam', dataAtom(1, utf8(opts.title))));
    if (opts.artist) items.push(metaItem('©ART', dataAtom(1, utf8(opts.artist))));
    if (opts.album)  items.push(metaItem('©alb', dataAtom(1, utf8(opts.album))));
    if (opts.year)   items.push(metaItem('©day', dataAtom(1, utf8(String(opts.year)))));
    if (opts.cover) {
      const fmt = (opts.coverMime === 'image/png') ? 14 : 13; // 13=jpeg,14=png
      items.push(metaItem('covr', dataAtom(fmt, opts.cover)));
    }
    return concat(items);
  }

  // Box: [size][type][payload]
  function box(type, payload) {
    const size = 8 + payload.length;
    const t = new Uint8Array(4);
    for (let i = 0; i < 4; i++) t[i] = type.charCodeAt(i) & 0xff;
    return concat([new Uint8Array(be32(size)), t, payload]);
  }

  // full box (meta): [size][type][1 version][3 flags][payload]
  function fullBox(type, payload) {
    return box(type, concat([new Uint8Array([0, 0, 0, 0]), payload]));
  }

  // hdlr для meta/ilst (обязателен)
  function buildHdlr() {
    // version+flags(4) + predefined(4)=0 + handler='mdir' + 'appl' + reserved(12) + name(1=\0)
    const payload = concat([
      new Uint8Array([0, 0, 0, 0]),        // version+flags
      new Uint8Array([0, 0, 0, 0]),        // predefined
      utf8('mdir'),                         // handler type
      utf8('appl'),                         // reserved/manufacturer
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // reserved(12)? actually 8+name
      new Uint8Array([0]),                  // name (empty, null-terminated)
    ]);
    return box('hdlr', payload);
  }

  // Патч всех stco (32-bit chunk offsets) внутри moov: +delta.
  // co64 (64-bit) — патчим тоже. Возвращает кол-во пропатченных таблиц.
  function patchChunkOffsets(bytes, moovStart, moovEnd, delta) {
    let patched = 0;
    // Линейно сканируем весь moov на сигнатуры 'stco' и 'co64'
    for (let p = moovStart; p + 8 <= moovEnd; p++) {
      const type = str4(bytes, p);
      if (type === 'stco') {
        // структура: [size@p-4][stco][ver/flags 4][count 4][offsets...]
        const boxSize = rd32(bytes, p - 4);
        if (boxSize < 16) continue;
        const count = rd32(bytes, p + 8);
        let q = p + 12;
        for (let i = 0; i < count && q + 4 <= moovEnd; i++, q += 4) {
          const v = rd32(bytes, q) + delta;
          bytes[q] = (v >>> 24) & 255; bytes[q + 1] = (v >>> 16) & 255;
          bytes[q + 2] = (v >>> 8) & 255; bytes[q + 3] = v & 255;
        }
        patched++;
      } else if (type === 'co64') {
        const count = rd32(bytes, p + 8);
        let q = p + 12;
        for (let i = 0; i < count && q + 8 <= moovEnd; i++, q += 8) {
          // 64-bit: патчим младшие 32 бита (наши смещения < 4GB)
          const lo = rd32(bytes, q + 4) + delta;
          bytes[q + 4] = (lo >>> 24) & 255; bytes[q + 5] = (lo >>> 16) & 255;
          bytes[q + 6] = (lo >>> 8) & 255; bytes[q + 7] = lo & 255;
        }
        patched++;
      }
    }
    return patched;
  }

  // Главная функция. Возвращает новый Uint8Array или бросает.
  function addCoverToMp4(input, opts) {
    const b = input;
    const top = children(b, 0, b.length);
    const moov = top.find(x => x.type === 'moov');
    const mdat = top.find(x => x.type === 'mdat');
    if (!moov) throw new Error('moov не найден');
    if (!mdat) throw new Error('mdat не найден');

    // Собираем новый ilst-контент
    const ilstItems = buildIlstItems(opts);
    if (!ilstItems.length) throw new Error('нет данных для записи');

    // Проверяем — есть ли уже udta>meta>ilst (обычно нет у Яндекса)
    const udta = findChild(b, moov, 'udta');
    if (udta) {
      // Чтобы не усложнять — если udta уже есть, не трогаем (редкий случай у Я.М.)
      throw new Error('udta уже существует — пропускаем (избегаем поломки)');
    }

    // Строим udta > meta(full) > [hdlr + ilst]
    const ilstBox = box('ilst', ilstItems);
    const hdlrBox = buildHdlr();
    const metaBox = fullBox('meta', concat([hdlrBox, ilstBox]));
    const udtaBox = box('udta', metaBox);

    const delta = udtaBox.length;

    // moov перед mdat? Если да — все chunk offsets в mdat сдвинутся на delta.
    const moovBeforeMdat = moov.start < mdat.start;

    // Новый moov = старый moov с udta в конце payload + обновлённый size
    const newMoovSize = moov.size + delta;
    const newMoov = new Uint8Array(newMoovSize);
    newMoov.set(b.subarray(moov.start, moov.dataEnd), 0); // старый moov целиком
    newMoov.set(udtaBox, moov.size);                      // udta в конец
    // обновить size moov
    newMoov[0] = (newMoovSize >>> 24) & 255; newMoov[1] = (newMoovSize >>> 16) & 255;
    newMoov[2] = (newMoovSize >>> 8) & 255; newMoov[3] = newMoovSize & 255;

    // Патчим chunk offsets ВНУТРИ нового moov (он самодостаточный)
    if (moovBeforeMdat) {
      patchChunkOffsets(newMoov, 0, moov.size, delta); // только в исходной части moov
    }

    // Пересобираем файл: заменяем старый moov на новый, остальное как было
    const out = new Uint8Array(b.length + delta);
    let p = 0;
    for (const boxItem of top) {
      if (boxItem.type === 'moov') {
        out.set(newMoov, p); p += newMoov.length;
      } else {
        out.set(b.subarray(boxItem.start, boxItem.dataEnd), p);
        p += boxItem.size;
      }
    }
    return out.subarray(0, p);
  }

  globalThis.YMD_MP4 = { addCoverToMp4 };
})();
