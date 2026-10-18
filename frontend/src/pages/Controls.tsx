import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Card, Chip, ErrorBox, Loading, PriorityBadge, Stat, TierBadge, score1000 } from "../components/ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableScrollBox, stickyHeader } from "../components/ui/table";
import { api } from "../lib/api";
import { humanize } from "../lib/format";
import type { Priority, Tier } from "../types";

const BLEND_COLOR: Record<string, string> = { ml: "bg-teal-600", rules: "bg-sky-600", anomaly: "bg-violet-600" };

export default function Controls() {
  const c = useQuery({ queryKey: ["controls"], queryFn: api.controls, staleTime: 60_000 });
  if (c.isLoading) return <Loading />;
  if (c.error) return <ErrorBox error={c.error} />;
  const d = c.data!;
  const blend = Object.entries(d.model.blend);
  const blendTotal = blend.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">What decides what: the screening model, the deterministic policy, the autonomy ceiling and the operating rules. Read-only in this build.</p>
        <Link to="/metrics" className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline">Evaluation results<ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Screening model" value={<span className="font-mono text-base">{d.model.version}</span>} hint="Gradient boosting + Isolation Forest + rules" />
        <Stat label="Alert threshold" value={`${score1000(d.model.threshold)} / 1000`} hint="Blended risk score that opens an alert" />
        <Stat label="Policy engine" value={<span className="font-mono text-base">{d.policy.version}</span>} hint={`${Object.keys(d.policy.rules).length} deterministic rules`} />
        <Stat label="Autonomy" value={`L${d.autonomy.current_level}`} hint={d.autonomy.levels[String(d.autonomy.current_level)]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="First-stage screening model" actions={<Chip tone="teal">No LLM on this path</Chip>}>
          <p className="text-sm text-slate-600">Risk score = weighted blend of three signals.</p>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {blend.map(([k, v]) => <span key={k} className={BLEND_COLOR[k] ?? "bg-slate-400"} style={{ width: `${(v / blendTotal) * 100}%` }} />)}
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            {blend.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-slate-600"><span className={`h-2.5 w-2.5 rounded-sm ${BLEND_COLOR[k] ?? "bg-slate-400"}`} aria-hidden />{k === "ml" ? "ML model" : humanize(k)}</dt>
                <dd className="font-medium tabular-nums text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
          {d.decision_model && (
            <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-violet-900">{d.decision_model.name}</p>
                <Chip tone={d.decision_model.enabled ? "teal" : "slate"}>{d.decision_model.enabled ? "Enabled" : "Disabled"}</Chip>
              </div>
              <p className="mt-1 text-xs text-slate-700">{d.decision_model.role}</p>
            </div>
          )}
        </Card>

        <Card title="Autonomy ladder">
          <ol className="space-y-1">
            {Object.entries(d.autonomy.levels).map(([lvl, text]) => {
              const current = Number(lvl) === d.autonomy.current_level;
              return (
                <li key={lvl} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${current ? "bg-violet-50 ring-1 ring-violet-200" : ""}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${current ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-600"}`}>L{lvl}</span>
                  <span className={current ? "font-medium text-violet-950" : "text-slate-700"}>{text}</span>
                  {current && <span className="ml-auto text-xs font-medium text-violet-800">Current</span>}
                </li>
              );
            })}
          </ol>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs text-slate-500">Promotion ceiling per tier, after validation</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(d.autonomy.ceilings).map(([t, l]) => (
                <span key={t} className="inline-flex items-center gap-1.5"><TierBadge tier={Number(t) as Tier} /><span className="text-xs text-slate-600">→ L{l}</span></span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Every case still needs an analyst decision.</p>
          </div>
        </Card>
      </div>

      <Card title="Policy engine" actions={<span className="font-mono text-xs text-slate-500">v{d.policy.version}</span>}>
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <h3 className="text-sm font-semibold text-slate-700">Rules</h3>
            <ol className="mt-2 divide-y divide-border">
              {Object.entries(d.policy.rules).map(([r, t]) => {
                const [cond, outcome] = t.split(/\s*→\s*/, 2);
                return (
                  <li key={r} className="flex gap-3 py-2 text-sm">
                    <span className="mt-0.5 h-fit shrink-0 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{r}</span>
                    <span className="text-slate-700">{cond}{outcome && <> <ArrowRight className="mx-0.5 inline h-3.5 w-3.5 text-slate-400" aria-label="then" /> <span className="font-medium text-slate-900">{outcome}</span></>}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="space-y-5 lg:col-span-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Tiers and simulated responses</h3>
              <ul className="mt-2 space-y-2.5">
                {Object.entries(d.policy.tiers).map(([t, v]) => (
                  <li key={t} className="space-y-1">
                    <TierBadge tier={Number(t) as Tier} />
                    <p className="text-sm text-slate-600">{v.actions.map(humanize).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Thresholds</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                {Object.entries(d.policy.config).map(([k, v]) => (
                  <Fragment key={k}><dt className="text-slate-600">{humanize(k)}</dt><dd className="text-right font-mono text-xs tabular-nums text-slate-900">{v}</dd></Fragment>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Operations" className="lg:col-span-2">
          <ul className="divide-y divide-border">
            {(Object.keys(d.operations.priority_bands) as Priority[]).map((p) => (
              <li key={p} className="flex items-center gap-3 py-2.5 text-sm">
                <PriorityBadge p={p} />
                <span className="text-slate-700">{d.operations.priority_bands[p]}</span>
                <span className="ml-auto whitespace-nowrap text-xs font-medium text-slate-500">SLA {d.operations.sla_minutes[p] / 60}h</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs text-slate-500">Analysts</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {d.operations.analysts.map((a) => (
                <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2.5 text-xs text-slate-700">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white" aria-hidden>{a.replace(/[^A-Z]/g, "").slice(0, 2)}</span>{a}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Prototype operating values.</p>
          </div>
        </Card>

        <div className="space-y-3 lg:col-span-3">
          <h2 className="text-base font-semibold text-slate-900">Reason codes</h2>
          <TableScrollBox rows={8}>
            <Table>
              <TableCaption className="sr-only">Reason codes and their meaning</TableCaption>
              <TableHeader className={stickyHeader}>
                <TableRow className="hover:bg-transparent"><TableHead className="h-11">Code</TableHead><TableHead className="h-11">Meaning</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(d.reason_codes).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-slate-900">{k}</TableCell>
                    <TableCell className="text-slate-700">{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScrollBox>
        </div>
      </div>
    </div>
  );
}
