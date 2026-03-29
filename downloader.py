"""
Yandex Music Downloader — Десктопная программа
Скачивание треков, альбомов и плейлистов по ссылке.
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import requests
import hashlib
import re
import os
import xml.etree.ElementTree as ET


API_BASE = 'https://music.yandex.ru/api/v2.5'
SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'


class YandexMusicDownloader:
    def __init__(self):
        self.token = ''
        self.save_dir = os.path.join(os.path.expanduser('~'), 'Music', 'Yandex Music Downloads')
        self.session = requests.Session()
        self.is_downloading = False
        self.setup_ui()

    def setup_ui(self):
        self.root = tk.Tk()
        self.root.title('Yandex Music Downloader')
        self.root.geometry('600x520')
        self.root.resizable(False, False)
        self.root.configure(bg='#0d0d1a')

        style = ttk.Style()
        style.theme_use('clam')
        style.configure('TFrame', background='#0d0d1a')
        style.configure('TLabel', background='#0d0d1a', foreground='white', font=('Segoe UI', 10))
        style.configure('Header.TLabel', background='#0d0d1a', foreground='#ffdb4d', font=('Segoe UI', 18, 'bold'))
        style.configure('Sub.TLabel', background='#0d0d1a', foreground='#888', font=('Segoe UI', 9))
        style.configure('TButton', font=('Segoe UI', 10))
        style.configure('Download.TButton', font=('Segoe UI', 12, 'bold'))
        style.configure('TEntry', font=('Segoe UI', 10))
        style.configure('Horizontal.TProgressbar', troughcolor='#1a1a2e', background='#ffdb4d')

        main = ttk.Frame(self.root, padding=20)
        main.pack(fill='both', expand=True)

        # Заголовок
        ttk.Label(main, text='Yandex Music Downloader', style='Header.TLabel').pack(pady=(0, 5))
        ttk.Label(main, text='Скачивайте треки, альбомы и плейлисты', style='Sub.TLabel').pack(pady=(0, 15))

        # Токен
        token_frame = ttk.Frame(main)
        token_frame.pack(fill='x', pady=(0, 10))
        ttk.Label(token_frame, text='Токен Яндекс Музыки:').pack(anchor='w')
        self.token_var = tk.StringVar()
        token_entry = ttk.Entry(token_frame, textvariable=self.token_var, show='*', font=('Segoe UI', 10))
        token_entry.pack(fill='x', pady=(4, 0))

        # Подсказка
        hint = ttk.Label(token_frame, text='Получить токен: откройте oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d',
                         style='Sub.TLabel', wraplength=550)
        hint.pack(anchor='w', pady=(4, 0))

        # Ссылка
        link_frame = ttk.Frame(main)
        link_frame.pack(fill='x', pady=(5, 10))
        ttk.Label(link_frame, text='Ссылка на трек / альбом / плейлист:').pack(anchor='w')
        self.link_var = tk.StringVar()
        link_entry = ttk.Entry(link_frame, textvariable=self.link_var, font=('Segoe UI', 10))
        link_entry.pack(fill='x', pady=(4, 0))

        # Папка
        dir_frame = ttk.Frame(main)
        dir_frame.pack(fill='x', pady=(0, 10))
        ttk.Label(dir_frame, text='Папка для сохранения:').pack(anchor='w')

        dir_row = ttk.Frame(dir_frame)
        dir_row.pack(fill='x', pady=(4, 0))
        self.dir_var = tk.StringVar(value=self.save_dir)
        dir_entry = ttk.Entry(dir_row, textvariable=self.dir_var, font=('Segoe UI', 10))
        dir_entry.pack(side='left', fill='x', expand=True, padx=(0, 8))
        ttk.Button(dir_row, text='Обзор', command=self.browse_dir).pack(side='right')

        # Кнопка скачивания
        self.download_btn = ttk.Button(main, text='Скачать', style='Download.TButton',
                                        command=self.start_download)
        self.download_btn.pack(fill='x', pady=(10, 10), ipady=6)

        # Прогресс
        self.progress_var = tk.DoubleVar()
        self.progress = ttk.Progressbar(main, variable=self.progress_var, maximum=100,
                                         style='Horizontal.TProgressbar')
        self.progress.pack(fill='x', pady=(0, 5))

        # Статус
        self.status_var = tk.StringVar(value='Готов к работе')
        ttk.Label(main, textvariable=self.status_var, style='Sub.TLabel').pack(anchor='w')

        # Лог
        log_frame = ttk.Frame(main)
        log_frame.pack(fill='both', expand=True, pady=(10, 0))
        self.log_text = tk.Text(log_frame, height=8, bg='#1a1a2e', fg='#ccc',
                                 font=('Consolas', 9), relief='flat', bd=0,
                                 insertbackground='white')
        scrollbar = ttk.Scrollbar(log_frame, orient='vertical', command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')
        self.log_text.pack(fill='both', expand=True)

    def log(self, message):
        self.log_text.insert('end', message + '\n')
        self.log_text.see('end')

    def browse_dir(self):
        path = filedialog.askdirectory()
        if path:
            self.dir_var.set(path)

    def set_status(self, text):
        self.status_var.set(text)

    def get_headers(self):
        return {
            'Authorization': f'OAuth {self.token}',
            'X-Retpath-Y': 'https://music.yandex.ru/',
        }

    def parse_link(self, link):
        """Разбор ссылки на тип и ID"""
        link = link.strip()

        # Трек: music.yandex.ru/album/123/track/456
        m = re.search(r'/album/(\d+)/track/(\d+)', link)
        if m:
            return {'type': 'track', 'trackId': m.group(2), 'albumId': m.group(1)}

        # Альбом: music.yandex.ru/album/123
        m = re.search(r'/album/(\d+)', link)
        if m:
            return {'type': 'album', 'albumId': m.group(1)}

        # Плейлист: music.yandex.ru/users/xxx/playlists/123
        m = re.search(r'/users/([^/]+)/playlists/(\d+)', link)
        if m:
            return {'type': 'playlist', 'owner': m.group(1), 'kinds': m.group(2)}

        # Просто число — считаем трек-ID
        if link.isdigit():
            return {'type': 'track', 'trackId': link}

        return None

    def get_track_info(self, track_id):
        resp = self.session.get(f'{API_BASE}/tracks/{track_id}',
                                 headers=self.get_headers())
        resp.raise_for_status()
        data = resp.json()
        result = data.get('result', data)
        if isinstance(result, list):
            return result[0]
        return result

    def get_download_url(self, track_id):
        resp = self.session.get(f'{API_BASE}/tracks/{track_id}/download-info',
                                 headers=self.get_headers())
        resp.raise_for_status()
        infos = resp.json().get('result', [])

        # Лучшее качество MP3
        mp3_infos = [i for i in infos if i.get('codec') == 'mp3']
        if mp3_infos:
            best = max(mp3_infos, key=lambda x: x.get('bitrateInKbps', 0))
        elif infos:
            best = max(infos, key=lambda x: x.get('bitrateInKbps', 0))
        else:
            raise Exception('Нет доступных вариантов скачивания')

        # Получаем XML с прямой ссылкой
        src_resp = self.session.get(best['downloadInfoUrl'], headers=self.get_headers())
        src_resp.raise_for_status()

        root = ET.fromstring(src_resp.text)
        host = root.find('host').text
        path = root.find('path').text
        ts = root.find('ts').text
        s = root.find('s').text

        # Генерируем подпись
        sign_string = f'{SIGN_SALT}{path[1:]}{s}'
        sign = hashlib.md5(sign_string.encode()).hexdigest()

        return f'https://{host}/get-mp3/{sign}/{ts}{path}'

    def sanitize_filename(self, name):
        return re.sub(r'[<>:"/\\|?*]', '_', name).strip()

    def download_track(self, track_id, index=None, total=None):
        try:
            info = self.get_track_info(track_id)
            artists = ', '.join(a['name'] for a in info.get('artists', [])) or 'Unknown'
            title = info.get('title', 'Unknown')

            prefix = f'[{index}/{total}] ' if index else ''
            self.log(f'{prefix}Скачиваю: {artists} - {title}')
            self.set_status(f'{prefix}Скачиваю: {artists} - {title}')

            url = self.get_download_url(track_id)

            save_dir = self.dir_var.get()
            os.makedirs(save_dir, exist_ok=True)

            filename = f'{self.sanitize_filename(artists)} - {self.sanitize_filename(title)}.mp3'
            filepath = os.path.join(save_dir, filename)

            resp = self.session.get(url, stream=True)
            resp.raise_for_status()

            total_size = int(resp.headers.get('content-length', 0))
            downloaded = 0

            with open(filepath, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size:
                        pct = (downloaded / total_size) * 100
                        self.progress_var.set(pct)

            self.log(f'{prefix}Готово: {filename}')
            return True

        except Exception as e:
            self.log(f'Ошибка скачивания трека {track_id}: {e}')
            return False

    def download_album(self, album_id):
        resp = self.session.get(f'{API_BASE}/albums/{album_id}/with-tracks',
                                 headers=self.get_headers())
        resp.raise_for_status()
        album = resp.json().get('result', {})

        album_title = album.get('title', 'Unknown Album')
        self.log(f'Альбом: {album_title}')

        track_ids = []
        for volume in album.get('volumes', []):
            for track in volume:
                track_ids.append(str(track['id']))

        self.log(f'Треков: {len(track_ids)}')
        downloaded = 0
        for i, tid in enumerate(track_ids, 1):
            if not self.is_downloading:
                break
            if self.download_track(tid, i, len(track_ids)):
                downloaded += 1
            self.progress_var.set((i / len(track_ids)) * 100)

        self.log(f'Скачано {downloaded}/{len(track_ids)} треков')

    def download_playlist(self, owner, kinds):
        resp = self.session.get(f'{API_BASE}/users/{owner}/playlists/{kinds}',
                                 headers=self.get_headers())
        resp.raise_for_status()
        playlist = resp.json().get('result', {})

        pl_title = playlist.get('title', 'Unknown Playlist')
        self.log(f'Плейлист: {pl_title}')

        tracks = playlist.get('tracks', [])
        track_ids = []
        for t in tracks:
            tid = t.get('track', {}).get('id') or t.get('id')
            if tid:
                track_ids.append(str(tid))

        self.log(f'Треков: {len(track_ids)}')
        downloaded = 0
        for i, tid in enumerate(track_ids, 1):
            if not self.is_downloading:
                break
            if self.download_track(tid, i, len(track_ids)):
                downloaded += 1
            self.progress_var.set((i / len(track_ids)) * 100)

        self.log(f'Скачано {downloaded}/{len(track_ids)} треков')

    def start_download(self):
        if self.is_downloading:
            self.is_downloading = False
            self.download_btn.configure(text='Скачать')
            return

        self.token = self.token_var.get().strip()
        link = self.link_var.get().strip()

        if not self.token:
            messagebox.showwarning('Внимание', 'Введите токен Яндекс Музыки!')
            return

        if not link:
            messagebox.showwarning('Внимание', 'Введите ссылку!')
            return

        parsed = self.parse_link(link)
        if not parsed:
            messagebox.showerror('Ошибка', 'Не удалось распознать ссылку.\n\n'
                                  'Поддерживаемые форматы:\n'
                                  '• music.yandex.ru/album/123/track/456\n'
                                  '• music.yandex.ru/album/123\n'
                                  '• music.yandex.ru/users/xxx/playlists/123')
            return

        self.is_downloading = True
        self.download_btn.configure(text='Остановить')
        self.progress_var.set(0)
        self.log_text.delete('1.0', 'end')

        def work():
            try:
                if parsed['type'] == 'track':
                    self.download_track(parsed['trackId'])
                elif parsed['type'] == 'album':
                    self.download_album(parsed['albumId'])
                elif parsed['type'] == 'playlist':
                    self.download_playlist(parsed['owner'], parsed['kinds'])

                self.set_status('Готово!')
                self.progress_var.set(100)
            except Exception as e:
                self.log(f'Ошибка: {e}')
                self.set_status(f'Ошибка: {e}')
            finally:
                self.is_downloading = False
                self.root.after(0, lambda: self.download_btn.configure(text='Скачать'))

        thread = threading.Thread(target=work, daemon=True)
        thread.start()

    def run(self):
        self.root.mainloop()


if __name__ == '__main__':
    app = YandexMusicDownloader()
    app.run()
