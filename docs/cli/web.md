---
title: soggfy web
---
# `soggfy web`

Ensure the Soggfy daemon is running and serve its local web application/API.

```sh
soggfy web
```

This is a convenience entry point for the daemon-backed web service. The daemon owns the patched Spotify process; the web layer uses that live `SpotifyInstance` through Soggfy's private in-process runtime API. It does not launch a second Spotify worker.

The default URL is `http://127.0.0.1:8085`. `soggfy webapp` is retained as an alias.

## Options

```text
--host <host>   Bind hostname or IP address when starting the daemon
--port <port>   HTTP port when starting the daemon (default: 8085)
```

Examples:

```sh
soggfy web
soggfy web --port 9090
soggfy web --host 0.0.0.0 --port 8085
```

`SOGGFY_HOST` and `SOGGFY_PORT` remain supported. If the daemon is already running, change bind settings with a daemon restart so the new process receives them.

Use `soggfy daemon stop`, `restart`, `status`, and `logs` to manage the combined daemon/web service.
