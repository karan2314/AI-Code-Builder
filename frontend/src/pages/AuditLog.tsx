import { useQuery } from "@tanstack/react-query";
import { Bot, FileClock, Scale, Server, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Chip, ErrorBox, Loading, Stat } from "../components/ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableScrollBox, stickyHeader } from "../components/ui/table";
import { api } from "../lib/api";
import { formatNum, humanize, pct } from "../lib/format";
import type { AuditEvent } from "../types";

type Tone = "slate" | "red" | "amber" | "teal" | "sky";
// Each filter is an event-type prefix; tone colours the event chip so the categories scan at a glance.
const KINDS: { key: string; label: string; tone: Tone }[] = [
  { key: "", label: "All events", tone: "slate" },
  { key: "analyst_", label: "Analyst decisions", tone: "teal" },
  { key: "simulated_action", label: "Simulated actions", tone: "red" },
  { key: "policy_decision", label: "Policy decisions", tone: "amber" },
  { key: "ai_summary", label: "AI summaries", tone: "sky" },
  { key: "case_", label: "Case lifecycle", tone: "slate" },
];
const toneFor = (type: string) => KINDS.find((k) => k.key && type.startsWith(k.key))?.tone ?? "slate";

function ActorIcon({ actor }: { actor: string }) {
  const a = actor.toLowerCase();
  const Icon = a === "system" ? Server : a.startsWith("policy") ? Scale : /agent|gemini|ai|laya/.test(a) ? Bot : UserRound;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />;
}

function detailText(e: AuditEvent) {
  const d = e.details;
  return d.reason ? `“${String(d.reason)}”` : d.action ? humanize(String(d.action)) : d.assignee !== undefined ? `→ ${String(d.assignee ?? "unassigned")}`
    : d.tier ? `Tier ${String(d.tier)}` : d.pattern ? humanize(String(d.pattern)) : "";
}

export default function AuditLog() {
  const a = useQuery({ queryKey: ["audit"], queryFn: () => api.audit(300), refetchInterval: 10000 });
  const [kind, setKind] = useState("");
  // Live analyst-vs-policy/AI agreement lives here (moved off Evaluation, which only shows reproducible eval results).
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics, refetchInterval: 10000 });
  const review = metrics.data?.live.analyst_review;
  if (a.isLoading) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} />;
  const all = a.data!.items;
  const count = (k: string) => all.filter((e) => !k || e.event_type.startsWith(k)).length;
  const items = all.filter((e) => !kind || e.event_type.startsWith(kind));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Append-only record of every system, agent, policy and analyst event across recent cases.</p>

      {review && (
        <section aria-labelledby="hitl-heading" className="space-y-2">
          <h2 id="hitl-heading" className="text-base font-semibold text-slate-900">Analyst review · live</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Cases reviewed by an analyst" value={formatNum(review.cases_reviewed)} />
            <Stat label="Analyst ↔ policy agreement" value={review.policy_agreement_rate === null ? "n/a" : pct(review.policy_agreement_rate)} hint={`${review.overrides} override(s), each with a logged reason`} />
            <Stat label="Analyst ↔ Gemini agreement" value={review.ai_agreement_rate === null ? "n/a" : pct(review.ai_agreement_rate)} hint={`${review.ai_compared} case(s) with an AI tier`} />
            <Stat label="Autonomy level" value="L2" hint="AI investigates, human decides every case" />
          </div>
          <p className="text-xs text-slate-500">Counters from this session's case store. Overrides are the feedback signal for reviewing agent and policy configuration.</p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter by event type" className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button key={k.key} type="button" role="tab" aria-selected={kind === k.key} onClick={() => setKind(k.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${kind === k.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 shadow-xs hover:bg-slate-100"}`}>
              {k.label} ({count(k.key)})
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">Newest first · refreshes every 10 s</span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white px-4 py-12 text-center shadow-xs">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-hidden><FileClock className="h-5 w-5" /></span>
          <p className="text-base font-semibold text-slate-900">No events{kind ? " of this type" : " yet"}</p>
          <p className="text-sm text-slate-600">Events appear as cases are opened, investigated and decided.</p>
        </div>
      ) : (
        <TableScrollBox rows={10}>
          <Table>
            <TableCaption className="sr-only">Audit events, newest first</TableCaption>
            <TableHeader className={stickyHeader}>
              <TableRow className="hover:bg-transparent">{["Time", "Case", "Event", "Actor", "Details"].map((h) => <TableHead key={h} className="h-11">{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => {
                const ts = new Date(e.timestamp);
                return (
                  <TableRow key={e.event_id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="text-sm text-slate-900">{ts.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                      <div className="text-xs text-slate-500">{ts.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs"><Link to={`/cases/${e.case_id}`} className="text-teal-700 hover:underline">{e.case_id}</Link></TableCell>
                    <TableCell><Chip tone={toneFor(e.event_type)}>{humanize(e.event_type)}</Chip></TableCell>
                    <TableCell><span className="flex items-center gap-1.5 text-xs text-slate-700"><ActorIcon actor={e.actor} />{e.actor}</span></TableCell>
                    <TableCell className="text-sm text-slate-700">
                      <span className="flex flex-wrap items-center gap-1">
                        {e.details.override === true && <Chip tone="amber">Override</Chip>}
                        {e.details.simulated === true && <Chip tone="red">Simulated</Chip>}
                        {detailText(e) || <span className="text-xs text-slate-400">—</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScrollBox>
      )}
    </div>
  );
}
