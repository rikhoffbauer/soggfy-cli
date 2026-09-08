# Shell scripting

Soggfy keeps machine data on stdout and operational messages on stderr where commands produce pipeable output.

## Stream media through a pipeline

```sh
soggfy download --format wav spotify:track:4PTG3Z6ehGkBFwjybzWkR8 | ffmpeg -i pipe:0 output.opus
```

The deprecated `stream` alias also keeps its warning on stderr, but new scripts should use `download`.

## Search as JSON

```sh
soggfy search --json --type track "portishead roads" \
  | jq -r '.[].uri'
```

Download the first result:

```sh
uri=$(soggfy search --json --type track --limit 1 "portishead roads" | jq -r '.[0].uri')
soggfy download -o track.mp3 "$uri"
```

Always check the command exit status. Soggfy may create temporary or partial files while a job is running, but successful validation/finalization is represented by exit code 0.

## Separate logs from binary output

```sh
soggfy download spotify:track:4PTG3Z6ehGkBFwjybzWkR8 \
  > song.mp3 \
  2> capture.log
```

Never merge stderr into stdout when stdout carries media (`2>&1` would corrupt the stream).

## Batch from a text file

```sh
while IFS= read -r uri; do
  [ -z "$uri" ] && continue
  soggfy download -o ./downloads/ "$uri" || exit 1
done < tracks.txt
```

For larger queues or parallel capture workers, use the web service job queue instead of starting multiple CLI processes against one daemon.

## Diagnostics in source checkouts

```sh
bun run doctor
bun test
bun run typecheck
```

`doctor` checks tools, supported Spotify versions, patched payload state, writable output paths, and the configured capture backend.
