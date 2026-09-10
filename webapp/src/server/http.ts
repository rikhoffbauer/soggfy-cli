import { existsSync, statSync, createReadStream } from "fs";

export const CORS_HEADERS: Record<string, string> = {};

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

export function notFound(message = "Not Found") {
  return new Response(message, { status: 404, headers: CORS_HEADERS });
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

export function serveFileWithRange(req: Request, path: string, downloadName?: string): Response {
  if (!existsSync(path)) return notFound("File not found");

  const size = statSync(path).size;
  const range = req.headers.get("range");
  const baseHeaders: Record<string, string> = {
    ...CORS_HEADERS,
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypeFor(path),
  };
  if (downloadName) {
    baseHeaders["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }

  if (!range) {
    return new Response(Bun.file(path), {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(size),
      },
    });
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return new Response("Invalid Range", { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : 0;
  let end = match[2] ? Number.parseInt(match[2], 10) : size - 1;

  if (!match[1] && match[2]) {
    const suffixLength = Number.parseInt(match[2], 10);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
  }

  end = Math.min(end, size - 1);
  const stream = createReadStream(path, { start, end });
  return new Response(stream as any, {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}
