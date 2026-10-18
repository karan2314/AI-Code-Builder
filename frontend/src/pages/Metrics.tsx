import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Chip, ErrorBox, Loading, Stat, TierBadge, score1000 } from "../components/ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableScrollBox, stickyHeader } from "../components/ui/table";
import { api } from "../lib/api";
import { formatINR, formatNum, humanize, pct } from "../lib/format";
import type { Impact, Tier, VariantMetrics } from "../types";

const VARIANT_LABEL: Record<string, string> = { A_rules: "A · Rules only", B_ml_blend: "B · ML + anomaly + rules" };
const TEAL = "#0f766e";
const SLATE = "#94a3b8";

/** Per-case result written by evals.run_benchmark (docs/metrics/agentic_eval.json). */
interface AgenticCase {
  transaction_id: string; label_is_fraud: number; tier: Tier; llm_tier: Tier | null; mode: string;
  evidence_items: number; evidence_validity_rate: number; dropped_findings?: number; tool_calls: number; latency_ms: number;
  pass_tier?: boolean; pass_citations?: boolean;
}
interface Agentic {
  generated_at: string; gemini_model: string; prompt_version: string; policy_version: string;
  golden_scenarios?: Record<string, AgenticCase>;
  sample?: { size: number; fraud: number; legit: number; agentic_runs: number; fallback_runs: number };
  evidence_validity_rate_mean?: number; invalid_citations_total?: number;
  investigation_latency_ms?: { p50: number; p95: number };
  tokens_per_case?: { input_mean: number; output_mean: number };
  gemini_escalation_rate_test?: number;
  cost?: { avg_llm_cost_usd_per_investigated_case: number; llm_cost_usd_per_1000_transactions: number; formula: string; pricing_checked: string };
  cases?: AgenticCase[];
}
type Laya = { status?: string; model?: string; candidates?: number; precision?: number; recall?: number; laya_latency_ms?: { service_p50?: number } };

const secs = (ms?: number) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const usd = (v?: number) => (v == null ? "—" : `$${v.toFixed(2)}`);
const featureLabel = (f: string) => humanize(f.replace(/^cp_/, "counterparty_").replace(/^amt_/, "amount_").replace(/_dev$/, "_deviation"));

/**
 * Confusion counts derived from what the detection report stores (candidates, precision, fraud total).
 * ponytail: rounded from precision; have the eval script write TP/FP directly if exact counts are needed.
 */
function counts(v: VariantMetrics) {
  const caught = Math.round(v.candidates * v.precision);
  return { caught, falseAlerts: v.candidates - caught, missed: v.fraud_transactions - caught };
}

/** Outcome of labelled cases when "escalated" means Tier 2 or higher. */
function outcomes(cases: AgenticCase[], tierOf: (c: AgenticCase) => number | null) {
  const esc = (c: AgenticCase) => (tierOf(c) ?? 1) >= 2;
  return {
    caught: cases.filter((c) => c.label_is_fraud && esc(c)).length,
    missed: cases.filter((c) => c.label_is_fraud && !esc(c)).length,
    cleared: cases.filter((c) => !c.label_is_fraud && !esc(c)).length,
    falseEsc: cases.filter((c) => !c.label_is_fraud && esc(c)).length,
  };
}

function Section({ step, title, question, children }: { step: string; title: string; question: string; children: ReactNode }) {
  return (
    <section aria-label={`${step} · ${title}`} className="space-y-3">
      <p className="text-sm text-slate-600"><span className="font-medium text-slate-900">The question:</span> {question}</p>
      {children}
    </section>
  );
}

function Headline({ label, value, sentence, tone = "slate", onClick }: { label: string; value: string; sentence: string; tone?: "teal" | "slate"; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-border bg-white p-4 text-left shadow-xs transition-colors hover:border-teal-300 hover:bg-teal-50/40">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "teal" ? "text-teal-700" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-sm text-slate-600">{sentence}</p>
    </button>
  );
}

const Pass = ({ ok, label }: { ok?: boolean; label: string }) => ok == null ? null : (
  <span className={`inline-flex items-center gap-1 text-xs font-medium ${ok ? "text-teal-700" : "text-red-700"}`}>
    {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <XCircle className="h-3.5 w-3.5" aria-hidden />}{label}
  </span>
);
const LabelChip = ({ fraud }: { fraud: number }) => <Chip tone={fraud ? "red" : "teal"}>{fraud ? "Fraud" : "Legit"}</Chip>;

