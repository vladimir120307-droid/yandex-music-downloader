package ru.ymd.downloader

/** Один трек (или эпизод подкаста) со всеми метаданными для тегов. */
data class Track(
    val trackId: String,
    val albumId: String = "",
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val albumArtist: String = "",
    val year: String = "",
    val genre: String = "",
    val trackNum: Int = 0,
    val trackTotal: Int = 0,
    val discNum: Int = 0,
    val coverUri: String = "",
    var lyrics: String = "",
) {
    /** Имя файла без расширения: «Исполнитель - Название». */
    fun baseName(): String {
        val a = sanitize(artist)
        val t = sanitize(title).ifEmpty { "track_$trackId" }
        return if (a.isNotEmpty()) "$a - $t" else t
    }

    private fun sanitize(s: String): String =
        s.replace(Regex("[<>:\"/\\|?*\x00-\x1f]"), "_").trim().take(120)
}

/** Что вернул API для скачивания: ссылка, кодек и (для FLAC) ключ расшифровки. */
data class AudioSource(
    val url: String,
    val codec: String,
    val encryptionKey: String? = null,
)

/** Разобранная ссылка Яндекс.Музыки. */
sealed class YmLink {
    data class TrackLink(val trackId: String, val albumId: String?) : YmLink()
    data class AlbumLink(val albumId: String) : YmLink()
    data class PlaylistLink(val owner: String?, val kinds: String?, val uuid: String?) : YmLink()
}

/** Качество, которое выбирает пользователь. */
enum class Quality { AUTO, FLAC, MP3_320 }
