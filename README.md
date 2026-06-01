# 2026 VGM Recordings

Static GitHub Pages browser for the 2026 VGM recording files.

- `index.html` is the app shell.
- `app.js` loads `data/recordings.csv`.
- Drive video and audio files use local thumbnails, Google Drive preview embeds, and direct Drive download links.
- The list supports inline audio playback controls and filtered multi-select downloads.
- `data/recordings.csv` is the public CSV export used by the site.
- `thumbs/` contains ffmpeg-extracted thumbnails for each source video.
