# `soggfy fingerprint`

Generate a Chromaprint fingerprint for a local audio file using `fpcalc`.

## Usage

```sh
soggfy fingerprint <audio-file>
```

Soggfy runs the deterministic fingerprint command used by its test suite:

```sh
fpcalc -length 240 -raw -plain <audio-file>
```

The fingerprint is written to stdout so it can be redirected or consumed by another process.

```sh
soggfy fingerprint song.mp3 > song.fp
```

`chromaprint`/`fpcalc` is installed or verified by `soggfy install` and checked by `bun run doctor` in a source checkout.
