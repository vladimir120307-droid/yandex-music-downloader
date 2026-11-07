package ru.ymd.downloader

import org.json.JSONObject

/** Проверка новой версии на GitHub: приложение раздаётся не через магазин, сам Android его не обновит. */
object UpdateChecker {

    private const val API =
        "https://api.github.com/repos/vladimir120307-droid/yandex-music-downloader/releases/latest"

    data class Update(val version: String, val url: String)

    private fun parts(version: String): List<Int> {
        val p = version.trim().removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
        return (p + listOf(0, 0, 0)).take(3)
    }

    /** Четвёртое число версии — пересборка десктопа со свежим yt-dlp, приложения она не касается. */
    fun isNewer(latest: String, current: String): Boolean {
        val a = parts(latest)
        val b = parts(current)
        for (i in 0 until 3) {
            if (a[i] != b[i]) return a[i] > b[i]
        }
        return false
    }

    /** Возвращает обновление или null. Сетевые ошибки глотаем: приложение работает и без этого. */
    fun check(current: String): Update? {
        // 0.0.0 — локальная сборка без версии из тега
        if (current == "0.0.0") return null
        return try {
            val release = JSONObject(Http.getString(API))
            val latest = release.getString("tag_name").removePrefix("v")
            if (!isNewer(latest, current)) return null
            val assets = release.getJSONArray("assets")
            var url = release.getString("html_url")
            for (i in 0 until assets.length()) {
                val asset = assets.getJSONObject(i)
                if (asset.getString("name").endsWith(".apk")) {
                    url = asset.getString("browser_download_url")
                    break
                }
            }
            Update(parts(latest).joinToString("."), url)
        } catch (e: Exception) {
            null
        }
    }
}
