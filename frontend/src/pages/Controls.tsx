import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Card, ErrorBox, Loading, PriorityBadge, TierBadge, score1000 } from "../components/ui";
import { api } from "../lib/api";
import { humanize } from "../lib/format";
import type { Priority, Tier } from "../types";

export default function Controls() {
  const c = useQuery({ queryKey: ["controls"], queryFn: api.controls, staleTime: 60_000 });
  if (c.isLoading) return <Loading />;
  if (c.error) return <ErrorBox error={c.error} />;
  const d = c.data!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Models & controls</h1>
          <p className="text-sm text-slate-600">What decides what: the screening model, the deterministic policy, the autonomy ceiling and the operating rules. Read-only in this build.</p>
        </div>
        <Link to="/metrics" className="text-sm text-teal-700 underline">Evaluation results →</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="First-stage screening model">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Version</dt><dd className="font-mono text-xs">{d.model.version}</dd>
            <dt className="text-slate-500">Alert threshold</dt><dd>{score1000(d.model.threshold)} / 1000</dd>
            {Object.entries(d.model.blend).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">Blend weight · {humanize(k)}</dt><dd>{v}</dd></Fragment>)}
          </dl>
          <p className="mt-2 text-xs text-slate-500">Gradient boosting + Isolation Forest + transparent rules. No LLM on this path.</p>
          {d.decision_model && (
            <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-2 text-sm">
              <p className="font-semibold text-violet-900">{d.decision_model.name} · {d.decision_model.enabled ? "enabled" : "disabled"}</p>
              <p className="text-xs text-slate-700">{d.decision_model.role}</p>
            </div>
          )}
        </Card>

        <Card title="Autonomy ladder">
          <ol className="space-y-1.5 text-sm">
            {Object.entries(d.autonomy.levels).map(([lvl, text]) => (
              <li key={lvl} className={`flex items-center gap-2 rounded px-2 py-1 ${Number(lvl) === d.autonomy.current_level ? "bg-violet-50 font-semibold text-violet-900" : ""}`}>
                <span className="w-7 font-mono">L{lvl}</span>{text}{Number(lvl) === d.autonomy.current_level && <span className="ml-auto text-xs">current</span>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-600">Ceilings: {Object.entries(d.autonomy.ceilings).map(([t, l]) => `Tier ${t} → L${l}`).join(" · ")}. Every case needs an analyst decision.</p>
        </Card>
      </div>

      <Card title={`Policy engine · version ${d.policy.version}`}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">Rules</h3>
            <ul className="mt-1 space-y-1 text-sm">{Object.entries(d.policy.rules).map(([r, t]) => <li key={r}><span className="mr-2 font-mono text-xs font-semibold">{r}</span>{t}</li>)}</ul>
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Tiers and simulated responses</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {Object.entries(d.policy.tiers).map(([t, v]) => <li key={t} className="flex flex-wrap items-center gap-2"><TierBadge tier={Number(t) as Tier} />{v.actions.map(humanize).join(", ")}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Thresholds</h3>
              <dl className="mt-1 grid grid-cols-2 gap-y-0.5 text-xs">
                {Object.entries(d.policy.config).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{humanize(k)}</dt><dd className="font-mono">{v}</dd></Fragment>)}
              </dl>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Operations">
          <ul className="space-y-1.5 text-sm">
            {(Object.keys(d.operations.priority_bands) as Priority[]).map((p) => (
              <li key={p} className="flex items-center gap-2"><PriorityBadge p={p} />{d.operations.priority_bands[p]} · SLA {d.operations.sla_minutes[p] / 60}h</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-600">Analysts: {d.operations.analysts.join(", ")}. Prototype operating values.</p>
        </Card>
        <Card title="Reason codes">
          <dl className="max-h-64 space-y-1 overflow-auto text-xs">
            {Object.entries(d.reason_codes).map(([k, v]) => <div key={k}><dt className="inline font-semibold">{humanize(k)}</dt>: <dd className="inline text-slate-600">{v}</dd></div>)}
          </dl>
        </Card>
      </div>
    </div>
  );
}
