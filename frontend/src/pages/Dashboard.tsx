import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Download, Fingerprint, Link2, Users, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { NextAlertButton } from "../App";
import { Card, Chip, ErrorBox, Loading, PriorityBadge, SlaChip } from "../components/ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableScrollBox, stickyHeader } from "../components/ui/table";
import { api } from "../lib/api";
import { dateTime, formatINR, formatINRCompact, formatNum, humanize, maskId, pct, slaText } from "../lib/format";
import type { Insight, Priority, QueueItem } from "../types";

const PRIO_COLOR: Record<Priority, string> = { P1: "#dc2626", P2: "#f59e0b", P3: "#0284c7" };
const PRIO_LABEL: Record<Priority, string> = { P1: "High", P2: "Medium", P3: "Low" };
const INSIGHT_ICON: Record<string, typeof Zap> = { shared_device: Fingerprint, fraud_link: Link2, velocity: Zap, new_payee_high_value: Users };

/** Metric tile from the line-charts-6 template (chart omitted). `lowerIsBetter` flips the badge colour, as the template's isNegative. */
function Kpi({ label, value, previous, format = formatNum, lowerIsBetter = false, sub }:
  { label: string; value: number; previous?: number; format?: (n: number) => string; lowerIsBetter?: boolean; sub?: ReactNode }) {
  const change = previous ? ((value - previous) / previous) * 100 : null;
  const good = change !== null && (lowerIsBetter ? change < 0 : change > 0);
  return (
    <div className="flex-1 rounded-xl border border-border bg-white p-4 shadow-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {change !== null && change !== 0 && (
          <span className={`inline-flex h-6 items-center gap-1 rounded-md border px-[0.45rem] text-xs font-medium ${good ? "border-green-200 bg-green-50 text-green-700" : "border-red-100 bg-red-50 text-red-700"}`}
            aria-label={`${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}% vs previous 24h`}>
            {change > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-slate-900">{format(value)}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub ?? (previous !== undefined && `from ${format(previous)}`)}</div>
    </div>
  );
}

function PriorityQueue({ items }: { items: QueueItem[] }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | Priority>("all");
  const [filter, setFilter] = useState("");
  const counts = useMemo(() => ({ all: items.length, P1: items.filter((i) => i.priority === "P1").length, P2: items.filter((i) => i.priority === "P2").length, P3: items.filter((i) => i.priority === "P3").length }), [items]);
  const rows = items
    .filter((i) => (tab === "all" || i.priority === tab) && (!filter || `${i.transaction_id} ${i.customer_id}`.toLowerCase().includes(filter.toLowerCase())));
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
      <TableScrollBox rows={5}>
        <Table>
          <TableCaption className="sr-only">Highest priority alerts. Press Enter on a row to open the case.</TableCaption>
          <TableHeader className={stickyHeader}>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11">Risk</TableHead><TableHead className="h-11">Transaction</TableHead><TableHead className="h-11">Customer</TableHead>
              <TableHead className="h-11 text-right">Amount</TableHead><TableHead className="h-11">Signals</TableHead><TableHead className="h-11">SLA</TableHead><TableHead className="h-11">Assigned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.transaction_id} tabIndex={0} onClick={() => void open(i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void open(i); } }}
                  aria-label={`Open ${i.transaction_id}, priority ${i.priority}, ${formatINR(i.amount_rupees)}`}
                  className="cursor-pointer focus:bg-muted">
                <TableCell><PriorityBadge p={i.priority} /></TableCell>
                <TableCell className="font-mono text-xs">{i.transaction_id}<div className="font-sans text-[11px] text-slate-500">{dateTime(i.timestamp)}</div></TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">{maskId(i.customer_id)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{formatINR(i.amount_rupees)}</TableCell>
                <TableCell className="max-w-[16rem]"><div className="flex flex-wrap gap-1">{i.reason_codes.slice(0, 2).map((r) => <Chip key={r}>{humanize(r)}</Chip>)}{i.reason_codes.length > 2 && <Chip>+{i.reason_codes.length - 2}</Chip>}</div></TableCell>
                <TableCell><SlaChip sla={i.sla} text={slaText(i.sla)} /></TableCell>
                <TableCell className="whitespace-nowrap text-xs">{i.assignee ?? <span className="text-slate-500">Unassigned</span>}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No alerts match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableScrollBox>
    </Card>
  );
}

