package ru.ymd.downloader

import java.io.ByteArrayOutputStream

/**
 * Переупаковка FLAC из MP4-контейнера в нативный .flac — без перекодирования.
 *
 * Яндекс отдаёт lossless как FLAC внутри MP4. Нативные FLAC-декодеры такой файл
 * не понимают (ждут сигнатуру fLaC), поэтому достаём STREAMINFO из бокса dfLa и
 * сами аудиокадры точно по таблицам stsz/stco/stsc, после чего собираем
 * обычный FLAC-контейнер. Аудио при этом побайтово то же самое.
 *
 * Порт проверенной реализации из расширения (lib/flacremux.js).
 */
object FlacRemux {

    class NotFlacMp4(message: String) : Exception(message)

    private fun rd32(b: ByteArray, o: Int): Int =
        ((b[o].toInt() and 0xff) shl 24) or
                ((b[o + 1].toInt() and 0xff) shl 16) or
                ((b[o + 2].toInt() and 0xff) shl 8) or
                (b[o + 3].toInt() and 0xff)

    private fun findSig(b: ByteArray, sig: String, from: Int = 0): Int {
        val s = sig.toByteArray(Charsets.US_ASCII)
        var i = from
        while (i + s.size <= b.size) {
            var ok = true
            for (j in s.indices) {
                if (b[i + j] != s[j]) { ok = false; break }
            }
            if (ok) return i
            i++
        }
        return -1
    }

    fun isMp4(b: ByteArray): Boolean =
        b.size > 8 && b[4] == 'f'.code.toByte() && b[5] == 't'.code.toByte() &&
                b[6] == 'y'.code.toByte() && b[7] == 'p'.code.toByte()

    fun isNativeFlac(b: ByteArray): Boolean =
        b.size > 4 && b[0] == 'f'.code.toByte() && b[1] == 'L'.code.toByte() &&
                b[2] == 'a'.code.toByte() && b[3] == 'C'.code.toByte()

    /** STREAMINFO лежит в боксе dfLa сразу после версии и флагов. */
    private fun extractStreamInfo(b: ByteArray): ByteArray? {
        val dfla = findSig(b, "dfLa")
        if (dfla < 0) return null
        val si = dfla + 4 + 4
        if (si + 4 > b.size) return null
        val blockSize = ((b[si + 1].toInt() and 0xff) shl 16) or
                ((b[si + 2].toInt() and 0xff) shl 8) or (b[si + 3].toInt() and 0xff)
        val end = si + 4 + blockSize
        if (end > b.size) return null
        val block = b.copyOfRange(si, end)
        // Тип 0 — это и есть STREAMINFO
        if ((block[0].toInt() and 0x7f) != 0) return null
        return block
    }

    /**
     * Достаём кадры по таблицам. Брать mdat целиком нельзя: между чанками
     * встречается выравнивание, из-за которого декодер спотыкается.
     */
    private fun extractFrames(b: ByteArray): ByteArray? {
        val stszI = findSig(b, "stsz")
        if (stszI < 0) return null
        var ds = stszI + 4 + 4
        val uniformSize = rd32(b, ds)
        val count = rd32(b, ds + 4)
        if (count <= 0) return null
        val sizes = IntArray(count)
        if (uniformSize == 0) {
            for (j in 0 until count) sizes[j] = rd32(b, ds + 8 + j * 4)
        } else {
            for (j in 0 until count) sizes[j] = uniformSize
        }

        // Смещения чанков: stco (32 бита) либо co64 (64 бита)
        val chunkOffsets: LongArray
        val stcoI = findSig(b, "stco")
        if (stcoI >= 0) {
            ds = stcoI + 4 + 4
            val cc = rd32(b, ds)
            chunkOffsets = LongArray(cc)
            for (j in 0 until cc) chunkOffsets[j] = rd32(b, ds + 4 + j * 4).toLong() and 0xffffffffL
        } else {
            val co64I = findSig(b, "co64")
            if (co64I < 0) return null
            ds = co64I + 4 + 4
            val cc = rd32(b, ds)
            chunkOffsets = LongArray(cc)
            for (j in 0 until cc) {
                val hi = rd32(b, ds + 4 + j * 8).toLong() and 0xffffffffL
                val lo = rd32(b, ds + 8 + j * 8).toLong() and 0xffffffffL
                chunkOffsets[j] = (hi shl 32) or lo
            }
        }
        val ccount = chunkOffsets.size
        if (ccount == 0) return null

        // stsc: сколько сэмплов в каждом чанке
        val stscI = findSig(b, "stsc")
        if (stscI < 0) return null
        ds = stscI + 4 + 4
        val sc = rd32(b, ds)
        val firstChunk = IntArray(sc)
        val samplesPerChunk = IntArray(sc)
        for (j in 0 until sc) {
            firstChunk[j] = rd32(b, ds + 4 + j * 12)
            samplesPerChunk[j] = rd32(b, ds + 8 + j * 12)
        }
        val spcPerChunk = IntArray(ccount + 1)
        for (idx in 0 until sc) {
            val fc = firstChunk[idx]
            val spc = samplesPerChunk[idx]
            val nextFc = if (idx + 1 < sc) firstChunk[idx + 1] else ccount + 1
            var c = fc
            while (c < nextFc && c <= ccount) {
                spcPerChunk[c] = spc
                c++
            }
        }

        var total = 0L
        for (s in sizes) total += s
        if (total <= 0 || total > Int.MAX_VALUE) return null

        val frames = ByteArray(total.toInt())
        var fp = 0
        var sampleIdx = 0
        for (c in 1..ccount) {
            var off = chunkOffsets[c - 1]
            val spc = spcPerChunk[c]
            var k = 0
            while (k < spc && sampleIdx < count) {
                val sz = sizes[sampleIdx]
                if (off < 0 || off + sz > b.size) return null
                System.arraycopy(b, off.toInt(), frames, fp, sz)
                fp += sz
                off += sz
                sampleIdx++
                k++
            }
        }
        return if (fp == frames.size) frames else frames.copyOf(fp)
    }

