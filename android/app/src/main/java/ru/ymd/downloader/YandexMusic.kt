package ru.ymd.downloader

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Клиент API Яндекс.Музыки.
 *
 * Логика повторяет проверенную реализацию из расширения и десктопа:
 * FLAC берётся через /get-file-info (поток зашифрован AES-CTR), MP3 — через
 * старый /download-info с MD5-подписью ссылки.
 */
object YandexMusic {

    private const val API = "https://api.music.yandex.net"
    private const val CODECS = "flac,flac-mp4,mp3,aac,he-aac,aac-mp4,he-aac-mp4"
    private const val TRANSPORTS = "encraw"

    const val OAUTH_URL =
        "https://oauth.yandex.ru/authorize?response_type=token" +
                "&client_id=23cabbbdc6cd418abb4b39c32c41195d"

    fun isYandexUrl(url: String): Boolean =
        Regex("^https?://music\\.yandex\\.\\w+/", RegexOption.IGNORE_CASE)
            .containsMatchIn(url.trim())

    // ─────────────────────── Разбор ссылок ───────────────────────

    fun parseUrl(url: String): YmLink? {
        val path = try { java.net.URL(url).path } catch (e: Exception) { return null }

        Regex("/album/(\\d+)/track/(\\d+)").find(path)?.let {
            return YmLink.TrackLink(it.groupValues[2], it.groupValues[1])
        }
        Regex("/track/(\\d+)").find(path)?.let {
            return YmLink.TrackLink(it.groupValues[1], null)
        }
        Regex("/album/(\\d+)").find(path)?.let {
            return YmLink.AlbumLink(it.groupValues[1])
        }
        // Подкасты: шоу = альбом, эпизод = трек
        Regex("/podcast/(\\d+)/episode/(\\d+)").find(path)?.let {
            return YmLink.TrackLink(it.groupValues[2], it.groupValues[1])
        }
        Regex("/podcast/(\\d+)").find(path)?.let {
            return YmLink.AlbumLink(it.groupValues[1])
        }
        Regex("/users/([^/]+)/playlists/(\\d+)").find(path)?.let {
            return YmLink.PlaylistLink(it.groupValues[1], it.groupValues[2], null)
        }
        // UUID-плейлисты, в том числе с префиксом вида lk.
        Regex("/playlists/((?:[a-z]{1,4}\\.)?[a-f0-9-]{32,40})", RegexOption.IGNORE_CASE)
            .find(path)?.let {
                return YmLink.PlaylistLink(null, null, it.groupValues[1])
            }
        return null
    }

    // ─────────────────────── Метаданные ───────────────────────

    private fun result(json: String): JSONObject {
        val o = JSONObject(json)
        return if (o.has("result")) o.optJSONObject("result") ?: JSONObject() else o
    }

    private fun resultArray(json: String): JSONArray {
        val o = JSONObject(json)
        return o.optJSONArray("result") ?: JSONArray()
    }

    private fun names(arr: JSONArray?): String {
        if (arr == null) return ""
        return (0 until arr.length())
            .mapNotNull { arr.optJSONObject(it)?.optString("name") }
            .filter { it.isNotBlank() }
            .joinToString(", ")
    }

    private fun shapeTrack(t: JSONObject, defaultAlbumId: String = ""): Track {
        val albums = t.optJSONArray("albums")
        val album = if (albums != null && albums.length() > 0) albums.getJSONObject(0) else JSONObject()
        val pos = album.optJSONObject("trackPosition") ?: JSONObject()

        val artists = names(t.optJSONArray("artists"))
        val albumTitle = album.optString("title", "")
        val yearRaw = album.optString("year", "")

        return Track(
            trackId = t.optString("id").ifBlank { t.optString("realId") },
            albumId = album.optString("id", defaultAlbumId),
            title = t.optString("title", ""),
            // У эпизодов подкастов artists пустой — подставляем название шоу
            artist = artists.ifBlank { albumTitle },
            album = albumTitle,
            albumArtist = names(album.optJSONArray("artists")),
            year = if (yearRaw.isBlank() || yearRaw == "0") "" else yearRaw,
            genre = album.optString("genre", ""),
            trackNum = pos.optInt("index", 0),
            trackTotal = album.optInt("trackCount", 0),
            discNum = pos.optInt("volume", 0),
            coverUri = t.optString("coverUri", "").ifBlank { album.optString("coverUri", "") },
        )
    }

    fun fetchTrack(trackId: String, albumId: String?, token: String?): Track {
        val body = "track-ids=" + URLEncoder.encode(trackId, "UTF-8")
        val arr = resultArray(Http.postString(API + "/tracks", body, token))
        if (arr.length() > 0) return shapeTrack(arr.getJSONObject(0), albumId ?: "")
        return Track(trackId = trackId, albumId = albumId ?: "")
    }

    fun fetchAlbumTracks(albumId: String, token: String?): List<Track> {
        val r = result(Http.getString(API + "/albums/" + albumId + "/with-tracks", token))
        val out = mutableListOf<Track>()
        val volumes = r.optJSONArray("volumes") ?: return out
        for (v in 0 until volumes.length()) {
            val vol = volumes.optJSONArray(v) ?: continue
            for (i in 0 until vol.length()) {
                val t = vol.optJSONObject(i) ?: continue
                out.add(shapeTrack(t, albumId))
            }
        }
        return out
    }

