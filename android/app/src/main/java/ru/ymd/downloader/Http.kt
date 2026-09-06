package ru.ymd.downloader

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** Минимальный HTTP-клиент на HttpURLConnection — без сторонних библиотек. */
object Http {

    private const val UA = "Mozilla/5.0 (Linux; Android 10) MusicDownloader/1.0"

    private fun open(url: String, token: String?, method: String = "GET"): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 30_000
        c.readTimeout = 120_000
        c.setRequestProperty("User-Agent", UA)
        c.setRequestProperty("Accept", "application/json")
        // Мимикаем мобильное приложение — иначе API не отдаёт lossless
        c.setRequestProperty("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
        if (!token.isNullOrBlank()) c.setRequestProperty("Authorization", "OAuth $token")
        return c
    }

    fun getString(url: String, token: String? = null): String {
        val c = open(url, token)
        try {
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw HttpError(code, body)
            return body
        } finally { c.disconnect() }
    }

    fun postString(url: String, body: String, token: String? = null): String {
        val c = open(url, token, "POST")
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        try {
            c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val resp = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw HttpError(code, resp)
            return resp
        } finally { c.disconnect() }
    }

    /** Скачивание в память с прогрессом (нужно для расшифровки и тегов). */
    fun getBytes(url: String, onProgress: ((Long, Long) -> Unit)? = null): ByteArray {
        val c = open(url, null)
        try {
            val code = c.responseCode
            if (code !in 200..299) throw HttpError(code, "")
            val total = c.contentLengthLong
            val out = ByteArrayOutputStream(if (total > 0) total.toInt() else 1 shl 20)
            val buf = ByteArray(64 * 1024)
            var read: Long = 0
            c.inputStream.use { input ->
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    read += n
                    onProgress?.invoke(read, total)
                }
            }
            return out.toByteArray()
        } finally { c.disconnect() }
    }

    class HttpError(val code: Int, val body: String) :
        Exception("HTTP $code ${body.take(200)}")
}
