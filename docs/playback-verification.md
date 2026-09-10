# Playback verification, 2026-09-10

## Root causes and repair

- AppleEvent PCtx playback can trigger a second `auto_play_on_load` context transition and `AdvanceStuck/unplayable`, including in Spotify's original signed 1.2.98.301 app. The signed bundled `spotify_cli` playback route progresses in the same patched app.
- The payload modified stdout before classifying unrelated processes. Spotify's shell/lsof connection-owner check lost its output and inherited an arm64 payload into arm64e lsof. Classifying first and clearing insertion in unrelated children fixes authentication. The real child-process fixture failed with exit 134 before the fix and passes afterward.
- Recursive ad-hoc signing destroys the Spotify CLI's trusted identity. Signing is centralized and preserves that executable's original signature while verifying the entire finished bundle.
- Playback confirmation now requires state and position, and frozen playback fails without treating stagnant bytes as EOS. BOS pre-roll, atomic stream selection, generation gates, media validation and isolated runtime/auth state are retained.

## Live captures

Verification completed successfully on 2026-09-10 after rebuilding the payload and restarting the daemon. All four fresh web jobs completed with zero validation warnings; the final three-song sequence completed on attempt 1 for every track.

| Track | Spotify ID | Job | Attempt | Source ffprobe | Output ffprobe |
|---|---|---|---|---|---|
| Murder Murder | `575BKqgHeL2srecj3MfGX1` | `mtvs03rv-1-575BKqgHeL2srecj3MfGX1` | 1 | Vorbis, 224.200 s | MP3, 224.200 s |
| Lose Yourself | `5Z01UMMf7V1o0MzF86s6WJ` | `mtvsbesd-1-5Z01UMMf7V1o0MzF86s6WJ` | 1 | Vorbis, 326.467 s | MP3, 326.467 s |
| Stan | `3UmaczJpikHgJFyBTAJVoz` | `mtvsc76g-2-3UmaczJpikHgJFyBTAJVoz` | 1 | Vorbis, 404.107 s | MP3, 404.107 s |
| Till I Collapse | `4xkOaSrkexMciUUogZKVTS` | `mtvsd2br-3-4xkOaSrkexMciUUogZKVTS` | 1 | Vorbis, 297.787 s | MP3, 297.787 s |

Murder Murder used POST `/api/play`, captured 4,065,345 Ogg bytes, and passed decoded-signal validation with zero warnings. The final Lose Yourself → Stan → Till I Collapse sequence used fresh `/api/play` jobs on the same restarted daemon; all three completed on attempt 1 with native EOS and zero validation warnings. Independent `ffprobe` checks confirmed 44.1 kHz stereo MP3 output at the durations above. Preview audio is never used as a capture output.