    private fun be32(n: Int): ByteArray = byteArrayOf(
        ((n ushr 24) and 0xff).toByte(), ((n ushr 16) and 0xff).toByte(),
        ((n ushr 8) and 0xff).toByte(), (n and 0xff).toByte()
    )

    private fun le32(n: Int): ByteArray = byteArrayOf(
        (n and 0xff).toByte(), ((n ushr 8) and 0xff).toByte(),
        ((n ushr 16) and 0xff).toByte(), ((n ushr 24) and 0xff).toByte()
    )

    /** VORBIS_COMMENT: длины пишутся little-endian. */
    private fun vorbisComment(track: Track): ByteArray {
        val vendor = "MusicDownloader".toByteArray(Charsets.UTF_8)
        val comments = mutableListOf<ByteArray>()
        fun add(key: String, value: String) {
            if (value.isNotBlank()) comments.add((key + "=" + value).toByteArray(Charsets.UTF_8))
        }
        add("TITLE", track.title)
        add("ARTIST", track.artist)
        add("ALBUM", track.album)
        add("ALBUMARTIST", track.albumArtist)
        add("DATE", track.year)
        add("GENRE", track.genre)
        if (track.trackNum > 0) add("TRACKNUMBER", track.trackNum.toString())
        if (track.trackTotal > 0) add("TRACKTOTAL", track.trackTotal.toString())
        if (track.discNum > 0) add("DISCNUMBER", track.discNum.toString())
        add("LYRICS", track.lyrics)

        val out = ByteArrayOutputStream()
        out.write(le32(vendor.size)); out.write(vendor)
        out.write(le32(comments.size))
        for (c in comments) { out.write(le32(c.size)); out.write(c) }
        return out.toByteArray()
    }

    /** PICTURE: тут, наоборот, big-endian. */
    private fun pictureBlock(cover: ByteArray, mime: String): ByteArray {
        val mimeB = mime.toByteArray(Charsets.US_ASCII)
        val out = ByteArrayOutputStream()
        out.write(be32(3))                 // 3 — обложка (передняя сторона)
        out.write(be32(mimeB.size)); out.write(mimeB)
        out.write(be32(0))                 // описание пустое
        out.write(be32(0)); out.write(be32(0))   // ширина, высота — неизвестны
        out.write(be32(0)); out.write(be32(0))   // глубина цвета, палитра
        out.write(be32(cover.size)); out.write(cover)
        return out.toByteArray()
    }

    private fun metaBlockHeader(type: Int, size: Int, isLast: Boolean): ByteArray =
        byteArrayOf(
            (((if (isLast) 0x80 else 0)) or type).toByte(),
            ((size ushr 16) and 0xff).toByte(),
            ((size ushr 8) and 0xff).toByte(),
            (size and 0xff).toByte()
        )

    /**
     * Собирает нативный FLAC из MP4. Бросает NotFlacMp4, если внутри не FLAC —
     * вызывающий код тогда просто сохраняет исходный файл как .m4a.
     */
    fun remux(mp4: ByteArray, track: Track, cover: ByteArray?): ByteArray {
        val streamInfo = extractStreamInfo(mp4)
            ?: throw NotFlacMp4("В контейнере нет FLAC (бокс dfLa не найден)")
        val frames = extractFrames(mp4)
            ?: throw NotFlacMp4("Не удалось извлечь аудиокадры")
        if (frames.isEmpty()) throw NotFlacMp4("Аудиокадры пустые")

        val si = streamInfo.copyOf()
        si[0] = (si[0].toInt() and 0x7f).toByte()   // снимаем флаг «последний блок»

        val blocks = mutableListOf<Pair<Int, ByteArray>>()   // тип к содержимому
        blocks.add(0 to si.copyOfRange(4, si.size))          // STREAMINFO без заголовка
        blocks.add(4 to vorbisComment(track))
        if (cover != null && cover.isNotEmpty()) {
            blocks.add(6 to pictureBlock(cover, "image/jpeg"))
        }

        val out = ByteArrayOutputStream(frames.size + 64 * 1024)
        out.write("fLaC".toByteArray(Charsets.US_ASCII))
        for ((i, blk) in blocks.withIndex()) {
            val isLast = i == blocks.size - 1
            out.write(metaBlockHeader(blk.first, blk.second.size, isLast))
            out.write(blk.second)
        }
        out.write(frames)
        return out.toByteArray()
    }
}
