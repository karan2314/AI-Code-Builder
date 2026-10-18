import type { AuditEvent, BoardItem, Case, Controls, GraphData, MetricsResponse, Overview, QueueItem, SearchHit } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  queue: (limit = 120) => request<{ items: QueueItem[]; threshold: number; model_version: string }>(`/api/queue?limit=${limit}`),
  metrics: () => request<MetricsResponse>("/api/metrics"),
  reasonCodes: () => request<Record<string, string>>("/api/reason-codes"),
  caseById: (id: string) => request<Case>(`/api/cases/${encodeURIComponent(id)}`),
  createCase: (transaction_id: string) => request<Case>("/api/cases", { method: "POST", body: JSON.stringify({ transaction_id }) }),
  investigate: (id: string, cached = false) =>
    request<Case>(`/api/cases/${encodeURIComponent(id)}/investigate${cached ? "?cached=true" : ""}`, { method: "POST" }),
  action: (id: string, body: { action: "approve" | "modify" | "close"; tier?: number; reason: string }) =>
    request<Case>(`/api/cases/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify(body) }),
  overview: () => request<Overview>("/api/overview"),
  board: (limit = 100) => request<{ items: BoardItem[] }>(`/api/cases-board?limit=${limit}`),
  search: (q: string) => request<{ items: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  audit: (limit = 200) => request<{ items: AuditEvent[] }>(`/api/audit?limit=${limit}`),
  controls: () => request<Controls>("/api/controls"),
  analysts: () => request<{ items: string[] }>("/api/analysts"),
  assign: (id: string, assignee: string | null) =>
    request<Case>(`/api/cases/${encodeURIComponent(id)}/assign`, { method: "POST", body: JSON.stringify({ assignee }) }),
  quickAction: (id: string, action: "request_customer_verification" | "escalate", note = "") =>
    request<Case>(`/api/cases/${encodeURIComponent(id)}/quick-action`, { method: "POST", body: JSON.stringify({ action, note }) }),
  demo: (scenario: "hero" | "benign") =>
    request<{ case_id: string; status: string; needs_investigation: boolean }>(`/api/demo/${scenario}`, { method: "POST" }),
  network: (entity: string, transactionId?: string) =>
    request<GraphData>(`/api/network/${encodeURIComponent(entity)}${transactionId ? `?transaction_id=${encodeURIComponent(transactionId)}` : ""}`),
  customerProfile: (id: string) => request<{
    profile: Record<string, string | number>;
    limits: { txn_limit_rupees: number; daily_limit_rupees: number };
    baseline: { transactions: number; median_rupees: number | null; p95_rupees: number | null; devices: Record<string, number>; channels: Record<string, number> };
  }>(`/api/customers/${encodeURIComponent(id)}/profile`),
  customerHistory: (id: string, days = 30) => request<{
    transactions: { transaction_id: string; timestamp: string; amount_rupees: number; channel: string; counterparty_id: string; device_id: string }[];
  }>(`/api/customers/${encodeURIComponent(id)}/history?days=${days}`),
};
