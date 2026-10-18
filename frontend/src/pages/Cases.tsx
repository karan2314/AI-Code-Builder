import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Chip, ErrorBox, Loading, PriorityBadge, RiskBar, SlaChip, TierBadge } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, formatINR, humanize, maskId, slaText } from "../lib/format";
import type { BoardItem } from "../types";

const GROUPS: { key: string; label: string; match: (c: BoardItem) => boolean }[] = [
  { key: "review", label: "Awaiting review", match: (c) => ["awaiting_review", "manual_review", "investigating"].includes(c.status) },
  { key: "open", label: "Not investigated", match: (c) => c.status === "open" },
  { key: "done", label: "Resolved", match: (c) => ["approved", "modified", "closed"].includes(c.status) },
];

export default function Cases() {
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ["board"], queryFn: () => api.board(200), refetchInterval: 8000 });
  const analysts = useQuery({ queryKey: ["analysts"], queryFn: api.analysts, staleTime: Infinity });
  const [mine, setMine] = useState("");
  const assign = useMutation({
    mutationFn: (v: { id: string; who: string | null }) => api.assign(v.id, v.who),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board"] }),
  });
  if (b.isLoading) return <Loading />;
  if (b.error) return <ErrorBox error={b.error} />;
  const items = b.data!.items.filter((c) => !mine || c.assignee === mine);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cases</h1>
          <p className="text-sm text-slate-600">Every alert opened as a case, with its policy tier, owner, SLA and outcome.</p>
        </div>
        <label className="text-sm">Assignee{" "}
          <select value={mine} onChange={(e) => setMine(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1">
            <option value="">Everyone</option>
            {analysts.data?.items.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
      </div>
      {assign.error && <ErrorBox error={assign.error} />}
      {b.data!.items.length === 0 && <Card><p className="text-sm text-slate-600">No cases yet. Open an alert from the <Link to="/queue" className="underline">alert queue</Link>.</p></Card>}
      {GROUPS.map((g) => {
        const rows = items.filter(g.match);
        if (!rows.length) return null;
        return (
          <Card key={g.key} title={`${g.label} (${rows.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{g.label} cases</caption>
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr><th className="py-1.5">Priority</th><th>Case</th><th>Customer</th><th className="text-right">Amount</th><th className="pl-3">Risk</th><th>Tier</th><th>Status</th><th>SLA</th><th>Assignee</th><th>Updated</th></tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.case_id} className="border-t border-slate-100">
                      <td className="py-2"><PriorityBadge p={c.priority} /></td>
                      <td className="font-mono text-xs"><Link to={`/cases/${c.case_id}`} className="font-semibold text-teal-800 underline">{c.case_id}</Link><div className="text-slate-500">{c.transaction_id}</div></td>
                      <td className="font-mono text-xs">{maskId(c.customer_id)}</td>
                      <td className="whitespace-nowrap text-right font-semibold">{formatINR(c.amount_rupees)}</td>
                      <td className="pl-3"><RiskBar value={c.risk_score} /></td>
                      <td><TierBadge tier={c.tier} /></td>
                      <td className="whitespace-nowrap"><Chip>{humanize(c.status)}</Chip>{c.override && <Chip tone="amber">override</Chip>}</td>
                      <td><SlaChip sla={c.sla} text={slaText(c.sla)} /></td>
                      <td>
                        <label className="sr-only" htmlFor={`as-${c.case_id}`}>Assignee for {c.case_id}</label>
                        <select id={`as-${c.case_id}`} value={c.assignee ?? ""} disabled={assign.isPending}
                          onChange={(e) => assign.mutate({ id: c.case_id, who: e.target.value || null })}
                          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs">
                          <option value="">Unassigned</option>
                          {analysts.data?.items.map((a) => <option key={a}>{a}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-500">{dateTime(c.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