/** Metric rows for the A vs B comparison. `better` marks which direction wins, so the winning cell can be highlighted. */
const SCREEN_ROWS: { label: string; hint: string; better: "high" | "low"; get: (v: VariantMetrics) => number; fmt: (n: number) => string }[] = [
  { label: "Frauds caught", hint: "Labelled frauds the screen flagged", better: "high", get: (v) => counts(v).caught, fmt: formatNum },
  { label: "Frauds missed", hint: "Labelled frauds that slipped through", better: "low", get: (v) => counts(v).missed, fmt: formatNum },
  { label: "False alerts", hint: "Legitimate payments flagged; analyst workload", better: "low", get: (v) => counts(v).falseAlerts, fmt: formatNum },
  { label: "Precision", hint: "Share of alerts that are real fraud", better: "high", get: (v) => v.precision, fmt: (n) => pct(n) },
  { label: "Recall", hint: "Share of all fraud that gets flagged", better: "high", get: (v) => v.recall, fmt: (n) => pct(n) },
  { label: "PR-AUC", hint: "Ranking quality across all thresholds (1.0 is perfect)", better: "high", get: (v) => v.pr_auc, fmt: (n) => n.toFixed(3) },
  { label: "False alerts per 10k", hint: "Alert burden normalised to volume", better: "low", get: (v) => v.false_positives_per_10k, fmt: (n) => String(n) },
  { label: "Candidate rate", hint: "Share of traffic sent on to AI investigation", better: "low", get: (v) => v.candidate_rate, fmt: (n) => pct(n, 2) },
  { label: "Fraud value captured", hint: "Share of fraud rupees in flagged payments", better: "high", get: (v) => v.fraud_value_captured_pct, fmt: (n) => `${n}%` },
];

