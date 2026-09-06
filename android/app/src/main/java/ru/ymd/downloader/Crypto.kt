package ru.ymd.downloader

import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Криптография для API Яндекс.Музыки.
 *
 * Портировано с рабочей реализации из расширения (lib/md5.js, services/yandex.js)
 * и десктопа (desktop/yandex_music.py) — форматы подписи там уже проверены боем.
 */
object Crypto {

    /** Ключ подписи для /get-file-info (публично известный, из Android-клиента). */
    private const val SIGN_KEY = "p93jhgh689SBReK6ghtw62"

    /** Соль для подписи URL старого /download-info. */
    const val SIGN_SALT = "XGRlBW9FXlekgbPrRHuSiA"

    /**
     * Подпись для /get-file-info.
     *
     * Особенность API: значения параметров склеиваются подряд, запятые из списка
     * кодеков удаляются, а у base64-результата отбрасывается последний символ.
     */
    fun fileInfoSign(ts: Long, trackId: String, codecs: String, transports: String): String {
        val msg = "$ts$trackId" + "lossless" + codecs.replace(",", "") + transports
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(SIGN_KEY.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val digest = mac.doFinal(msg.toByteArray(Charsets.UTF_8))
        val b64 = android.util.Base64.encodeToString(digest, android.util.Base64.NO_WRAP)
        return b64.dropLast(1)
    }

    /** MD5-хэш в hex — для подписи ссылок старого /download-info. */
    fun md5Hex(input: String): String {
        val d = MessageDigest.getInstance("MD5").digest(input.toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }
    }

    /**
     * Расшифровка аудиопотока: AES-CTR с нулевым nonce.
     * Ключ приходит от API в hex. Счётчик — 16 нулевых байт.
     */
    fun decryptAesCtr(data: ByteArray, hexKey: String): ByteArray {
        val key = ByteArray(hexKey.length / 2) {
            ((Character.digit(hexKey[it * 2], 16) shl 4) or
                    Character.digit(hexKey[it * 2 + 1], 16)).toByte()
        }
        val cipher = Cipher.getInstance("AES/CTR/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(ByteArray(16)))
        return cipher.doFinal(data)
    }
}
