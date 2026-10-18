// Mirrors backend/app/schemas.py
export type Tier = 1 | 2 | 3;

export interface TopFeature { name: string; value: number; weight: number }

export interface ScoreResult {
  transaction_id: string;
  risk_score: number;
  rules_score: number;
  ml_score: number;
  anomaly_score: number;
  is_candidate: boolean;
  reason_codes: string[];
  top_features: TopFeature[];
  model_version: string;
}

export interface Evidence {
  id: string;
  case_id: string;
  source_tool: string;
  kind: string;
  indicator_family: string;
  summary: string;
  observed: Record<string, unknown>;
  baseline: Record<string, unknown> | null;
  status: "ok" | "unavailable" | "stale" | "conflicting";
  created_at: string;
}

export interface Finding {
  statement: string;
  kind: "observed_fact" | "interpretation";
  evidence_ids: string[];
  severity: "low" | "medium" | "high" | "critical";
}

export interface InvestigationSummary {
  headline: string;
  pattern: string;
  findings: Finding[];
  conflicting_evidence: string[];
  missing_evidence: string[];
  recommended_tier: Tier;
  confidence: "low" | "medium" | "high";
  next_questions: string[];
}

export interface PolicyDecision {
  tier: Tier;
  tier_name: string;
  allowed_actions: string[];
  rule_hits: string[];
  critical_families: string[];
  requires_review: boolean;
  manual_review: boolean;
  flags: string[];
  policy_version: string;
  llm_recommended_tier: number | null;
  disagreement: boolean;
  laya_route: string | null;
  laya_disagreement: boolean;
}

export interface TrajectoryStep {
  step: number;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  status: "ok" | "error" | "blocked";
  latency_ms: number;
  evidence_ids: string[];
  at: string;
}

export interface AuditEvent {
  event_id: string;
  case_id: string;
  event_type: string;
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export type CaseStatus = "open" | "investigating" | "awaiting_review" | "manual_review" | "approved" | "modified" | "closed";

export interface Case {
  case_id: string;
  transaction_id: string;
  customer_id: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  transaction: Record<string, string | number>;
  ml: ScoreResult;
  evidence: Evidence[];
  summary: InvestigationSummary | null;
  evidence_validity_rate: number | null;
  dropped_findings: number;
  decision: PolicyDecision | null;
  simulated_actions: { action: string; simulated: boolean; tier: number; at: string; label: string }[];
  trajectory: TrajectoryStep[];
  progress: string[];
  investigation_mode: "agentic" | "deterministic_fallback" | "none";
  ai_error: string | null;
  versions: Record<string, string>;
  usage: Record<string, unknown>;
  analyst_action: Record<string, unknown> | null;
  audit: AuditEvent[];
}

export interface QueueItem {
  transaction_id: string;
  customer_id: string;
  timestamp: string;
  amount_rupees: number;
  channel: string;
  counterparty_id: string;
  risk_score: number;
  reason_codes: string[];
  case_id: string | null;
  case_status: string;
  tier: Tier | null;
  demo: boolean;
}

export interface GraphData {
  nodes: { data: { id: string; label: string; type: string; fraud_status: string | null; seed: boolean } }[];
  edges: { data: { id: string; source: string; target: string; relation: string; n: number } }[];
  signals: { node_count: number; edge_count: number; known_fraud_nodes: string[] };
}

export interface VariantMetrics {
  transactions: number;
  fraud_transactions: number;
  candidates: number;
  candidate_rate: number;
  precision: number;
  recall: number;
  pr_auc: number;
  false_positives_per_10k: number;
  fraud_value_captured_pct: number;
}

export interface MetricsResponse {
  live: {
    transactions_screened: number;
    candidates: number;
    candidate_rate: number;
    gemini_escalation_rate: number;
    open_cases: number;
    cases_investigated: number;
    tier_distribution: Record<string, number>;
    avg_evidence_validity_rate: number | null;
    single_score_latency: Record<string, number>;
    case_store: string;
  };
  detection: {
    generated_at: string;
    model_version: string;
    split: Record<string, string | number>;
    thresholds: Record<string, number | string>;
    variants: Record<string, VariantMetrics>;
    batch_scoring_ms_per_1k_txns: number;
    top_global_features: [string, number][];
  } | null;
  benchmark: Record<string, unknown> | null;
  agentic: Record<string, unknown> | null;
}
