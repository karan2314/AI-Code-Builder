import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import NetworkGraph from "../components/NetworkGraph";
import { Card } from "../components/ui";

const SUGGESTED = ["RCP-MULE-07", "CUST-HERO01", "DEV-HERO-NEW"];

export default function EntityNetwork() {
  const [params, setParams] = useSearchParams();
  const entity = params.get("entity") || SUGGESTED[0];
  const [draft, setDraft] = useState(entity);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Entity network</h1>
        <p className="text-sm text-slate-600">Customers, devices, recipients and merchants linked by payments and shared devices, with confirmed fraud highlighted.</p>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) setParams({ entity: draft.trim().toUpperCase() }); }}>
        <label className="text-sm">Entity ID
          <input value={draft} onChange={(e) => setDraft(e.target.value)} className="ml-2 rounded border border-slate-300 px-2 py-1 font-mono text-sm" />
        </label>
        <button type="submit" className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800">Explore</button>
        <span className="text-xs text-slate-500">Try:</span>
        {SUGGESTED.map((s) => (
          <button key={s} type="button" onClick={() => { setDraft(s); setParams({ entity: s }); }} className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs hover:bg-slate-300">{s}</button>
        ))}
      </form>
      <Card title={<span className="font-mono normal-case">{entity}</span>}>
        <NetworkGraph key={entity} entityId={entity} />
      </Card>
    </div>
  );
}
