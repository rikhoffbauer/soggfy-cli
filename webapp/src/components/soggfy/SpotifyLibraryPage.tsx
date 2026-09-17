import {
  IconDownload,
  IconHeart,
  IconLoader2,
  IconMusic,
  IconPlayerPlay,
  IconPlaylist,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type {
  DownloadJob,
  SpotifyLibraryPlaylist,
  SpotifyLibrarySnapshot,
  SpotifyLibraryTrack,
} from "./models";
import type { SpotifyCollectionSelection } from "./workspace-model";

interface SpotifyLibraryPageProps {
  library: SpotifyLibrarySnapshot | null;
  loading: boolean;
  error: string | null;
  selectedCollection: SpotifyCollectionSelection;
  jobsByTrack: Map<string, DownloadJob>;
  onRetry: () => void;
  onPlayTrack: (trackId: string) => void;
  onQueueTrack: (trackId: string) => void;
  onQueuePlaylist: (playlistId: string) => void;
  onSelectCollection: (selection: SpotifyCollectionSelection) => void;
}

export function SpotifyLibraryPage(props: SpotifyLibraryPageProps) {
  const {
    library, loading, error, selectedCollection, jobsByTrack,
    onRetry, onPlayTrack, onQueueTrack, onQueuePlaylist, onSelectCollection,
  } = props;

  if (loading && !library) return <StatusState icon={<IconLoader2 className="animate-spin" />} text="Loading your Spotify library…" />;
  if (error && !library) {
    return (
      <StatusState icon={<IconRefresh />} text={error}>
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>Try again</Button>
      </StatusState>
    );
  }
  if (!library) return <StatusState icon={<IconHeart />} text="Spotify library is not loaded yet." />;

  const playlist = selectedCollection.type === "playlist"
    ? library.playlists.find((item) => item.id === selectedCollection.id) ?? null
    : null;
  const liked = selectedCollection.type === "liked";
  const tracks = liked ? library.likedSongs.tracks : playlist?.tracks ?? [];
  const issueCount = liked ? library.likedSongs.issues.length : playlist?.issues.length ?? 0;
  const totalCount = liked ? library.likedSongs.totalCount : playlist?.totalCount ?? 0;
  const title = liked ? "Liked Songs" : playlist?.name ?? "Playlist";
  const subtitle = liked
    ? `${library.account.displayName} · ${totalCount} saved ${totalCount === 1 ? "song" : "songs"}`
    : playlistSubtitle(playlist);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4 border-b border-white/[0.06] pb-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/70">Your Spotify</div>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          <p className="mt-1 truncate text-sm text-white/40">{subtitle}</p>
        </div>
        {playlist?.contentsAvailable && playlist.tracks.length ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onQueuePlaylist(playlist.id)}>
            <IconDownload className="size-4" /> Queue all
          </Button>
        ) : null}
      </div>

      <label className="mt-4 flex shrink-0 flex-col gap-1.5 lg:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">Collection</span>
        <select
          aria-label="Spotify collection"
          value={liked ? "liked" : `playlist:${playlist?.id ?? ""}`}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onSelectCollection(value === "liked"
              ? { type: "liked" }
              : { type: "playlist", id: value.slice("playlist:".length) });
          }}
          className="h-10 rounded-lg border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none focus:border-primary/40"
        >
          <option value="liked">Liked Songs ({library.likedSongs.totalCount})</option>
          {library.playlists.map((item) => (
            <option key={item.id} value={`playlist:${item.id}`}>{item.name} ({item.totalCount})</option>
          ))}
        </select>
      </label>

      {error && library ? (
        <div role="alert" className="mt-4 border border-red-400/20 bg-red-500/8 px-3 py-2 text-sm text-red-200">{error}</div>
      ) : null}

      {!liked && playlist && !playlist.contentsAvailable ? (
        <div className="mt-4 border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2 text-xs text-amber-100/70">
          Spotify exposed this playlist in your library, but its contents are not currently available to Soggfy.
        </div>
      ) : null}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-y border-white/[0.06]">
        {tracks.length ? tracks.map((track, index) => (
          <TrackRow
            key={`${index}:${track.id}`}
            track={track}
            index={index}
            job={jobsByTrack.get(track.id)}
            onPlay={() => onPlayTrack(track.id)}
            onQueue={() => onQueueTrack(track.id)}
          />
        )) : (
          <div className="grid min-h-72 place-items-center px-5 text-center text-sm text-white/30">
            {playlist && !playlist.contentsAvailable ? "Playlist contents unavailable." : "No songs in this collection."}
          </div>
        )}
      </div>
      {issueCount ? <div className="shrink-0 pt-2 text-[11px] text-white/28">{issueCount} unavailable or unsupported {issueCount === 1 ? "item" : "items"} omitted.</div> : null}
    </section>
  );
}

function TrackRow({ track, index, job, onPlay, onQueue }: {
  track: SpotifyLibraryTrack;
  index: number;
  job?: DownloadJob;
  onPlay: () => void;
  onQueue: () => void;
}) {
  const local = track.uri.startsWith("spotify:local:");
  return (
    <div className="group grid min-h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_minmax(6rem,.5fr)_auto] items-center gap-3 border-b border-white/[0.05] px-2 py-1.5 last:border-b-0 hover:bg-white/[0.035] sm:px-3 max-md:grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto]">
      <span className="text-right text-xs tabular-nums text-white/22">{index + 1}</span>
      <div className="grid size-10 place-items-center overflow-hidden rounded bg-white/[0.055] text-white/20">
        {track.imageUrl ? <img src={track.imageUrl} alt="" className="size-full object-cover" loading="lazy" /> : <IconMusic className="size-4" />}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white/90">{track.title}</div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-white/38">
          <span className="truncate">{track.artists.join(", ") || "Unknown artist"}</span>
          {local ? <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/35">Local file</span> : null}
        </div>
      </div>
      <div className="truncate text-xs text-white/30 max-md:hidden">{track.album || "Spotify"}</div>
      <div className="flex items-center gap-1">
        {job ? <span className="mr-1 hidden text-[10px] capitalize text-primary/70 sm:inline">{job.state}</span> : null}
        <IconAction label="Play" disabled={!track.playable} onClick={onPlay}><IconPlayerPlay /></IconAction>
        <IconAction label="Queue" disabled={!track.playable} onClick={onQueue}><IconDownload /></IconAction>
      </div>
    </div>
  );
}

function IconAction({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="rounded-md p-2 text-white/38 hover:bg-white/8 hover:text-white disabled:pointer-events-none disabled:opacity-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 [&>svg]:size-4">
      {children}
    </button>
  );
}

function StatusState({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-72 flex-1 place-items-center text-center">
      <div><div className="mx-auto grid size-10 place-items-center rounded-full bg-white/[0.045] text-white/25 [&>svg]:size-5">{icon}</div><p className="mt-3 max-w-md text-sm text-white/42">{text}</p>{children ? <div className="mt-3">{children}</div> : null}</div>
    </div>
  );
}

function playlistSubtitle(playlist: SpotifyLibraryPlaylist | null): string {
  if (!playlist) return "Playlist not found in the authenticated library.";
  const owner = playlist.owner ? `${playlist.owner} · ` : "";
  return `${owner}${playlist.totalCount} ${playlist.totalCount === 1 ? "song" : "songs"}`;
}
