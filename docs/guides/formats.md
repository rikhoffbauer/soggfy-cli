# Output formats and validation

Production capture receives Spotify's Ogg/Vorbis stream. `soggfy download` can preserve or convert that capture for different consumers.

| Format | Use |
| --- | --- |
| `mp3` | Default portable output; metadata and cover art are added when available. |
| `ogg` | Closest to the native captured stream; avoids an unnecessary lossy transcode. |
| `flac` | Lossless container for downstream compatibility, but cannot restore information lost in Spotify's source stream. |
| `wav` | Uncompressed PCM for editors, analyzers, and pipelines. |
| `raw` | Raw PCM-style output only where the source/transcode path supports it; not raw Ogg bytes. |

## Format selection

```sh
soggfy download -f ogg -o song.ogg <track>
soggfy download -o song.flac <track>   # inferred from extension
soggfy download -f wav <track> | ffplay -
```

If `--output` names a directory, `--format` controls the extension of generated files.

## Validation

A successful capture is probed and decoded before Soggfy reports success. Checks include container/duration sanity, decodability, RMS/peak signal measurements, and excessive-silence detection. This prevents a truncated or silent file from being accepted merely because bytes were written.
