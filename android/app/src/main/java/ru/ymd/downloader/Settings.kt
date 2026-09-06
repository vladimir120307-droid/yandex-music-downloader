package ru.ymd.downloader

import android.content.Context

/** Настройки приложения. Хранятся локально на устройстве. */
class Settings(context: Context) {

    private val prefs = context.getSharedPreferences("ymd", Context.MODE_PRIVATE)

    var token: String
        get() = prefs.getString("token", "") ?: ""
        set(v) = prefs.edit().putString("token", v).apply()

    var quality: Quality
        get() = when (prefs.getString("quality", "AUTO")) {
            "FLAC" -> Quality.FLAC
            "MP3_320" -> Quality.MP3_320
            else -> Quality.AUTO
        }
        set(v) = prefs.edit().putString("quality", v.name).apply()

    var nativeFlac: Boolean
        get() = prefs.getBoolean("nativeFlac", true)
        set(v) = prefs.edit().putBoolean("nativeFlac", v).apply()

    var lyrics: Boolean
        get() = prefs.getBoolean("lyrics", false)
        set(v) = prefs.edit().putBoolean("lyrics", v).apply()

    companion object {
        /** Из адреса после авторизации достаём сам токен. */
        fun extractToken(raw: String): String {
            val m = Regex("[#&?]access_token=([A-Za-z0-9_.\\-]+)").find(raw)
            return m?.groupValues?.get(1) ?: raw.trim()
        }
    }
}
