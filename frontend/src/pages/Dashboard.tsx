import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Download, Fingerprint, IndianRupee, Inbox, Link2, ShieldAlert, Users, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { NextAlertButton } from "../App";
import { Card, Chip, Delta, ErrorBox, Loading, PriorityBadge, SlaChip } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, formatINR, formatINRCompact, formatNum, humanize, maskId, pct, slaText } from "../lib/format";
import type { Insight, Priority, QueueItem } from "../types";

const PRIO_COLOR: Record<Priority, string> = { P1: "#dc2626", P2: "#f59e0b", P3: "#0284c7" };
const PRIO_LABEL: Record<Priority, string> = { P1: "High", P2: "Medium", P3: "Low" };
const INSIGHT_ICON: Record<string, typeof Zap> = { shared_device: Fingerprint, fraud_link: Link2, velocity: Zap, new_payee_high_value: Users };

function Kpi({ icon, label, value, children, tone = "slate" }: { icon: ReactNode; label: string; value: ReactNode; children?: ReactNode; tone?: "red" | "amber" | "slate" | "teal" }) {
  const ring = { red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-700", teal: "bg-teal-50 text-teal-700" }[tone];
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ring}`} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 text-2xl font-bold text-slate-900">{value}</div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function PriorityQueue({ items }: { items: QueueItem[] }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | Priority>("all");
  const [filter, setFilter] = useState("");
  const counts = useMemo(() => ({ all: items.length, P1: items.filter((i) => i.priority === "P1").length, P2: items.filter((i) => i.priority === "P2").length, P3: items.filter((i) => i.priority === "P3").length }), [items]);
  const rows = items
    .filter((i) => (tab === "all" || i.priority === tab) && (!filter || `${i.transaction_id} ${i.customer_id}`.toLowerCase().includes(filter.toLowerCase())))
    .slice(0, 8);
  const open = async (i: QueueItem) => navigate(`/cases/${i.case_id ?? (await api.createCase(i.transaction_id)).case_id}`);
  return (
    <Card title="Priority review queue" actions={<Link to="/queue" className="text-sm text-teal-700 underline">View all</Link>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Filter by priority" className="flex gap-1">
          {(["all", "P1", "P2", "P3"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {k === "all" ? "All" : PRIO_LABEL[k]} ({counts[k]})
            </button>
          ))}
        </div>
        <label className="text-xs"><span className="sr-only">Filter by customer or transaction</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter customer or transaction…" className="rounded border border-slate-300 px-2 py-1 text-xs" />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Highest priority alerts. Press Enter on a row to open the case.</caption>
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-1.5">Risk</th><th>Transaction</th><th>Customer</th><th className="text-right">Amount</th><th className="pl-3">Signals</th><th>SLA</th><th>Assigned</th></tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.transaction_id} tabIndex={0} onClick={() => void open(i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void open(i); } }}
                  aria-label={`Open ${i.transaction_id}, priority ${i.priority}, ${formatINR(i.amount_rupees)}`}
                  className="cursor-pointer border-t border-slate-100 hover:bg-teal-50 focus:bg-teal-50">
                <td className="py-2"><PriorityBadge p={i.priority} /></td>
                <td className="font-mono text-xs">{i.transaction_id}<div className="font-sans text-[11px] text-slate-500">{dateTime(i.timestamp)}</div></td>
                <td className="font-mono text-xs">{maskId(i.customer_id)}</td>
                <td className="whitespace-nowrap text-right font-semibold">{formatINR(i.amount_rupees)}</td>
                <td className="max-w-[16rem] pl-3"><div className="flex flex-wrap gap-1">{i.reason_codes.slice(0, 2).map((r) => <Chip key={r}>{humanize(r)}</Chip>)}{i.reason_codes.length > 2 && <Chip>+{i.reason_codes.length - 2}</Chip>}</div></td>
                <td><SlaChip sla={i.sla} text={slaText(i.sla)} /></td>
                <td className="whitespace-nowrap text-xs">{i.assignee ?? <span className="text-slate-500">Unassigned</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-sm text-slate-500">No alerts match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ModelPerformance() {
  const m = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  const [tab, setTab] = useState<"detection" | "investigation">("detection");
  const b = m.data?.detection?.variants?.B_ml_blend;
  const ag = m.data?.agentic as { sample?: { tier_vs_label_agreement?: number }; evidence_validity_rate_mean?: number; investigation_latency_ms?: { p50?: number } } | null | undefined;
  const cell = (label: string, value: string) => (
    <div className="rounded-md bg-slate-50 p-2 text-center"><div className="text-[11px] text-slate-500">{label}</div><div className="text-lg font-bold">{value}</div></div>
  );
  return (
    <Card title="Model performance" actions={<Link to="/metrics" className="text-sm text-teal-700 underline">View details</Link>}>
      <div role="tablist" aria-label="Model performance view" className="mb-3 flex gap-1">
        {(["detection", "investigation"] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === k ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700"}`}>{humanize(k)}</button>
        ))}
      </div>
      {tab === "detection" ? (
        b ? <div className="grid grid-cols-3 gap-2">{cell("Precision", pct(b.precision))}{cell("Recall", pct(b.recall))}{cell("PR-AUC", b.pr_auc.toFixed(3))}</div>
          : <p className="text-sm text-slate-500">Not measured yet.</p>
      ) : ag ? (
        <div className="grid grid-cols-3 gap-2">
          {cell("Tier agreement", pct(ag.sample?.tier_vs_label_agreement))}
          {cell("Evidence validity", pct(ag.evidence_validity_rate_mean))}
          {cell("Latency p50", ag.investigation_latency_ms?.p50 ? `${(ag.investigation_latency_ms.p50 / 1000).toFixed(1)} s` : "—")}
        </div>
      ) : <p className="text-sm text-slate-500">Not measured yet.</p>}
      <p className="mt-2 text-[11px] text-slate-500">Held-out synthetic test split · docs/metrics</p>
    </Card>
  );
}

