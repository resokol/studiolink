# StudioLink 0.9.1 — responsive layout

Baseline 0.9 is backed up on GitHub in backup/v0.9, locally in backups/, and on the VPS in /opt/studiolink/backups/studiolink-v0.9.tar.gz. Docker image studiolink_web:v0.9 is retained.

- Guest and studio media pages use the full available width.
- Removed forced 2×2 LiveKit CSS: ordinary conferences use its responsive layout, studio-only mode fills the complete video area with one tile.
- Studio and guest previews precede settings. Guest monitoring controls remain below the videos in the settings table.
- The studio-only button is labelled «Гости могут видеть только студию» and precedes the Studio Return check button. Audio restriction behaviour is unchanged.
- Existing colours, typography, buttons and themes are preserved.

Validation: production build, TypeScript, guest-entry, room-mode-monitoring, studio-video-recovery, video-quality. Isolated LiveKit 1.13.7 + Chromium with fake camera/microphone: actual Studio Return and guest video, studio-only toggle, video above settings, no document overflow at widths 320, 390, 768, 1440 and 2560. Studio tile occupies full grid width and height. Screenshots inspected at mobile width.

Docker builds use Dockerfile.web with STUDIOLINK_RELEASE and NEXT_BUILD_DIR=.next. The build context excludes credentials and runtime data; VPS supplies these at runtime.
