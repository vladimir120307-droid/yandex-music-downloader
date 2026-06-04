"""Music Downloader Lite — облегчённая версия для Windows 7.

Только Яндекс.Музыка (FLAC / MP3 + обложка + теги + текст). GUI на tkinter
(встроен в Python, работает на Win7), переиспользует desktop/yandex_music.py.

Полная версия (1800 сайтов через yt-dlp) — на PySide6, требует Win10+.
Эта lite-версия специально для Win7.

Зависимости: mutagen, pycryptodome (для FLAC). tkinter — встроен.
    pip install mutagen pycryptodome
"""
from __future__ import annotations

import os
import re
import sys
import threading
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

sys.path.insert(0, str(Path(__file__).resolve().parent))
import yandex_music

OAUTH_URL = (
    'https://oauth.yandex.ru/authorize?response_type=token'
    '&client_id=23cabbbdc6cd418abb4b39c32c41195d'
)

# Палитра под стиль проекта
BG = '#0d0d1a'
BG2 = '#1a1a2e'
YELLOW = '#ffdb4d'
WHITE = '#ffffff'
GREY = '#888888'
GREEN = '#4caf50'
RED = '#f44336'


def config_path() -> Path:
    base = Path(os.environ.get('APPDATA', Path.home())) / 'MusicDownloaderLite'
    base.mkdir(parents=True, exist_ok=True)
    return base / 'settings.txt'


def load_settings() -> dict:
    p = config_path()
    out = {}
    if p.exists():
        try:
            for line in p.read_text(encoding='utf-8').splitlines():
                if '=' in line:
                    k, v = line.split('=', 1)
                    out[k.strip()] = v.strip()
        except Exception:
            pass
    return out


def save_settings(data: dict):
    try:
        config_path().write_text(
            '\n'.join(f'{k}={v}' for k, v in data.items()), encoding='utf-8')
    except Exception:
        pass


