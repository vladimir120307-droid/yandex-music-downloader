package ru.ymd.downloader

import java.io.ByteArrayOutputStream

/**
 * Запись тегов ID3v2.3 в MP3: название, исполнитель, альбом, жанр, номер трека,
 * текст песни и обложка.
 *
 * Важная деталь, проверенная на практике: в ID3v2.3 кодировка UTF-8 недопустима.
 * Текстовые поля пишем в UTF-16 с BOM, иначе проводник Windows молча
 * игнорирует такие теги вместе с обложкой.
 *
 * Порт реализации из расширения (lib/id3.js).
 */
object Id3 {

    private fun ascii(s: String): ByteArray = s.toByteArray(Charsets.US_ASCII)

    private fun be32(n: Int): ByteArray = byteArrayOf(
        ((n ushr 24) and 0xff).toByte(), ((n ushr 16) and 0xff).toByte(),
        ((n ushr 8) and 0xff).toByte(), (n and 0xff).toByte()
    )

    /** Размер тега пишется «синхробезопасно»: по 7 бит в байте. */
    private fun syncsafe32(n: Int): ByteArray = byteArrayOf(
        ((n shr 21) and 0x7f).toByte(), ((n shr 14) and 0x7f).toByte(),
        ((n shr 7) and 0x7f).toByte(), (n and 0x7f).toByte()
    )

    /** UTF-16LE с BOM и двойным нулём в конце. */
    private fun utf16(s: String): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(0xff); out.write(0xfe)
        for (ch in s) {
            val c = ch.code
            out.write(c and 0xff)
            out.write((c shr 8) and 0xff)
        }
        out.write(0); out.write(0)
        return out.toByteArray()
    }

    private fun textFrame(id: String, text: String): ByteArray {
        if (text.isBlank()) return ByteArray(0)
        val body = ByteArrayOutputStream()
        body.write(0x01)              // 0x01 — UTF-16, допустимо в ID3v2.3
        body.write(utf16(text))
        val b = body.toByteArray()
        val out = ByteArrayOutputStream()
        out.write(ascii(id)); out.write(be32(b.size)); out.write(0); out.write(0)
        out.write(b)
        return out.toByteArray()
    }

    /** Текст песни: язык + пустое описание + сам текст. */
    private fun usltFrame(lyrics: String): ByteArray {
        if (lyrics.isBlank()) return ByteArray(0)
        val body = ByteArrayOutputStream()
        body.write(0x01)
        body.write(ascii("rus"))
        body.write(byteArrayOf(0xff.toByte(), 0xfe.toByte(), 0, 0))  // пустое описание
        body.write(utf16(lyrics))
        val b = body.toByteArray()
        val out = ByteArrayOutputStream()
        out.write(ascii("USLT")); out.write(be32(b.size)); out.write(0); out.write(0)
        out.write(b)
        return out.toByteArray()
    }

    /** Обложка. Кодировку берём ISO-8859-1: описание пустое, MIME — чистый ASCII. */
    private fun apicFrame(cover: ByteArray, mime: String): ByteArray {
        val body = ByteArrayOutputStream()
        body.write(0x00)
        body.write(ascii(mime)); body.write(0)
        body.write(0x03)              // 3 — обложка (передняя сторона)
        body.write(0)                 // описание пустое
        body.write(cover)
        val b = body.toByteArray()
        val out = ByteArrayOutputStream()
        out.write(ascii("APIC")); out.write(be32(b.size)); out.write(0); out.write(0)
        out.write(b)
        return out.toByteArray()
    }

    fun buildTag(track: Track, cover: ByteArray?): ByteArray {
        val frames = ByteArrayOutputStream()
        frames.write(textFrame("TIT2", track.title))
        frames.write(textFrame("TPE1", track.artist))
        frames.write(textFrame("TALB", track.album))
        frames.write(textFrame("TPE2", track.albumArtist))
        frames.write(textFrame("TDRC", track.year))
        frames.write(textFrame("TCON", track.genre))
        if (track.trackNum > 0) {
            val v = if (track.trackTotal > 0) "${track.trackNum}/${track.trackTotal}"
            else track.trackNum.toString()
            frames.write(textFrame("TRCK", v))
        }
        if (track.discNum > 0) frames.write(textFrame("TPOS", track.discNum.toString()))
        frames.write(usltFrame(track.lyrics))
        if (cover != null && cover.isNotEmpty()) frames.write(apicFrame(cover, "image/jpeg"))

        val body = frames.toByteArray()
        val out = ByteArrayOutputStream(body.size + 10)
        out.write(ascii("ID3"))
        out.write(0x03); out.write(0x00)   // версия 2.3.0
        out.write(0x00)                    // флаги
        out.write(syncsafe32(body.size))
        out.write(body)
        return out.toByteArray()
    }

    /** Убираем ранее приклеенный тег, чтобы не было дублей. */
    private fun stripExisting(mp3: ByteArray): ByteArray {
        if (mp3.size < 10) return mp3
        if (mp3[0] == 'I'.code.toByte() && mp3[1] == 'D'.code.toByte() && mp3[2] == '3'.code.toByte()) {
            val size = ((mp3[6].toInt() and 0x7f) shl 21) or
                    ((mp3[7].toInt() and 0x7f) shl 14) or
                    ((mp3[8].toInt() and 0x7f) shl 7) or
                    (mp3[9].toInt() and 0x7f)
            val start = 10 + size
            if (start in 0..mp3.size) return mp3.copyOfRange(start, mp3.size)
        }
        return mp3
    }

    fun attach(mp3: ByteArray, track: Track, cover: ByteArray?): ByteArray {
        val clean = stripExisting(mp3)
        val tag = buildTag(track, cover)
        val out = ByteArray(tag.size + clean.size)
        System.arraycopy(tag, 0, out, 0, tag.size)
        System.arraycopy(clean, 0, out, tag.size, clean.size)
        return out
    }
}
