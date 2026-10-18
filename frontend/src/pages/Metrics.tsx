import { useQuery } from "@tanstack/react-query";
import { Card, ErrorBox, Loading, Stat } from "../components/ui";
import { api } from "../lib/api";
import { formatNum, humanize, pct } from "../lib/format";

const LABELS: Record<string, string> = {
  A_rules: "A · Rules only",
  B_ml_blend: "B · ML + anomaly + rules",
};

export default function Metrics() {
  const m = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  if (m.isLoading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  const det = m.data!.detection;
  const agentic = m.data!.agentic as Record<string, unknown> | null;
  const bench = m.data!.benchmark as Record<string, unknown> | null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Evaluation</h1>
      <p className="text-sm text-slate-600">All numbers are measured by the evaluation scripts on the held-out synthetic test split and read from docs/metrics/*.json. Nothing here is estimated.</p>
      {det ? (
        <Card title={`First-stage detection · test days ${det.split.test_days} · ${formatNum(Number(det.split.test_transactions))} transactions`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Detection benchmark</caption>
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-1">Variant</th><th>Precision</th><th>Recall</th><th>PR-AUC</th><th>FP / 10k</th><th>Candidate rate</th><th>Fraud value captured</th></tr>
              </thead>
              <tbody>
                {Object.entries(det.variants).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-2 font-medium">{LABELS[k] ?? k}</td>
                    <td>{pct(v.precision)}</td><td>{pct(v.recall)}</td><td>{v.pr_auc.toFixed(3)}</td>
                    <td>{v.false_positives_per_10k}</td><td>{pct(v.candidate_rate, 2)}</td><td>{v.fraud_value_captured_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Model {det.model_version} · thresholds calibrated on validation ({String(det.thresholds.blend)} blend / {String(det.thresholds.rules)} rules) ·
            batch scoring {det.batch_scoring_ms_per_1k_txns} ms per 1k transactions · generated {new Date(det.generated_at).toLocaleString("en-IN")}
          </p>
          <h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Top global features (permutation importance)</h3>
          <ul className="flex flex-wrap gap-2 text-xs">{det.top_global_features.map(([f, v]) => <li key={f} className="rounded bg-slate-100 px-2 py-0.5">{humanize(f)} <span className="text-slate-700">{v.toFixed(3)}</span></li>)}</ul>
        </Card>
      ) : <Card><p className="text-sm">No detection metrics yet. Run <code>uv run python -m app.ml.train</code>.</p></Card>}
      {(() => {
        const r = m.data!.live.analyst_review;
        if (!r) return null;
        return (
          <section aria-labelledby="hitl-heading" className="space-y-2">
            <h2 id="hitl-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-600">Human in the loop · live (this session's case store)</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Cases reviewed by an analyst" value={formatNum(r.cases_reviewed)} />
              <Stat label="Analyst ↔ policy agreement" value={r.policy_agreement_rate === null ? "n/a" : pct(r.policy_agreement_rate)} hint={`${r.overrides} override(s), each with a logged reason`} />
              <Stat label="Analyst ↔ Gemini agreement" value={r.ai_agreement_rate === null ? "n/a" : pct(r.ai_agreement_rate)} hint={`${r.ai_compared} case(s) with an AI tier`} />
              <Stat label="Autonomy level" value="L2" hint="AI investigates, human decides every case" />
            </div>
            <p className="text-xs text-slate-500">Live counters, not evaluation results. Overrides are the feedback signal used to review agent and policy configuration.</p>
          </section>
        );
      })()}
      <Card title="Agentic investigation (Variant D)">
        {agentic ? <pre className="overflow-auto text-xs">{JSON.stringify(agentic, null, 2)}</pre>
          : <p className="text-sm text-slate-500">Not measured yet. Run <code>uv run python -m evals.run_benchmark</code> with Gemini enabled.</p>}
      </Card>
      {bench && <Card title="Benchmark summary"><pre className="overflow-auto text-xs">{JSON.stringify(bench, null, 2)}</pre></Card>}
    </div>
  );
}
