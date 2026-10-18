import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bell, BriefcaseBusiness, FileClock, FlaskConical, LayoutDashboard, ListChecks, Network, PlayCircle, ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import AuditLog from "./pages/AuditLog";
import CaseWorkspace from "./pages/CaseWorkspace";
import Cases from "./pages/Cases";
import Controls from "./pages/Controls";
import Customer360 from "./pages/Customer360";
import Dashboard from "./pages/Dashboard";
import EntityNetwork from "./pages/EntityNetwork";
import Metrics from "./pages/Metrics";
import Queue from "./pages/Queue";

/** Opens the next alert in queue order that has no analyst decision yet, and starts its investigation. */
export function NextAlertButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: async () => {
      const q = await api.queue(150);
      const next = q.items.find((i) => ["new", "open"].includes(i.case_status)) ?? q.items.find((i) => !["approved", "modified", "closed"].includes(i.case_status));
      if (!next) throw new Error("No alerts awaiting investigation");
      const caseId = next.case_id ?? (await api.createCase(next.transaction_id)).case_id;
      return { caseId, autorun: next.case_status === "new" || next.case_status === "open" };
    },
    onSuccess: (r) => navigate(`/cases/${r.caseId}${r.autorun ? "?autorun=1" : ""}`),
  });
  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      title={m.error instanceof Error ? m.error.message : "Open the next alert in the priority queue and run the AI investigation"}
      className={`inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 ${className}`}
    >
      <PlayCircle className="h-4 w-4" aria-hidden />
      {m.isPending ? "Starting…" : "Run new investigation"}
    </button>
  );
}

function NotificationBell({ atRisk, className = "" }: { atRisk: number; className?: string }) {
  return (
    <NavLink to="/queue" className={`relative shrink-0 rounded-full p-2 ${className}`} aria-label={`${atRisk} alerts nearing SLA`}>
      <Bell className="h-5 w-5" aria-hidden />
      {atRisk > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />}
    </NavLink>
  );
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Fraud Operations Dashboard", "/queue": "Alert queue", "/cases": "Cases", "/network": "Entity network",
  "/controls": "Models & controls", "/metrics": "Evaluation", "/audit": "Audit log",
};

function Shell({ children }: { children: ReactNode }) {
  const ov = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 10000 });
  const loc = useLocation();
  const awaiting = ov.data?.kpis.awaiting_review.value;
  const atRisk = ov.data?.kpis.nearing_sla.value ?? 0;
  const nav = [
    { to: "/", label: "Overview", icon: LayoutDashboard, badge: undefined as number | undefined },
    { to: "/queue", label: "Alert queue", icon: ListChecks, badge: awaiting },
    { to: "/cases", label: "Cases", icon: BriefcaseBusiness },
    { to: "/network", label: "Entity network", icon: Network },
    { to: "/controls", label: "Models & controls", icon: SlidersHorizontal },
    { to: "/metrics", label: "Evaluation", icon: FlaskConical },
    { to: "/audit", label: "Audit log", icon: FileClock },
  ];
  const path = loc.pathname;
  const title = PAGE_TITLES[path]
    ?? (path.startsWith("/cases/") ? "Case workspace"
      : path.startsWith("/customers/") ? `Customer 360 · ${decodeURIComponent(path.split("/")[2] ?? "")}`
      : "Page not found");
  useEffect(() => { document.getElementById("main")?.focus({ preventScroll: true }); }, [loc.pathname]);
  return (
    <div className="flex min-h-screen bg-slate-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-200 md:flex">
        <NavLink to="/" className="flex items-center gap-2 px-5 py-5 text-lg font-bold text-white">
          <ShieldCheck className="h-6 w-6 text-teal-400" aria-hidden /> FraudLens AI
        </NavLink>
        <nav aria-label="Main" className="flex-1 space-y-1 px-3">
          {nav.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} end={to === "/"}
              className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
              <Icon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{label}</span>
              {badge ? <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white" aria-label={`${badge} awaiting review`}>{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-md bg-slate-800 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white" aria-hidden>FO</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400">Signed in as</p>
              <p className="truncate text-sm font-semibold text-white">Fraud Operations</p>
            </div>
            <NotificationBell atRisk={atRisk} className="text-slate-300 hover:bg-slate-700 hover:text-white" />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Same grey as the page, so the title sits on the canvas; stays opaque so scrolled content doesn't show through. */}
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-slate-100 px-4 pb-1 pt-5 md:px-6">
          <NavLink to="/" className="flex items-center gap-1 font-bold md:hidden"><ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden />FraudLens</NavLink>
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {/* Sidebar is hidden below md, so keep the bell reachable on mobile. */}
          <NotificationBell atRisk={atRisk} className="ml-auto text-slate-600 hover:bg-slate-200 md:hidden" />
        </header>
        <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1 md:hidden">
          {nav.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded px-2 py-1 text-xs ${isActive ? "bg-slate-900 text-white" : "text-slate-700"}`}>{label}</NavLink>
          ))}
        </nav>
        <main id="main" tabIndex={-1} className="w-full max-w-[1500px] flex-1 px-4 pb-5 pt-1 outline-none md:px-6">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:caseId" element={<CaseWorkspace />} />
        <Route path="/customers/:customerId" element={<Customer360 />} />
        <Route path="/network" element={<EntityNetwork />} />
        <Route path="/controls" element={<Controls />} />
        <Route path="/metrics" element={<Metrics />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="*" element={<p>Page not found.</p>} />
      </Routes>
    </Shell>
  );
}
