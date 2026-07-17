# Background music library

The sound engine (`client/js/sound.js`) reads `tracks.json`, picks one entry at
random, and moves to another random one when it ends. Nothing else needs editing
to change the music.

Pages choose their ambience with `<body data-ambience="...">`:

| value | result |
|---|---|
| *(not declared)* | this library — the default on every page |
| `""` | silence (e.g. `doctor.html`) |
| `/assets/audio/tracks.json` | that library explicitly |
| `/path/track.mp3` | one track, looped |
| `generative` | the synthesized oscillator pad |

Volume and mute come from the floating sound widget, which controls the music,
the UI click sounds and the pad alike — there is deliberately no second control.

    client/assets/audio/
      tracks.json          <- the library
      sample-*.mp3         <- three synthesized placeholders (replace these)

## The manifest

```json
[
  { "file": "sample-calm.mp3", "title": "Calm (sample)", "credit": "synthesized placeholder" }
]
```

`file` is required and resolves against this directory. `title` and `credit` are
optional metadata — keep `credit` accurate, it is the cheapest place
to record where a track came from.

An empty list (or a missing `tracks.json`) simply means silence — no fallback pad
— so an install with no music is not a broken install. A single track that 404s is
dropped from the library at runtime and the rest keep playing.

## The samples are placeholders

`sample-calm/warm/bright.mp3` are three chords synthesized from sine waves with
ffmpeg — deliberately generated rather than sourced, so they carry no third-party
rights and are safe to commit and ship. They exist to prove the player works, not
because they are good: they are plain sustained pads and will get old fast.

**Replace them with real music before launch.** Whatever ships here plays to every
visitor of a public medical site, so it must be music the product holds a licence
for — owned, commissioned, or from a library whose licence covers commercial web
use. Keep the licence receipt with the project. Sources that are free and clean:
the YouTube Audio Library and Pixabay Music. Music from a YouTube video is *not*
licensed for this by virtue of being public.

## Encoding

    ffmpeg -i source.wav -ac 2 -ar 44100 -b:a 96k -filter:a "loudnorm" track.mp3

Keep each track under ~1.5 MB (they download on demand), quiet, and fading in and
out so entering and leaving a track is not abrupt. Playback starts at volume 0.35;
the choice persists in `localStorage.aam_volume` / `aam_muted`. Tracks are loaded
with `preload='none'` and streamed via range requests, so a muted visitor
transfers nothing and playback starts after a few KB rather than the whole file.
