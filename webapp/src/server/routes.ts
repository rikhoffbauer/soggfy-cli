import { existsSync } from "fs";
import { extname } from "path";
import { ZipArchive } from "archiver";
import { clampSearchLimit, searchSpotify, type SpotifySearchType } from "../../../src/core/spotify-search";
import { fetchAllSpotifyPlaylistTracks, fetchSpotifyPlaylistPage } from "../../../src/core/spotify-playlist";
import { fetchSpotifyAlbumPage } from "../../../src/core/spotify-album";
import { resolveInput as resolveSpotifyInput } from "../../../src/core/metadata";
import { fetchSpotifyLyrics } from "../../../src/core/spotify-lyrics";
import { CAPTURE_BACKEND, OUTPUT_DIR } from "../../../src/core/paths";
import { CORS_HEADERS, jsonResponse, serveFileWithRange } from "./http";
import { parseAlbumId, parsePlaylistId, parseTrackId } from "./spotify-url";
import { streamGrowingFile } from "./growing-file";
import { listLogSources, readLogTail } from "./logs";
import { displayFileName } from "./media";
import {
  GLOBAL_METADATA, LOG_ROOTS, POOL_SIZE, REPO_ROOT,
  cachePlaylistTrackMetadata, fetchTrackDuration, fetchTrackMetadata,
  findOutputForTrack, jobs, pool, resolveSpotifyUrl,
} from "./runtime";

