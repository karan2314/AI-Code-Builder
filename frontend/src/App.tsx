import { useQuery } from "@tanstack/react-query";
import {
  Bell, BriefcaseBusiness, FileClock, FlaskConical, LayoutDashboard, ListChecks, Network, PlayCircle, Search, ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import NewInvestigationDialog from "./components/NewInvestigationDialog";
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
import type { SearchHit } from "./types";

/** "Run new investigation": opens a dialog to investigate the next alert, upload a file to test, or score one transaction. */
export function NextAlertButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Investigate the next alert, or upload your own transactions to test"
        className={`inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 ${className}`}
      >
        <PlayCircle className="h-4 w-4" aria-hidden />
        Run new investigation
      </button>
      <NewInvestigationDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const r = useQuery({ queryKey: ["search", debounced], queryFn: () => api.search(debounced), enabled: debounced.length >= 3 });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const go = async (h: SearchHit) => {
    setOpen(false); setQ("");
    if (h.kind === "customer") return navigate(`/customers/${h.id}`);
    if (h.kind === "entity") return navigate(`/network?entity=${encodeURIComponent(h.id)}`);
    const id = h.case_id ?? (await api.createCase(h.id)).case_id;
    navigate(`/cases/${id}`);
  };
  const hits = debounced.length >= 3 ? r.data?.items ?? [] : [];
  return (
    <div ref={box} className="relative w-full max-w-xl">
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (hits[0]) void go(hits[0]); }}>
        <label htmlFor="global-search" className="sr-only">Search by case, transaction, customer or entity ID</label>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
        <input
          id="global-search" role="combobox" aria-autocomplete="list" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          placeholder="Search by case ID, transaction, customer or entity…" autoComplete="off"
          aria-controls={listId} aria-expanded={open && hits.length > 0}
          className="w-full rounded-md border border-slate-300 bg-slate-50 py-2 pl-8 pr-3 text-sm focus:bg-white"
        />
      </form>
      {open && debounced.length >= 3 && (
        <ul id={listId} className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {r.isLoading && <li className="px-3 py-2 text-slate-500">Searching…</li>}
          {!r.isLoading && hits.length === 0 && <li className="px-3 py-2 text-slate-500">No match. Use a full ID such as TXN-…, CASE-…, CUST-…</li>}
          {hits.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              <button type="button" onClick={() => void go(h)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-teal-50 focus:bg-teal-50">
                <span className="w-20 shrink-0 text-xs uppercase text-slate-500">{h.kind}</span>
                <span className="font-mono text-xs">{h.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
        <div className="m-3 rounded-md bg-slate-800 p-3 text-xs">
          <p className="text-slate-400">Signed in as</p>
          <p className="font-semibold text-white">Fraud Operations</p>
          <p className="mt-2 text-[11px] text-slate-400">Synthetic data · account actions simulated</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <NavLink to="/" className="flex items-center gap-1 font-bold md:hidden"><ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden />FraudLens</NavLink>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <NavLink to="/queue" className="relative rounded-full p-2 hover:bg-slate-100" aria-label={`${atRisk} alerts nearing SLA`}>
              <Bell className="h-5 w-5 text-slate-600" aria-hidden />
              {atRisk > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-600" aria-hidden />}
            </NavLink>
            <span className="flex items-center gap-2 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white" aria-hidden>FO</span>
              <span className="hidden font-medium sm:inline">Fraud Operations</span>
            </span>
          </div>
        </header>
        <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1 md:hidden">
          {nav.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded px-2 py-1 text-xs ${isActive ? "bg-slate-900 text-white" : "text-slate-700"}`}>{label}</NavLink>
          ))}
        </nav>
        <main id="main" tabIndex={-1} className="w-full max-w-[1500px] flex-1 px-4 py-5 outline-none md:px-6">{children}</main>
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
