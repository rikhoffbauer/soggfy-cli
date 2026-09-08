# `soggfy daemon`

Manage the reusable background Soggfy service. The daemon owns one patched Spotify capture instance and serves the local web UI/API in the same process.

## Usage

```sh
soggfy daemon <start|stop|status|restart|logs>
```

## Actions

- `start` launches the daemon, starts its Spotify capture instance, then starts the web UI/API.
- `stop` terminates the exact daemon process tree recorded by Soggfy; the web server stops with it.
- `status` checks the daemon PID and Spotify IPC endpoint.
- `restart` performs an exact stop followed by start.
- `logs` prints the daemon log, including web-server startup/errors.

```sh
soggfy daemon start
open http://127.0.0.1:8085
soggfy download -o song.mp3 spotify:track:4PTG3Z6ehGkBFwjybzWkR8
soggfy daemon status
soggfy daemon logs
```

`download` and the web UI use the same daemon-owned `SpotifyInstance`. The web server receives that live instance through Soggfy's private in-process runtime API and calls it directly; it does not launch or own a second patched Spotify process. The instance itself still communicates with the injected Spotify payload over Soggfy's local IPC socket.

The web UI/API binds to `127.0.0.1:8085` by default. Set `SOGGFY_HOST` and `SOGGFY_PORT` before starting the daemon to change this. `soggfy web` is a convenience alias that ensures the daemon is running and accepts `--host`/`--port` when starting it.

If the daemon is unavailable, `download` can still fall back to a temporary isolated instance unless other startup requirements fail. Binary capture output is never routed into the daemon log.
