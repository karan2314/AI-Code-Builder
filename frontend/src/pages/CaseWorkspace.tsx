import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, CheckCircle2, Cpu, Download, Play, Wrench, XCircle } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import NetworkGraph from "../components/NetworkGraph";
import { Card, Chip, ErrorBox, Loading, RiskBar, TierBadge } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, formatINR, humanize, pct } from "../lib/format";
import type { Case, Evidence, Tier } from "../types";

const RUNNING = new Set(["investigating"]);

function scrollToEvidence(id: string) {
  const el = document.getElementById(`ev-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("evidence-highlight");
  void el.offsetWidth;
  el.classList.add("evidence-highlight");
  el.focus({ preventScroll: true });
}

function EvidenceChip({ id }: { id: string }) {
  return (
    <button type="button" onClick={() => scrollToEvidence(id)} className="rounded bg-teal-50 px-1 font-mono text-[11px] text-teal-800 underline decoration-dotted hover:bg-teal-100">
      [{id}]
    </button>
  );
}

function Progress({ c }: { c: Case }) {
  const steps = c.progress.filter((p) => !p.startsWith("tool:") || p.endsWith(":ok") || p.endsWith(":error") || p.endsWith(":blocked"));
  return (
    <div role="status" aria-live="polite" className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
      <p className="font-semibold">Investigation running…</p>
      <ol className="mt-1 max-h-40 list-decimal overflow-auto pl-5 text-xs">
        {steps.slice(-12).map((p, i) => <li key={i}>{humanize(p.replace(/:/g, " · "))}</li>)}
      </ol>
    </div>
  );
}

function SummaryPanel({ c }: { c: Case }) {
  const s = c.summary;
  if (!s) {
    return (
      <Card title={<span className="flex items-center gap-1"><Bot className="h-4 w-4" aria-hidden /> AI investigation summary</span>}>
        <p className="text-sm text-slate-600">
          {c.status === "open" ? "Run the investigation to generate an evidence-linked summary." :
            "AI investigation unavailable: the ML/rules score and the deterministic evidence are preserved and the case is routed to manual review."}
        </p>
        {c.ai_error && <p className="mt-2 text-xs text-slate-500">Reason: {c.ai_error}</p>}
      </Card>
    );
  }
  return (
    <Card title={<span className="flex items-center gap-1"><Bot className="h-4 w-4" aria-hidden /> AI investigation summary (Gemini)</span>}
          actions={<span className="text-xs text-slate-500">confidence: <strong>{s.confidence}</strong> · validity {pct(c.evidence_validity_rate, 0)}</span>}>
      <p className="text-lg font-semibold">{s.headline}</p>
      <p className="mt-1 text-sm text-slate-600">Pattern: <Chip tone="red">{humanize(s.pattern)}</Chip> · Gemini recommends <TierBadge tier={s.recommended_tier} /> (advisory)</p>
      <ul className="mt-3 space-y-2">
        {s.findings.map((f, i) => (
          <li key={i} className="rounded border border-slate-100 p-2 text-sm">
            <div className="flex flex-wrap items-center gap-1">
              <Chip tone={f.kind === "observed_fact" ? "sky" : "amber"}>{f.kind === "observed_fact" ? "Observed fact" : "Interpretation"}</Chip>
              <Chip tone={f.severity === "critical" || f.severity === "high" ? "red" : "slate"}>{f.severity}</Chip>
            </div>
            <p className="mt-1">{f.statement} {f.evidence_ids.map((id) => <EvidenceChip key={id} id={id} />)}</p>
          </li>
        ))}
      </ul>
      {c.dropped_findings > 0 && <p className="mt-2 text-xs text-amber-800">{c.dropped_findings} finding(s) removed because they cited evidence that does not exist.</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div><h3 className="text-xs font-semibold uppercase text-slate-500">Conflicting evidence</h3><ul className="text-sm">{s.conflicting_evidence.length ? s.conflicting_evidence.map((x, i) => <li key={i}>• {x}</li>) : <li className="text-slate-500">None reported</li>}</ul></div>
        <div><h3 className="text-xs font-semibold uppercase text-slate-500">Missing evidence</h3><ul className="text-sm">{s.missing_evidence.length ? s.missing_evidence.map((x, i) => <li key={i}>• {x}</li>) : <li className="text-slate-500">None reported</li>}</ul></div>
        <div><h3 className="text-xs font-semibold uppercase text-slate-500">Next questions</h3><ul className="text-sm">{s.next_questions.map((x, i) => <li key={i}>• {x}</li>)}</ul></div>
      </div>
    </Card>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <Card title={`Evidence (${evidence.length}) · tool-verified`}>
      {evidence.length === 0 ? <p className="text-sm text-slate-500">No evidence collected yet.</p> : (
        <ul className="space-y-2">
          {evidence.map((e) => (
            <li key={e.id} id={`ev-${e.id}`} tabIndex={-1} className="rounded border border-slate-100 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs font-semibold">{e.id}</span>
                <Chip>{e.indicator_family}</Chip>
                <Chip tone="sky">{e.source_tool}</Chip>
                {e.status !== "ok" && <Chip tone="amber">{e.status}</Chip>}
              </div>
              <p className="mt-1">{e.summary}</p>
              <details className="mt-1 text-xs text-slate-600">
                <summary className="cursor-pointer">Values</summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify({ observed: e.observed, baseline: e.baseline }, null, 1)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Timeline({ c }: { c: Case }) {
  return (
    <Card title="Investigation timeline · agent & tool calls" actions={<Chip tone={c.investigation_mode === "agentic" ? "teal" : "amber"}>{humanize(c.investigation_mode)}</Chip>}>
      {c.trajectory.length === 0 ? <p className="text-sm text-slate-500">No calls yet.</p> : (
        <ol className="relative space-y-2 border-l-2 border-slate-200 pl-4">
          {c.trajectory.map((t) => (
            <li key={t.step} className="text-sm">
              <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-teal-600" aria-hidden />
              <div className="flex flex-wrap items-center gap-1">
                {t.agent.includes("agent") ? <Cpu className="h-3.5 w-3.5 text-violet-700" aria-hidden /> : <Wrench className="h-3.5 w-3.5 text-slate-600" aria-hidden />}
                <span className="font-semibold">{humanize(t.agent)}</span> → <span className="font-mono text-xs">{t.tool}</span>
                <Chip tone={t.status === "ok" ? "teal" : "red"}>{t.status}</Chip>
                <span className="text-xs text-slate-500">{t.latency_ms} ms</span>
              </div>
              {t.evidence_ids.length > 0 && <div className="text-xs">produced {t.evidence_ids.map((id) => <EvidenceChip key={id} id={id} />)}</div>}
            </li>
          ))}
        </ol>
      )}
      {typeof c.usage?.total_latency_ms === "number" && (
        <p className="mt-2 text-xs text-slate-500">
          Total investigation time: {(c.usage.total_latency_ms as number) < 1000
            ? `${Math.round(c.usage.total_latency_ms as number)} ms`
            : `${((c.usage.total_latency_ms as number) / 1000).toFixed(1)} s`}
        </p>
      )}
    </Card>
  );
}

function DecisionPanel({ c, onAction, pending }: { c: Case; onAction: (a: "approve" | "modify" | "close", tier?: Tier, reason?: string) => void; pending: boolean }) {
  const [tier, setTier] = useState<Tier>(2);
  const [reason, setReason] = useState("");
  const d = c.decision;
  if (!d) return null;
  const done = ["approved", "modified", "closed"].includes(c.status);
  return (
    <Card title="Policy decision & response">
      <div className="flex flex-wrap items-center gap-2"><TierBadge tier={d.tier} size="lg" /><span className="text-xs text-slate-500">policy {d.policy_version}</span></div>
      {d.disagreement && <p className="mt-2 flex items-center gap-1 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" aria-hidden /> Gemini recommended Tier {d.llm_recommended_tier}; the deterministic policy decides.</p>}
      <LayaPanel c={c} />
      <h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Rule hits</h3>
      <ul className="text-sm">{d.rule_hits.map((r) => <li key={r} className="font-mono text-xs">{r}</li>)}</ul>
      <p className="mt-2 text-sm">Critical indicator families: {d.critical_families.map((f) => <Chip key={f} tone="red">{f}</Chip>)}</p>
      {d.flags.length > 0 && <p className="mt-1 text-sm">Flags: {d.flags.map((f) => <Chip key={f} tone="amber">{f}</Chip>)}</p>}
      {d.requires_review && <p className="mt-1 text-sm text-amber-800">Analyst review required.</p>}
      <h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Simulated response</h3>
      <ul className="space-y-1">
        {c.simulated_actions.map((a, i) => (
          <li key={i} className="rounded border border-dashed border-red-300 bg-red-50 px-2 py-1 text-sm text-red-900">
            <strong>SIMULATED</strong> · {humanize(a.action)} <span className="text-xs">— no real account was affected</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Analyst action</h3>
        {done ? (
          <p className="mt-1 text-sm"><CheckCircle2 className="inline h-4 w-4 text-teal-700" aria-hidden /> {humanize(c.status)} by {String(c.analyst_action?.actor)}{c.analyst_action?.reason ? `: “${String(c.analyst_action.reason)}”` : ""}</p>
        ) : (
          <div className="mt-2 space-y-2">
            <label className="block text-sm">Reason / note
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded border border-slate-300 p-1.5 text-sm" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={() => onAction("approve", undefined, reason)} className="rounded bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Approve tier</button>
              <label className="text-sm">Change to
                <select value={tier} onChange={(e) => setTier(Number(e.target.value) as Tier)} className="ml-1 rounded border border-slate-300 px-1 py-1">
                  <option value={1}>Tier 1</option><option value={2}>Tier 2</option><option value={3}>Tier 3</option>
                </select>
              </label>
              <button type="button" disabled={pending || !reason.trim()} onClick={() => onAction("modify", tier, reason)} className="rounded border border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50" title="A reason is required">Modify</button>
              <button type="button" disabled={pending} onClick={() => onAction("close", undefined, reason)} className="inline-flex items-center gap-1 rounded border border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"><XCircle className="h-4 w-4" aria-hidden />Close</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function LayaPanel({ c }: { c: Case }) {
  const ev = c.evidence.find((e) => e.source_tool === "get_laya_decision");
  if (!ev) return null;
  const o = ev.observed as Record<string, number | string | null>;
  const num = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : "n/a");
  return (
    <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-2 text-sm">
      <h3 className="text-xs font-semibold uppercase text-violet-900">Laya triage · open decision model (advisory)</h3>
      {ev.status !== "ok" ? (
        <p className="text-slate-700">Unavailable; the investigation continued without it.</p>
      ) : (
        <>
          <p>
            Route <strong>{String(o.route)}</strong> (confidence {num(o.route_confidence)}) · P(account takeover) {num(o.p_account_takeover)} ·
            P(mule payment) {num(o.p_mule_payment)} <EvidenceChip id={ev.id} />
          </p>
          {c.decision?.laya_disagreement && (
            <p className="mt-1 text-amber-900">Laya disagrees with the policy tier; shown for analyst review only.</p>
          )}
        </>
      )}
    </div>
  );
}

function AuditTrail({ c }: { c: Case }) {
  return (
    <Card title="Audit trail (append-only)">
      <ol className="max-h-72 space-y-1 overflow-auto text-xs">
        {c.audit.map((a) => (
          <li key={a.event_id} className="flex gap-2 border-b border-slate-100 py-1">
            <span className="whitespace-nowrap text-slate-500">{new Date(a.timestamp).toLocaleTimeString("en-IN")}</span>
            <span className="font-semibold">{humanize(a.event_type)}</span>
            <span className="text-slate-600">{a.actor}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function CaseWorkspace() {
  const { caseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"evidence" | "network">("evidence");
  const [polling, setPolling] = useState(false);
  const q = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => api.caseById(caseId),
    refetchInterval: (query) => (polling || (query.state.data && RUNNING.has(query.state.data.status)) ? 1000 : false),
  });
  // The investigate call returns when the investigation finishes; we poll the case meanwhile for live progress.
  const run = useMutation({
    mutationFn: (cached: boolean) => api.investigate(caseId, cached),
    onMutate: () => setPolling(true),
    onSettled: () => setPolling(false),
    onSuccess: (data) => qc.setQueryData(["case", caseId], data),
  });
  const autoRun = useRef(false);
  useEffect(() => {
    if (params.get("autorun") && q.data?.status === "open" && !autoRun.current) {
      autoRun.current = true;
      setParams({}, { replace: true });
      run.mutate(true);
    }
  }, [params, q.data?.status, run, setParams]);
  const act = useMutation({
    mutationFn: (v: { action: "approve" | "modify" | "close"; tier?: Tier; reason?: string }) => api.action(caseId, { action: v.action, tier: v.tier, reason: v.reason ?? "" }),
    onSuccess: (data) => qc.setQueryData(["case", caseId], data),
  });

  if (q.isLoading) return <Loading label="Loading case…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  const t = c.transaction;
  const running = RUNNING.has(c.status) || run.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500"><Link to="/queue" className="underline">Queue</Link> / {c.case_id}</p>
          <h1 className="text-2xl font-bold">{formatINR(Number(t.amount_paise) / 100)} <span className="text-base font-normal text-slate-600">{String(t.channel).toUpperCase()} to <span className="font-mono">{String(t.counterparty_id)}</span></span></h1>
          <p className="text-sm text-slate-600">
            <span className="font-mono">{c.transaction_id}</span> · <Link className="font-mono underline" to={`/customers/${c.customer_id}`}>{c.customer_id}</Link> · device <span className="font-mono">{String(t.device_id)}</span> · {dateTime(String(t.timestamp))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>First-stage risk</span><RiskBar value={c.ml.risk_score} />
            {c.ml.reason_codes.map((r) => <Chip key={r}>{humanize(r)}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2"><Chip>{humanize(c.status)}</Chip><TierBadge tier={c.decision?.tier} size="lg" /></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => run.mutate(false)} disabled={running} className="inline-flex items-center gap-1 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
              <Play className="h-4 w-4" aria-hidden />{running ? "Investigating…" : c.decision ? "Re-run investigation" : "Run AI investigation"}
            </button>
            <a href={`/api/cases/${c.case_id}/export`} download={`${c.case_id}.json`} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">
              <Download className="h-4 w-4" aria-hidden />Export
            </a>
          </div>
        </div>
      </div>

      {(run.error || act.error) && <ErrorBox error={run.error || act.error} />}
      {running && <Progress c={c} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SummaryPanel c={c} />
          <div role="tablist" aria-label="Case details" className="flex gap-1">
            {(["evidence", "network"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                      className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
                {k === "evidence" ? "Evidence & timeline" : "Network graph"}
              </button>
            ))}
          </div>
          {tab === "evidence" ? (
            <div className="grid gap-4 md:grid-cols-2"><EvidenceList evidence={c.evidence} /><Timeline c={c} /></div>
          ) : (
            <Card title="Fraud network"><NetworkGraph entityId={String(t.counterparty_id)} transactionId={c.transaction_id} /></Card>
          )}
        </div>
        <div className="space-y-4">
          <DecisionPanel c={c} pending={act.isPending} onAction={(action, tier, reason) => act.mutate({ action, tier, reason })} />
          <AuditTrail c={c} />
          <Card title="Versions"><dl className="grid grid-cols-2 gap-1 text-xs">{Object.entries(c.versions).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="font-mono">{v}</dd></Fragment>)}</dl></Card>
        </div>
      </div>
    </div>
  );
}
