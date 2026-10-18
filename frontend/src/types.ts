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
  autonomy_level?: 1 | 2 | 3 | 4;
  autonomy_label?: string;
  autonomy_ceiling?: 1 | 2 | 3 | 4;
  limitations?: string[];
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
  batch_id?: string | null;
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
  assignee?: string | null;
  audit: AuditEvent[];
  priority?: Priority;
  sla?: Sla;
}

export type Priority = "P1" | "P2" | "P3";

export interface Sla {
  target_minutes: number;
  remaining_minutes: number | null;
  state: "on_track" | "at_risk" | "breached" | "resolved";
}

export interface KpiPair { value: number; previous: number; delta: number }

export interface Insight {
  id: string;
  title: string;
  count: number;
  previous: number;
  change: number | null;
  detail: string;
  severity: "high" | "medium";
}

export interface Overview {
  as_of: string;
  window_hours: number;
  kpis: {
    high_risk_alerts: KpiPair;
    potential_exposure_rupees: KpiPair;
    nearing_sla: { value: number; breached: number };
    awaiting_review: KpiPair;
    transactions_screened: KpiPair;
  };
  alert_rate_24h: number;
  priority_mix_7d: Record<Priority, number>;
  sla_states_7d: Record<Sla["state"], number>;
  insights: Insight[];
}

export interface BoardItem {
  case_id: string;
  transaction_id: string;
  customer_id: string;
  status: CaseStatus;
  tier: Tier | null;
  priority: Priority;
  risk_score: number;
  amount_rupees: number;
  assignee: string | null;
  investigation_mode: string;
  override: boolean;
  sla: Sla;
  updated_at: string;
}

export interface SearchHit { kind: "case" | "transaction" | "customer" | "entity"; id: string; label: string; case_id: string | null }

export interface Controls {
  model: { version: string; threshold: number; blend: Record<string, number> };
  reason_codes: Record<string, string>;
  policy: { version: string; config: Record<string, number>; rules: Record<string, string>; tiers: Record<string, { name: string; actions: string[] }> };
  decision_model?: { name: string; enabled: boolean; role: string };
  autonomy: { current_level: number; levels: Record<string, string>; ceilings: Record<string, number> };
  operations: { priority_bands: Record<Priority, string>; sla_minutes: Record<Priority, number>; analysts: string[] };
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
  priority: Priority;
  sla: Sla;
  assignee: string | null;
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
    analyst_review?: {
      cases_reviewed: number;
      overrides: number;
      policy_agreement_rate: number | null;
      ai_compared: number;
      ai_agreement_rate: number | null;
    };
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
  impact?: Impact | null;
}

export interface BatchRow {
  transaction_id: string;
  customer_id: string;
  timestamp: string;
  amount_rupees: number;
  channel: string;
  counterparty_id: string;
  device_id: string;
  risk_score: number;
  is_candidate: boolean;
  reason_codes: string[];
  label: number | null;
  case_id: string | null;
  case_status: string | null;
  tier: Tier | null;
}

export interface BatchView {
  batch_id: string;
  filename: string;
  created_at: string;
  expires_at: string;
  summary: {
    rows: number;
    candidates: number;
    candidate_rate: number;
    customers: number;
    new_customers: number;
    new_counterparties: number;
    new_devices: number;
    processing_ms: number;
    time_range: [string, string];
    model_version: string;
    threshold: number;
    labelled_metrics?: { fraud_rows: number; true_positives: number; false_positives: number; precision: number | null; recall: number | null };
  };
  ai_investigations: { used: number; limit: number };
  rows: BatchRow[];
  truncated: boolean;
}

export interface ImpactCounts {
  alerts: number; caught: number; missed: number; false_alarms: number; true_negatives: number;
  precision: number; recall: number; fraud_value_caught_rupees: number;
}

export interface Impact {
  generated_at: string;
  model_version: string;
  test_transactions: number;
  test_fraud_transactions: number;
  total_fraud_value_rupees: number;
  variants: { rules: ImpactCounts; fraudlens: ImpactCounts; union: ImpactCounts };
  by_fraud_type: { type: string; label: string; fraud_transactions: number; rules_caught: number; fraudlens_caught: number; union_caught: number }[];
  legit_high_value: { transactions: number; rules_flagged: number; fraudlens_flagged: number };
  pr_curves: { rules: { recall: number; precision: number }[]; fraudlens: { recall: number; precision: number }[] };
  funnel: {
    screened: number; alerts: number; alerts_fraud: number; policy_tiers: Record<string, number>;
    policy_tiers_fraud: Record<string, number>; escalated_tier2plus: number; escalated_precision: number | null;
  };
  policy_validation: ImpactCounts & { split: string };
  headline: {
    extra_frauds_caught: number; extra_frauds_caught_pct: number; recall_rules: number; recall_fraudlens: number;
    pr_auc_rules: number; pr_auc_fraudlens: number; pr_auc_gain_pct: number; alert_rate: number; transactions_per_alert: number;
    llm_calls_avoided_pct: number; extra_false_alarms: number;
    llm_cost_per_1000_fraudlens_usd?: number; llm_cost_per_1000_if_all_usd?: number; llm_cost_reduction_x?: number;
  };
  agentic: null | {
    sample: { size: number; fraud: number; legit: number; tier_vs_label_agreement: number };
    evidence_validity_rate_mean: number | null; invalid_citations_total: number;
    investigation_latency_ms: { p50: number | null; p95: number | null };
    tokens_per_case: { input_mean: number | null; output_mean: number | null };
    gemini_model: string; policy_version: string;
    golden: Record<string, { tier: number; pass: boolean }>;
  };
  laya: null | { routed_investigate: number; queried: number; escalation_reduction: number; latency_ms: Record<string, number>; auc: Record<string, number> | null };
  screening_ms_per_1k: number;
}
