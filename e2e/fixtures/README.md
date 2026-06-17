# e2e media fixtures

Small, committed test assets the UI flow sends as photo / video / file. The
interactive runner (`scripts/e2e-interactive.mjs`) pushes these onto the
device before Maestro runs (iOS Photos via `simctl addmedia`; Android via
`adb push` + a media-scanner broadcast).

| File | What | Regenerate |
|---|---|---|
| `image.jpg` | 320×240 solid JPEG | `ffmpeg -f lavfi -i color=c=blue:s=320x240 -frames:v 1 image.jpg` |
| `video.mp4` | 2s H.264/yuv420p clip (plays on iOS + Android) | `ffmpeg -f lavfi -i color=c=green:s=320x240:d=2 -pix_fmt yuv420p -c:v libx264 -movflags +faststart video.mp4` |
| `document.pdf` | minimal valid 1-page PDF | see git history / `scripts/e2e-interactive.mjs` notes |

Keep them tiny — they're uploaded to the real `/files/` endpoint on every run.
