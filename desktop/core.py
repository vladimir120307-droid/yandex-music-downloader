"""yt-dlp worker — runs in QThread, emits Qt signals."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QObject, Signal, Slot

import yt_dlp


class CancelledError(Exception):
    pass


def build_ydl_opts(options: dict, progress_hook) -> dict:
    output_dir = options.get('output_dir') or str(Path.home() / 'Downloads')
    ffmpeg_path = options.get('ffmpeg_path')
    audio_only = bool(options.get('audio_only', True))
    audio_format = options.get('audio_format', 'mp3')
    audio_quality = str(options.get('audio_quality', '320'))
    video_format = options.get('video_format', 'best')
    cookies_browser = options.get('cookies_browser')

    template = options.get('template', '%(uploader,channel,artist|Unknown)s - %(title).100s.%(ext)s')
    outtmpl = str(Path(output_dir) / template)

    opts: dict = {
        'outtmpl': outtmpl,
        'progress_hooks': [progress_hook],
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'ignoreerrors': False,
        'retries': 3,
        'fragment_retries': 3,
        'concurrent_fragment_downloads': 4,
    }
    if ffmpeg_path:
        opts['ffmpeg_location'] = ffmpeg_path
    if cookies_browser:
        opts['cookiesfrombrowser'] = (cookies_browser,)

    if audio_only:
        opts['format'] = 'bestaudio/best'
        opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': audio_format,
            'preferredquality': audio_quality,
        }, {
            'key': 'FFmpegMetadata',
        }, {
            'key': 'EmbedThumbnail',
        }]
        opts['writethumbnail'] = True
    else:
        if video_format == 'best':
            opts['format'] = 'bestvideo*+bestaudio/best'
        else:
            opts['format'] = f'bestvideo[height<={video_format}]+bestaudio/best[height<={video_format}]'
        opts['merge_output_format'] = 'mp4'
        opts['postprocessors'] = [{
            'key': 'FFmpegMetadata',
        }]

    return opts


class DownloadWorker(QObject):
    info_ready = Signal(int, dict)   # job_id, info dict
    progress = Signal(int, dict)     # job_id, progress info
    done = Signal(int, str)          # job_id, file path (best-effort)
    error = Signal(int, str)         # job_id, error message

    def __init__(self, job_id: int, url: str, options: dict, parent=None):
        super().__init__(parent)
        self.job_id = job_id
        self.url = url
        self.options = options
        self._cancel = False

    def cancel(self):
        self._cancel = True

    def _hook(self, d: dict):
        if self._cancel:
            raise CancelledError('Cancelled by user')
        self.progress.emit(self.job_id, d)

    @Slot()
    def run(self):
        ydl_opts = build_ydl_opts(self.options, self._hook)
        final_path = ''
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(self.url, download=False)
                if self._cancel:
                    self.error.emit(self.job_id, 'Отменено')
                    return
                self.info_ready.emit(self.job_id, info or {})
                ydl.download([self.url])
                if info:
                    try:
                        final_path = ydl.prepare_filename(info)
                        if self.options.get('audio_only'):
                            ext = self.options.get('audio_format', 'mp3')
                            final_path = str(Path(final_path).with_suffix('.' + ext))
                    except Exception:
                        final_path = ''
            self.done.emit(self.job_id, final_path)
        except CancelledError:
            self.error.emit(self.job_id, 'Отменено')
        except yt_dlp.utils.DownloadError as e:
            self.error.emit(self.job_id, str(e))
        except Exception as e:
            self.error.emit(self.job_id, f'{type(e).__name__}: {e}')
