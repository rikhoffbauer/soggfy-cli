import type { TrackMetadata } from "./jobs";

export async function fetchTrackDuration(
  trackId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<number | null> {
  try {
    const res = await fetchImpl(`https://open.spotify.com/embed/track/${trackId}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/"duration"\s*:\s*(\d+)/);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  } catch (error) {
    console.warn(`[Server] Failed to fetch duration for ${trackId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function fetchTrackMetadata(
  trackId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<TrackMetadata | null> {
  try {
    const res = await fetchImpl(`https://open.spotify.com/embed/track/${trackId}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const html = await res.text();
    const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">({.*?})<\/script>/)?.[1];
    if (!nextData) return null;
    const entity = JSON.parse(nextData).props?.pageProps?.state?.data?.entity;
    if (!entity) return null;
    return {
      title: entity?.title || entity?.name,
      artist: entity?.artists?.[0]?.name,
      coverUrl: entity?.visualIdentity?.image?.[0]?.url,
    };
  } catch (error) {
    console.warn(`[Server] Failed to fetch metadata for ${trackId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
