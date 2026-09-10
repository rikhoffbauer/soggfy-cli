import { signSpotifyBundle } from "../src/core/spotify-signing";

const app = process.argv[2];
if (!app) throw new Error("Usage: bun scripts/sign-spotify.ts <Spotify.app>");
signSpotifyBundle(app);
