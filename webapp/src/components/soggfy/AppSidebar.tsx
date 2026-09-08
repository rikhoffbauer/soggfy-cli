import {
  IconActivityHeartbeat,
  IconBook2,
  IconDownload,
  IconHistory,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import logo from "../../logo.png";
import type { HealthSnapshot } from "./models";

interface AppSidebarProps {
  queueCount: number;
  libraryCount: number;
  health: HealthSnapshot | null;
}

const DOCS_BASE = "https://rikhoffbauer.github.io/soggfy-cli/";

export function AppSidebar({ queueCount, libraryCount, health }: AppSidebarProps) {
  const ready = Boolean(health?.started && (health.readyInstances ?? 0) > 0);

  return (
    <aside className="hidden lg:flex lg:w-60 xl:w-64 shrink-0 flex-col border-r border-white/8 bg-[#0b0d10] px-3 py-4">
      <a href="#search" className="flex items-center gap-3 rounded-xl px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
        <img src={logo} alt="Soggfy" className="size-9 rounded-xl shadow-lg" />
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-tight text-white">Soggfy</div>
          <div className="text-[11px] text-white/40">Spotify capture workspace</div>
        </div>
      </a>

      <nav className="mt-6 space-y-1" aria-label="Primary">
        <SidebarLink href="#search" icon={<IconSearch />} label="Search" />
        <SidebarLink href="#queue" icon={<IconDownload />} label="Queue" count={queueCount} />
        <SidebarLink href="#library" icon={<IconHistory />} label="Downloads" count={libraryCount} />
        <SidebarLink href="#diagnostics" icon={<IconActivityHeartbeat />} label="Diagnostics" />
      </nav>

      <div className="mt-7 border-t border-white/8 pt-5">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Help</div>
        <SidebarLink external href={DOCS_BASE} icon={<IconBook2 />} label="Documentation" />
        <SidebarLink external href={`${DOCS_BASE}cli/`} icon={<IconTerminal2 />} label="CLI reference" />
      </div>

      <div className="mt-auto rounded-xl border border-white/8 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white/90">
          <span className={`size-2 rounded-full ${ready ? "bg-primary shadow-[0_0_10px_rgba(30,215,96,0.7)]" : "bg-amber-400"}`} />
          {ready ? "Ready" : health?.started ? "Starting instances" : "Server starting"}
        </div>
        <div className="mt-2 space-y-0.5 text-[11px] text-white/40">
          <div>{health?.readyInstances ?? 0}/{health?.poolSize ?? 0} capture instances ready</div>
          <div>Backend: {health?.captureBackend || "ogg"}</div>
        </div>
      </div>
    </aside>
  );
}

interface SidebarLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  external?: boolean;
}

function SidebarLink({ href, icon, label, count, external }: SidebarLinkProps) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/55 transition hover:bg-white/[0.055] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <span className="[&>svg]:size-[18px] [&>svg]:stroke-[1.7] text-white/45 group-hover:text-primary">{icon}</span>
      <span>{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="ml-auto min-w-5 rounded-full bg-white/8 px-1.5 py-0.5 text-center text-[10px] tabular-nums text-white/60">{count}</span>
      ) : null}
    </a>
  );
}
