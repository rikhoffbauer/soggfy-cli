# `soggfy auth`

Manage the private Spotify desktop login state used by Soggfy capture instances. Soggfy stores its copy under `~/.soggfy/auth/spotify`; logout/import never modify Spotify's normal Application Support profile. On the first launch after upgrading from the old shared-profile behavior, Soggfy can import an existing logged-in official Spotify session once. A completed migration marker prevents a later `auth logout` from silently re-importing it.

Setting `SOGGFY_HOME` disables automatic import of the official profile. Authenticate that home explicitly with `auth login` or `auth import`. Auth state mutations use a macOS kernel file lock that is released on process exit; the `.state.lock` file remains in place and is not a stale-lock indicator.

## Usage

```sh
soggfy auth <login|logout|status|export|import>
```

## Commands

- `login` launches the official Spotify app for interactive authentication, then atomically snapshots the session-critical state into Soggfy-owned storage.
- `status` reports the account found in Soggfy-owned login state.
- `logout` removes only Soggfy-owned credentials and records that automatic official-profile migration must not run again.
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
