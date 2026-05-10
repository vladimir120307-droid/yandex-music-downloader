"""Music Downloader desktop — entry point."""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running as script from any cwd
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PySide6.QtCore import QCoreApplication
from PySide6.QtWidgets import QApplication

from window import MainWindow


def main() -> int:
    QCoreApplication.setOrganizationName('MusicDownloader')
    QCoreApplication.setApplicationName('Music Downloader')
    app = QApplication(sys.argv)
    app.setStyle('Fusion')
    win = MainWindow()
    win.show()
    return app.exec()


if __name__ == '__main__':
    raise SystemExit(main())