function ModelPerformance() {
  const m = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  const [tab, setTab] = useState<"detection" | "investigation">("detection");
  const b = m.data?.detection?.variants?.B_ml_blend;
  const ag = m.data?.agentic as { sample?: { tier_vs_label_agreement?: number }; evidence_validity_rate_mean?: number; investigation_latency_ms?: { p50?: number } } | null | undefined;
  const cell = (label: string, value: string) => (
    <div className="rounded-md bg-slate-50 p-2 text-center"><div className="text-[11px] text-slate-500">{label}</div><div className="text-lg font-semibold">{value}</div></div>
  );
  return (
    <Card title="Model performance">
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
          <p className="text-sm text-slate-600">Monitor high-risk activity, investigate suspicious cases and take action.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500"></span>
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800"><span className="h-1.5 w-1.5 rounded-full bg-teal-600" aria-hidden />Live</span>
          <a href="/api/overview" download="fraudlens-overview.json" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100"><Download className="h-4 w-4" aria-hidden />Export report</a>
          <NextAlertButton />
        </div>
      </div>

      <div className="@container">
        <div className="grid gap-3 @2xl:grid-cols-5">
          <Kpi label="High-risk alerts (24h)" value={k.high_risk_alerts.value} previous={k.high_risk_alerts.previous} lowerIsBetter />
          <Kpi label="Potential exposure (24h)" value={k.potential_exposure_rupees.value} previous={k.potential_exposure_rupees.previous} format={formatINRCompact} lowerIsBetter />
          <Kpi label="Alerts nearing SLA" value={k.nearing_sla.value} sub={`${k.nearing_sla.breached} past SLA (7d)`} />
          <Kpi label="Awaiting review (24h)" value={k.awaiting_review.value} previous={k.awaiting_review.previous} lowerIsBetter />
          <Kpi label="Transactions screened (24h)" value={k.transactions_screened.value} previous={k.transactions_screened.previous}
            sub={`from ${formatNum(k.transactions_screened.previous)} · ${pct(o.alert_rate_24h, 2)} alerted`} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">{q.data ? <PriorityQueue items={queueItems} /> : <Loading />}</div>
        <div className="space-y-4">
          <Card title="Alert priority mix (7 days)">
            {/* Thick ring with rounded segment ends, total in the centre, legend list below a divider. */}
            <div className="relative mx-auto h-48 w-48" role="img" aria-label={`${formatNum(totalAlerts)} alerts: ${prio.map((x) => `${x.name} ${x.value}`).join(", ")}`}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={prio} dataKey="value" nameKey="name" innerRadius={66} outerRadius={90} paddingAngle={4} cornerRadius={12}
                    startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                    {prio.map((x) => <Cell key={x.p} fill={PRIO_COLOR[x.p]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-muted-foreground">Total alerts</span>
                <span className="text-3xl font-semibold tracking-tight text-slate-900">{formatNum(totalAlerts)}</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2.5 border-t border-border pt-4 text-sm">
              {prio.map((x) => (
                <li key={x.p} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5 font-medium text-slate-900"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PRIO_COLOR[x.p] }} aria-hidden />{x.name}</span>
                  <span className="tabular-nums text-slate-900">{formatNum(x.value)} <span className="ml-1 text-xs text-slate-500">{pct(x.value / Math.max(totalAlerts, 1), 0)}</span></span>
                </li>
              ))}
            </ul>
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
