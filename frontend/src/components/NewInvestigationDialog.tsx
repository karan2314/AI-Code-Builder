import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp, ListChecks, PlayCircle, Send, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { dateTime, formatINR, humanize, pct } from "../lib/format";
import type { BatchRow, BatchView } from "../types";
import { Chip, RiskBar, TierBadge } from "./ui";

type Tab = "next" | "upload" | "single";
const RECENT_KEY = "fraudlens.recentBatches";
const MAX_BYTES = 2 * 1024 * 1024;

interface Recent { batch_id: string; filename: string; created_at: string; rows: number; candidates: number }

const loadRecent = (): Recent[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[]; } catch { return []; }
};
const saveRecent = (b: BatchView) => {
  const item: Recent = { batch_id: b.batch_id, filename: b.filename, created_at: b.created_at, rows: b.summary.rows, candidates: b.summary.candidates };
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...loadRecent().filter((r) => r.batch_id !== b.batch_id)].slice(0, 5)));
};

/** "Run new investigation": pick the next alert, upload a file to test, or score a single transaction. */
export default function NewInvestigationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("next");
  const [batch, setBatch] = useState<BatchView | null>(null);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) { // keep keyboard focus inside the dialog
        const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  const tabs: { id: Tab; label: string; icon: typeof Upload }[] = [
    { id: "next", label: "Next alert", icon: ListChecks },
    { id: "upload", label: "Upload & test", icon: Upload },
    { id: "single", label: "Single transaction", icon: Send },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-5xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 id={titleId} className="text-lg font-bold">Run new investigation</h2>
            <p className="text-xs text-slate-600">Investigate the next alert, or upload your own synthetic transactions to test the pipeline end to end.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 hover:bg-slate-100" aria-label="Close dialog"><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <div role="tablist" aria-label="Investigation source" className="flex gap-1 border-b border-slate-200 px-4 pt-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} type="button" data-autofocus={tab === id ? true : undefined}
              onClick={() => setTab(id)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-teal-700 text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </button>
          ))}
        </div>
        <div className="p-5" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "next" && <NextAlertPanel onDone={onClose} />}
          {tab === "upload" && <UploadPanel batch={batch} setBatch={setBatch} onDone={onClose} />}
          {tab === "single" && <SinglePanel batch={batch} setBatch={setBatch} onDone={onClose} />}
        </div>
      </div>
    </div>
  );
}