function InsightCard({ i }: { i: Insight }) {
  const Icon = INSIGHT_ICON[i.id] ?? AlertTriangle;
  const up = i.change != null && i.change > 0;
  return (
    <li className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${i.severity === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`} aria-hidden><Icon className="h-4 w-4" /></span>
      <div className="text-sm">
        <p className="font-semibold">{i.title}{i.change != null && <span className={`ml-1 text-xs font-medium ${up ? "text-red-700" : "text-teal-700"}`}>{up ? "▲" : "▼"} {pct(Math.abs(i.change), 0)}</span>}</p>
        <p className="text-xs text-slate-600">{i.detail}</p>
      </div>
    </li>
  );
}

export default function Dashboard() {
  const ov = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 10000 });
  const q = useQuery({ queryKey: ["queue"], queryFn: () => api.queue(150), refetchInterval: 10000 });
  const [allInsights, setAllInsights] = useState(false);
  if (ov.isLoading) return <Loading />;
  if (ov.error) return <ErrorBox error={ov.error} />;
  const o = ov.data!;
  const k = o.kpis;
  const prio = (Object.keys(o.priority_mix_7d) as Priority[]).map((p) => ({ name: `${PRIO_LABEL[p]} (${p})`, p, value: o.priority_mix_7d[p] }));
  const totalAlerts = prio.reduce((s, x) => s + x.value, 0);
  const queueItems = [...(q.data?.items ?? [])].sort((a, b) => a.priority.localeCompare(b.priority) || b.risk_score - a.risk_score);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fraud Operations Dashboard</h1>
          <p className="text-sm text-slate-600">Monitor high-risk activity, investigate suspicious cases and take action.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Data as of {dateTime(o.as_of)}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800"><span className="h-1.5 w-1.5 rounded-full bg-teal-600" aria-hidden />Live</span>
          <a href="/api/overview" download="fraudlens-overview.json" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100"><Download className="h-4 w-4" aria-hidden />Export report</a>
          <NextAlertButton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<ShieldAlert className="h-4 w-4" />} tone="red" label="High-risk alerts (24h)" value={formatNum(k.high_risk_alerts.value)}>
          <Delta delta={k.high_risk_alerts.delta} />
        </Kpi>
        <Kpi icon={<IndianRupee className="h-4 w-4" />} tone="amber" label="Potential exposure (24h)" value={formatINRCompact(k.potential_exposure_rupees.value)}>
          <Delta delta={k.potential_exposure_rupees.delta} format={formatINRCompact} />
        </Kpi>
        <Kpi icon={<Clock className="h-4 w-4" />} tone="amber" label="Alerts nearing SLA" value={formatNum(k.nearing_sla.value)}>
          <span className="text-xs text-slate-500">{k.nearing_sla.breached} past SLA (7d)</span>
        </Kpi>
        <Kpi icon={<Inbox className="h-4 w-4" />} label="Alerts awaiting review (24h)" value={formatNum(k.awaiting_review.value)}>
          <Delta delta={k.awaiting_review.delta} />
        </Kpi>
        <Kpi icon={<Zap className="h-4 w-4" />} tone="teal" label="Transactions screened (24h)" value={formatNum(k.transactions_screened.value)}>
          <span className="text-xs text-slate-500">{pct(o.alert_rate_24h, 2)} alerted · no LLM</span>
        </Kpi>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">{q.data ? <PriorityQueue items={queueItems} /> : <Loading />}</div>
        <div className="space-y-4">
          <Card title="Alert priority mix (7 days)">
            <div className="flex items-center gap-4">
              <div className="relative h-40 w-40 shrink-0" role="img" aria-label={prio.map((x) => `${x.name}: ${x.value}`).join(", ")}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={prio} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
                      {prio.map((x) => <Cell key={x.p} fill={PRIO_COLOR[x.p]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold">{formatNum(totalAlerts)}</span><span className="text-[11px] text-slate-500">alerts</span>
                </div>
              </div>
              <ul className="flex-1 space-y-1.5 text-sm">
                {prio.map((x) => (
                  <li key={x.p} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PRIO_COLOR[x.p] }} aria-hidden />{x.name}</span>
                    <span className="font-semibold">{x.value} <span className="text-xs font-normal text-slate-500">{pct(x.value / Math.max(totalAlerts, 1), 0)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
          <ModelPerformance />
        </div>
      </div>

      <Card title="Key insights · last 7 days vs previous 7" actions={o.insights.length > 3 && <button type="button" onClick={() => setAllInsights((v) => !v)} className="text-sm text-teal-700 underline">{allInsights ? "Show fewer" : "View all insights"}</button>}>
        <ul className="grid gap-3 md:grid-cols-3">{(allInsights ? o.insights : o.insights.slice(0, 3)).map((i) => <InsightCard key={i.id} i={i} />)}</ul>
        <p className="mt-2 text-[11px] text-slate-500">Deterministic counts over screened alerts (no LLM).</p>
      </Card>
    </div>
  );
}