/** Log-scaled funnel from every screened transaction down to Tier 3 containment (from impact.json). */
function Funnel({ i }: { i: Impact }) {
  const f = i.funnel;
  const steps = [
    { label: "Transactions screened", value: f.screened, note: "rules + ML, no LLM, milliseconds" },
    { label: "Alerts (screening)", value: f.alerts, note: `1 in ${formatNum(i.headline.transactions_per_alert)} · ${f.alerts_fraud} are real fraud` },
    { label: "Escalated by policy (Tier 2–3)", value: f.escalated_tier2plus, note: `${pct(f.escalated_precision ?? 0, 1)} are real fraud` },
    { label: "Contain (Tier 3)", value: Number(f.policy_tiers["3"] ?? 0), note: `${f.policy_tiers_fraud["3"] ?? 0} of ${f.policy_tiers["3"] ?? 0} are real fraud` },
  ];
  const max = Math.log10(f.screened);
  return (
    <ol className="space-y-2" aria-label="Detection funnel on the held-out test split">
      {steps.map((s) => (
        <li key={s.label} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[13rem_1fr]">
          <span className="font-medium text-slate-700">{s.label}</span>
          <div className="flex items-center gap-3">
            <div className="h-6 rounded bg-teal-600" style={{ width: `${Math.max(4, (Math.log10(Math.max(s.value, 1)) / max) * 100)}%` }} aria-hidden />
            <span className="whitespace-nowrap"><span className="font-semibold tabular-nums text-slate-900">{formatNum(s.value)}</span> <span className="text-xs text-slate-600">{s.note}</span></span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const TABS = [
  { k: "overview", label: "Overview" },
  { k: "screening", label: "Stage 1 · Screening" },
  { k: "investigation", label: "Stage 2 · Investigation" },
  { k: "efficiency", label: "Stage 3 · Efficiency" },
] as const;
type TabKey = (typeof TABS)[number]["k"];

export default function Metrics() {
  const m = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  // Tab lives in the URL (?tab=) so a reload or a shared link opens the same stage.
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.some((t) => t.k === params.get("tab")) ? (params.get("tab") as TabKey) : "overview";
  const setTab = (k: TabKey) => setParams(k === "overview" ? {} : { tab: k }, { replace: true });
  if (m.isLoading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  const det = m.data!.detection;
  const ag = m.data!.agentic as Agentic | null;
  const bench = m.data!.benchmark as Record<string, unknown> | null;
  const laya = bench?.C_laya as Laya | undefined;
  const i = m.data!.impact;

  if (!det) return <Card><p className="text-sm">No detection metrics yet. Run <code>uv run python -m app.ml.train</code>.</p></Card>;
  const variants = Object.entries(det.variants);
  const A = det.variants.A_rules, B = det.variants.B_ml_blend;
  const cA = A && counts(A), cB = B && counts(B);
  const prod = B ?? variants[0][1];
  const cProd = counts(prod);
  const perCase = ag?.cost?.avg_llm_cost_usd_per_investigated_case;
  const per1k = ag?.cost?.llm_cost_usd_per_1000_transactions;
  const allToLlm = perCase != null ? perCase * 1000 : undefined;
  const cheaper = allToLlm && per1k ? Math.round(allToLlm / per1k) : undefined;
  const maxFeat = Math.max(...det.top_global_features.map(([, v]) => v), 1e-9);

  // Outcome-first view, from docs/metrics/impact.json (evals.run_impact). Optional so the page still works without it.
  const h = i?.headline;
  const r = i?.variants.rules, f = i?.variants.fraudlens, u = i?.variants.union;
  const byType = i?.by_fraud_type.map((t) => ({ name: t.label, Rules: Math.round((t.rules_caught / t.fraud_transactions) * 100), FraudLens: Math.round((t.fraudlens_caught / t.fraud_transactions) * 100), n: t.fraud_transactions })) ?? [];
  const sortCurve = (c: { recall: number; precision: number }[]) => [...c].sort((x, y) => x.recall - y.recall);
  const compareRows: { label: string; before: number; after: number; better: "high" | "low"; fmt: (v: number) => string }[] = i && r && f && h ? [
    { label: "Fraud caught", before: r.caught, after: f.caught, better: "high", fmt: formatNum },
    { label: "Fraud missed", before: r.missed, after: f.missed, better: "low", fmt: formatNum },
    { label: "Recall", before: r.recall, after: f.recall, better: "high", fmt: (v) => pct(v, 1) },
    { label: "PR-AUC", before: h.pr_auc_rules, after: h.pr_auc_fraudlens, better: "high", fmt: (v) => v.toFixed(3) },
    { label: "Alerts to review", before: r.alerts, after: f.alerts, better: "low", fmt: formatNum },
    { label: "Precision", before: r.precision, after: f.precision, better: "high", fmt: (v) => pct(v, 1) },
    { label: "False alarms", before: r.false_alarms, after: f.false_alarms, better: "low", fmt: formatNum },
  ] : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        How much better FraudLens performs than a rules-only fraud engine, measured on the held-out synthetic test period
        ({formatNum(prod.transactions)} transactions, {formatNum(prod.fraud_transactions)} labelled frauds the models never saw). Nothing is estimated.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {h && r && f ? (
          <>
            <Headline onClick={() => setTab("screening")} label="More fraud caught" tone="teal" value={`+${formatNum(h.extra_frauds_caught)} frauds`}
              sentence={`${pct(h.extra_frauds_caught_pct, 0)} more than rules alone: ${formatNum(f.caught)} vs ${formatNum(r.caught)} of ${formatNum(i!.test_fraud_transactions)}.`} />
            <Headline onClick={() => setTab("screening")} label="Sharper risk ranking" value={`+${pct(h.pr_auc_gain_pct, 0)} PR-AUC`}
              sentence={`${h.pr_auc_rules.toFixed(2)} → ${h.pr_auc_fraudlens.toFixed(2)}: real fraud ranks above legitimate payments far more reliably.`} />
          </>
        ) : (
          <>
            <Headline onClick={() => setTab("screening")} label="Catches fraud" tone="teal" value={`${formatNum(cProd.caught)} of ${formatNum(prod.fraud_transactions)}`}
              sentence={`Screening flags ${pct(prod.recall, 0)} of labelled frauds; ${formatNum(cProd.missed)} slip through.`} />
            <Headline onClick={() => setTab("screening")} label="Low alert burden" value={`${formatNum(cProd.falseAlerts)} false alerts`}
              sentence={`Across ${formatNum(prod.transactions)} transactions, ${prod.false_positives_per_10k} per 10,000.`} />
          </>
        )}
        <Headline onClick={() => setTab("investigation")} label="Trustworthy AI" value={ag ? `${pct(ag.evidence_validity_rate_mean, 0)} grounded` : "—"}
          sentence={ag ? `${pct(ag.evidence_validity_rate_mean, 0)} of AI claims cite tool-verified evidence; ${formatNum(ag.invalid_citations_total ?? 0)} invalid citations.` : "Agentic evaluation not run yet."} />
        <Headline onClick={() => setTab("efficiency")} label="AI cost focused on risk" value={h?.llm_cost_reduction_x ? `${h.llm_cost_reduction_x}× cheaper` : per1k != null ? usd(per1k) : "—"}
          sentence={per1k != null ? `${usd(per1k)} vs ${usd(allToLlm)} per 1,000 transactions if every payment went to Gemini.` : "Agentic evaluation not run yet."} />
      </div>

      <div role="tablist" aria-label="Evaluation stages" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ k, label }) => (
          <button key={k} role="tab" id={`evtab-${k}`} aria-controls="evpanel" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-teal-700 text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="evpanel" aria-labelledby={`evtab-${tab}`} className="space-y-4">
      {tab === "overview" && i && r && f && u && h && (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-5">
            <Card title="From every transaction to the few that need action" className="xl:col-span-3">
              <Funnel i={i} />
              <p className="mt-3 text-xs text-slate-500">Bar length on a log scale. Policy tiers use the same tools and deterministic policy as production for every test alert. Analysts start with the {formatNum(i.funnel.escalated_tier2plus)} escalated cases, and {pct(i.funnel.escalated_precision ?? 0, 0)} of them are real fraud.</p>
            </Card>
            <Card title="Rules engine vs FraudLens" className="xl:col-span-2">
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableCaption className="sr-only">Rules-only baseline compared with FraudLens screening on the test split</TableCaption>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-10">Metric</TableHead>
                      <TableHead className="h-10 text-right">Rules</TableHead>
                      <TableHead className="h-10 text-right">FraudLens</TableHead>
                      <TableHead className="h-10"><span className="sr-only">Result</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compareRows.map((row) => {
                      const improved = row.better === "high" ? row.after > row.before : row.after < row.before;
                      return (
                        <TableRow key={row.label}>
                          <TableCell className="font-medium text-slate-900">{row.label}</TableCell>
                          <TableCell className="text-right tabular-nums text-slate-600">{row.fmt(row.before)}</TableCell>
                          <TableCell className={`text-right font-semibold tabular-nums ${improved ? "text-teal-700" : "text-amber-800"}`}>{row.fmt(row.after)}</TableCell>
                          <TableCell className="text-xs">{improved ? <span className="text-teal-700">better</span> : <span className="text-amber-800">trade-off</span>}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>

          <Card title="Where FraudLens wins: catch rate by fraud pattern">
            <div className="h-80" role="img" aria-label={byType.map((t) => `${t.name}: rules ${t.Rules}%, FraudLens ${t.FraudLens}% of ${t.n}`).join("; ")}>
              <ResponsiveContainer>
                <BarChart data={byType} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" />
                  <YAxis type="category" dataKey="name" width={230} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="Rules" fill={SLATE} isAnimationActive={false} />
                  <Bar dataKey="FraudLens" fill={TEAL} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-medium text-teal-700 hover:underline">View as table</summary>
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableCaption className="sr-only">Catch rate by fraud pattern</TableCaption>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {["Pattern", "Fraud cases", "Rules", "FraudLens"].map((c) => <TableHead key={c} className="h-10 text-right first:text-left">{c}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {i.by_fraud_type.map((t) => (
                      <TableRow key={t.type}>
                        <TableCell>{t.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.fraud_transactions}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.rules_caught}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{t.fraudlens_caught}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
            <p className="mt-2 text-sm text-slate-600">Biggest gains come from behaviour-based fraud that fixed thresholds miss: account takeovers and card-testing bursts. Legitimate high-value purchases flagged: rules {i.legit_high_value.rules_flagged} vs FraudLens {i.legit_high_value.fraudlens_flagged} of {i.legit_high_value.transactions}.</p>
          </Card>

          <Card title="Trade-offs, and how they are handled">
            <ul className="space-y-2 text-sm text-slate-700">
              <li><span className="font-semibold text-slate-900">More alerts, still a tiny fraction:</span> {f.alerts} vs {r.alerts} alerts ({pct(f.alerts / i.test_transactions, 2)} of volume). The {h.extra_false_alarms} extra false alarms buy {h.extra_frauds_caught} extra frauds caught, and the agent investigation plus the policy engine filter them: {pct(i.funnel.escalated_precision ?? 0, 0)} of escalated cases are real fraud.</li>
              <li><span className="font-semibold text-slate-900">Rules still win on two patterns:</span> payments to known mule networks and fraud on brand-new customers (see chart). Value of fraud caught: rules {formatINR(r.fraud_value_caught_rupees)} vs FraudLens {formatINR(f.fraud_value_caught_rupees)}.
                {" "}Measured fix: keeping rule hits as hard triggers on top of the ML screen catches <span className="font-semibold text-slate-900">{u.caught} of {i.test_fraud_transactions} ({pct(u.recall, 1)})</span> and {formatINR(u.fraud_value_caught_rupees)} of fraud value, at precision {pct(u.precision, 1)} with {u.alerts} alerts. This is the next configuration change.</li>
              <li><span className="font-semibold text-slate-900">Not yet caught by anyone:</span> scams to brand-new, unlinked mule accounts and first-party fraud. They look like normal behaviour, so they need external signals (beneficiary intelligence, consortium data).</li>
            </ul>
          </Card>
        </>
      )}

      {tab === "overview" && !i && (
      <Card title="How a transaction flows">
        <ol className="grid gap-2 md:grid-cols-5">
          {[
            { n: formatNum(prod.transactions), t: "Screened", d: "Every transaction · rules + ML, no LLM" },
            { n: formatNum(prod.candidates), t: "Flagged", d: `${pct(prod.candidate_rate, 2)} sent on to the agents` },
            { n: "Agents", t: "Investigated", d: "Tool-verified evidence + cited Gemini summary" },
            { n: "R1–R8", t: "Policy tier", d: "Deterministic rules set Tier 1 / 2 / 3" },
            { n: "L2", t: "Analyst decides", d: "A human approves or overrides every case" },
          ].map((s, idx) => (
            <li key={s.t} className="relative flex flex-col rounded-lg bg-slate-50 p-3">
              <span className="text-xl font-semibold tracking-tight text-slate-900">{s.n}</span>
              <span className="text-sm font-medium text-slate-900">{s.t}</span>
              <span className="mt-0.5 text-xs text-slate-600">{s.d}</span>
              {idx < 4 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-white text-slate-400 md:block" aria-hidden />}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-500">Run <code>uv run python -m evals.run_impact</code> for the rules-vs-FraudLens impact view.</p>
      </Card>
      )}

      {tab === "screening" && (
      <Section step="Stage 1" title="Screening" question="Which first-stage detector should run in production?">
        <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
        {cA && cB && (
          <p className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
            <span className="font-semibold">B runs in production.</span> It catches {formatNum(cB.caught - cA.caught)} more frauds than rules alone
            ({formatNum(cB.caught)} vs {formatNum(cA.caught)}) for {formatNum(cB.falseAlerts - cA.falseAlerts)} more false alerts.
            {A.fraud_value_captured_pct > B.fraud_value_captured_pct && (
              <> Trade-off: rules alone capture more fraud by value ({A.fraud_value_captured_pct}% vs {B.fraud_value_captured_pct}%), so some high-value frauds score below B's threshold.</>
            )}
          </p>
        )}
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          <Table>
            <TableCaption className="sr-only">Screening variants compared; the better value in each row is highlighted</TableCaption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-11">Metric</TableHead>
                {variants.map(([k]) => <TableHead key={k} className="h-11 text-right">{VARIANT_LABEL[k] ?? k}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {SCREEN_ROWS.map((row) => {
                const vals = variants.map(([, v]) => row.get(v));
                const best = row.better === "high" ? Math.max(...vals) : Math.min(...vals);
                return (
                  <TableRow key={row.label}>
                    <TableCell title={row.hint}>
                      <div className="font-medium text-slate-900">{row.label}</div>
                      <div className="text-xs text-slate-500">{row.hint}</div>
                    </TableCell>
                    {vals.map((v, idx) => (
                      <TableCell key={variants[idx][0]} className={`text-right tabular-nums ${v === best && vals.some((x) => x !== best) ? "font-semibold text-teal-700" : "text-slate-700"}`}>
                        {row.fmt(v)}{v === best && vals.some((x) => x !== best) && <span className="sr-only"> (better)</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-slate-500">Better value per row in teal. Counts are derived from candidates × precision and rounded. Thresholds calibrated on validation (blend {score1000(Number(det.thresholds.blend))} / 1000).</p>
        </div>
        <Card title="Why the model decides" actions={<span className="text-xs text-slate-500">Permutation importance</span>}>
          <ul className="space-y-3">
            {det.top_global_features.map(([feat, v]) => (
              <li key={feat} className="space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-700" title={feat}>{featureLabel(feat)}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-900">{v.toFixed(3)}</span>
                </div>
                <span className="block h-1.5 rounded-full bg-slate-100" aria-hidden><span className="block h-1.5 rounded-full bg-teal-600" style={{ width: `${Math.max((v / maxFeat) * 100, 1)}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">How much the model's accuracy drops when each feature is shuffled. Device novelty dominates.</p>
        </Card>
        </div>
        {i && h && (
          <Card title="Precision at every catch rate" actions={<span className="text-xs text-slate-500">PR-AUC rules {h.pr_auc_rules.toFixed(2)} · FraudLens {h.pr_auc_fraudlens.toFixed(2)}</span>}>
            <div className="h-64" role="img" aria-label={`Precision-recall curves. PR-AUC rules ${h.pr_auc_rules.toFixed(2)}, FraudLens ${h.pr_auc_fraudlens.toFixed(2)}`}>
              <ResponsiveContainer>
                <LineChart margin={{ right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="recall" type="number" allowDuplicatedCategory={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "Fraud caught (recall)", position: "insideBottom", offset: -2, fontSize: 12 }} height={40} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <Tooltip formatter={(v) => (typeof v === "number" ? pct(v, 1) : String(v))} labelFormatter={(v) => `Recall ${pct(Number(v), 0)}`} />
                  <Legend />
                  <Line data={sortCurve(i.pr_curves.rules)} name="Rules" type="linear" dataKey="precision" stroke={SLATE} dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line data={sortCurve(i.pr_curves.fraudlens)} name="FraudLens" type="linear" dataKey="precision" stroke={TEAL} dot={false} strokeWidth={3} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500">Higher and further right is better. FraudLens keeps precision high while catching far more fraud.</p>
          </Card>
        )}
      </Section>
      )}

      {tab === "investigation" && (
      <Section step="Stage 2" title="Agentic investigation" question="When agents investigate a flagged case, does the final tier match the truth, and can the AI be trusted?">
        {!ag?.cases?.length ? (
          <Card><p className="text-sm text-slate-500">Not measured yet. Run <code>uv run python -m evals.run_benchmark</code> with Gemini enabled.</p></Card>
        ) : (() => {
          const cs = ag.cases!;
          const pol = outcomes(cs, (c) => c.tier);
          const gem = outcomes(cs, (c) => c.llm_tier);
          const heldFraud = cs.filter((c) => (c.llm_tier ?? 1) >= 2 && c.tier < 2 && c.label_is_fraud).length;
          const heldLegit = cs.filter((c) => (c.llm_tier ?? 1) >= 2 && c.tier < 2 && !c.label_is_fraud).length;
          const dropped = cs.reduce((s, c) => s + (c.dropped_findings ?? 0), 0);
          const cell = (n: number, good: boolean, label: string) => (
            <div className={`rounded-lg p-3 ${good ? "bg-teal-50 text-teal-900" : n ? "bg-red-50 text-red-900" : "bg-slate-50 text-slate-500"}`}>
              <div className="text-2xl font-semibold tabular-nums">{n}</div><div className="text-xs font-medium">{label}</div>
            </div>
          );
          return (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Policy tier vs the true label" actions={<span className="text-xs text-slate-500">{cs.length} labelled cases · {ag.sample?.fraud ?? 0} fraud / {ag.sample?.legit ?? 0} legit</span>}>
                  <div className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2 text-sm">
                    <span />
                    <span className="text-xs font-medium text-slate-500">Escalated (Tier 2–3)</span>
                    <span className="text-xs font-medium text-slate-500">Monitor (Tier 1)</span>
                    <span className="font-medium text-slate-700">Fraud</span>{cell(pol.caught, true, "Caught")}{cell(pol.missed, false, "Missed")}
                    <span className="font-medium text-slate-700">Legit</span>{cell(pol.falseEsc, false, "Falsely escalated")}{cell(pol.cleared, true, "Correctly cleared")}
                  </div>
                  <p className="mt-3 text-sm text-slate-600">The tier matches the label on {pct((pol.caught + pol.cleared) / cs.length, 1)} of cases. Small sample: treat as indicative.</p>
                </Card>

                <Card title="AI advised · policy decided">
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                      <TableCaption className="sr-only">Gemini's advisory tier versus the policy tier, against the true label</TableCaption>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          {["", "Frauds caught", "Frauds missed", "Legit escalated"].map((c) => <TableHead key={c} className="h-10 text-right first:text-left">{c}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[["Gemini (advisory)", gem], ["Policy (decides)", pol]].map(([who, o]) => {
                          const v = o as typeof pol;
                          return (
                            <TableRow key={who as string}>
                              <TableCell className="font-medium text-slate-900">{who as string}</TableCell>
                              <TableCell className="text-right tabular-nums">{v.caught}</TableCell>
                              <TableCell className="text-right tabular-nums">{v.missed}</TableCell>
                              <TableCell className="text-right tabular-nums">{v.falseEsc}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    On {heldLegit + heldFraud} case(s) Gemini advised Tier 2+ but the policy held Tier 1:
                    {" "}<span className="font-medium text-teal-800">{heldLegit} legitimate (over-escalation blocked)</span>
                    {heldFraud > 0 && <> and <span className="font-medium text-red-800">{heldFraud} fraud (missed by the policy)</span></>}.
                    The policy trades some recall for zero false escalations; an analyst still reviews every case.
                  </p>
                </Card>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Evidence validity" value={pct(ag.evidence_validity_rate_mean, 0)} hint="AI claims that cite an existing evidence ID" />
                <Stat label="Invalid citations" value={formatNum(ag.invalid_citations_total ?? 0)} hint="Cited IDs that did not exist" />
                <Stat label="Findings dropped" value={formatNum(dropped)} hint="Removed by the citation validator" />
                <Stat label="Agentic runs" value={`${ag.sample?.agentic_runs ?? cs.length} of ${ag.sample?.size ?? cs.length}`} hint={`${ag.sample?.fallback_runs ?? 0} fell back to deterministic evidence only`} />
              </div>

              {i && (
                <Card title="What we tested and kept">
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden /><span><span className="font-semibold text-slate-900">Deterministic policy over Gemini.</span> On every test alert, policy escalations are {pct(i.funnel.escalated_precision ?? 0, 1)} real fraud; on validation alerts {pct(i.policy_validation.precision, 1)} ({i.policy_validation.false_alarms} false escalations). Policy 2026.10.2 stopped the ML score counting as its own signal, which removed 4 of 4 false escalations seen in testing.</span></li>
                    <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden /><span><span className="font-semibold text-slate-900">Citation guard.</span> A valid-ID list plus one bounded repair took invalid AI citations to {ag.invalid_citations_total ?? 0}.</span></li>
                  </ul>
                </Card>
              )}

              {ag.golden_scenarios && (
                <Card title="Golden scenarios" actions={<span className="text-xs text-slate-500">Fixed regression checks</span>}>
                  <ul className="divide-y divide-border">
                    {Object.entries(ag.golden_scenarios).map(([name, s]) => (
                      <li key={name} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                        <div className="min-w-48 flex-1">
                          <p className="text-sm font-medium text-slate-900">{humanize(name)}</p>
                          <p className="font-mono text-xs text-slate-500">{s.transaction_id}</p>
                        </div>
                        <LabelChip fraud={s.label_is_fraud} />
                        <TierBadge tier={s.tier} />
                        <span className="text-xs text-slate-500">{s.evidence_items} evidence · {s.tool_calls} tool calls · {secs(s.latency_ms)}</span>
                        <span className="flex gap-3"><Pass ok={s.pass_tier} label="Tier correct" /><Pass ok={s.pass_citations} label="Citations valid" /></span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">Per-case results ({cs.length})</h3>
                <TableScrollBox rows={6}>
                  <Table>
                    <TableCaption className="sr-only">Per-case agentic results</TableCaption>
                    <TableHeader className={stickyHeader}>
                      <TableRow className="hover:bg-transparent">
                        {["Transaction", "Label", "Policy tier", "Gemini advised", "Evidence validity", "Tool calls", "Latency", "Mode"].map((c) => <TableHead key={c} className="h-10">{c}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cs.map((c) => (
                        <TableRow key={c.transaction_id}>
                          <TableCell className="font-mono text-xs">{c.transaction_id}</TableCell>
                          <TableCell><LabelChip fraud={c.label_is_fraud} /></TableCell>
                          <TableCell><TierBadge tier={c.tier} /></TableCell>
                          <TableCell className="text-sm">{c.llm_tier ? `Tier ${c.llm_tier}` : "—"}</TableCell>
                          <TableCell className="tabular-nums">{pct(c.evidence_validity_rate, 0)}</TableCell>
                          <TableCell className="tabular-nums">{c.tool_calls}</TableCell>
                          <TableCell className="tabular-nums">{secs(c.latency_ms)}</TableCell>
                          <TableCell><Chip tone={c.mode === "agentic" ? "teal" : "amber"}>{humanize(c.mode)}</Chip></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollBox>
              </div>
            </>
          );
        })()}
      </Section>
      )}

      {tab === "efficiency" && !ag && <Card><p className="text-sm text-slate-500">Not measured yet. Run <code>uv run python -m evals.run_benchmark</code> with Gemini enabled.</p></Card>}
      {tab === "efficiency" && ag && (
        <Section step="Stage 3" title="Efficiency" question="Is it fast and cheap enough to run on every flagged payment?">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {i && <Stat label="Screening speed" value={`${i.screening_ms_per_1k} ms`} hint="Per 1,000 transactions · rules + ML, no LLM" />}
            <Stat label="Investigation latency (p50)" value={secs(ag.investigation_latency_ms?.p50)} hint={`p95 ${secs(ag.investigation_latency_ms?.p95)} · full multi-agent run`} />
            <Stat label="Tokens per case" value={ag.tokens_per_case ? formatNum(ag.tokens_per_case.input_mean) : "—"} hint={ag.tokens_per_case ? `in · ${formatNum(ag.tokens_per_case.output_mean)} out` : undefined} />
            <Stat label="LLM cost per case" value={usd(perCase)} hint={ag.gemini_model} />
            <Stat label="Escalation rate" value={pct(ag.gemini_escalation_rate_test, 2)} hint="Share of traffic sent to Gemini; set by the screening threshold" />
            <Stat label="LLM cost per 1k transactions" value={usd(per1k)} hint="Cost per case × escalation rate × 1,000" />
          </div>
          {allToLlm != null && per1k != null && (
            <Card title="Why screen first: LLM cost per 1,000 transactions">
              <div className="space-y-2">
                {[
                  { label: "Send everything to Gemini", v: allToLlm, cls: "bg-red-500" },
                  { label: "Screen first (FraudLens)", v: per1k, cls: "bg-teal-600" },
                ].map((b) => (
                  <div key={b.label} className="grid grid-cols-[12rem_1fr_4.5rem] items-center gap-3 text-sm">
                    <span className="text-slate-600">{b.label}</span>
                    <span className="h-3 rounded-full bg-slate-100" aria-hidden><span className={`block h-3 rounded-full ${b.cls}`} style={{ width: `${Math.max((b.v / allToLlm) * 100, 0.8)}%` }} /></span>
                    <span className="text-right font-semibold tabular-nums text-slate-900">{usd(b.v)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {cheaper && <>About <span className="font-semibold text-slate-700">{cheaper}× cheaper</span>. </>}
                "Everything" = measured cost per investigated case ({usd(perCase)}) × 1,000; screened = the same cost × the {pct(ag.gemini_escalation_rate_test, 2)} escalation rate.
              </p>
            </Card>
          )}
          {ag.cost && <p className="text-xs text-slate-500">Formula: {ag.cost.formula}. List prices checked {ag.cost.pricing_checked}.</p>}
        </Section>
      )}

      {tab === "efficiency" && laya?.status === "measured" && B && (
        <Card title="Evaluated and rejected: Laya routing (Variant C)" actions={<Chip>Advisory only</Chip>}>
          <dl className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-lg border border-border border-t-4 border-t-slate-400 bg-slate-50/60 p-4">
              <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><FlaskConical className="h-3.5 w-3.5 text-slate-500" aria-hidden />What was tested</dt>
              <dd className="mt-2 text-slate-700">Open-weight <span className="font-mono text-xs">{laya.model}</span> deciding which of B's {formatNum(B.candidates)} candidates need a Gemini investigation, to cut LLM cost.</dd>
            </div>
            <div className="rounded-lg border border-border border-t-4 border-t-amber-500 bg-slate-50/60 p-4">
              <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />Result</dt>
              <dd className="mt-2 text-slate-700">
                {laya.candidates === B.candidates
                  ? `Routed all ${formatNum(laya.candidates)} candidates to "investigate", so Gemini escalations did not drop.`
                  : `Kept ${formatNum(laya.candidates ?? 0)} of ${formatNum(B.candidates)} candidates.`}
                {" "}Precision {pct(laya.precision)} and recall {pct(laya.recall)} are unchanged from B. Latency p50 {secs(laya.laya_latency_ms?.service_p50)} on CPU.
              </dd>
            </div>
            <div className="rounded-lg border border-border border-t-4 border-t-teal-600 bg-slate-50/60 p-4">
              <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><CheckCircle2 className="h-3.5 w-3.5 text-teal-700" aria-hidden />Decision</dt>
              <dd className="mt-2 text-slate-700">Kept as one advisory evidence item that is compared with the policy tier and never sets it. Off by default.</dd>
            </div>
          </dl>
        </Card>
      )}

      {tab !== "overview" && (
        <p className="text-xs text-slate-500">
          Synthetic data, time-based split, small agentic sample.{" "}
          <button type="button" onClick={() => setTab("overview")} className="font-medium text-teal-700 hover:underline">See method and caveats</button>
        </p>
      )}
      </div>

      {tab === "overview" && (
      <Card title="Method and caveats">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Synthetic data with injected fraud patterns; results show the method works, not production performance.</li>
          <li>Time-based split: train days {String(det.split.train_days)}, validation {String(det.split.validation_days)}, test {String(det.split.test_days)}. Features use only data before each transaction. Thresholds calibrated on validation only (rules {String(det.thresholds.rules)}, blend {String(det.thresholds.blend)}).</li>
          <li>Baseline is the rules-only engine on the same data; "FraudLens" is the ML + anomaly + rules blend that runs in production.</li>
          {ag?.sample && <li>The agentic sample is {ag.sample.size} cases ({ag.sample.fraud} fraud, {ag.sample.legit} legit) plus the golden scenarios; agreement figures are indicative. Cost uses Gemini list prices.</li>}
          <li>Fraud counts on the screening tab are derived from candidates × precision and rounded; impact figures are exact counts.</li>
          <li>
            Sources: <span className="font-mono text-xs">docs/metrics/*.json</span> · detection {new Date(det.generated_at).toLocaleString("en-IN")} ({det.model_version})
            {i && <> · impact {new Date(i.generated_at).toLocaleString("en-IN")}</>}
            {ag && <> · agentic {new Date(ag.generated_at).toLocaleString("en-IN")} (prompt {ag.prompt_version}, policy {ag.policy_version})</>}.
          </li>
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Raw metrics JSON</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify({ detection: det, benchmark: bench, agentic: ag, impact: i }, null, 2)}</pre>
        </details>
      </Card>
      )}
    </div>
  );
}