    fun fetchPlaylistTracks(link: YmLink.PlaylistLink, token: String?): List<Track> {
        val url = if (link.uuid != null) API + "/playlist/" + link.uuid
        else API + "/users/" + link.owner + "/playlists/" + link.kinds
        val r = result(Http.getString(url, token))
        val out = mutableListOf<Track>()
        val tracks = r.optJSONArray("tracks") ?: return out
        for (i in 0 until tracks.length()) {
            val item = tracks.optJSONObject(i) ?: continue
            // Элемент плейлиста может быть обёрткой вида { track: { ... } }
            val t = item.optJSONObject("track") ?: item
            out.add(shapeTrack(t))
        }
        return out
    }

    fun listTracks(link: YmLink, token: String?): List<Track> = when (link) {
        is YmLink.TrackLink -> listOf(fetchTrack(link.trackId, link.albumId, token))
        is YmLink.AlbumLink -> fetchAlbumTracks(link.albumId, token)
        is YmLink.PlaylistLink -> fetchPlaylistTracks(link, token)
    }

    /** Текст песни — отдаётся и без токена. */
    fun fetchLyrics(trackId: String, token: String?): String {
        return try {
            val r = result(Http.getString(API + "/tracks/" + trackId + "/supplement", token))
            val l = r.optJSONObject("lyrics") ?: return ""
            val full = l.optString("fullLyrics", "")
            if (full.isNotBlank()) full else l.optString("lyrics", "")
        } catch (e: Exception) {
            ""
        }
    }

    fun coverUrl(coverUri: String, size: String = "600x600"): String? {
        if (coverUri.isBlank()) return null
        val u = if (coverUri.startsWith("http")) coverUri else "https://" + coverUri
        return u.replace("%%", size)
    }

    // ─────────────────────── Ссылка на аудио ───────────────────────

    /** Новый эндпоинт — единственный путь к FLAC. Поток приходит зашифрованным. */
    private fun getFileInfoV2(trackId: String, token: String?): JSONObject? {
        val ts = System.currentTimeMillis() / 1000
        val sign = Crypto.fileInfoSign(ts, trackId, CODECS, TRANSPORTS)
        val url = API + "/get-file-info?ts=" + ts + "&trackId=" + trackId +
                "&quality=lossless" +
                "&codecs=" + URLEncoder.encode(CODECS, "UTF-8") +
                "&transports=" + TRANSPORTS +
                "&sign=" + URLEncoder.encode(sign, "UTF-8")
        val r = result(Http.getString(url, token))
        return r.optJSONObject("downloadInfo") ?: r
    }

    /** Старый путь: получаем host/path/s/ts и подписываем ссылку через MD5. */
    private fun resolveDownloadInfoUrl(infoUrl: String): String? {
        val sep = if (infoUrl.contains("?")) "&" else "?"
        val text = Http.getString(infoUrl + sep + "format=json")
        val j = JSONObject(text)
        val host = j.optString("host")
        val path = j.optString("path")
        val ts = j.optString("ts")
        val s = j.optString("s")
        if (host.isBlank() || path.isBlank() || ts.isBlank() || s.isBlank()) return null
        val sign = Crypto.md5Hex(Crypto.SIGN_SALT + path.substring(1) + s)
        return "https://" + host + "/get-mp3/" + sign + "/" + ts + path
    }

    fun getAudioSource(track: Track, quality: Quality, token: String): AudioSource {
        // FLAC и Авто сначала пробуют новый эндпоинт
        if (quality == Quality.FLAC || quality == Quality.AUTO) {
            try {
                val info = getFileInfoV2(track.trackId, token)
                val urls = info?.optJSONArray("urls")
                val codec = (info?.optString("codec") ?: "").lowercase()
                val key = info?.optString("key") ?: ""
                val isFlac = codec == "flac" || codec == "flac-mp4"
                if (urls != null && urls.length() > 0 && key.isNotBlank() && isFlac) {
                    return AudioSource(urls.getString(0), "flac", key)
                }
                if (quality == Quality.FLAC) {
                    val extra = if (codec.isNotBlank()) " (доступно: " + codec + ")" else ""
                    throw Exception(
                        "FLAC недоступен для этого трека — нет lossless-версии" + extra +
                                ". Выберите «MP3 320» или «Авто»."
                    )
                }
            } catch (e: Http.HttpError) {
                if (quality == Quality.FLAC) {
                    val msg = if (e.code == 403) "FLAC недоступен: нужна подписка Яндекс.Плюс."
                    else "FLAC недоступен: " + e.message
                    throw Exception(msg)
                }
                // В режиме «Авто» молча уходим на MP3
            }
        }

        // MP3 через /download-info
        val arr = resultArray(
            Http.getString(API + "/tracks/" + track.trackId + "/download-info", token)
        )
        if (arr.length() == 0) throw Exception("Яндекс не вернул ссылки на скачивание")

        var best: JSONObject? = null
        var bestBitrate = -1
        for (i in 0 until arr.length()) {
            val item = arr.getJSONObject(i)
            if (item.optString("codec") != "mp3") continue
            val br = item.optInt("bitrateInKbps")
            if (br > bestBitrate) {
                bestBitrate = br
                best = item
            }
        }
        val pick = best ?: arr.getJSONObject(0)
        val direct = resolveDownloadInfoUrl(pick.optString("downloadInfoUrl"))
            ?: throw Exception("Не удалось получить прямую ссылку на аудио")
        return AudioSource(direct, pick.optString("codec", "mp3"), null)
    }
}
