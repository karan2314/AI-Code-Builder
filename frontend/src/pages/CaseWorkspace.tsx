import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpCircle, Bot, CheckCircle2, Clock, Cpu, Download, PhoneCall, Play, UserRound, Wrench, XCircle } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import NetworkGraph from "../components/NetworkGraph";
import { AutonomyBadge, Card, Chip, ErrorBox, Loading, PriorityBadge, RiskBar, SlaChip, TierBadge } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, formatINR, formatNum, humanize, pct, slaText } from "../lib/format";
import type { Case, Tier } from "../types";

const RUNNING = new Set(["investigating"]);

const EVIDENCE_EVENT = "fraudlens:show-evidence";

function scrollToEvidence(id: string) {
  const el = document.getElementById(`ev-${id}`);
  if (!el) {
    window.dispatchEvent(new CustomEvent(EVIDENCE_EVENT, { detail: id }));
    return;
  }
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

function Limitations({ c }: { c: Case }) {
  const items = [...(c.decision?.limitations ?? [])];
  if (c.dropped_findings > 0) items.unshift(`${c.dropped_findings} AI finding(s) removed for citing evidence that does not exist.`);
  if (!items.length) return null;
  return (
    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
      <h3 className="text-xs font-semibold uppercase text-amber-900">Assumptions & limitations</h3>
      <ul className="mt-1 text-sm text-amber-950">{items.map((x, i) => <li key={i}>• {x}</li>)}</ul>
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
        <Limitations c={c} />
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
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div><h3 className="text-xs font-semibold uppercase text-slate-500">Conflicting evidence</h3><ul className="text-sm">{s.conflicting_evidence.length ? s.conflicting_evidence.map((x, i) => <li key={i}>• {x}</li>) : <li className="text-slate-500">None reported</li>}</ul></div>
        <div><h3 className="text-xs font-semibold uppercase text-slate-500">Missing evidence</h3><ul className="text-sm">{s.missing_evidence.length ? s.missing_evidence.map((x, i) => <li key={i}>• {x}</li>) : <li className="text-slate-500">None reported</li>}</ul></div>
        <div><h3 className="text-xs font-semibold uppercase text-slate-500">Next questions</h3><ul className="text-sm">{s.next_questions.map((x, i) => <li key={i}>• {x}</li>)}</ul></div>
      </div>
      <Limitations c={c} />
    </Card>
  );
}

function EvidenceList({ c }: { c: Case }) {
  const evidence = c.evidence;
  // Which agent produced each evidence item (from the recorded trajectory)
  const producer = new Map<string, string>();
  c.trajectory.forEach((t) => t.evidence_ids.forEach((id) => producer.set(id, t.agent)));
  return (
    <Card title={`Evidence (${evidence.length}) · tool-verified`}>
      {evidence.length === 0 ? <p className="text-sm text-slate-500">No evidence collected yet.</p> : (
        <ul className="space-y-2">
          {evidence.map((e) => (
            <li key={e.id} id={`ev-${e.id}`} tabIndex={-1} className="rounded border border-slate-100 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs font-semibold">{e.id}</span>
                {producer.get(e.id) && <span className="text-xs font-semibold text-violet-800">{humanize(producer.get(e.id)!)}</span>}
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
  // Mirrors backend analyst_final_tier: approve keeps the policy tier, modify sets one, close = Tier 1 (dismiss).
  const modifyOverride = tier !== d.tier;
  const closeOverride = d.tier !== 1;
  const needReason = !reason.trim();
  const a = c.analyst_action;
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
          <div className="mt-1 text-sm">
            <p><CheckCircle2 className="inline h-4 w-4 text-teal-700" aria-hidden /> {humanize(c.status)} by {String(a?.actor)}{a?.reason ? `: “${String(a.reason)}”` : ""}</p>
            {a?.override === true && <p className="mt-1"><Chip tone="amber">Override</Chip> analyst chose Tier {String(a.final_tier)} vs policy Tier {String(a.policy_tier)}; reason logged in the audit trail.</p>}
            {typeof a?.agrees_with_ai === "boolean" && <p className="mt-1 text-xs text-slate-600">Analyst {a.agrees_with_ai ? "agreed" : "disagreed"} with Gemini's advisory Tier {String(a.ai_tier)}.</p>}
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <label className="block text-sm">Reason / note <span className="text-xs text-slate-500">(required to override the policy tier)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded border border-slate-300 p-1.5 text-sm" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={() => onAction("approve", undefined, reason)} className="rounded bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Approve tier</button>
              <label className="text-sm">Change to
                <select value={tier} onChange={(e) => setTier(Number(e.target.value) as Tier)} className="ml-1 rounded border border-slate-300 px-1 py-1">
                  <option value={1}>Tier 1</option><option value={2}>Tier 2</option><option value={3}>Tier 3</option>
                </select>
              </label>
              <button type="button" disabled={pending || needReason} onClick={() => onAction("modify", tier, reason)} className="rounded border border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50" title="A reason is required">Modify</button>
              <button type="button" disabled={pending || (closeOverride && needReason)} onClick={() => onAction("close", undefined, reason)} className="inline-flex items-center gap-1 rounded border border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50" title={closeOverride ? "Closing a Tier 2/3 case overrides the policy: a reason is required" : undefined}><XCircle className="h-4 w-4" aria-hidden />Close</button>
            </div>
            {needReason && (modifyOverride || closeOverride) && (
              <p className="text-xs text-slate-600" aria-live="polite">
                {closeOverride ? "Closing this case or changing its tier overrides the policy and needs a reason." : "Changing the tier overrides the policy and needs a reason."}
              </p>
            )}
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
            {a.event_type.startsWith("analyst_") && (
              <span className="text-slate-700">
                {a.details.override === true && <Chip tone="amber">override</Chip>}
                {a.details.reason ? ` “${String(a.details.reason)}”` : ""}
              </span>
            )}
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
  const [tab, setTab] = useState<"investigation" | "evidence" | "network" | "audit">("investigation");
  const analysts = useQuery({ queryKey: ["analysts"], queryFn: api.analysts, staleTime: Infinity });
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

  const assign = useMutation({
    mutationFn: (who: string | null) => api.assign(caseId, who),
    onSuccess: (data) => qc.setQueryData(["case", caseId], data),
  });
  const quick = useMutation({
    mutationFn: (a: "request_customer_verification" | "escalate") => api.quickAction(caseId, a),
    onSuccess: (data) => qc.setQueryData(["case", caseId], data),
  });

  // Evidence chips outside the evidence tab switch to it, then scroll to the cited item.
  const [pendingEv, setPendingEv] = useState<string | null>(null);
  useEffect(() => {
    const onEv = (e: Event) => { setTab("evidence"); setPendingEv((e as CustomEvent<string>).detail); };
    window.addEventListener(EVIDENCE_EVENT, onEv);
    return () => window.removeEventListener(EVIDENCE_EVENT, onEv);
  }, []);
  useEffect(() => {
    if (tab === "evidence" && pendingEv) { scrollToEvidence(pendingEv); setPendingEv(null); }
  }, [tab, pendingEv]);

  if (q.isLoading) return <Loading label="Loading case…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  const t = c.transaction;
  const running = RUNNING.has(c.status) || run.isPending;
  const investigated = !!c.decision && !running;
  const band = riskBand(c.ml.risk_score);
  const TABS = [
    { k: "investigation", label: "Investigation" },
    { k: "evidence", label: `Evidence & timeline (${c.evidence.length})` },
    { k: "network", label: "Network graph" },
    { k: "audit", label: `Audit log (${c.audit.length})` },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500"><Link to="/cases" className="underline">Cases</Link> / Case details</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {c.priority && <PriorityBadge p={c.priority} size="lg" />}
            <h1 className="text-2xl font-bold">CASE <span className="font-mono">{c.case_id.replace("CASE-", "#")}</span></h1>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${band.cls}`}>{band.label}</span>
            <Chip>{humanize(c.status)}</Chip>
          </div>
          <p className="mt-1 text-xl font-bold">{formatINR(Number(t.amount_paise) / 100)} <span className="text-base font-normal text-slate-600">{String(t.channel).toUpperCase()} to <span className="font-mono">{String(t.counterparty_id)}</span></span></p>
          <p className="text-sm text-slate-600">
            <span className="font-mono">{c.transaction_id}</span> · <Link className="font-mono underline" to={`/customers/${c.customer_id}`}>{c.customer_id}</Link> · device <span className="font-mono">{String(t.device_id)}</span> · {dateTime(String(t.timestamp))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>First-stage risk</span><RiskBar value={c.ml.risk_score} />
            {c.ml.reason_codes.map((r) => <Chip key={r} tone="red">{humanize(r)}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a href={`/api/cases/${c.case_id}/export`} download={`${c.case_id}.json`} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100">
              <Download className="h-4 w-4" aria-hidden />Export report
            </a>
            {c.sla && (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs">
                <div className="flex items-center gap-1 text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden />SLA</div>
                <SlaChip sla={c.sla} text={slaText(c.sla)} />
              </div>
            )}
            <label className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1 text-slate-500"><UserRound className="h-3.5 w-3.5" aria-hidden />Assignee</span>
              <select value={c.assignee ?? ""} disabled={assign.isPending} onChange={(e) => assign.mutate(e.target.value || null)} className="mt-0.5 bg-transparent text-sm font-medium">
                <option value="">Unassigned</option>
                {analysts.data?.items.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2"><TierBadge tier={c.decision?.tier} size="lg" /></div>
          <AutonomyBadge level={c.decision?.autonomy_level} ceiling={c.decision?.autonomy_ceiling} />
        </div>
      </div>

      {(run.error || act.error || assign.error || quick.error) && <ErrorBox error={run.error || act.error || assign.error || quick.error} />}
      {running && <Progress c={c} />}

      <div role="tablist" aria-label="Case sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ k, label }) => (
          <button key={k} role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-teal-700 text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "investigation" && (
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <SummaryPanel c={c} />
              <DecisionPanel c={c} pending={act.isPending} onAction={(action, tier, reason) => act.mutate({ action, tier, reason })} />
            </div>
            <div className="space-y-4">
              <Card title="Quick actions">
                <div className="space-y-2">
                  <button type="button" onClick={() => run.mutate(false)} disabled={running} className="flex w-full items-center justify-center gap-1 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
                    <Play className="h-4 w-4" aria-hidden />{running ? "Investigating…" : c.decision ? "Re-run investigation" : "Open investigation"}
                  </button>
                  <button type="button" onClick={() => quick.mutate("request_customer_verification")} disabled={!investigated || quick.isPending} className="flex w-full items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50">
                    <PhoneCall className="h-4 w-4" aria-hidden />Request customer verification
                  </button>
                  <button type="button" onClick={() => quick.mutate("escalate")} disabled={!investigated || quick.isPending} className="flex w-full items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50">
                    <ArrowUpCircle className="h-4 w-4" aria-hidden />Escalate
                  </button>
                  <p className="text-[11px] text-slate-500">{investigated ? "Verification and escalation are SIMULATED and logged in the audit trail." : "Available after the investigation."}</p>
                </div>
              </Card>
              <CaseDetails c={c} />
              <FamilySummary c={c} />
              <FraudIndicators c={c} />
            </div>
          </div>
        )}
        {tab === "evidence" && (
          <div className="grid gap-4 lg:grid-cols-2"><EvidenceList c={c} /><Timeline c={c} /></div>
        )}
        {tab === "network" && (
          <Card title="Fraud network"><NetworkGraph entityId={String(t.counterparty_id)} transactionId={c.transaction_id} /></Card>
        )}
        {tab === "audit" && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><AuditTrail c={c} /></div>
            <Card title="Versions"><dl className="grid grid-cols-2 gap-1 text-xs">{Object.entries(c.versions).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="font-mono">{v}</dd></Fragment>)}</dl></Card>
          </div>
        )}
      </div>
    </div>
  );
}

function riskBand(score: number) {
  if (score >= 0.85) return { label: "High risk", cls: "border-red-300 bg-red-50 text-red-800" };
  if (score >= 0.6) return { label: "Medium risk", cls: "border-amber-300 bg-amber-50 text-amber-900" };
  return { label: "Low risk", cls: "border-sky-300 bg-sky-50 text-sky-900" };
}

function CaseDetails({ c }: { c: Case }) {
  const p = useQuery({ queryKey: ["customer", c.customer_id], queryFn: () => api.customerProfile(c.customer_id), staleTime: 60_000 });
  const t = c.transaction;
  const rows: [string, ReactNode][] = [
    ["Case ID", <span className="font-mono">{c.case_id}</span>],
    ["Customer ID", <Link to={`/customers/${c.customer_id}`} className="font-mono underline">{c.customer_id}</Link>],
    ["Segment", p.data ? humanize(String(p.data.profile.segment)) : "…"],
    ["Account age", p.data ? `${formatNum(Number(p.data.profile.account_age_days))} days` : "…"],
    ["Usual median", p.data ? formatINR(p.data.baseline.median_rupees) : "…"],
    ["Device", <span className="font-mono">{String(t.device_id)}</span>],
    ["Channel", String(t.channel).toUpperCase()],
    ["Risk tier", <TierBadge tier={c.decision?.tier} />],
  ];
  return (
    <Card title="Case details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></Fragment>)}
      </dl>
    </Card>
  );
}

const FAMILY_LABEL: Record<string, string> = { behavior: "Customer behaviour", velocity: "Transaction velocity", device: "Device", network: "Network link" };

function FamilySummary({ c }: { c: Case }) {
  if (!c.decision) return null;
  const crit = new Set(c.decision.critical_families);
  const status = (fam: string) => {
    const ev = c.evidence.filter((e) => e.indicator_family === fam);
    if (crit.has(fam)) return { text: fam === "network" ? "High risk" : "Suspicious", tone: "red" as const };
    if (!ev.length) return { text: "Not checked", tone: "slate" as const };
    if (ev.every((e) => e.status === "unavailable")) return { text: "Unavailable", tone: "amber" as const };
    if (ev.some((e) => e.status === "stale")) return { text: "Stale link", tone: "amber" as const };
    return { text: "Normal", tone: "teal" as const };
  };
  return (
    <Card title="Investigation summary">
      <dl className="space-y-1.5 text-sm">
        {Object.keys(FAMILY_LABEL).map((f) => {
          const s = status(f);
          return <div key={f} className="flex items-center justify-between"><dt>{FAMILY_LABEL[f]}</dt><dd><Chip tone={s.tone}>{s.text}</Chip></dd></div>;
        })}
        <div className="flex items-center justify-between border-t border-slate-100 pt-1.5"><dt className="font-semibold">Overall risk</dt><dd><TierBadge tier={c.decision.tier} /></dd></div>
      </dl>
    </Card>
  );
}

function FraudIndicators({ c }: { c: Case }) {
  const codes = useQuery({ queryKey: ["reason-codes"], queryFn: api.reasonCodes, staleTime: Infinity });
  if (!c.ml.reason_codes.length) return null;
  return (
    <Card title="Fraud indicators">
      <ul className="space-y-1.5 text-sm">
        {c.ml.reason_codes.map((r) => (
          <li key={r} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden /><span><span className="font-medium">{humanize(r)}</span>{codes.data?.[r] && <span className="block text-xs text-slate-600">{codes.data[r]}</span>}</span></li>
        ))}
      </ul>
    </Card>
  );
}
