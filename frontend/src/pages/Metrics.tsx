import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Coins, Gauge, ShieldCheck, Target, TrendingUp, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, ErrorBox, Loading } from "../components/ui";
import { api } from "../lib/api";
import { formatINR, formatNum, pct } from "../lib/format";
import type { Impact } from "../types";

const TEAL = "#0f766e";
const SLATE = "#94a3b8";

function Headline({ icon: Icon, value, label, detail }: { icon: typeof Target; value: ReactNode; label: string; detail: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-teal-800"><Icon className="h-4 w-4" aria-hidden />{label}</div>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-700">{detail}</p>
    </div>
  );
}

function Compare({ label, before, after, better = "higher", fmt }: { label: string; before: number; after: number; better?: "higher" | "lower"; fmt: (v: number) => string }) {
  const improved = better === "higher" ? after > before : after < before;
  return (
    <tr className="border-t border-slate-100">
      <th scope="row" className="py-2 text-left font-medium">{label}</th>
      <td className="text-right text-slate-600">{fmt(before)}</td>
      <td className="px-2 text-center text-slate-400"><ArrowRight className="inline h-3.5 w-3.5" aria-label="to" /></td>
      <td className={`text-right font-semibold ${improved ? "text-teal-800" : "text-amber-800"}`}>{fmt(after)}</td>
      <td className="pl-3 text-xs">{improved ? <span className="text-teal-800">better</span> : <span className="text-amber-800">trade-off</span>}</td>
    </tr>
  );
}

