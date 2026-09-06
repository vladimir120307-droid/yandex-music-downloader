package ru.ymd.downloader

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Bg = Color(0xFF0D0D1A)
private val Bg2 = Color(0xFF1A1A2E)
private val Yellow = Color(0xFFFFDB4D)
private val TextGrey = Color(0xFF9A9AAE)

class MainActivity : ComponentActivity() {

    private lateinit var settings: Settings

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)

        // Ссылка, пришедшая через «Поделиться»
        val shared = if (intent?.action == Intent.ACTION_SEND)
            intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty() else ""

        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Yellow, background = Bg)) {
                Screen(shared)
            }
        }
    }

    @Composable
    private fun Screen(sharedUrl: String) {
        var token by remember { mutableStateOf(settings.token) }
        var url by remember { mutableStateOf(extractUrl(sharedUrl)) }
        var quality by remember { mutableStateOf(settings.quality) }
        var nativeFlac by remember { mutableStateOf(settings.nativeFlac) }
        var lyrics by remember { mutableStateOf(settings.lyrics) }

        var busy by remember { mutableStateOf(false) }
        var status by remember { mutableStateOf("Готов к работе") }
        var progress by remember { mutableStateOf(0f) }
        val log = remember { mutableStateListOf<String>() }

        fun addLog(line: String) {
            log.add(line)
            if (log.size > 200) log.removeAt(0)
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Bg)
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Text("Music Downloader", color = Yellow, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("Яндекс.Музыка · FLAC / MP3 · обложка, теги, текст",
                color = TextGrey, fontSize = 12.sp)

            Spacer(Modifier.height(18.dp))

            // ── Токен ──
            Text("Токен Яндекс.Музыки", color = Color.White, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                placeholder = { Text("Вставьте токен или адрес после входа", color = TextGrey) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = fieldColors(),
            )
            Spacer(Modifier.height(8.dp))
            Row {
                Button(
                    onClick = {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(YandexMusic.OAUTH_URL)))
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Bg2)
                ) { Text("Получить токен", color = Color.White) }

                Spacer(Modifier.width(8.dp))

                Button(
                    onClick = {
                        val clean = Settings.extractToken(token)
                        token = clean
                        settings.token = clean
                        status = if (clean.isBlank()) "Токен очищен"
                        else "Токен сохранён (${clean.length} символов)"
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Yellow)
                ) { Text("Сохранить", color = Bg, fontWeight = FontWeight.Bold) }
            }
            Text(
                "Нужен один раз. Для FLAC требуется подписка Яндекс.Плюс.",
                color = TextGrey, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)
            )

            Spacer(Modifier.height(18.dp))

            // ── Ссылка ──
            Text("Ссылка на трек, альбом, плейлист или подкаст",
                color = Color.White, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                placeholder = { Text("https://music.yandex.ru/...", color = TextGrey) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = fieldColors(),
            )

            Spacer(Modifier.height(16.dp))

            // ── Качество ──
            Text("Качество", color = Color.White, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Row {
                QualityChip("Авто", quality == Quality.AUTO) {
                    quality = Quality.AUTO; settings.quality = quality
                }
                Spacer(Modifier.width(8.dp))
                QualityChip("FLAC", quality == Quality.FLAC) {
                    quality = Quality.FLAC; settings.quality = quality
                }
                Spacer(Modifier.width(8.dp))
                QualityChip("MP3 320", quality == Quality.MP3_320) {
                    quality = Quality.MP3_320; settings.quality = quality
                }
            }

            Spacer(Modifier.height(8.dp))
            CheckRow("Переупаковывать FLAC в настоящий .flac", nativeFlac) {
                nativeFlac = it; settings.nativeFlac = it
            }
            CheckRow("Сохранять текст песни", lyrics) {
                lyrics = it; settings.lyrics = it
            }

            Spacer(Modifier.height(18.dp))

            Button(
                onClick = {
                    val link = url.trim()
                    if (link.isBlank()) { status = "Вставьте ссылку"; return@Button }
                    if (token.isBlank()) { status = "Сначала сохраните токен"; return@Button }
                    busy = true; progress = 0f; log.clear()
                    status = "Получаю данные…"

                    lifecycleScope.launch {
                        try {
                            val result = withContext(Dispatchers.IO) {
                                runDownload(link, token, quality, nativeFlac, lyrics,
                                    onStatus = { s -> status = s },
                                    onProgress = { p -> progress = p },
                                    onLog = { l -> addLog(l) })
                            }
                            status = result
                            progress = 1f
                        } catch (e: Exception) {
                            status = "Ошибка: " + (e.message ?: e.toString())
                            addLog("Ошибка: " + (e.message ?: e.toString()))
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Yellow)
            ) {
                Text(if (busy) "Скачиваю…" else "Скачать",
                    color = Bg, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }

            Spacer(Modifier.height(12.dp))
            if (busy || progress > 0f) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth(),
                    color = Yellow,
                    trackColor = Bg2,
                )
                Spacer(Modifier.height(8.dp))
            }
            Text(status, color = TextGrey, fontSize = 13.sp)

            if (log.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Text("Журнал", color = Color.White, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                SelectionContainer {
                    Column(
                        Modifier.fillMaxWidth()
                            .background(Color(0xFF11111D))
                            .padding(10.dp)
                    ) {
                        log.forEach {
                            Text(it, color = Color(0xFFBBBBCC), fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
            Text("Файлы сохраняются в папку Музыка/MusicDownloader",
                color = TextGrey, fontSize = 11.sp)
        }
    }

    /** Скачивание одного трека или целого альбома/плейлиста. */
    private fun runDownload(
        link: String,
        token: String,
        quality: Quality,
        nativeFlac: Boolean,
        lyrics: Boolean,
        onStatus: (String) -> Unit,
        onProgress: (Float) -> Unit,
        onLog: (String) -> Unit,
    ): String {
        if (!YandexMusic.isYandexUrl(link)) {
            throw Exception("Это не ссылка на Яндекс.Музыку")
        }
        val parsed = YandexMusic.parseUrl(link)
            ?: throw Exception("Не удалось разобрать ссылку. Поддерживаются треки, альбомы, плейлисты и подкасты.")

        val tracks = YandexMusic.listTracks(parsed, token)
        if (tracks.isEmpty()) throw Exception("Треки не найдены")

        val downloader = Downloader(this)
        var done = 0
        var failed = 0

        tracks.forEachIndexed { index, track ->
            val label = track.baseName()
            onStatus("${index + 1} из ${tracks.size}: $label")
            try {
                val res = downloader.downloadTrack(
                    track, token, quality, nativeFlac, lyrics,
                    onBytes = { read, total ->
                        val base = index.toFloat() / tracks.size
                        val step = if (total > 0) (read.toFloat() / total) / tracks.size else 0f
                        onProgress(base + step)
                    }
                )
                done++
                onLog("✓ ${res.fileName}")
            } catch (e: Exception) {
                failed++
                onLog("✗ $label — ${e.message}")
            }
            onProgress((index + 1).toFloat() / tracks.size)
        }

        return if (failed == 0) "Готово: скачано $done из ${tracks.size}"
        else "Скачано $done из ${tracks.size}, с ошибкой: $failed"
    }

    /** Из текста «Поделиться» вытаскиваем именно адрес. */
    private fun extractUrl(text: String): String {
        if (text.isBlank()) return ""
        return Regex("https?://\\S+").find(text)?.value ?: ""
    }

    @Composable
    private fun QualityChip(label: String, selected: Boolean, onClick: () -> Unit) {
        FilterChip(
            selected = selected,
            onClick = onClick,
            label = { Text(label) },
            colors = FilterChipDefaults.filterChipColors(
                containerColor = Bg2,
                labelColor = Color.White,
                selectedContainerColor = Yellow,
                selectedLabelColor = Bg,
            )
        )
    }

    @Composable
    private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = checked,
                onCheckedChange = onChange,
                colors = CheckboxDefaults.colors(checkedColor = Yellow, checkmarkColor = Bg)
            )
            Text(label, color = Color.White, fontSize = 13.sp)
        }
    }

    @Composable
    private fun fieldColors() = OutlinedTextFieldDefaults.colors(
        focusedContainerColor = Bg2,
        unfocusedContainerColor = Bg2,
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White,
        focusedBorderColor = Yellow,
        unfocusedBorderColor = Color(0xFF2A2A3E),
        cursorColor = Yellow,
    )
}
