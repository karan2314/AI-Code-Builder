"""Pydantic models shared by the API, tools, agents, policy engine and UI (mirrored in frontend/src/types.ts)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

IndicatorFamily = Literal["behavior", "velocity", "device", "network", "ml", "context"]
EvidenceStatus = Literal["ok", "unavailable", "stale", "conflicting"]


class Transaction(BaseModel):
    transaction_id: str = Field(pattern=r"^TXN-[A-Z0-9-]{3,40}$")
    customer_id: str = Field(pattern=r"^CUST-[A-Z0-9-]{3,30}$")
    account_id: str = Field(pattern=r"^ACC-[A-Z0-9-]{3,30}$")
    timestamp: datetime
    amount_paise: int = Field(gt=0, le=10_000_000_000)
    currency: Literal["INR"] = "INR"
    channel: Literal["upi", "card", "netbanking", "imps"]
    counterparty_id: str = Field(pattern=r"^(MER|RCP)-[A-Z0-9-]{2,30}$")
    device_id: str = Field(pattern=r"^DEV-[A-Z0-9-]{2,30}$")


class TopFeature(BaseModel):
    name: str
    value: float
    weight: float


class ScoreResult(BaseModel):
    transaction_id: str
    risk_score: float
    rules_score: float
    ml_score: float
    anomaly_score: float
    is_candidate: bool
    reason_codes: list[str]
    top_features: list[TopFeature]
    model_version: str


class BatchScoreResult(BaseModel):
    count: int
    candidates: int
    candidate_rate: float
    latency_ms: float
    candidate_ids: list[str]


class Evidence(BaseModel):
    id: str
    case_id: str
    source_tool: str
    kind: str
    indicator_family: IndicatorFamily
    summary: str
    observed: dict[str, Any] = {}
    baseline: dict[str, Any] | None = None
    status: EvidenceStatus = "ok"
    created_at: datetime


class Finding(BaseModel):
    statement: str = Field(description="One observed fact or interpretation, at most 30 words")
    kind: Literal["observed_fact", "interpretation"]
    evidence_ids: list[str] = Field(min_length=1, description="Evidence IDs from the evidence package only")
    severity: Literal["low", "medium", "high", "critical"]


class InvestigationSummary(BaseModel):
    headline: str = Field(description="At most 20 words, analyst-readable")
    pattern: Literal[
        "account_takeover", "mule_network", "card_testing", "first_party", "unusual_but_benign", "insufficient_evidence"
    ]
    findings: list[Finding]
    conflicting_evidence: list[str] = Field(description="Evidence IDs that point in different directions, with reason")
    missing_evidence: list[str] = Field(description="What could not be verified")
    recommended_tier: int = Field(ge=1, le=3, description="Advisory tier: 1 Monitor, 2 Verify/Investigate, 3 Contain")
    confidence: Literal["low", "medium", "high"]
    next_questions: list[str] = Field(max_length=3)


class PolicyDecision(BaseModel):
    tier: Literal[1, 2, 3]
    tier_name: str
    allowed_actions: list[str]
    rule_hits: list[str]
    critical_families: list[str]
    requires_review: bool
    manual_review: bool
    flags: list[str]
    policy_version: str
    llm_recommended_tier: int | None = None
    disagreement: bool = False
    laya_route: str | None = None          # advisory Variant C triage (investigate / monitor / dismiss)
    laya_disagreement: bool = False
    # Progressive autonomy ladder (1 manual · 2 AI investigates, human decides · 3 AI recommends, sampled review
    # · 4 auto-close within guardrails). FraudLens never acts autonomously: the level is a governance label.
    autonomy_level: Literal[1, 2, 3, 4] = 2
    autonomy_label: str = "AI investigates, human decides"
    autonomy_ceiling: Literal[1, 2, 3, 4] = 2  # highest level this tier could ever be promoted to after validation
    limitations: list[str] = []            # deterministic "assumptions & limitations" shown with the AI summary


class TrajectoryStep(BaseModel):
    step: int
    agent: str
    tool: str
    args: dict[str, Any] = {}
    status: Literal["ok", "error", "blocked"]
    latency_ms: float
    evidence_ids: list[str] = []
    at: datetime


class AuditEvent(BaseModel):
    event_id: str
    case_id: str
    event_type: str
    actor: str
    timestamp: datetime
    details: dict[str, Any] = {}


CaseStatus = Literal[
    "open", "investigating", "awaiting_review", "manual_review", "approved", "modified", "closed"
]


class Case(BaseModel):
    case_id: str
    transaction_id: str
    customer_id: str
    status: CaseStatus
    created_at: datetime
    updated_at: datetime
    transaction: dict[str, Any]
    ml: ScoreResult
    evidence: list[Evidence] = []
    summary: InvestigationSummary | None = None
    evidence_validity_rate: float | None = None
    dropped_findings: int = 0
    decision: PolicyDecision | None = None
    simulated_actions: list[dict[str, Any]] = []
    trajectory: list[TrajectoryStep] = []
    progress: list[str] = []
    investigation_mode: Literal["agentic", "deterministic_fallback", "none"] = "none"
    ai_error: str | None = None
    versions: dict[str, str] = {}
    usage: dict[str, Any] = {}
    analyst_action: dict[str, Any] | None = None
    assignee: str | None = None


class CaseCreate(BaseModel):
    transaction_id: str = Field(pattern=r"^TXN-[A-Z0-9-]{3,40}$")


ANALYSTS = ("A. Sharma", "R. Verma", "S. Khan", "N. Iyer")


class CaseAssign(BaseModel):
    assignee: Literal["A. Sharma", "R. Verma", "S. Khan", "N. Iyer"] | None = None


class QuickAction(BaseModel):
    action: Literal["request_customer_verification", "escalate"]
    note: str = Field(default="", max_length=300)


class AnalystAction(BaseModel):
    action: Literal["approve", "modify", "close"]
    tier: Literal[1, 2, 3] | None = None
    reason: str = Field(default="", max_length=500)