function Funnel({ i }: { i: Impact }) {
  const f = i.funnel;
  const steps = [
    { label: "Transactions screened", value: f.screened, note: "rules + ML, no LLM, milliseconds" },
    { label: "Alerts (screening)", value: f.alerts, note: `1 in ${formatNum(i.headline.transactions_per_alert)} · ${f.alerts_fraud} are real fraud` },
    { label: "Escalated by policy (Tier 2–3)", value: f.escalated_tier2plus, note: `${pct(f.escalated_precision ?? 0, 1)} of escalations are real fraud` },
    { label: "Contain (Tier 3)", value: Number(f.policy_tiers["3"] ?? 0), note: `${f.policy_tiers_fraud["3"] ?? 0} of ${f.policy_tiers["3"] ?? 0} are real fraud` },
  ];
  const max = Math.log10(f.screened);
  return (
    <ol className="space-y-2" aria-label="Detection funnel on the held-out test split">
      {steps.map((s) => (
        <li key={s.label} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr]">
          <span className="font-medium">{s.label}</span>
          <div className="flex items-center gap-3">
            <div className="h-7 rounded bg-teal-700" style={{ width: `${Math.max(4, (Math.log10(Math.max(s.value, 1)) / max) * 100)}%` }} aria-hidden />
            <span className="whitespace-nowrap"><strong>{formatNum(s.value)}</strong> <span className="text-slate-600">{s.note}</span></span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Metrics() {
  const m = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  if (m.isLoading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  const i = m.data!.impact;
  const det = m.data!.detection;
  if (!i || !det) {
    return <Card><p className="text-sm">Impact metrics not generated yet. Run <code>uv run python -m evals.run_impact</code>.</p></Card>;
  }
  const h = i.headline;
  const r = i.variants.rules, f = i.variants.fraudlens, u = i.variants.union;
  const a = i.agentic;
  const byType = i.by_fraud_type.map((t) => ({ name: t.label, Rules: Math.round((t.rules_caught / t.fraud_transactions) * 100), FraudLens: Math.round((t.fraudlens_caught / t.fraud_transactions) * 100), n: t.fraud_transactions }));
  const sortCurve = (c: { recall: number; precision: number }[]) => [...c].sort((x, y) => x.recall - y.recall);
  const prRules = sortCurve(i.pr_curves.rules), prFl = sortCurve(i.pr_curves.fraudlens);
  const review = m.data!.live.analyst_review;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Evaluation · how much better FraudLens performs</h1>
        <p className="text-sm text-slate-700">
          Held-out test period: <strong>{formatNum(i.test_transactions)}</strong> transactions containing <strong>{i.test_fraud_transactions}</strong> fraud cases the models never saw.
          Baseline: a rules-only fraud engine on the same data.
        </p>
      </div>

      {/* 1. Headline impact */}
      <section aria-labelledby="impact-h" className="space-y-3">
        <h2 id="impact-h" className="sr-only">Headline impact</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Headline icon={Target} label="More fraud caught" value={`+${h.extra_frauds_caught} frauds`}
            detail={<>{pct(h.extra_frauds_caught_pct, 0)} more than rules alone: {f.caught} vs {r.caught} of {i.test_fraud_transactions} (recall {pct(h.recall_rules, 0)} → {pct(h.recall_fraudlens, 0)})</>} />
          <Headline icon={TrendingUp} label="Sharper risk ranking" value={`+${pct(h.pr_auc_gain_pct, 0)}`}
            detail={<>PR-AUC {h.pr_auc_rules.toFixed(2)} → {h.pr_auc_fraudlens.toFixed(2)}: real fraud is ranked above legitimate payments far more reliably</>} />
          <Headline icon={Coins} label="AI cost focused on risk" value={h.llm_cost_reduction_x ? `${h.llm_cost_reduction_x}× cheaper` : pct(h.llm_calls_avoided_pct, 1)}
            detail={<>{pct(h.llm_calls_avoided_pct, 1)} of transactions never reach Gemini{h.llm_cost_per_1000_fraudlens_usd != null && <>: ${h.llm_cost_per_1000_fraudlens_usd.toFixed(2)} vs ${h.llm_cost_per_1000_if_all_usd?.toFixed(0)} per 1,000 transactions</>}</>} />
          <Headline icon={ShieldCheck} label="Trustworthy AI output" value={a?.evidence_validity_rate_mean != null ? `${pct(a.evidence_validity_rate_mean, 0)} grounded` : "n/a"}
            detail={<>{a ? `${a.invalid_citations_total} invented citations; every AI claim links to tool-verified evidence` : "Run the agentic benchmark"}</>} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* 2. Funnel */}
        <Card title="From every transaction to the few that need action" className="xl:col-span-3">
          <Funnel i={i} />
          <p className="mt-3 text-xs text-slate-600">Bar length on a log scale. Policy tiers use the same tools and deterministic policy as production for every test alert. Analysts start with the {formatNum(i.funnel.escalated_tier2plus)} escalated cases, and {pct(i.funnel.escalated_precision ?? 0, 0)} of them are real fraud.</p>
        </Card>
        {/* 3. Before / after */}
        <Card title="Rules engine vs FraudLens" className="xl:col-span-2">
          <table className="w-full text-sm">
            <caption className="sr-only">Rules-only baseline compared with FraudLens screening on the test split</caption>
            <thead className="text-xs uppercase text-slate-500"><tr><th className="text-left font-medium">Metric</th><th className="text-right font-medium">Rules</th><th /><th className="text-right font-medium">FraudLens</th><th /></tr></thead>
            <tbody>
              <Compare label="Fraud caught" before={r.caught} after={f.caught} fmt={formatNum} />
              <Compare label="Fraud missed" before={r.missed} after={f.missed} better="lower" fmt={formatNum} />
              <Compare label="Recall" before={r.recall} after={f.recall} fmt={(v) => pct(v, 1)} />
              <Compare label="PR-AUC" before={h.pr_auc_rules} after={h.pr_auc_fraudlens} fmt={(v) => v.toFixed(3)} />
              <Compare label="Alerts to review" before={r.alerts} after={f.alerts} better="lower" fmt={formatNum} />
              <Compare label="Precision" before={r.precision} after={f.precision} fmt={(v) => pct(v, 1)} />
              <Compare label="False alarms" before={r.false_alarms} after={f.false_alarms} better="lower" fmt={formatNum} />
            </tbody>
          </table>
        </Card>
      </div>

      {/* 4. Where it's better */}
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
          <summary className="cursor-pointer text-teal-800 underline">View as table</summary>
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Catch rate by fraud pattern</caption>
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th>Pattern</th><th className="text-right">Fraud cases</th><th className="text-right">Rules</th><th className="text-right">FraudLens</th></tr></thead>
            <tbody>{i.by_fraud_type.map((t) => <tr key={t.type} className="border-t border-slate-100"><td className="py-1">{t.label}</td><td className="text-right">{t.fraud_transactions}</td><td className="text-right">{t.rules_caught}</td><td className="text-right font-semibold">{t.fraudlens_caught}</td></tr>)}</tbody>
          </table>
        </details>
        <p className="mt-2 text-sm text-slate-700">Biggest gains come from behaviour-based fraud that fixed thresholds miss: account takeovers and card-testing bursts. Legitimate high-value purchases flagged: rules {i.legit_high_value.rules_flagged} vs FraudLens {i.legit_high_value.fraudlens_flagged} of {i.legit_high_value.transactions}.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 5. PR curve */}
        <Card title="Precision at every catch rate">
          <div className="h-64" role="img" aria-label={`Precision-recall curves. PR-AUC rules ${h.pr_auc_rules.toFixed(2)}, FraudLens ${h.pr_auc_fraudlens.toFixed(2)}`}>
            <ResponsiveContainer>
              <LineChart margin={{ right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="recall" type="number" allowDuplicatedCategory={false} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} label={{ value: "Fraud caught (recall)", position: "insideBottom", offset: -2, fontSize: 12 }} height={40} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                <Tooltip formatter={(v) => (typeof v === "number" ? pct(v, 1) : String(v))} labelFormatter={(v) => `Recall ${pct(Number(v), 0)}`} />
                <Legend />
                <Line data={prRules} name="Rules" type="linear" dataKey="precision" stroke={SLATE} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line data={prFl} name="FraudLens" type="linear" dataKey="precision" stroke={TEAL} dot={false} strokeWidth={3} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-600">Higher and further right is better. FraudLens keeps precision high while catching far more fraud.</p>
        </Card>
        {/* 6. Speed, cost, trust */}
        <Card title="Speed, cost and trust">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-600"><Gauge className="mr-1 inline h-4 w-4" aria-hidden />Screening</dt><dd className="text-lg font-bold">{i.screening_ms_per_1k} ms / 1,000 txns</dd></div>
            <div><dt className="text-slate-600">AI investigation (typical / slowest 5%)</dt><dd className="text-lg font-bold">{a?.investigation_latency_ms.p50 ? `${(a.investigation_latency_ms.p50 / 1000).toFixed(1)} s / ${((a.investigation_latency_ms.p95 ?? 0) / 1000).toFixed(1)} s` : "n/a"}</dd></div>
            <div><dt className="text-slate-600">LLM cost per 1,000 transactions</dt><dd className="text-lg font-bold">{h.llm_cost_per_1000_fraudlens_usd != null ? `$${h.llm_cost_per_1000_fraudlens_usd.toFixed(2)}` : "n/a"}</dd></div>
            <div><dt className="text-slate-600">Escalations that are real fraud</dt><dd className="text-lg font-bold">{pct(i.funnel.escalated_precision ?? 0, 1)}</dd></div>
            <div><dt className="text-slate-600">AI tier matches ground truth</dt><dd className="text-lg font-bold">{a ? pct(a.sample.tier_vs_label_agreement, 0) : "n/a"} <span className="text-xs font-normal text-slate-600">(n = {a?.sample.size})</span></dd></div>
            <div><dt className="text-slate-600">Demo scenarios passed</dt><dd className="text-lg font-bold">{a ? `${Object.values(a.golden).filter((g) => g.pass).length} / ${Object.keys(a.golden).length}` : "n/a"}</dd></div>
            {review && <div className="col-span-2"><dt className="text-slate-600">Live analyst review</dt><dd>{formatNum(review.cases_reviewed)} reviewed · policy agreement {review.policy_agreement_rate == null ? "n/a" : pct(review.policy_agreement_rate)} · Gemini agreement {review.ai_agreement_rate == null ? "n/a" : pct(review.ai_agreement_rate)} · {review.overrides} override(s), each with a reason</dd></div>}
          </dl>
        </Card>
      </div>

      {/* 7. Trade-offs */}
      <Card title="Trade-offs, and how they are handled">
        <ul className="space-y-2 text-sm">
          <li><strong>More alerts, still a tiny fraction:</strong> {f.alerts} vs {r.alerts} alerts ({pct(f.alerts / i.test_transactions, 2)} of volume). The {h.extra_false_alarms} extra false alarms buy {h.extra_frauds_caught} extra frauds caught, and the agent investigation plus the policy engine filter them: {pct(i.funnel.escalated_precision ?? 0, 0)} of escalated cases are real fraud.</li>
          <li><strong>Rules still win on two patterns:</strong> payments to known mule networks and fraud on brand-new customers (see chart). Value of fraud caught: rules {formatINR(r.fraud_value_caught_rupees)} vs FraudLens {formatINR(f.fraud_value_caught_rupees)}.
            Measured fix: keeping rule hits as hard triggers on top of the ML screen catches <strong>{u.caught} of {i.test_fraud_transactions} ({pct(u.recall, 1)})</strong> and {formatINR(u.fraud_value_caught_rupees)} of fraud value, at precision {pct(u.precision, 1)} with {u.alerts} alerts. This is the next configuration change.</li>
          <li><strong>Not yet caught by anyone:</strong> scams to brand-new, unlinked mule accounts and first-party fraud. They look like normal behaviour, so they need external signals (beneficiary intelligence, consortium data).</li>
        </ul>
      </Card>

      {/* 8. Experiments */}
      <Card title="What we tested, kept and rejected">
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden /><span><strong>Kept: deterministic policy over Gemini.</strong> On validation alerts, policy escalations are {pct(i.policy_validation.precision, 1)} precise ({i.policy_validation.false_alarms} false escalations). Policy 2026.10.2 stopped the ML score from counting as its own signal, which removed 4 of 4 false escalations seen in testing.</span></li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden /><span><strong>Kept: citation guard.</strong> Valid-ID list plus one bounded repair took invalid AI citations to {a?.invalid_citations_total ?? 0}.</span></li>
          {i.laya && <li className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden /><span><strong>Rejected (for now): Laya open decision model as a router.</strong> Zero-shot it routed {i.laya.routed_investigate} of {i.laya.queried} alerts to "investigate" ({pct(i.laya.escalation_reduction, 0)} fewer escalations), so it stays off until fine-tuned.</span></li>}
        </ul>
      </Card>

      {/* 9. Methodology */}
      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Methodology and sources</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li>Synthetic BFSI dataset (seed 42, {formatNum(179242)} transactions, INR). Time-based split: train days {String(det.split.train_days)}, validation {String(det.split.validation_days)}, test {String(det.split.test_days)}. Features use only data before each transaction (leakage test in CI).</li>
          <li>Thresholds calibrated on validation (rules {String(det.thresholds.rules)}, FraudLens blend {String(det.thresholds.blend)}); all results on the test split. Model {i.model_version}; policy {a?.policy_version}; Gemini model {a?.gemini_model}.</li>
          <li>AI metrics: real Gemini runs on a stratified sample of {a?.sample.size} test alerts plus demo scenarios. Cost uses list prices (Gemini 3.5 Flash, global).</li>
          <li>Sources: <a className="underline" href="https://github.com/karan2314/AI-Code-Builder/tree/main/docs/metrics" target="_blank" rel="noreferrer">docs/metrics</a> (impact.json, detection_metrics.json, agentic_eval.json, laya_eval.json). Generated {new Date(i.generated_at).toLocaleString("en-IN")}.</li>
        </ul>
      </details>
    </div>
  );
}
