package ru.ymd.downloader

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/**
 * Скачивание трека: получить ссылку, расшифровать при необходимости,
 * переупаковать FLAC, вшить теги и сохранить в общую папку «Музыка».
 */
class Downloader(private val context: Context) {

    data class Progress(
        val current: Int,
        val total: Int,
        val title: String,
        val bytes: Long = 0,
        val totalBytes: Long = 0,
    )

    data class Result(val fileName: String, val format: String)

    /**
     * @param wantNativeFlac переупаковывать FLAC-в-MP4 в настоящий .flac
     * @param wantLyrics вшивать текст песни
     */
    fun downloadTrack(
        track: Track,
        token: String,
        quality: Quality,
        wantNativeFlac: Boolean,
        wantLyrics: Boolean,
        onBytes: ((Long, Long) -> Unit)? = null,
    ): Result {
        val source = YandexMusic.getAudioSource(track, quality, token)

        var bytes = Http.getBytes(source.url, onBytes)
        if (source.encryptionKey != null) {
            bytes = Crypto.decryptAesCtr(bytes, source.encryptionKey)
        }

        if (wantLyrics && track.lyrics.isBlank()) {
            track.lyrics = YandexMusic.fetchLyrics(track.trackId, token)
        }

        val cover = try {
            YandexMusic.coverUrl(track.coverUri)?.let { Http.getBytes(it) }
        } catch (e: Exception) { null }

        // Определяем формат по содержимому: поле codec из API бывает неточным
        var ext: String
        var mime: String
        when {
            FlacRemux.isNativeFlac(bytes) -> { ext = "flac"; mime = "audio/flac" }
            FlacRemux.isMp4(bytes) -> {
                if (wantNativeFlac) {
                    try {
                        bytes = FlacRemux.remux(bytes, track, cover)
                        ext = "flac"; mime = "audio/flac"
                    } catch (e: FlacRemux.NotFlacMp4) {
                        ext = "m4a"; mime = "audio/mp4"
                    }
                } else {
                    ext = "m4a"; mime = "audio/mp4"
                }
            }
            else -> {
                ext = "mp3"; mime = "audio/mpeg"
                bytes = Id3.attach(bytes, track, cover)
            }
        }

        val fileName = track.baseName() + "." + ext
        saveToMusic(fileName, mime, bytes)
        return Result(fileName, ext)
    }

    /** Сохранение в общую папку «Музыка/MusicDownloader». */
    private fun saveToMusic(fileName: String, mime: String, data: ByteArray) {
        val subDir = "MusicDownloader"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_MUSIC + File.separator + subDir
                )
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw Exception("Не удалось создать файл в папке «Музыка»")
            resolver.openOutputStream(uri).use { out ->
                out?.write(data) ?: throw Exception("Не удалось записать файл")
            }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                subDir
            )
            if (!dir.exists()) dir.mkdirs()
            File(dir, fileName).writeBytes(data)
        }
    }
}
