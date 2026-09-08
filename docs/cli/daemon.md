# `soggfy daemon`

Manage a reusable background Spotify capture instance so repeated downloads avoid launch/setup overhead.

## Usage

```sh
soggfy daemon <start|stop|status|restart|logs>
```

## Actions

- `start` launches the bundled daemon process and waits for IPC readiness.
- `stop` terminates the exact daemon process tree recorded by Soggfy.
- `status` checks the PID and IPC endpoint.
- `restart` performs an exact stop followed by start.
- `logs` prints the daemon log.

```sh
soggfy daemon start
soggfy download -o song.mp3 spotify:track:4PTG3Z6ehGkBFwjybzWkR8
soggfy daemon status
soggfy daemon logs
```

`download` automatically uses the daemon when it is healthy. If it is unavailable, the command falls back to a temporary isolated instance unless other startup requirements fail.

The daemon never routes binary capture output into its own log. Media stays on the invoking command's stdout or requested output path.
