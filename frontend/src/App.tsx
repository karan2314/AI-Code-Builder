import { useMutation } from "@tanstack/react-query";
import { BarChart3, Gauge, ListChecks, PlayCircle, ScanSearch } from "lucide-react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import CaseWorkspace from "./pages/CaseWorkspace";
import Customer360 from "./pages/Customer360";
import Dashboard from "./pages/Dashboard";
import Metrics from "./pages/Metrics";
import Queue from "./pages/Queue";

const nav = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/queue", label: "Suspicious queue", icon: ListChecks },
  { to: "/metrics", label: "Evaluation", icon: BarChart3 },
];

export function HeroButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => api.demo("hero"),
    onSuccess: (r) => navigate(`/cases/${r.case_id}${r.needs_investigation ? "?autorun=demo" : ""}`),
  });
  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className={`inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 ${className}`}
    >
      <PlayCircle className="h-4 w-4" aria-hidden />
      {m.isPending ? "Starting…" : "Run hero scenario"}
    </button>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-2">
        Skip to content
      </a>
      <div role="note" className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
        Demo on SYNTHETIC data. All account actions are SIMULATED. Not a production banking system.
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <ScanSearch className="h-6 w-6 text-teal-700" aria-hidden />
            FraudLens <span className="font-normal text-slate-500">AI</span>
          </NavLink>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
            <HeroButton className="ml-2" />
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/cases/:caseId" element={<CaseWorkspace />} />
          <Route path="/customers/:customerId" element={<Customer360 />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-500">
        ML handles scale · tools provide verified evidence · agents orchestrate · Gemini synthesizes · policy controls the action.
      </footer>
    </div>
  );
}
