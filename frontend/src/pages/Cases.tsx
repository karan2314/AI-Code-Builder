import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Chip, ErrorBox, Loading, PriorityBadge, RiskBar, SlaChip, TierBadge } from "../components/ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { api } from "../lib/api";
import { dateTime, formatINR, humanize, maskId, slaText } from "../lib/format";
import type { BoardItem } from "../types";

const GROUPS: { key: string; label: string; match: (c: BoardItem) => boolean }[] = [
  { key: "review", label: "Awaiting review", match: (c) => ["awaiting_review", "manual_review", "investigating"].includes(c.status) },
  { key: "open", label: "Pending investigation", match: (c) => c.status === "open" },
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
            <div className="overflow-hidden rounded-lg border border-border bg-white">
              <Table>
                <TableCaption className="sr-only">{g.label} cases</TableCaption>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {["Priority", "Case", "Customer", "Amount", "Risk", "Tier", "Status", "SLA", "Assignee", "Updated"].map((h) => (
                      <TableHead key={h} className={h === "Amount" ? "h-11 text-right" : "h-11"}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.case_id}>
                      <TableCell><PriorityBadge p={c.priority} /></TableCell>
                      <TableCell className="font-mono text-xs"><Link to={`/cases/${c.case_id}`} className="font-semibold text-teal-800 underline">{c.case_id}</Link><div className="text-slate-500">{c.transaction_id}</div></TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{maskId(c.customer_id)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatINR(c.amount_rupees)}</TableCell>
                      <TableCell><RiskBar value={c.risk_score} /></TableCell>
                      <TableCell><TierBadge tier={c.tier} /></TableCell>
                      <TableCell className="whitespace-nowrap"><Chip>{humanize(c.status)}</Chip>{c.override && <Chip tone="amber">override</Chip>}</TableCell>
                      <TableCell><SlaChip sla={c.sla} text={slaText(c.sla)} /></TableCell>
                      <TableCell>
                        <label className="sr-only" htmlFor={`as-${c.case_id}`}>Assignee for {c.case_id}</label>
                        <select id={`as-${c.case_id}`} value={c.assignee ?? ""} disabled={assign.isPending}
                          onChange={(e) => assign.mutate({ id: c.case_id, who: e.target.value || null })}
                          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs">
                          <option value="">Unassigned</option>
                          {analysts.data?.items.map((a) => <option key={a}>{a}</option>)}
                        </select>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">{dateTime(c.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