class App:
    def __init__(self):
        self.settings = load_settings()
        self.root = tk.Tk()
        self.root.title('Music Downloader Lite — Яндекс.Музыка (Win7)')
        self.root.geometry('640x600')
        self.root.configure(bg=BG)
        self.root.minsize(560, 520)
        self._build()
        self._cancel = False

    def _build(self):
        pad = dict(padx=16)

        # Заголовок
        head = tk.Frame(self.root, bg=BG)
        head.pack(fill='x', pady=(14, 6), **pad)
        tk.Label(head, text='🎵 Music Downloader Lite', bg=BG, fg=YELLOW,
                 font=('Segoe UI', 16, 'bold')).pack(anchor='w')
        tk.Label(head, text='Яндекс.Музыка · FLAC / MP3 · обложка · теги · текст',
                 bg=BG, fg=GREY, font=('Segoe UI', 9)).pack(anchor='w')

        # Токен
        self._section('Токен Яндекс.Музыки (нужен один раз):')
        trow = tk.Frame(self.root, bg=BG); trow.pack(fill='x', **pad)
        self.token_var = tk.StringVar(value=self.settings.get('token', ''))
        e = tk.Entry(trow, textvariable=self.token_var, bg=BG2, fg=WHITE,
                     insertbackground=WHITE, relief='flat', font=('Segoe UI', 9), show='*')
        e.pack(side='left', fill='x', expand=True, ipady=4, padx=(0, 6))
        tk.Button(trow, text='Получить', command=self._open_oauth, bg=BG2, fg=WHITE,
                  relief='flat', font=('Segoe UI', 9), cursor='hand2').pack(side='left', padx=(0, 4))
        tk.Button(trow, text='Сохранить', command=self._save_token, bg=YELLOW, fg=BG,
                  relief='flat', font=('Segoe UI', 9, 'bold'), cursor='hand2').pack(side='left')
        tk.Label(self.root, text='Вставь токен ИЛИ полный URL после OAuth (#access_token=…). Нужен Я.Плюс для FLAC.',
                 bg=BG, fg=GREY, font=('Segoe UI', 8), wraplength=600, justify='left').pack(anchor='w', **pad)

        # Ссылка
        self._section('Ссылка на трек / альбом / плейлист:')
        self.url_var = tk.StringVar()
        ue = tk.Entry(self.root, textvariable=self.url_var, bg=BG2, fg=WHITE,
                      insertbackground=WHITE, relief='flat', font=('Segoe UI', 10))
        ue.pack(fill='x', ipady=5, **pad)
        ue.bind('<Return>', lambda e: self.start())

        # Качество + текст
        opt = tk.Frame(self.root, bg=BG); opt.pack(fill='x', pady=(10, 0), **pad)
        tk.Label(opt, text='Качество:', bg=BG, fg=WHITE, font=('Segoe UI', 9)).pack(side='left')
        self.quality_var = tk.StringVar(value=self.settings.get('quality', 'auto'))
        qbox = ttk.Combobox(opt, textvariable=self.quality_var, state='readonly', width=28,
                            values=['auto', 'flac', 'mp3-320'])
        qbox.pack(side='left', padx=(6, 16))
        self.lyrics_var = tk.BooleanVar(value=self.settings.get('lyrics', '0') == '1')
        tk.Checkbutton(opt, text='Текст песни', variable=self.lyrics_var, bg=BG, fg=WHITE,
                       selectcolor=BG2, activebackground=BG, activeforeground=WHITE,
                       font=('Segoe UI', 9)).pack(side='left')

        # Папка
        self._section('Папка для сохранения:')
        drow = tk.Frame(self.root, bg=BG); drow.pack(fill='x', **pad)
        default_dir = self.settings.get('dir', str(Path.home() / 'Downloads' / 'MusicDownloader'))
        self.dir_var = tk.StringVar(value=default_dir)
        tk.Entry(drow, textvariable=self.dir_var, bg=BG2, fg=GREY, relief='flat',
                 font=('Segoe UI', 9)).pack(side='left', fill='x', expand=True, ipady=4, padx=(0, 6))
        tk.Button(drow, text='Обзор', command=self._browse, bg=BG2, fg=WHITE, relief='flat',
                  font=('Segoe UI', 9), cursor='hand2').pack(side='left')

        # Кнопка скачать
        self.dl_btn = tk.Button(self.root, text='Скачать', command=self.start, bg=YELLOW, fg=BG,
                                relief='flat', font=('Segoe UI', 12, 'bold'), cursor='hand2')
        self.dl_btn.pack(fill='x', ipady=8, pady=(14, 8), **pad)

        # Прогресс
        self.prog = ttk.Progressbar(self.root, mode='determinate', maximum=100)
        self.prog.pack(fill='x', **pad)
        self.status_var = tk.StringVar(value='Готов к работе')
        tk.Label(self.root, textvariable=self.status_var, bg=BG, fg=GREY,
                 font=('Segoe UI', 9), anchor='w').pack(fill='x', pady=(4, 6), **pad)

        # Лог
        logf = tk.Frame(self.root, bg=BG); logf.pack(fill='both', expand=True, pady=(0, 12), **pad)
        self.log = tk.Text(logf, bg='#11111d', fg='#ccc', relief='flat', height=8,
                           font=('Consolas', 8), insertbackground=WHITE)
        sb = ttk.Scrollbar(logf, command=self.log.yview)
        self.log.configure(yscrollcommand=sb.set)
        sb.pack(side='right', fill='y'); self.log.pack(side='left', fill='both', expand=True)

        # ffmpeg статус
        from ffmpeg_helper import find_ffmpeg
        ff = find_ffmpeg()
        if ff:
            self._log(f'ffmpeg найден — FLAC будет нативным .flac')
        else:
            self._log('ffmpeg не найден — FLAC сохранится как .m4a (тоже lossless). '
                      'Для .flac положи ffmpeg.exe рядом с программой.')

    def _section(self, text):
        tk.Label(self.root, text=text, bg=BG, fg=WHITE, font=('Segoe UI', 9, 'bold'),
                 anchor='w').pack(fill='x', padx=16, pady=(12, 4))

    def _log(self, msg):
        self.log.insert('end', msg + '\n'); self.log.see('end'); self.root.update_idletasks()

    def _set_status(self, msg):
        self.status_var.set(msg); self.root.update_idletasks()

    def _open_oauth(self):
        webbrowser.open(OAUTH_URL)

    def _save_token(self):
        raw = self.token_var.get().strip()
        m = re.search(r'[#&?]access_token=([A-Za-z0-9_.\-]+)', raw)
        token = m.group(1) if m else raw
        self.token_var.set(token)
        self.settings['token'] = token
        save_settings(self.settings)
        self._set_status(f'Токен сохранён ({len(token)} символов)' if token else 'Токен очищен')

    def _browse(self):
        d = filedialog.askdirectory(initialdir=self.dir_var.get())
        if d:
            self.dir_var.set(d)

    def start(self):
        if self.dl_btn['text'] == 'Остановить':
            self._cancel = True
            return
        url = self.url_var.get().strip()
        token = self.token_var.get().strip()
        if not url:
            messagebox.showwarning('Внимание', 'Вставь ссылку на трек/альбом/плейлист'); return
        if not token:
            if messagebox.askyesno('Нужен токен',
                                    'Для скачивания нужен токен Я.Музыки. Открыть страницу получения?'):
                self._open_oauth()
            return
        # Сохраняем настройки
        self.settings.update({'quality': self.quality_var.get(), 'dir': self.dir_var.get(),
                              'lyrics': '1' if self.lyrics_var.get() else '0'})
        save_settings(self.settings)

        self._cancel = False
        self.dl_btn.config(text='Остановить')
        self.prog['value'] = 0
        threading.Thread(target=self._work, args=(url, token), daemon=True).start()

    def _work(self, url, token):
        try:
            self._set_status('Получаю данные…')
            yandex_music.download(
                url, self.dir_var.get(), token=token,
                info_cb=self._on_info, progress_cb=self._on_progress,
                cancel_check=lambda: self._cancel,
                quality=self.quality_var.get(),
                want_lyrics=self.lyrics_var.get(),
            )
            self._set_status('Готово!'); self.prog['value'] = 100
            self._log('✓ Скачивание завершено')
        except yandex_music.YMCancelled:
            self._set_status('Отменено'); self._log('Отменено пользователем')
        except Exception as e:
            self._set_status('Ошибка: ' + str(e)[:80])
            self._log('✗ Ошибка: ' + str(e))
        finally:
            self.root.after(0, lambda: self.dl_btn.config(text='Скачать'))

    def _on_info(self, info):
        title = info.get('title', '')
        artist = info.get('uploader', '')
        self._log(f'→ {artist} — {title}' if artist else f'→ {title}')

    def _on_progress(self, p):
        st = p.get('status')
        if st == 'downloading':
            msg = p.get('message')
            if msg:
                self._set_status(msg)
            total = p.get('total_bytes'); dl = p.get('downloaded_bytes', 0)
            if total:
                self.prog['value'] = min(99, int(dl / total * 100))
            bc, bt = p.get('batch_current'), p.get('batch_total')
            if bc and bt:
                self.prog['value'] = int(bc / bt * 100)
        elif st == 'error':
            self._log('  ' + (p.get('message') or 'ошибка'))

    def run(self):
        self.root.mainloop()


if __name__ == '__main__':
    App().run()
