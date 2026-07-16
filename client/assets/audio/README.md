# Background music

The home screen looks for a single looping track:

    client/assets/audio/bg-loop.mp3

It is intentionally **not committed**: whatever ships here plays to every visitor
of a public medical site, so it must be a track the product actually holds a
licence for. Use music you own, commissioned, or took from a library whose licence
covers web/commercial use (and keep the licence receipt with the project).

If the file is absent the player notices the load error, hides its toggle, and the
page behaves exactly as before — so an install without a track is not broken.

## Encoding for the web

    ffmpeg -i source.wav -ac 2 -ar 44100 -b:a 96k -filter:a "loudnorm" bg-loop.mp3

Guidelines: aim under ~1.5 MB (it downloads on every cold load), keep it quiet and
seamless at the loop point, and remember playback is at volume 0.35 by design.

The toggle state persists in `localStorage.aam_music`; visitors with
`prefers-reduced-motion` never get audio at all.