export function createApiRoutes() {
  return {
    "/api/health": {
      GET: () => jsonResponse({
        ok: true,
        started: pool.started,
        repoRoot: REPO_ROOT,
        outputDir: OUTPUT_DIR,
        poolSize: POOL_SIZE,
        readyInstances: pool.instances.filter((i) => i.isReady).length,
        activeJobs: jobs.all().filter((j) => jobs.isActive(j)).length,
        completedJobs: jobs.all().filter((j) => j.state === "completed").length,
        failedJobs: jobs.all().filter((j) => j.state === "failed").length,
        captureBackend: CAPTURE_BACKEND,
        revision: jobs.revision,
      }),
    },
    "/api/logs": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const sources = listLogSources(LOG_ROOTS);
        const sourceId = url.searchParams.get("source");
        if (!sourceId) return jsonResponse({ sources });
        const source = sources.find((item) => item.id === sourceId);
        if (!source) return jsonResponse({ error: "Unknown log source" }, { status: 404 });
        if (url.searchParams.get("raw") === "1") {
          return new Response(Bun.file(source.path), {
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS },
          });
        }
        const requestedLines = Number.parseInt(url.searchParams.get("lines") || "1000", 10);
        return jsonResponse(readLogTail(source, Number.isFinite(requestedLines) ? requestedLines : 1000));
      },
    },
    "/api/instances": {
      GET: () => jsonResponse(pool.snapshots()),
    },
    "/api/jobs": {
      GET: (req: Request) => {
        const since = Number.parseInt(new URL(req.url).searchParams.get("since") || "", 10);
        if (Number.isInteger(since) && since >= jobs.revision) {
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
        return jsonResponse({ revision: jobs.revision, jobs: jobs.all(), queue: pool.queue.ids(), instances: pool.snapshots() });
      },
    },
    "/api/jobs/action": {
      POST: async (req: Request) => {
        try {
          const body = await req.json();
          const jobId = body.jobId;
          const action = body.action;
          if (!jobId || typeof jobId !== "string") return jsonResponse({ error: "Missing jobId" }, { status: 400 });
          if (action === "cancel") return jsonResponse({ job: await pool.cancelJob(jobId, body.reason || "cancelled by user") });
          if (action === "retry") return jsonResponse({ job: await pool.retryJob(jobId) });
          return jsonResponse({ error: "Unsupported action" }, { status: 400 });
        } catch (err: any) {
          return jsonResponse({ error: err.message }, { status: 500 });
        }
      },
    },
    "/api/status": {
      GET: () => jsonResponse(jobs.toLegacyStatus(GLOBAL_METADATA)),
    },
    "/api/search": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const query = url.searchParams.get("q");
        if (!query) return jsonResponse({ error: "Missing query" }, { status: 400 });
        const rawType = url.searchParams.get("type");
        if (rawType !== "track" && rawType !== "album" && rawType !== "playlist" && rawType !== "artist") {
          return jsonResponse({ error: "Search type must be track, album, playlist, or artist" }, { status: 400 });
        }
        const type = rawType as SpotifySearchType;
        const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "40", 10);
        const requestedOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = clampSearchLimit(Number.isFinite(requestedLimit) ? requestedLimit : 40);
        const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
        try {
          const items = await searchSpotify(query, { types: [type], limit, offset });
          return jsonResponse({
            type, items, offset, limit,
            nextOffset: items.length > 0 ? offset + items.length : null,
          });
        } catch (err: any) {
          return jsonResponse({ error: err.message }, { status: 500 });
        }
      },
    },
    "/api/album": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const input = url.searchParams.get("id");
        const albumId = input ? parseAlbumId(input) : null;
        if (!albumId) return jsonResponse({ error: "Invalid Spotify album" }, { status: 400 });
        const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
        try {
          const page = await fetchSpotifyAlbumPage(albumId, { offset, limit });
          for (const track of page.tracks) cachePlaylistTrackMetadata(track);
          return jsonResponse(page);
        } catch (err: any) {
          const status = /not found/i.test(err.message) ? 404 : 502;
          return jsonResponse({ error: err.message }, { status });
        }
      },
    },
    "/api/playlist": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const input = url.searchParams.get("id");
        if (!input) return jsonResponse({ error: "Missing playlist id" }, { status: 400 });
        const playlistId = parsePlaylistId(input);
        if (!playlistId) return jsonResponse({ error: "Invalid Spotify playlist" }, { status: 400 });
        const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
        try {
          const page = await fetchSpotifyPlaylistPage(playlistId, { offset, limit });
          for (const track of page.tracks) cachePlaylistTrackMetadata(track);
          return jsonResponse(page);
        } catch (err: any) {
          const status = /not found/i.test(err.message) ? 404 : 502;
          return jsonResponse({ error: err.message }, { status });
        }
      },
    },
    "/api/track": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const input = url.searchParams.get("id");
        const trackId = input ? parseTrackId(input) : null;
        if (!trackId) return jsonResponse({ error: "Invalid Spotify track" }, { status: 400 });
        const [metadata, durationMs] = await Promise.all([fetchTrackMetadata(trackId), fetchTrackDuration(trackId)]);
        if (metadata) GLOBAL_METADATA[trackId] = metadata;
        return jsonResponse({
          id: trackId, uri: `spotify:track:${trackId}`, type: "track",
          name: metadata?.title || trackId, subtitle: metadata?.artist || "Unknown artist",
          imageUrl: metadata?.coverUrl, durationMs: durationMs || undefined,
        });
      },
    },
    "/api/play": {
      POST: async (req: Request) => {
        try {
          const body = await req.json();
          const input = body.trackId || body.url;
          if (!input) return jsonResponse({ success: false, error: "Missing trackId" }, { status: 400 });
          const result = await pool.playNow(input);
          return jsonResponse({ success: true, revision: jobs.revision, ...result });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, { status: 400 });
        }
      },
    },
    "/api/playlist/queue-all": {
      POST: async (req: Request) => {
        try {
          const body = await req.json();
          const input = body.playlistId || body.url || body.id;
          const playlistId = typeof input === "string" ? parsePlaylistId(input) : null;
          if (!playlistId) return jsonResponse({ success: false, error: "Invalid Spotify playlist" }, { status: 400 });
          const playlist = await fetchAllSpotifyPlaylistTracks(playlistId);
          let newlyQueued = 0;
          let existing = 0;
          let skipped = playlist.issues.length;
          const trackIds: string[] = [];
          for (const track of playlist.tracks) {
            cachePlaylistTrackMetadata(track);
            if (!track.playable) { skipped += 1; continue; }
            trackIds.push(track.id);
            if (jobs.findReusable(track.id)) {
              existing += 1;
            } else {
              pool.addResolvedJob(track.id, {
                title: track.name,
                artist: track.artists.join(", ") || "Unknown artist",
                coverUrl: track.imageUrl,
              });
              newlyQueued += 1;
            }
          }
          return jsonResponse({ success: true, total: playlist.totalCount, newlyQueued, existing, skipped, trackIds });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, { status: 502 });
        }
      },
    },
    "/api/lyrics": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const trackParam = url.searchParams.get("track");
        if (!trackParam) return jsonResponse({ error: "Missing track" }, { status: 400 });
        const trackId = parseTrackId(trackParam);
        if (!trackId) return jsonResponse({ error: "Invalid Spotify track" }, { status: 400 });
        try {
          const lyrics = await fetchSpotifyLyrics(trackId);
          if (!lyrics) return jsonResponse({ available: false, source: "spotify", trackId }, { status: 404 });
          return jsonResponse(lyrics);
        } catch (err: any) {
          return jsonResponse({ error: err.message, source: "spotify", trackId }, { status: 502 });
        }
      },
    },
    "/api/download-all": {
      GET: () => {
        const archive = new ZipArchive({ zlib: { level: 9 } });
        const stream = new ReadableStream({
          start(controller) {
            archive.on("data", (chunk: Buffer) => controller.enqueue(chunk));
            archive.on("end", () => controller.close());
            archive.on("error", (err: Error) => controller.error(err));
            for (const job of jobs.all().filter((j) => j.state === "completed" && j.savedPath && existsSync(j.savedPath))) {
              const ext = job.outputFormat || extname(job.savedPath!).slice(1).toLowerCase() || "bin";
              archive.file(job.savedPath!, { name: displayFileName(job.trackId, job.metadata, ext) });
            }
            archive.finalize();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="soggfy_downloads.zip"',
            ...CORS_HEADERS,
          },
        });
      },
    },
    "/api/file": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const trackParam = url.searchParams.get("track");
        if (!trackParam) return new Response("Missing track", { status: 400, headers: CORS_HEADERS });
        const trackId = parseTrackId(trackParam);
        if (!trackId) return new Response("Invalid track", { status: 400, headers: CORS_HEADERS });
        const output = findOutputForTrack(trackId);
        if (!output) return new Response("File not ready", { status: 404, headers: CORS_HEADERS });
        const job = jobs.findByTrack(trackId);
        return serveFileWithRange(req, output.path, displayFileName(trackId, job?.metadata, output.format));
      },
    },
    "/api/stream": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const trackParam = url.searchParams.get("track");
        if (!trackParam) return new Response("Missing track", { status: 400, headers: CORS_HEADERS });
        const resolvedTrackIds = await resolveSpotifyInput(trackParam);
        const trackId = resolvedTrackIds[0];
        if (!trackId) return new Response("Invalid track", { status: 400, headers: CORS_HEADERS });

        const requestedJobId = url.searchParams.get("job");
        const requestedJob = requestedJobId ? jobs.get(requestedJobId) : undefined;
        if (requestedJobId && !requestedJob) {
          return jsonResponse({ error: "Unknown stream job" }, { status: 404 });
        }
        if (requestedJob && requestedJob.trackId !== trackId) {
          return jsonResponse({ error: "Stream job does not match track" }, { status: 409 });
        }

        const output = findOutputForTrack(trackId);
        if (output) return serveFileWithRange(req, output.path);

        const existing = requestedJob ?? jobs.findReusable(trackId);
        if (!existing) {
          return jsonResponse({ error: "Track is not queued or capturing; use /api/play or /api/download first" }, { status: 404 });
        }
        if (existing.state === "failed" || existing.state === "cancelled") {
          return jsonResponse({ error: existing.error || `Track job is ${existing.state}` }, { status: 409 });
        }

        return streamGrowingFile({
          getPath: () => {
            const current = jobs.get(existing.id);
            if (!current || current.priorityInterrupted) return undefined;
            if (current.oggPath) return current.oggPath;
            return current.capturePath?.endsWith(".ogg") ? current.capturePath : undefined;
          },
          getState: () => {
            const current = jobs.get(existing.id);
            if (!current || current.priorityInterrupted) return "cancelled";
            return current.state;
          },
          signal: req.signal,
          startupTimeoutMs: 20_000,
          pollMs: 100,
        });
      },
    },
    "/api/download": {
      POST: async (req: Request) => {
        try {
          const body = await req.json();
          const input = body.url || body.trackId;
          if (!input) return jsonResponse({ success: false, error: "Missing 'url' or 'trackId'" }, { status: 400 });
          const trackIds = await resolveSpotifyUrl(input);
          if (trackIds.length === 0) return jsonResponse({ success: false, error: "Could not extract any valid tracks from the input URL." }, { status: 400 });

          for (const id of trackIds) {
            pool.addJob(id).catch((err) => console.error(`[Server] Background job failed for ${id}:`, err));
          }
          return jsonResponse({ success: true, queued: true, count: trackIds.length, trackIds });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, { status: 500 });
        }
      },
    },

  };
}
