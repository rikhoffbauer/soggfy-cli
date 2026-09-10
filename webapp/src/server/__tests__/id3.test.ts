import { expect, test } from "bun:test";
import { writeTrackTags } from "../id3";

test("ID3 cover handling requires success and preserves MIME type", async () => {
  const logs: string[] = [];
  let written: any;
  await writeTrackTags(
    "song.mp3",
    { title: "Song", coverUrl: "https://example.test/cover" },
    (message) => logs.push(message),
    (async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png; charset=binary" } })) as unknown as typeof fetch,
    ((tags: any) => { written = tags; return true; }) as any,
  );
  expect(written.image.mime).toBe("image/png");

  written = undefined;
  await writeTrackTags(
    "song.mp3",
    { title: "Song", coverUrl: "https://example.test/missing" },
    (message) => logs.push(message),
    (async () => new Response("missing", { status: 404 })) as unknown as typeof fetch,
    ((tags: any) => { written = tags; return new Error("tag write failed"); }) as any,
  );
  expect(written.image).toBeUndefined();
  expect(logs.some((line) => line.includes("cover fetch returned 404"))).toBe(true);
  expect(logs.some((line) => line.includes("tag write failed"))).toBe(true);
});