function NextAlertPanel({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const next = useMutation({
    mutationFn: async () => {
      const q = await api.queue(150);
      const item = q.items.find((i) => ["new", "open"].includes(i.case_status)) ?? q.items.find((i) => !["approved", "modified", "closed"].includes(i.case_status));
      if (!item) throw new Error("No alerts awaiting investigation");
      const caseId = item.case_id ?? (await api.createCase(item.transaction_id)).case_id;
      return { caseId, autorun: item.case_status === "new" || item.case_status === "open" };
    },
    onSuccess: (r) => { onDone(); navigate(`/cases/${r.caseId}${r.autorun ? "?autorun=1" : ""}`); },
  });
  const demo = useMutation({
    mutationFn: (s: "hero" | "benign") => api.demo(s),
    onSuccess: (r) => { onDone(); navigate(`/cases/${r.case_id}${r.needs_investigation ? "?autorun=demo" : ""}`); },
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold">Next alert in the priority queue</h3>
        <p className="mt-1 text-sm text-slate-600">Opens the highest-priority alert without an analyst decision and runs the AI investigation.</p>
        <button type="button" onClick={() => next.mutate()} disabled={next.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
          <PlayCircle className="h-4 w-4" aria-hidden />{next.isPending ? "Starting…" : "Investigate next alert"}
        </button>
        {next.error && <p role="alert" className="mt-2 text-sm text-red-700">{(next.error as Error).message}</p>}
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold">Demo scenarios</h3>
        <p className="mt-1 text-sm text-slate-600">Pre-built cases from the synthetic dataset.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => demo.mutate("hero")} disabled={demo.isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">₹1,85,000 account takeover</button>
          <button type="button" onClick={() => demo.mutate("benign")} disabled={demo.isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">₹1,50,000 benign purchase</button>
        </div>
      </div>
    </div>
  );
}

function ErrorReport({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden />{e.message.replace(/^\d+: /, "")}</p>
      {e.errors?.length > 0 && (
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Validation errors</caption>
            <thead className="text-left"><tr><th className="pr-3">Row</th><th className="pr-3">Field</th><th>Problem</th></tr></thead>
            <tbody>{e.errors.slice(0, 100).map((x, i) => <tr key={i} className="border-t border-red-100"><td className="pr-3 font-mono">{x.row ?? "—"}</td><td className="pr-3 font-mono">{x.field}</td><td>{x.error}</td></tr>)}</tbody>
          </table>
          {e.errors.length > 100 && <p className="mt-1 text-xs">…and {e.errors.length - 100} more</p>}
        </div>
      )}
    </div>
  );
}

function UploadPanel({ batch, setBatch, onDone }: { batch: BatchView | null; setBatch: (b: BatchView | null) => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (f: File) => api.uploadBatch(f, f.name.toLowerCase().endsWith(".json") ? "json" : "csv", f.name),
    onSuccess: (b) => { setBatch(b); saveRecent(b); setRecent(loadRecent()); },
  });
  const reopen = useMutation({ mutationFn: (id: string) => api.batch(id), onSuccess: (b) => setBatch(b) });
  const pick = (f: File | undefined) => {
    setLocalError(null); upload.reset();
    if (!f) return;
    if (!/\.(csv|json)$/i.test(f.name)) return setLocalError("Choose a .csv or .json file.");
    if (f.size > MAX_BYTES) return setLocalError("File is larger than 2 MB.");
    setFile(f);
  };

  if (batch) return <BatchResults batch={batch} onBack={() => { setBatch(null); setFile(null); upload.reset(); }} onDone={onDone} />;
  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center ${drag ? "border-teal-600 bg-teal-50" : "border-slate-300 bg-slate-50"}`}>
        <FileUp className="h-8 w-8 text-slate-500" aria-hidden />
        <p className="mt-2 text-sm font-medium">Drag and drop a CSV or JSON file, or</p>
        <button type="button" onClick={() => input.current?.click()} className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">Choose file</button>
        <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" aria-label="Transaction file" onChange={(e) => pick(e.target.files?.[0])} />
        <p className="mt-2 text-xs text-slate-600">Up to 5,000 rows / 2 MB · synthetic, pseudonymous data only (no names, card numbers, PAN, Aadhaar, emails or phone numbers) · kept for 24 hours</p>
        {file && <p className="mt-3 text-sm"><Chip tone="teal">{file.name}</Chip> {(file.size / 1024).toFixed(1)} KB</p>}
      </div>
      {localError && <p role="alert" className="text-sm text-red-700">{localError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!file || upload.isPending} onClick={() => file && upload.mutate(file)}
          className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          <Upload className="h-4 w-4" aria-hidden />{upload.isPending ? "Uploading & screening…" : "Upload & screen"}
        </button>
        <a href="/api/batches/template.csv" className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100"><Download className="h-4 w-4" aria-hidden />Download template</a>
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-800 underline">File format</summary>
          <p className="mt-1 max-w-xl text-xs text-slate-700">
            Columns: <code>transaction_id, customer_id, account_id, timestamp, amount_rupees, channel, counterparty_id, device_id</code>, plus optional <code>is_fraud</code> (0/1) to measure precision and recall.
            IDs use the prefixes TXN-, CUST-, ACC-, MER-/RCP-, DEV-. Existing customers are compared with their history; new customers use a cohort baseline.
            Timestamps are ISO-8601 (e.g. 2026-09-29T14:05:00); channel is upi, card, netbanking or imps.
          </p>
        </details>
      </div>
      <div aria-live="polite">{upload.isPending && <p role="status" className="text-sm text-slate-600">Validating, computing point-in-time features and scoring…</p>}</div>
      <ErrorReport error={upload.error ?? reopen.error} />
      {recent.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-slate-500">Recent uploads (this browser)</h3>
          <ul className="mt-1 divide-y divide-slate-100 text-sm">
            {recent.map((r) => (
              <li key={r.batch_id} className="flex items-center justify-between py-1.5">
                <span><span className="font-mono text-xs">{r.batch_id}</span> · {r.filename} · {r.rows} rows · {r.candidates} flagged · {dateTime(r.created_at)}</span>
                <button type="button" onClick={() => reopen.mutate(r.batch_id)} className="text-teal-800 underline">Open</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-md border border-slate-200 px-3 py-2"><p className="text-[11px] uppercase text-slate-500">{label}</p><p className="text-lg font-bold">{value}</p></div>;
}

function BatchResults({ batch, onBack, onDone }: { batch: BatchView; onBack: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const live = useQuery({ queryKey: ["batch", batch.batch_id], queryFn: () => api.batch(batch.batch_id), initialData: batch, refetchOnMount: true });
  const b = live.data ?? batch;
  const open = useMutation({
    mutationFn: async (r: BatchRow) => r.case_id ?? (await api.createCase(r.transaction_id, b.batch_id)).case_id,
    onSuccess: (caseId, r) => { qc.invalidateQueries({ queryKey: ["batch", b.batch_id] }); onDone(); navigate(`/cases/${caseId}${r.case_id ? "" : "?autorun=1"}`); },
  });
  const s = b.summary;
  const rows = showAll ? b.rows : b.rows.filter((r) => r.is_candidate);
  const lm = s.labelled_metrics;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1 text-sm font-semibold text-teal-800"><CheckCircle2 className="h-4 w-4" aria-hidden />Screened {s.rows.toLocaleString("en-IN")} transactions in {s.processing_ms < 1000 ? `${Math.round(s.processing_ms)} ms` : `${(s.processing_ms / 1000).toFixed(1)} s`}</p>
          <p className="text-xs text-slate-600"><span className="font-mono">{b.batch_id}</span> · {b.filename} · model {s.model_version} · threshold {s.threshold} · expires {dateTime(b.expires_at)}</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/batches/${b.batch_id}/results.csv`} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"><Download className="h-4 w-4" aria-hidden />Export results</a>
          <button type="button" onClick={onBack} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Upload another file</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Flagged" value={`${s.candidates} (${pct(s.candidate_rate, 1)})`} />
        <Stat label="Customers" value={s.customers} />
        <Stat label="New customers" value={s.new_customers} />
        <Stat label="New devices" value={s.new_devices} />
        <Stat label="New counterparties" value={s.new_counterparties} />
        <Stat label="AI investigations" value={`${b.ai_investigations.used} / ${b.ai_investigations.limit}`} />
      </div>
      {lm && (
        <p className="rounded-md bg-slate-50 p-2 text-sm">
          Labels found: <strong>{lm.fraud_rows}</strong> fraud rows · precision <strong>{lm.precision ?? "—"}</strong> · recall <strong>{lm.recall ?? "—"}</strong> ·
          {" "}{lm.true_positives} caught, {lm.false_positives} false alarms (first-stage screening, before AI investigation)
        </p>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{showAll ? "All transactions" : "Flagged for investigation"} ({rows.length})</h3>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show all rows</label>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-slate-200 p-4 text-sm text-slate-600">No transactions crossed the screening threshold. Tick "Show all rows" to open any transaction anyway.</p>
      ) : (
        <div className="max-h-[45vh] overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <caption className="sr-only">Screening results for the uploaded batch</caption>
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-2 py-1.5">Transaction</th><th>Customer</th><th className="text-right">Amount</th><th className="px-2">Risk</th><th>Reasons</th><th>Case</th><th className="px-2" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.transaction_id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-mono text-xs">{r.transaction_id}<div className="text-slate-500">{dateTime(r.timestamp)} · {r.channel.toUpperCase()} → {r.counterparty_id}</div></td>
                  <td className="font-mono text-xs">{r.customer_id}</td>
                  <td className="whitespace-nowrap text-right font-semibold">{formatINR(r.amount_rupees)}</td>
                  <td className="px-2"><RiskBar value={r.risk_score} /></td>
                  <td className="max-w-xs"><div className="flex flex-wrap gap-1">{r.reason_codes.slice(0, 3).map((c) => <Chip key={c}>{humanize(c)}</Chip>)}{r.reason_codes.length > 3 && <Chip>+{r.reason_codes.length - 3}</Chip>}</div></td>
                  <td className="whitespace-nowrap">{r.tier ? <TierBadge tier={r.tier} /> : <span className="text-xs text-slate-500">{r.case_status ? humanize(r.case_status) : "—"}</span>}</td>
                  <td className="whitespace-nowrap px-2">
                    <button type="button" onClick={() => open.mutate(r)} disabled={open.isPending}
                      className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
                      {r.case_id ? "Open case" : "Investigate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.truncated && <p className="text-xs text-slate-600">Showing the 500 highest-risk rows; export to see all.</p>}
      {open.error && <p role="alert" className="text-sm text-red-700">{(open.error as Error).message}</p>}
      <p className="text-xs text-slate-600">Investigations of uploaded rows use the same agents, tools, Gemini synthesis and policy engine as the live queue, isolated to this upload.</p>
    </div>
  );
}

function SinglePanel({ batch, setBatch, onDone }: { batch: BatchView | null; setBatch: (b: BatchView | null) => void; onDone: () => void }) {
  const [f, setF] = useState({
    customer_id: "CUST-000123", account_id: "ACC-000123", timestamp: "2026-09-29T14:05", amount_rupees: "45000",
    channel: "imps", counterparty_id: "RCP-NEW-0001", device_id: "DEV-NEW-0001",
  });
  const submit = useMutation({
    mutationFn: () => {
      const row = { ...f, transaction_id: `TXN-MANUAL-${Date.now().toString(36).toUpperCase()}`, timestamp: `${f.timestamp}:00` };
      return api.uploadBatch(JSON.stringify({ transactions: [row] }), "json", "single-transaction.json");
    },
    onSuccess: (b) => { saveRecent(b); setBatch(b); },
  });
  if (batch && batch.filename === "single-transaction.json") return <BatchResults batch={{ ...batch }} onBack={() => setBatch(null)} onDone={onDone} />;
  const field = (k: keyof typeof f, label: string, extra: Record<string, string> = {}) => (
    <label className="text-sm">{label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required {...extra}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm" />
    </label>
  );
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
      <p className="text-sm text-slate-600">Score one transaction against the customer's history, then investigate it. Use an existing ID (e.g. CUST-000123 / ACC-000123) or a new one.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("customer_id", "Customer ID")}
        {field("account_id", "Account ID")}
        {field("amount_rupees", "Amount (₹)", { inputMode: "decimal" })}
        <label className="text-sm">Channel
          <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
            {["upi", "card", "netbanking", "imps"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
        </label>
        {field("timestamp", "Date & time", { type: "datetime-local" })}
        {field("counterparty_id", "Counterparty (MER-/RCP-)")}
        {field("device_id", "Device ID")}
      </div>
      <button type="submit" disabled={submit.isPending} className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
        <Send className="h-4 w-4" aria-hidden />{submit.isPending ? "Scoring…" : "Score transaction"}
      </button>
      <ErrorReport error={submit.error} />
    </form>
  );
}
