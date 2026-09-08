import { fetchTrackMetadata, resolveInput, resolvePlayableTrackId } from "../src/core/metadata";
import { invalidateSpotifySearchTokens } from "../src/core/spotify-search";

const originalFetch = globalThis.fetch;
const originalCookie = process.env.SPOTIFY_COOKIE;
const originalAccessToken = process.env.SPOTIFY_ACCESS_TOKEN;
const originalClientToken = process.env.SPOTIFY_CLIENT_TOKEN;

function embedHtml(entity: Record<string, unknown>) {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { state: { data: { entity } } } },
  })}</script></html>`;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCookie === undefined) delete process.env.SPOTIFY_COOKIE;
  else process.env.SPOTIFY_COOKIE = originalCookie;
  if (originalAccessToken === undefined) delete process.env.SPOTIFY_ACCESS_TOKEN;
  else process.env.SPOTIFY_ACCESS_TOKEN = originalAccessToken;
  if (originalClientToken === undefined) delete process.env.SPOTIFY_CLIENT_TOKEN;
  else process.env.SPOTIFY_CLIENT_TOKEN = originalClientToken;
  invalidateSpotifySearchTokens();
});

test("track metadata preserves Spotify playability", async () => {
  globalThis.fetch = (async () => new Response(embedHtml({
    id: "7wCEROvvpVgPLDeFFp0Fsm",
    title: "Empty Out Your Pockets",
    artists: [{ name: "Juice WRLD" }],
    duration: 140591,
    isPlayable: false,
    playabilityReason: "PLAYABLE",
  }))) as typeof fetch;

  const metadata = await fetchTrackMetadata("7wCEROvvpVgPLDeFFp0Fsm");
  expect(metadata.isPlayable).toBe(false);
  expect(metadata.playabilityReason).toBe("PLAYABLE");
});


test("direct track input relinks an unavailable Spotify ID to a playable exact match", async () => {
  const unavailable = "7wCEROvvpVgPLDeFFp0Fsm";
  const playable = "2QxekHjOYDnzNO5w8hu2D9";
  process.env.SPOTIFY_ACCESS_TOKEN = "test-access";
  process.env.SPOTIFY_CLIENT_TOKEN = "test-client";
  invalidateSpotifySearchTokens();

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === `https://open.spotify.com/embed/track/${unavailable}`) {
      return new Response(embedHtml({
        id: unavailable,
        title: "Empty Out Your Pockets",
        artists: [{ name: "Juice WRLD" }],
        duration: 140591,
        isPlayable: false,
      }));
    }
    if (url === `https://open.spotify.com/embed/track/${playable}`) {
      return new Response(embedHtml({
        id: playable,
        title: "Empty Out Your Pockets",
        artists: [{ name: "Juice WRLD" }],
        duration: 135653,
        isPlayable: true,
      }));
    }
    if (url === "https://api-partner.spotify.com/pathfinder/v2/query") {
      return Response.json({
        data: {
          searchV2: {
            tracksV2: {
              items: [
                {
                  item: {
                    data: {
                      id: playable,
                      uri: `spotify:track:${playable}`,
                      name: "Empty Out Your Pockets",
                      artists: { items: [{ profile: { name: "Juice WRLD" } }] },
                      albumOfTrack: { coverArt: { sources: [] } },
                    },
                  },
                },
              ],
            },
          },
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  expect(await resolveInput(unavailable)).toEqual([playable]);
});

test("unavailable-track lookup retries one transient Spotify search failure", async () => {
  const unavailable = "7wCEROvvpVgPLDeFFp0Fsm";
  const playable = "2QxekHjOYDnzNO5w8hu2D9";
  process.env.SPOTIFY_ACCESS_TOKEN = "test-access";
  process.env.SPOTIFY_CLIENT_TOKEN = "test-client";
  invalidateSpotifySearchTokens();
  let searchAttempts = 0;

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === `https://open.spotify.com/embed/track/${unavailable}`) {
      return new Response(embedHtml({
        id: unavailable,
        title: "Empty Out Your Pockets",
        artists: [{ name: "Juice WRLD" }],
        duration: 140591,
        isPlayable: false,
      }));
    }
    if (url === `https://open.spotify.com/embed/track/${playable}`) {
      return new Response(embedHtml({
        id: playable,
        title: "Empty Out Your Pockets",
        artists: [{ name: "Juice WRLD" }],
        duration: 135653,
        isPlayable: true,
      }));
    }
    if (url === "https://api-partner.spotify.com/pathfinder/v2/query") {
      searchAttempts++;
      if (searchAttempts === 1) throw new Error("socket closed");
      return Response.json({
        data: {
          searchV2: {
            tracksV2: {
              items: [{
                item: {
                  data: {
                    id: playable,
                    uri: `spotify:track:${playable}`,
                    name: "Empty Out Your Pockets",
                    artists: { items: [{ profile: { name: "Juice WRLD" } }] },
                    albumOfTrack: { coverArt: { sources: [] } },
                  },
                },
              }],
            },
          },
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  expect(await resolveInput(unavailable)).toEqual([playable]);
  expect(searchAttempts).toBe(2);
});


test("unavailable track can relink to a title-variant when Spotify previews prove the audio matches", async () => {
  const unavailable = "6Jq5fvEVfWQtYXZ0V29Hlc";
  const playable = "3kpYJjvM8Ja6btr5hEJLWc";
  const unavailablePreview = "https://p.scdn.co/mp3-preview/unavailable-venom";
  const playablePreview = "https://p.scdn.co/mp3-preview/playable-venom";
  process.env.SPOTIFY_ACCESS_TOKEN = "test-access";
  process.env.SPOTIFY_CLIENT_TOKEN = "test-client";
  invalidateSpotifySearchTokens();

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === `https://open.spotify.com/embed/track/${unavailable}`) {
      return new Response(embedHtml({
        id: unavailable,
        title: "Venom",
        artists: [{ name: "Eminem" }],
        duration: 295753,
        isPlayable: false,
        audioPreview: { url: unavailablePreview },
      }));
    }
    if (url === `https://open.spotify.com/embed/track/${playable}`) {
      return new Response(embedHtml({
        id: playable,
        title: "Venom - Music From The Motion Picture",
        artists: [{ name: "Eminem" }],
        duration: 269573,
        isPlayable: true,
        audioPreview: { url: playablePreview },
      }));
    }
    if (url === "https://api-partner.spotify.com/pathfinder/v2/query") {
      return Response.json({
        data: { searchV2: { tracksV2: { items: [{ item: { data: {
          id: playable,
          uri: `spotify:track:${playable}`,
          name: "Venom - Music From The Motion Picture",
          artists: { items: [{ profile: { name: "Eminem" } }] },
          albumOfTrack: { coverArt: { sources: [] } },
        } } }] } } },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const resolution = await resolvePlayableTrackId(unavailable, {
    previewSimilarity: async (left, right) =>
      left === unavailablePreview && right === playablePreview ? 0.984 : 0,
  });
  expect(resolution.trackId).toBe(playable);
  expect(resolution.relinked).toBe(true);
});
