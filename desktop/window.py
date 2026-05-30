"""Main window — paste URL, see queue, watch progress."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import Qt, QObject, QThread, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices, QGuiApplication, QIcon
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QFileDialog, QFrame, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QMainWindow, QMenu, QMessageBox,
    QProgressBar, QPushButton, QStatusBar, QTableWidget, QTableWidgetItem,
    QVBoxLayout, QWidget,
)

import ffmpeg_installer
from core import DownloadWorker
from ffmpeg_helper import find_ffmpeg, suggest_install
from settings import Settings


class FfmpegInstallWorker(QObject):
    progress = Signal(dict)
    done = Signal(str)
    error = Signal(str)

    def __init__(self, target_dir: Path):
        super().__init__()
        self._target = target_dir
        self._cancel = False

    def cancel(self):
        self._cancel = True

    @Slot()
    def run(self):
        try:
            path = ffmpeg_installer.install_ffmpeg(
                self._target,
                progress_cb=lambda d: self.progress.emit(d),
                cancel_check=lambda: self._cancel,
            )
            self.done.emit(str(path))
        except Exception as e:
            self.error.emit(str(e))


STYLESHEET = """
* { font-family: 'Segoe UI', -apple-system, sans-serif; }
QMainWindow, QWidget { background: #0d0d1a; color: #fff; }
QLabel { color: #ccc; font-size: 12px; }
QLabel#title { color: #ffdb4d; font-size: 18px; font-weight: 700; }
QLabel#subtitle { color: #888; font-size: 11px; }
QLabel.section { color: #888; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; font-weight: 600; }

QLineEdit {
    background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 6px;
    padding: 8px 10px; color: #fff; font-size: 12px;
    selection-background-color: #ffdb4d; selection-color: #1a1a2e;
}
QLineEdit:focus { border: 1px solid #ffdb4d; }
QLineEdit:read-only { background: #15151f; color: #888; }

QPushButton {
    background: #ffdb4d; color: #1a1a2e; border: none; border-radius: 6px;
    padding: 8px 18px; font-weight: 600; font-size: 12px;
}
QPushButton:hover { background: #ffe87d; }
QPushButton:pressed { background: #f0c000; }
QPushButton:disabled { background: #444; color: #888; }
QPushButton[secondary="true"] {
    background: #2a2a3e; color: #fff;
}
QPushButton[secondary="true"]:hover { background: #3a3a4e; }

QComboBox {
    background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 6px;
    padding: 6px 10px; color: #fff; min-width: 110px;
}
QComboBox:hover { border-color: #3a3a5e; }
QComboBox::drop-down { border: none; width: 22px; }
QComboBox::down-arrow {
    image: none; width: 0; height: 0;
    border-left: 5px solid transparent; border-right: 5px solid transparent;
    border-top: 5px solid #888; margin-right: 8px;
}
QComboBox QAbstractItemView {
    background: #1a1a2e; color: #fff; border: 1px solid #2a2a3e;
    selection-background-color: #ffdb4d; selection-color: #1a1a2e;
    padding: 4px;
}

QTableWidget {
    background: #11111d; border: 1px solid #1a1a2e; border-radius: 8px;
    gridline-color: transparent; font-size: 12px;
}
QTableWidget::item { padding: 6px 8px; border: none; }
QTableWidget::item:selected { background: rgba(255, 219, 77, 0.12); color: #fff; }
QHeaderView { background: #1a1a2e; }
QHeaderView::section {
    background: #1a1a2e; color: #888; border: none; padding: 8px;
    font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;
}

QProgressBar {
    background: #1a1a2e; border: none; border-radius: 4px; height: 8px;
    text-align: center; color: transparent;
}
QProgressBar::chunk { background: #ffdb4d; border-radius: 4px; }

QStatusBar { background: #08080d; color: #888; font-size: 11px; }
QStatusBar::item { border: none; }

QFrame#sep { background: #1a1a2e; max-height: 1px; min-height: 1px; }

QMenu { background: #1a1a2e; color: #fff; border: 1px solid #2a2a3e; padding: 4px; }
QMenu::item { padding: 6px 18px; border-radius: 4px; }
QMenu::item:selected { background: #ffdb4d; color: #1a1a2e; }
"""


AUDIO_MODES = [
    ('Аудио · mp3 320kbps', dict(audio_only=True, audio_format='mp3', audio_quality='320')),
    ('Аудио · mp3 192kbps', dict(audio_only=True, audio_format='mp3', audio_quality='192')),
    ('Аудио · m4a (best)',  dict(audio_only=True, audio_format='m4a', audio_quality='0')),
    ('Аудио · flac',         dict(audio_only=True, audio_format='flac', audio_quality='0')),
    ('Аудио · opus',         dict(audio_only=True, audio_format='opus', audio_quality='0')),
    ('Видео · best',         dict(audio_only=False, video_format='best')),
    ('Видео · 1080p',        dict(audio_only=False, video_format='1080')),
    ('Видео · 720p',         dict(audio_only=False, video_format='720')),
    ('Видео · 480p',         dict(audio_only=False, video_format='480')),
]


def humanize(bytes_):
    if not bytes_:
        return '?'
    for unit in ('B', 'KB', 'MB', 'GB'):
        if bytes_ < 1024:
            return f'{bytes_:.1f} {unit}'
        bytes_ /= 1024
    return f'{bytes_:.1f} TB'


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = Settings()
        self._jobs = {}                   # job_id -> dict(thread, worker, file_path)
        self._next_job_id = 1
        self.ffmpeg_path = find_ffmpeg()

        self.setWindowTitle('Music Downloader')
        self.resize(820, 600)
        self.setStyleSheet(STYLESHEET)
        try:
            icon_path = Path(__file__).resolve().parents[1] / 'icons' / 'icon128.png'
            if icon_path.exists():
                self.setWindowIcon(QIcon(str(icon_path)))
        except Exception:
            pass

        self._build_ui()
        self._load_settings()
        self._refresh_status()

    # ─────────────────────── UI ───────────────────────
    def _build_ui(self):
        central = QWidget()
        layout = QVBoxLayout(central)
        layout.setContentsMargins(18, 16, 18, 12)
        layout.setSpacing(10)

        title = QLabel('Music Downloader')
        title.setObjectName('title')
        layout.addWidget(title)

        subtitle = QLabel('Я.Музыка (прямой mp3 без ffmpeg) · YouTube · SoundCloud · Bandcamp · VK · Twitch · 1800+ сайтов')
        subtitle.setObjectName('subtitle')
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        # URL input row
        url_row = QHBoxLayout()
        self.url_edit = QLineEdit()
        self.url_edit.setPlaceholderText('Вставьте ссылку (можно несколько через пробел/Enter)')
        self.url_edit.returnPressed.connect(self.add_jobs_from_input)
        url_row.addWidget(self.url_edit, 1)
        self.add_btn = QPushButton('Скачать')
        self.add_btn.clicked.connect(self.add_jobs_from_input)
        url_row.addWidget(self.add_btn)
        layout.addLayout(url_row)

        # Options row 1: mode + cookies
        opt_row1 = QHBoxLayout()
        opt_row1.addWidget(QLabel('Формат:'))
        self.mode_combo = QComboBox()
        for label, _ in AUDIO_MODES:
            self.mode_combo.addItem(label)
        self.mode_combo.currentIndexChanged.connect(self._save_settings)
        opt_row1.addWidget(self.mode_combo)

        opt_row1.addSpacing(20)
        opt_row1.addWidget(QLabel('Cookies:'))
        self.cookies_combo = QComboBox()
        self.cookies_combo.addItem('Не использовать', userData='')
        for browser in ('chrome', 'edge', 'firefox', 'brave', 'chromium', 'opera', 'vivaldi'):
            self.cookies_combo.addItem(browser.capitalize(), userData=browser)
        self.cookies_combo.setToolTip(
            'Использовать cookies из выбранного браузера.\n'
            'Нужно для авторизованных сервисов (Я.Музыка premium, YouTube Premium и т.д.).'
        )
        self.cookies_combo.currentIndexChanged.connect(self._save_settings)
        opt_row1.addWidget(self.cookies_combo)
        opt_row1.addStretch()
        layout.addLayout(opt_row1)

        # Options row 2: output dir
        dir_row = QHBoxLayout()
        dir_row.addWidget(QLabel('Папка:'))
        self.dir_edit = QLineEdit()
        self.dir_edit.setReadOnly(True)
        dir_row.addWidget(self.dir_edit, 1)
        choose_btn = QPushButton('Выбрать')
        choose_btn.setProperty('secondary', True)
        choose_btn.clicked.connect(self._choose_dir)
        dir_row.addWidget(choose_btn)
        open_btn = QPushButton('Открыть')
        open_btn.setProperty('secondary', True)
        open_btn.clicked.connect(self._open_dir)
        dir_row.addWidget(open_btn)
        layout.addLayout(dir_row)

        # Я.Музыка токен — нужен с мая 2026 (Яндекс снёс старый веб-API)
        yam_row = QHBoxLayout()
        yam_label = QLabel('Я.Музыка токен:')
        yam_label.setToolTip(
            'OAuth-токен нужен только для Я.Музыки (с мая 2026 другого пути нет).\n'
            'Для остальных сайтов (YouTube, SoundCloud, и т.д.) поле можно оставить пустым.'
        )
        yam_row.addWidget(yam_label)
        self.yam_token_edit = QLineEdit()
        self.yam_token_edit.setPlaceholderText('токен или ПОЛНЫЙ URL после OAuth (с #access_token=...)')
        self.yam_token_edit.setToolTip(
            'Можно вставить просто токен ИЛИ полный URL из адресной строки после авторизации.\n'
            'Если страница быстро редиректнула — открой History (Ctrl+H), найди URL содержащий\n'
            'access_token и скопируй полностью. Программа сама вытащит токен.'
        )
        yam_row.addWidget(self.yam_token_edit, 1)
        yam_get_btn = QPushButton('Получить')
        yam_get_btn.setProperty('secondary', True)
        yam_get_btn.setToolTip('Откроет страницу OAuth Яндекса — авторизуйся, скопируй access_token из URL.')
        yam_get_btn.clicked.connect(self._open_yam_oauth)
        yam_row.addWidget(yam_get_btn)
        yam_save_btn = QPushButton('Сохранить')
        yam_save_btn.setProperty('secondary', True)
        yam_save_btn.clicked.connect(self._save_yam_token)
        yam_row.addWidget(yam_save_btn)
        layout.addLayout(yam_row)

        # Я.Музыка качество — отдельно от mode combo (тот для yt-dlp)
        yam_qual_row = QHBoxLayout()
        yam_qual_label = QLabel('Я.Музыка качество:')
        yam_qual_label.setToolTip(
            'Качество скачивания именно для Я.Музыки. На остальные сайты не влияет.\n'
            'Авто = FLAC если есть (нужен Я.Плюс), иначе MP3 320 — рекомендую большинству.'
        )
        yam_qual_row.addWidget(yam_qual_label)
        self.yam_quality_combo = QComboBox()
        self.yam_quality_combo.addItem('Авто (FLAC → MP3 320)', 'auto')
        self.yam_quality_combo.addItem('FLAC (lossless, Я.Плюс)', 'flac')
        self.yam_quality_combo.addItem('MP3 320 kbps (высокое)', 'mp3-320')
        self.yam_quality_combo.addItem('MP3 192 kbps (среднее)', 'mp3-192')
        self.yam_quality_combo.addItem('AAC 256 kbps', 'aac-256')
        self.yam_quality_combo.addItem('AAC 128 kbps', 'aac-128')
        self.yam_quality_combo.addItem('Минимальный размер', 'smallest')
        self.yam_quality_combo.setToolTip(
            'FLAC ~30-50 МБ/трек, идеально, нужен Я.Плюс.\n'
            'MP3 320 ~10 МБ/трек, звучит как FLAC на обычной акустике.\n'
            'MP3 192 ~7 МБ/трек, для телефона/фона.\n'
            'AAC лучше MP3 при том же битрейте, хорошо для Apple.\n'
            'Минимальный — если совсем мало места.'
        )
        self.yam_quality_combo.currentIndexChanged.connect(self._save_settings)
        yam_qual_row.addWidget(self.yam_quality_combo)
        yam_qual_row.addStretch()
        layout.addLayout(yam_qual_row)

        sep = QFrame(); sep.setObjectName('sep'); sep.setFrameShape(QFrame.HLine)
        layout.addWidget(sep)

        queue_label = QLabel('Очередь')
        queue_label.setProperty('class', 'section')
        layout.addWidget(queue_label)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(['Название', 'Сайт', 'Прогресс', 'Статус'])
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(0, QHeaderView.Stretch)
        h.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        h.setSectionResizeMode(2, QHeaderView.Fixed)
        h.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.setColumnWidth(2, 160)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._show_table_menu)
        self.table.doubleClicked.connect(self._on_row_double_click)
        layout.addWidget(self.table, 1)

        # Bottom actions
        action_row = QHBoxLayout()
        clear_btn = QPushButton('Очистить готовые')
        clear_btn.setProperty('secondary', True)
        clear_btn.clicked.connect(self._clear_finished)
        action_row.addWidget(clear_btn)
        action_row.addStretch()
        self.ffmpeg_btn = QPushButton('ffmpeg…')
        self.ffmpeg_btn.setProperty('secondary', True)
        self.ffmpeg_btn.clicked.connect(self._ffmpeg_button_clicked)
        action_row.addWidget(self.ffmpeg_btn)
        layout.addLayout(action_row)

        self.setCentralWidget(central)

        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)

    # ─────────────────────── Settings ───────────────────────
    def _load_settings(self):
        default_dir = str(Path.home() / 'Downloads' / 'MusicDownloader')
        self.dir_edit.setText(self.settings.get('output_dir', default_dir))
        self.mode_combo.setCurrentIndex(self.settings.get('mode', 0) or 0)
        self.cookies_combo.setCurrentIndex(self.settings.get('cookies', 0) or 0)
        self.yam_token_edit.setText(self.settings.get('yam_token', '') or '')
        saved_q = self.settings.get('yam_quality', 'auto') or 'auto'
        for i in range(self.yam_quality_combo.count()):
            if self.yam_quality_combo.itemData(i) == saved_q:
                self.yam_quality_combo.setCurrentIndex(i)
                break

    def _save_settings(self):
        self.settings.set('output_dir', self.dir_edit.text())
        self.settings.set('mode', self.mode_combo.currentIndex())
        self.settings.set('cookies', self.cookies_combo.currentIndex())
        self.settings.set('yam_quality', self.yam_quality_combo.currentData() or 'auto')

    def _refresh_status(self):
        if self.ffmpeg_path:
            self.status_bar.showMessage(f'ffmpeg: {self.ffmpeg_path}')
            if hasattr(self, 'ffmpeg_btn'):
                self.ffmpeg_btn.setText('ffmpeg ✓')
        else:
            self.status_bar.showMessage(
                '⚠ ffmpeg не найден — нажмите «Установить ffmpeg» (Я.Музыка работает и без него)'
            )
            if hasattr(self, 'ffmpeg_btn'):
                self.ffmpeg_btn.setText('Установить ffmpeg')

    def _choose_dir(self):
        d = QFileDialog.getExistingDirectory(self, 'Папка для загрузок', self.dir_edit.text())
        if d:
            self.dir_edit.setText(d)
            self._save_settings()

    def _open_yam_oauth(self):
        QDesktopServices.openUrl(QUrl(
            'https://oauth.yandex.ru/authorize?response_type=token'
            '&client_id=23cabbbdc6cd418abb4b39c32c41195d'
        ))

    def _save_yam_token(self):
        import re as _re
        raw = (self.yam_token_edit.text() or '').strip()
        # Если вставили полный URL после OAuth — вытащим токен из него
        m = _re.search(r'[#&?]access_token=([A-Za-z0-9_.\-]+)', raw)
        if m:
            t = m.group(1)
            self.yam_token_edit.setText(t)
        else:
            t = raw
        self.settings.set('yam_token', t)
        if t:
            self.status_bar.showMessage(f'Я.Музыка токен сохранён ({len(t)} символов)', 4000)
        else:
            self.status_bar.showMessage('Я.Музыка токен очищен', 4000)

    def _open_dir(self):
        path = self.dir_edit.text()
        Path(path).mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    def _ffmpeg_button_clicked(self):
        # Re-check first
        path = find_ffmpeg()
        self.ffmpeg_path = path
        self._refresh_status()
        if path:
            QMessageBox.information(self, 'ffmpeg', f'ffmpeg найден:\n{path}\n\nРаботает для всех сайтов.')
            return
        if os.name != 'nt':
            QMessageBox.warning(self, 'ffmpeg не найден', suggest_install())
            return
        target = ffmpeg_installer.get_install_target()
        reply = QMessageBox.question(
            self, 'Установить ffmpeg?',
            f'Скачать ffmpeg (~80 МБ) и положить в:\n{target}\n\n'
            f'Это нужно для скачивания с YouTube, SoundCloud и видео.\n'
            f'Для Я.Музыки и Bandcamp работает и без него.\n\n'
            f'Продолжить?',
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return
        self._start_ffmpeg_install(target)

    def _start_ffmpeg_install(self, target):
        if getattr(self, '_ffmpeg_thread', None) is not None:
            return  # already running
        self.ffmpeg_btn.setEnabled(False)
        self.ffmpeg_btn.setText('Скачиваю ffmpeg…')
        self.status_bar.showMessage('Скачиваю ffmpeg (~80 МБ)…')

        thread = QThread(self)
        worker = FfmpegInstallWorker(target)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.progress.connect(self._on_ffmpeg_progress)
        worker.done.connect(self._on_ffmpeg_done)
        worker.error.connect(self._on_ffmpeg_error)
        worker.done.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(self._clear_ffmpeg_thread)
        self._ffmpeg_thread = thread
        thread.start()

    def _clear_ffmpeg_thread(self):
        self._ffmpeg_thread = None
        self.ffmpeg_btn.setEnabled(True)

    @Slot(dict)
    def _on_ffmpeg_progress(self, d):
        status = d.get('status', '')
        msg = d.get('message', '')
        if status == 'downloading':
            downloaded = d.get('downloaded') or 0
            total = d.get('total') or 0
            if total:
                pct = int(downloaded / total * 100)
                self.status_bar.showMessage(f'{msg}  {pct}%  ({humanize(downloaded)}/{humanize(total)})')
            else:
                self.status_bar.showMessage(f'{msg}  {humanize(downloaded)}')
        else:
            self.status_bar.showMessage(msg or status)

    @Slot(str)
    def _on_ffmpeg_done(self, path):
        self.ffmpeg_path = path
        self._refresh_status()
        QMessageBox.information(self, 'ffmpeg установлен',
                                f'Готово! ffmpeg установлен в:\n{path}\n\n'
                                'Теперь работает скачивание со всех сайтов.')

    @Slot(str)
    def _on_ffmpeg_error(self, msg):
        self._refresh_status()
        QMessageBox.warning(self, 'Не получилось установить ffmpeg',
                            f'{msg}\n\nМожно поставить вручную — см. README.')

    # ─────────────────────── Job management ───────────────────────
    def add_jobs_from_input(self):
        raw = self.url_edit.text().strip()
        if not raw:
            return
        urls = [u for u in raw.split() if u]
        if not urls:
            return
        for u in urls:
            self._queue_url(u)
        self.url_edit.clear()

    def _build_options(self) -> dict:
        idx = self.mode_combo.currentIndex()
        _, mode_opts = AUDIO_MODES[idx]
        cookies = self.cookies_combo.currentData() or None
        return {
            'output_dir': self.dir_edit.text(),
            'ffmpeg_path': self.ffmpeg_path,
            'cookies_browser': cookies,
            'yam_token': self.settings.get('yam_token', '') or '',
            'yam_quality': self.yam_quality_combo.currentData() or 'auto',
            **mode_opts,
        }

    def _queue_url(self, url: str):
        job_id = self._next_job_id
        self._next_job_id += 1
        opts = self._build_options()

        row = self.table.rowCount()
        self.table.insertRow(row)
        title_item = QTableWidgetItem(url[:120])
        title_item.setData(Qt.UserRole, job_id)
        title_item.setData(Qt.UserRole + 1, url)
        title_item.setToolTip(url)
        self.table.setItem(row, 0, title_item)
        self.table.setItem(row, 1, QTableWidgetItem('—'))
        bar = QProgressBar()
        bar.setRange(0, 100)
        bar.setValue(0)
        bar.setTextVisible(True)
        self.table.setCellWidget(row, 2, bar)
        status_item = QTableWidgetItem('Ожидание…')
        self.table.setItem(row, 3, status_item)

        thread = QThread(self)
        worker = DownloadWorker(job_id, url, opts)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.info_ready.connect(self._on_info_ready)
        worker.progress.connect(self._on_progress)
        worker.done.connect(self._on_done)
        worker.error.connect(self._on_error)
        worker.done.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)

        self._jobs[job_id] = {'thread': thread, 'worker': worker, 'file_path': '', 'url': url, 'options': opts}
        thread.start()
        self.status_bar.showMessage(f'В очереди: {url[:80]}', 4000)

    def _row_for_job(self, job_id: int) -> int:
        for r in range(self.table.rowCount()):
            it = self.table.item(r, 0)
            if it and it.data(Qt.UserRole) == job_id:
                return r
        return -1

    @Slot(int, dict)
    def _on_info_ready(self, job_id, info):
        row = self._row_for_job(job_id)
        if row < 0:
            return
        title = info.get('title') or info.get('id') or '?'
        uploader = info.get('uploader') or info.get('channel') or info.get('artist') or ''
        site = info.get('extractor_key') or info.get('extractor') or '—'
        display = f'{uploader} — {title}' if uploader else title
        self.table.item(row, 0).setText(display[:140])
        self.table.item(row, 0).setToolTip(self._jobs[job_id]['url'])
        self.table.item(row, 1).setText(site)
        self.table.item(row, 3).setText('Скачивание…')

    @Slot(int, dict)
    def _on_progress(self, job_id, d):
        row = self._row_for_job(job_id)
        if row < 0:
            return
        bar = self.table.cellWidget(row, 2)
        status_item = self.table.item(row, 3)
        if d.get('status') == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate')
            downloaded = d.get('downloaded_bytes', 0) or 0
            speed = d.get('speed') or 0
            if total:
                pct = max(0, min(99, int(downloaded / total * 100)))
                bar.setValue(pct)
                bar.setFormat(f'{humanize(downloaded)}/{humanize(total)}  ·  {humanize(speed)}/s')
            else:
                bar.setFormat(f'{humanize(downloaded)} · {humanize(speed)}/s')
            status_item.setText('Скачивание')
        elif d.get('status') == 'finished':
            bar.setValue(99)
            bar.setFormat('Конвертация…')
            status_item.setText('Конвертация')

    @Slot(int, str)
    def _on_done(self, job_id, file_path):
        row = self._row_for_job(job_id)
        if row < 0:
            return
        bar = self.table.cellWidget(row, 2)
        bar.setValue(100)
        bar.setFormat('100%')
        self.table.item(row, 3).setText('✓ Готово')
        if job_id in self._jobs:
            self._jobs[job_id]['file_path'] = file_path
            self.table.item(row, 0).setData(Qt.UserRole + 2, file_path)
        self.status_bar.showMessage(f'Готово: {Path(file_path).name if file_path else "ОК"}', 5000)

    @Slot(int, str)
    def _on_error(self, job_id, msg):
        row = self._row_for_job(job_id)
        if row < 0:
            return
        self.table.cellWidget(row, 2).setFormat('—')
        item = self.table.item(row, 3)
        item.setText('✗ Ошибка')
        item.setToolTip(msg)
        self.status_bar.showMessage(f'Ошибка: {msg[:120]}', 8000)

    # ─────────────────────── Table interactions ───────────────────────
    def _show_table_menu(self, pos):
        idx = self.table.indexAt(pos)
        if not idx.isValid():
            return
        row = idx.row()
        title_item = self.table.item(row, 0)
        if not title_item:
            return
        job_id = title_item.data(Qt.UserRole)
        file_path = title_item.data(Qt.UserRole + 2) or ''
        url = title_item.data(Qt.UserRole + 1) or ''

        menu = QMenu(self)
        a_open = menu.addAction('Открыть в проводнике')
        a_open.setEnabled(bool(file_path) and Path(file_path).exists())
        a_retry = menu.addAction('Повторить')
        a_retry.setEnabled(bool(url) and self._jobs.get(job_id) is None)
        a_remove = menu.addAction('Убрать из списка')
        action = menu.exec(self.table.viewport().mapToGlobal(pos))

        if action == a_open and file_path:
            self._reveal_in_explorer(file_path)
        elif action == a_remove:
            self.table.removeRow(row)
        elif action == a_retry and url:
            self.table.removeRow(row)
            self._queue_url(url)

    def _on_row_double_click(self, idx):
        row = idx.row()
        title_item = self.table.item(row, 0)
        if not title_item:
            return
        file_path = title_item.data(Qt.UserRole + 2)
        if file_path and Path(file_path).exists():
            self._reveal_in_explorer(file_path)

    def _reveal_in_explorer(self, path: str):
        p = Path(path)
        try:
            if os.name == 'nt':
                subprocess.Popen(['explorer', '/select,', str(p)])
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', '-R', str(p)])
            else:
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(p.parent)))
        except Exception:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(p.parent)))

    def _clear_finished(self):
        for r in range(self.table.rowCount() - 1, -1, -1):
            status = self.table.item(r, 3)
            if status and status.text().startswith(('✓', '✗')):
                self.table.removeRow(r)
