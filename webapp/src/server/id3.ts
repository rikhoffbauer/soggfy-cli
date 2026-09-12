import NodeID3 from "node-id3";
import type { TrackMetadata } from "./jobs";

export type TagLogger = (message: string) => void;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

async function readBoundedBody(response: Response, maxBytes = MAX_COVER_BYTES): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`cover image exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("cover image too large").catch(() => undefined);
      throw new Error(`cover image exceeds ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function writeTrackTags(
  mp3Path: string,
  meta: TrackMetadata,
  log: TagLogger,
  fetchImpl: typeof fetch = fetch,
  writeImpl: typeof NodeID3.write = NodeID3.write.bind(NodeID3),
): Promise<void> {
  let coverBuffer: Buffer | null = null;
  let coverMime = "image/jpeg";

  if (meta.coverUrl) {
    try {
      const response = await fetchImpl(meta.coverUrl, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        coverMime = response.headers.get("content-type")?.split(";", 1)[0] || coverMime;
        coverBuffer = await readBoundedBody(response);
      } else {
        log(`Warning: cover fetch returned ${response.status}`);
      }
    } catch (error) {
      log(`Warning: cover fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const tags: any = { title: meta.title, artist: meta.artist };
  if (coverBuffer) {
    tags.image = {
      mime: coverMime,
      type: { id: 3, name: "front cover" },
      description: "Cover",
      imageBuffer: coverBuffer,
    };
  }

  try {
    const result = writeImpl(tags, mp3Path) as true | Error;
    if (result !== true) {
      log(`Warning: failed to write ID3 tags: ${result instanceof Error ? result.message : String(result)}`);
    }
  } catch (error) {
    log(`Warning: failed to write ID3 tags: ${error instanceof Error ? error.message : String(error)}`);
  }
}
