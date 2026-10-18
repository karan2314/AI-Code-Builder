import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import NetworkGraph, { NODE_COLORS } from "../components/NetworkGraph";
import { Card, Stat } from "../components/ui";
import { api } from "../lib/api";
import { formatNum } from "../lib/format";

const SUGGESTED = ["RCP-MULE-07", "CUST-HERO01", "DEV-HERO-NEW"];

export default function EntityNetwork() {
  const [params, setParams] = useSearchParams();
  const entity = params.get("entity") || SUGGESTED[0];
  const [draft, setDraft] = useState(entity);
  const explore = (id: string) => { setDraft(id); setParams({ entity: id }); };
  // Same query key as NetworkGraph, so this shares its request instead of fetching twice.
  const q = useQuery({ queryKey: ["network", entity, undefined], queryFn: () => api.network(entity) });
  const d = q.data;
  const counts = Object.keys(NODE_COLORS).map((t) => [t, d?.nodes.filter((n) => n.data.type === t).length ?? 0] as const);
  const fraud = d?.signals.known_fraud_nodes ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Customers, devices, recipients and merchants linked by payments and shared devices, with confirmed fraud highlighted.</p>

      <form className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-4 shadow-xs"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) explore(draft.trim().toUpperCase()); }}>
        <label htmlFor="entity-id" className="sr-only">Entity ID</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input id="entity-id" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Entity ID, e.g. CUST-000851"
            className="w-72 rounded-md border border-slate-300 bg-white py-2 pl-8 pr-3 font-mono text-sm" />
        </div>
        <button type="submit" className="rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">Explore</button>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-500">Try</span>
          {SUGGESTED.map((s) => (
            <button key={s} type="button" onClick={() => explore(s)} aria-pressed={entity === s}
              className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium ${entity === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{s}</button>
          ))}
        </div>
      </form>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card className="xl:col-span-3" title={<>Network around <span className="font-mono">{entity}</span></>}>
          <NetworkGraph key={entity} entityId={entity} height="h-[34rem]" />
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
            <Stat label="Entities" value={d ? formatNum(d.signals.node_count) : "…"} hint={d ? `${formatNum(d.signals.edge_count)} links` : undefined} />
            <Stat label="Known fraud" value={<span className={fraud.length ? "text-red-700" : undefined}>{d ? formatNum(fraud.length) : "…"}</span>}
              hint={d ? `${d.signals.node_count ? Math.round((fraud.length / d.signals.node_count) * 100) : 0}% of the network` : undefined} />
          </div>

          <Card title="Composition">
            <dl className="space-y-2 text-sm">
              {counts.map(([t, n]) => (
                <div key={t} className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 capitalize text-slate-600"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NODE_COLORS[t] }} aria-hidden />{t}s</dt>
                  <dd className="font-medium text-slate-900">{formatNum(n)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Known fraud entities">
            {fraud.length === 0 ? <p className="text-sm text-slate-500">None in this network.</p> : (
              <ul className="space-y-1">
                {fraud.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => explore(id)} title={`Explore the network around ${id}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
                      <span className="font-mono text-xs text-slate-900">{id}</span>
                      <span className="ml-auto text-xs text-teal-700">Explore</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
