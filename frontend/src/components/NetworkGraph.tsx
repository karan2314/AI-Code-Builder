import { useQuery } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Chip, ErrorBox, Loading } from "./ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableScrollBox, stickyHeader } from "./ui/table";

const SHAPES: Record<string, string> = { customer: "ellipse", device: "round-rectangle", recipient: "diamond", merchant: "hexagon" };
export const NODE_COLORS: Record<string, string> = { customer: "#0369a1", device: "#6d28d9", recipient: "#b45309", merchant: "#475569" };

export default function NetworkGraph({ entityId, transactionId, height = "h-[28rem]" }: { entityId: string; transactionId?: string; height?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [asList, setAsList] = useState(false);
  const q = useQuery({ queryKey: ["network", entityId, transactionId], queryFn: () => api.network(entityId, transactionId) });

  useEffect(() => {
    if (!q.data || !ref.current || asList) return;
    const cy = cytoscape({
      container: ref.current,
      elements: [...q.data.nodes, ...q.data.edges],
      minZoom: 0.3, maxZoom: 3, wheelSensitivity: 0.2,
      layout: { name: "cose", animate: false, padding: 24, nodeRepulsion: () => 12000, idealEdgeLength: () => 80 } as cytoscape.LayoutOptions,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)", "font-size": 9, "font-family": "Inter, ui-sans-serif, system-ui", color: "#334155",
            "text-valign": "bottom", "text-margin-y": 4,
            "text-background-color": "#ffffff", "text-background-opacity": 0.85, "text-background-padding": "1px",
            "min-zoomed-font-size": 6,
            width: 20, height: 20,
            shape: ((n: cytoscape.NodeSingular) => SHAPES[n.data("type")] ?? "ellipse") as unknown as cytoscape.Css.NodeShape,
            "background-color": ((n: cytoscape.NodeSingular) => NODE_COLORS[n.data("type")] ?? "#64748b") as unknown as string,
          },
        },
        { selector: "node[fraud_status = 'confirmed']", style: { "border-width": 3, "border-color": "#dc2626", width: 26, height: 26, color: "#b91c1c", "font-weight": 600 } },
        { selector: "node[fraud_status = 'stale']", style: { "border-width": 3, "border-style": "dashed", "border-color": "#f59e0b" } },
        { selector: "node[?seed]", style: { width: 34, height: 34, "border-width": 4, "border-color": "#0f766e", "font-size": 11, "font-weight": 700, color: "#0f172a" } },
        { selector: "edge", style: { width: 1.2, "line-color": "#cbd5e1", "curve-style": "haystack" } },
        { selector: "edge[relation = 'account_uses_device'], edge[relation = 'used_device']", style: { "line-color": "#a78bfa", "line-style": "dashed" } },
        { selector: "node:selected", style: { "overlay-color": "#0f766e", "overlay-opacity": 0.15, "overlay-padding": 6 } },
      ],
    });
    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [q.data, asList]);

  if (q.isLoading) return <Loading label="Loading relationship graph…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const seg = (on: boolean) => `rounded px-2.5 py-1 text-xs font-medium ${on ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
          {Object.entries(NODE_COLORS).map(([t, c]) => (
            <li key={t} className="flex items-center gap-1.5 capitalize"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} aria-hidden />{t}</li>
          ))}
          <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-red-600" aria-hidden />Confirmed fraud</li>
          <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-amber-500" aria-hidden />Stale link</li>
        </ul>
        <div className="flex items-center gap-2">
          {!asList && (
            <button type="button" onClick={() => cyRef.current?.fit(undefined, 24)} title="Fit graph to view"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />Fit
            </button>
          )}
          <div role="group" aria-label="View" className="flex rounded-md bg-slate-100 p-0.5">
            <button type="button" aria-pressed={!asList} onClick={() => setAsList(false)} className={seg(!asList)}>Graph</button>
            <button type="button" aria-pressed={asList} onClick={() => setAsList(true)} className={seg(asList)}>List</button>
          </div>
        </div>
      </div>
      {asList ? (
        <TableScrollBox rows={10}>
          <Table>
            <TableCaption className="sr-only">Entities in the 2-hop network around {entityId}</TableCaption>
            <TableHeader className={stickyHeader}>
              <TableRow className="hover:bg-transparent">{["Entity", "Type", "Status"].map((h) => <TableHead key={h} className="h-11">{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {d.nodes.map((n) => (
                <TableRow key={n.data.id}>
                  <TableCell className="font-mono text-xs">{n.data.id}</TableCell>
                  <TableCell><span className="flex items-center gap-1.5 capitalize"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NODE_COLORS[n.data.type] ?? "#64748b" }} aria-hidden />{n.data.type}</span></TableCell>
                  <TableCell className="space-x-1">
                    {n.data.seed && <Chip tone="teal">Focus</Chip>}
                    {n.data.fraud_status === "confirmed" && <Chip tone="red">Confirmed fraud</Chip>}
                    {n.data.fraud_status === "stale" && <Chip tone="amber">Stale link</Chip>}
                    {!n.data.seed && !n.data.fraud_status && <span className="text-xs text-slate-500">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScrollBox>
      ) : (
        <div ref={ref} className={`${height} w-full rounded-lg border border-border bg-slate-50`} role="img"
             aria-label={`Relationship graph with ${d.signals.node_count} nodes; known fraud nodes: ${d.signals.known_fraud_nodes.join(", ") || "none"}. Switch to List for an accessible view.`} />
      )}
      <p className="text-xs text-slate-500">
        2-hop network around <span className="font-mono">{entityId}</span> as of the transaction time · {d.signals.node_count} nodes · {d.signals.edge_count} links.
        {!asList && " Scroll to zoom, drag to pan."}
      </p>
    </div>
  );
}
