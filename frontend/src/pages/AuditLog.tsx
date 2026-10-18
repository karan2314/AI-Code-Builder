import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Chip, ErrorBox, Loading } from "../components/ui";
import { api } from "../lib/api";
import { humanize } from "../lib/format";

const KINDS = [
  { key: "", label: "All events" },
  { key: "analyst_", label: "Analyst decisions" },
  { key: "simulated_action", label: "Simulated actions" },
  { key: "policy_decision", label: "Policy decisions" },
  { key: "ai_summary", label: "AI summaries" },
  { key: "case_", label: "Case lifecycle" },
];

export default function AuditLog() {
  const a = useQuery({ queryKey: ["audit"], queryFn: () => api.audit(300), refetchInterval: 10000 });
  const [kind, setKind] = useState("");
  if (a.isLoading) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} />;
  const items = a.data!.items.filter((e) => !kind || e.event_type.startsWith(kind));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit log</h1>
          <p className="text-sm text-slate-600">Append-only record of every system, agent, policy and analyst event across recent cases.</p>
        </div>
        <label className="text-sm">Show{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1">
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
      </div>
      <Card>
        {items.length === 0 ? <p className="text-sm text-slate-500">No events yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Audit events, newest first</caption>
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1.5">Time</th><th>Case</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead>
              <tbody>
                {items.map((e) => {
                  const d = e.details as Record<string, unknown>;
                  const detail = d.reason ? `“${String(d.reason)}”` : d.action ? humanize(String(d.action)) : d.assignee !== undefined ? `→ ${String(d.assignee ?? "unassigned")}` : d.tier ? `Tier ${String(d.tier)}` : d.pattern ? humanize(String(d.pattern)) : "";
                  return (
                    <tr key={e.event_id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap py-1.5 text-xs text-slate-600">{new Date(e.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                      <td className="font-mono text-xs"><Link to={`/cases/${e.case_id}`} className="underline">{e.case_id}</Link></td>
                      <td className="font-medium">{humanize(e.event_type)}</td>
                      <td className="text-xs text-slate-600">{e.actor}</td>
                      <td className="text-xs">{d.override === true && <Chip tone="amber">override</Chip>} {d.simulated === true && <Chip tone="red">SIMULATED</Chip>} {detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
