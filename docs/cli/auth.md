# `soggfy auth`

Manage the Spotify desktop login state used by Soggfy capture instances.

## Usage

```sh
soggfy auth <login|logout|status|export|import>
```

## Commands

- `login` launches the official Spotify app for interactive authentication, then verifies the resulting local prefs.
- `status` reports whether a username can be resolved from Spotify's local login state.
- `logout` removes the local Spotify prefs/users credential state used by Soggfy.
- `export [file]` writes a portable JSON snapshot with mode `0600`.
- `import <file>` restores a previously exported snapshot and rejects paths escaping Spotify's Users directory.

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
