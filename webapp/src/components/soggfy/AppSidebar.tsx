import type { ReactNode } from "react";
import {
  IconActivityHeartbeat,
  IconBook2,
  IconDownload,
  IconHeart,
  IconHistory,
  IconPlaylist,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import logo from "../../logo.png";
import type { HealthSnapshot, SpotifyLibrarySnapshot } from "./models";
import type { SpotifyCollectionSelection, WorkspacePage } from "./workspace-model";

interface AppSidebarProps {
  activePage: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
  queueCount: number;
  libraryCount: number;
  health: HealthSnapshot | null;
  spotifyLibrary: SpotifyLibrarySnapshot | null;
  spotifyLibraryLoading: boolean;
  spotifyLibraryError: string | null;
  selectedSpotifyCollection: SpotifyCollectionSelection;
  onOpenSpotifyCollection: (selection: SpotifyCollectionSelection) => void;
}

const DOCS_BASE = "https://rikhoffbauer.github.io/soggfy-cli/";
const PRIMARY: Array<{ page: WorkspacePage; label: string; icon: ReactNode; count?: "queue" | "library" }> = [
  { page: "search", label: "Search", icon: <IconSearch /> },
  { page: "queue", label: "Queue", icon: <IconDownload />, count: "queue" },
  { page: "downloads", label: "Downloads", icon: <IconHistory />, count: "library" },
  { page: "diagnostics", label: "Diagnostics", icon: <IconActivityHeartbeat /> },
];

export function AppSidebar(props: AppSidebarProps) {
  const {
    activePage, onNavigate, queueCount, libraryCount, health,
    spotifyLibrary, spotifyLibraryLoading, spotifyLibraryError,
    selectedSpotifyCollection, onOpenSpotifyCollection,
  } = props;
  const ready = Boolean(health?.started && (health.readyInstances ?? 0) > 0);
  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-white/8 bg-[#0b0d10] px-3 py-4 lg:flex xl:w-64">
      <button type="button" onClick={() => onNavigate("search")} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
        <img src={logo} alt="Soggfy" className="size-9 rounded-xl shadow-lg" />
        <div className="min-w-0"><div className="text-lg font-bold tracking-tight text-white">Soggfy</div><div className="text-[11px] text-white/40">Spotify capture workspace</div></div>
      </button>

      <nav className="mt-6 space-y-1" aria-label="Primary">
        {PRIMARY.map((item) => (
          <SidebarButton
            key={item.page}
            active={activePage === item.page}
            icon={item.icon}
            label={item.label}
            count={item.count === "queue" ? queueCount : item.count === "library" ? libraryCount : undefined}
            onClick={() => onNavigate(item.page)}
          />
        ))}
      </nav>

      <div className="mt-5 min-h-0 border-t border-white/8 pt-4">
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Spotify</div>
          {spotifyLibrary ? <div className="text-[10px] text-white/22">{spotifyLibrary.account.displayName}</div> : null}
        </div>
        {spotifyLibrary ? (
          <div className="max-h-[min(38vh,20rem)] space-y-0.5 overflow-y-auto pr-1">
            <CollectionButton
              active={activePage === "spotify" && selectedSpotifyCollection.type === "liked"}
              icon={<IconHeart />}
              label="Liked Songs"
              count={spotifyLibrary.likedSongs.totalCount}
              onClick={() => onOpenSpotifyCollection({ type: "liked" })}
            />
            {spotifyLibrary.playlists.map((playlist) => (
              <CollectionButton
                key={playlist.id}
                active={activePage === "spotify" && selectedSpotifyCollection.type === "playlist" && selectedSpotifyCollection.id === playlist.id}
                icon={<IconPlaylist />}
                label={playlist.name}
                count={playlist.totalCount}
                onClick={() => onOpenSpotifyCollection({ type: "playlist", id: playlist.id })}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenSpotifyCollection({ type: "liked" })}
            className="w-full rounded-md px-3 py-2 text-left text-xs text-white/28 transition hover:bg-white/[0.045] hover:text-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {spotifyLibraryLoading ? "Loading library…" : spotifyLibraryError ? "Library unavailable" : "Waiting for Spotify…"}
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-white/8 pt-4">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Help</div>
        <ExternalLink href={DOCS_BASE} icon={<IconBook2 />} label="Documentation" />
        <ExternalLink href={`${DOCS_BASE}cli/`} icon={<IconTerminal2 />} label="CLI reference" />
      </div>

      <div className="mt-auto px-3 pb-1 pt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-white/75"><span className={`size-2 rounded-full ${ready ? "bg-primary" : "bg-amber-400"}`} />{ready ? "Ready" : health?.started ? "Starting instances" : "Server starting"}</div>
        <div className="mt-1 text-[11px] text-white/32">{health?.readyInstances ?? 0}/{health?.poolSize ?? 0} instances · {health?.captureBackend || "ogg"}</div>
      </div>
    </aside>
  );
}

function SidebarButton({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${active ? "bg-white/[0.075] text-white" : "text-white/52 hover:bg-white/[0.05] hover:text-white"}`}>
      <span className={`[&>svg]:size-[18px] [&>svg]:stroke-[1.7] ${active ? "text-primary" : "text-white/42 group-hover:text-primary"}`}>{icon}</span><span>{label}</span>
      {typeof count === "number" && count > 0 ? <span className="ml-auto min-w-5 rounded-full bg-white/8 px-1.5 py-0.5 text-center text-[10px] tabular-nums text-white/60">{count}</span> : null}
    </button>
  );
}

function CollectionButton({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} className={`group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${active ? "bg-white/[0.075] text-white" : "text-white/48 hover:bg-white/[0.045] hover:text-white/80"}`}>
      <span className={`shrink-0 [&>svg]:size-4 [&>svg]:stroke-[1.7] ${active ? "text-primary" : "text-white/34"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 ? <span className="text-[10px] tabular-nums text-white/24">{count}</span> : null}
    </button>
  );
}

function ExternalLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/52 transition hover:bg-white/[0.05] hover:text-white"><span className="[&>svg]:size-[18px] [&>svg]:stroke-[1.7] text-white/42 group-hover:text-primary">{icon}</span><span>{label}</span></a>;
}
