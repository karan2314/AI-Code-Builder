import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HeroButton } from "../App";
import { Card, ErrorBox, Loading, Stat } from "../components/ui";
import { api } from "../lib/api";
import { formatNum, pct } from "../lib/format";

export default function Dashboard() {
  const m = useQuery({ queryKey: ["metrics"], queryFn: api.metrics, refetchInterval: 5000 });
  if (m.isLoading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  const live = m.data!.live;
  const det = m.data!.detection;
  const tiers = [1, 2, 3].map((t) => ({ tier: `Tier ${t}`, cases: live.tier_distribution[String(t)] ?? 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Operations dashboard</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Rules + ML screen every transaction. Only candidates go to the Gemini-powered agentic investigation, and a
            deterministic policy engine decides the risk tier.
          </p>
        </div>
        <HeroButton />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Transactions screened" value={formatNum(live.transactions_screened)} hint="first-stage, no LLM" />
        <Stat label="Candidates" value={formatNum(live.candidates)} hint={`${pct(live.candidate_rate, 2)} of volume`} />
        <Stat label="Gemini escalation rate" value={pct(live.gemini_escalation_rate, 2)} hint="share eligible for AI investigation" />
        <Stat label="Open cases" value={formatNum(live.open_cases)} />
        <Stat label="Cases investigated" value={formatNum(live.cases_investigated)} />
        <Stat label="Evidence validity" value={pct(live.avg_evidence_validity_rate)} hint="AI claims citing real evidence" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tier distribution (investigated cases)">
          <div className="h-56" role="img" aria-label={tiers.map((t) => `${t.tier}: ${t.cases}`).join(", ")}>
            <ResponsiveContainer>
              <BarChart data={tiers}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="tier" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="cases" fill="#0f766e" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="First-stage detection (held-out test split)" actions={<Link to="/metrics" className="text-sm text-teal-700 underline">Details</Link>}>
          {det ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Detection metrics on the test split</caption>
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">Variant</th><th>Precision</th><th>Recall</th><th>PR-AUC</th><th>FP / 10k</th></tr>
              </thead>
              <tbody>
                {Object.entries(det.variants).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium">{k === "A_rules" ? "A · Rules only" : "B · ML + anomaly + rules"}</td>
                    <td>{pct(v.precision)}</td><td>{pct(v.recall)}</td><td>{v.pr_auc.toFixed(3)}</td><td>{v.false_positives_per_10k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Run the training script to produce metrics.</p>
          )}
          <p className="mt-3 text-xs text-slate-500">Measured on synthetic data (model {det?.model_version}). Source: docs/metrics/detection_metrics.json</p>
        </Card>
      </div>
      <p className="text-xs text-slate-500">Case store: {live.case_store}</p>
    </div>
  );
}
