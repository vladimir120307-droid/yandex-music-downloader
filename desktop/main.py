"""Music Downloader desktop — entry point."""
from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

# Allow running as script from any cwd
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PySide6.QtCore import QCoreApplication, QTimer
from PySide6.QtWidgets import QApplication

from window import MainWindow


def smoke_test(report_path: str) -> None:
    """Проверка собранного exe перед публикацией релиза (см. release.yml):
    окно открылось, а всё нужное для скачивания попало внутрь сборки."""
    try:
        import mutagen  # noqa: F401
        import yt_dlp
        from Crypto.Cipher import AES
        AES.new(bytes(16), AES.MODE_CTR, nonce=bytes(12))
        yt_dlp.YoutubeDL({'quiet': True})
        result = f'ok yt-dlp={yt_dlp.version.__version__}'
    except Exception:
        result = traceback.format_exc()
    Path(report_path).write_text(result, encoding='utf-8')
    QApplication.quit()


def main() -> int:
    QCoreApplication.setOrganizationName('MusicDownloader')
    QCoreApplication.setApplicationName('Music Downloader')
    app = QApplication(sys.argv)
    app.setStyle('Fusion')
    win = MainWindow()
    win.show()
    report_path = os.environ.get('MD_SMOKE_REPORT')
    if report_path:
        QTimer.singleShot(1500, lambda: smoke_test(report_path))
    return app.exec()


if __name__ == '__main__':
    raise SystemExit(main())
