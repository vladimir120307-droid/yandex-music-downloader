package ru.ymd.downloader

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.BufferedOutputStream
import java.io.File
import java.io.OutputStream

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
        if (wantLyrics && track.lyrics.isBlank()) {
            track.lyrics = YandexMusic.fetchLyrics(track.trackId, token)
        }
        return save(source, track, wantNativeFlac, onBytes)
    }

    /**
     * Скачивает, расшифровывает и сохраняет трек.
     *
     * В памяти держим одну копию файла. FLAC бывает по 40–60 МБ, а приложению
     * на многих телефонах дают около 192 МБ. Раньше копий было до четырёх, и
     * длинные треки роняли приложение посреди плейлиста (issue #76).
     */
    fun save(
        source: AudioSource,
        track: Track,
        wantNativeFlac: Boolean,
        onBytes: ((Long, Long) -> Unit)? = null,
    ): Result {
        val bytes = Http.getBytes(source.url, onBytes)

        // Лучше честная ошибка, чем молча сохранённый пустой файл (обсуждение #51)
        if (bytes.size < 1024) {
            throw Exception(
                "Аудио скачалось пустым (${bytes.size} байт). Обычно это значит, " +
                        "что ссылка устарела — попробуйте ещё раз."
            )
        }

        source.encryptionKey?.let { Crypto.decryptAesCtrInPlace(bytes, it) }

        val cover = try {
            YandexMusic.coverUrl(track.coverUri)?.let { Http.getBytes(it) }
        } catch (e: Exception) { null }

        // Определяем формат по содержимому: поле codec из API бывает неточным
        val name = track.baseName()
        return when {
            FlacRemux.isNativeFlac(bytes) ->
                saveToMusic("$name.flac", "audio/flac") { it.write(bytes) }

            FlacRemux.isMp4(bytes) -> {
                val plan = if (wantNativeFlac) {
                    try { FlacRemux.plan(bytes) } catch (e: FlacRemux.NotFlacMp4) { null }
                } else null
                if (plan != null) {
                    saveToMusic("$name.flac", "audio/flac") { FlacRemux.write(bytes, plan, track, cover, it) }
                } else {
                    saveToMusic("$name.m4a", "audio/mp4") { it.write(bytes) }
                }
            }

            else -> {
                val tagged = Id3.attach(bytes, track, cover)
                saveToMusic("$name.mp3", "audio/mpeg") { it.write(tagged) }
            }
        }
    }

    /** Сохранение в общую папку «Музыка/MusicDownloader». */
    private fun saveToMusic(fileName: String, mime: String, write: (OutputStream) -> Unit): Result {
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
            try {
                val out = resolver.openOutputStream(uri) ?: throw Exception("Не удалось записать файл")
                BufferedOutputStream(out, 256 * 1024).use(write)
            } catch (e: Throwable) {
                // Недописанный файл не оставляем
                resolver.delete(uri, null, null)
                throw e
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
            val file = File(dir, fileName)
            try {
                BufferedOutputStream(file.outputStream(), 256 * 1024).use(write)
            } catch (e: Throwable) {
                file.delete()
                throw e
            }
        }
        return Result(fileName, fileName.substringAfterLast('.'))
    }
}
