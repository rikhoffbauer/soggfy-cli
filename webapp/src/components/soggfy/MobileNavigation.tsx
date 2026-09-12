import type { ReactNode } from "react";
import { IconActivityHeartbeat, IconDownload, IconHistory, IconSearch } from "@tabler/icons-react";
import type { WorkspacePage } from "./workspace-model";

const PAGES: Array<{ page: WorkspacePage; label: string; icon: ReactNode }> = [
  { page: "search", label: "Search", icon: <IconSearch /> },
  { page: "queue", label: "Queue", icon: <IconDownload /> },
  { page: "downloads", label: "Downloads", icon: <IconHistory /> },
  { page: "diagnostics", label: "Diagnostics", icon: <IconActivityHeartbeat /> },
];

export function MobileNavigation({ activePage, onNavigate }: { activePage: WorkspacePage; onNavigate: (page: WorkspacePage) => void }) {
  return (
    <nav className="grid h-11 shrink-0 grid-cols-4 border-b border-white/[0.06] bg-[#0b0d10] lg:hidden" aria-label="Primary">
      {PAGES.map((item) => (
        <button key={item.page} type="button" aria-label={item.label} aria-current={activePage === item.page ? "page" : undefined} onClick={() => onNavigate(item.page)} className={`flex items-center justify-center gap-1.5 border-b-2 px-1 text-[11px] font-semibold [&>svg]:size-4 ${activePage === item.page ? "border-primary text-white" : "border-transparent text-white/40"}`}>
          {item.icon}<span className="max-sm:hidden">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
