# `soggfy auth`

Manage the private Spotify desktop login state used by Soggfy capture instances. Soggfy stores its copy under `~/.soggfy/auth/spotify`; logout/import never modify Spotify's normal Application Support profile.

## Usage

```sh
soggfy auth <login|logout|status|export|import>
```

## Commands

- `login` launches the official Spotify app for interactive authentication, then atomically snapshots the session-critical state into Soggfy-owned storage.
- `status` reports the account found in Soggfy-owned login state.
- `logout` removes only Soggfy-owned credentials.
- `export [file]` writes a portable version-2 JSON snapshot with mode `0600`, including nested session-cache files.
- `import <file>` atomically restores a version-2 snapshot; legacy version-1 snapshots remain accepted. Every restored path is constrained to the private auth root.

## Examples

```sh
soggfy auth login
soggfy auth status
soggfy auth export ~/Documents/soggfy-auth.json
soggfy auth import ~/Documents/soggfy-auth.json
```

Authentication snapshots contain sensitive Spotify session material. Treat exported files like passwords and do not commit or share them.

## Search versus capture credentials

Desktop login is used for playback/capture. `soggfy search` currently uses Spotify web-player credentials described in the search documentation; the two mechanisms are intentionally isolated.
