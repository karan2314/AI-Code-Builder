# Product Context: FraudLens AI (AI Builder Cup 2026)

Source of truth: `docs/BRD.md` (FraudLens AI Business Requirements Document). When this file and the
BRD disagree on product scope, the BRD wins; when either conflicts with hackathon rules, the rules win.

## One-liner

**FraudLens AI turns a suspicious transaction into an evidence-backed, reviewable fraud case in seconds.**

Design principle (repeat it everywhere: code, deck, video):
> ML handles scale; tools provide verified evidence; agents orchestrate the investigation;
> Gemini synthesizes and explains; policy controls the action.

## Hackathon facts

- **Submission deadline: 18 October 2026.** Every task must serve the end-to-end MVP first.
- **Theme:** Intelligent Risk, Fraud & Financial Experiences (BFSI).
- **Category:** confirm the exact problem statement in the Hack2skill dashboard. If you have to
  pick from Healthcare / Education / Sustainability / Accessibility / Social Good, use **Social Good**
  (protecting bank customers from fraud and account takeover).
- **Mandatory:** Gemini (Google AI) integrated meaningfully; deployed on **Cloud Run** (GCP);
  PDF deck; public demo video **≤ 3 minutes** (the BRD's "3–4 min" is too long); public GitHub repo;
  all in English.
- **Data:** synthetic only. No real PII, no real bank data.

## Users

| Persona | Need | FraudLens gives them |
|---|---|---|
| Fraud Analyst (primary) | Triage alerts fast with evidence | Queue, case workspace, evidence timeline, network graph, AI summary |
| Risk / Banking Ops | Consistent, auditable action | Risk tiers, policy recommendation, audit trail |
| Customer Protection | Spot account compromise | Behavior-change and new-device signals, verification recommendation |
| ML Team | Measure quality | Metrics, model versions, traceable decisions |
| Hackathon Judge | See real AI working on GCP | Demo mode, seeded hero scenario, live agent trace, measured benchmarks |

## Pipeline (BRD §6–7)

Ingest → validate → feature enrichment → rules + ML/anomaly screening → candidate queue →
**Orchestrator Agent** → Customer Behavior / Transaction Analysis / Fraud Network agents (tools) →
bounded evidence package → **Gemini synthesis** (structured, evidence-linked) → **deterministic
Policy Engine** → Tier 1 Monitor / Tier 2 Verify / Tier 3 Contain → simulated action → case +
audit record → analyst review (approve / modify / close).

## MVP definition of done (BRD §22, every item must work on the deployed URL)

1. Load a synthetic dataset; score thousands of transactions in the first stage.
2. Show candidates; open a candidate case.
3. Run the orchestrator, which calls at least 2 specialist capabilities (Customer Behavior + Fraud Network first).
4. Send bounded evidence to Gemini, get a structured, evidence-linked summary back.
5. The policy engine assigns a tier and simulates the response.
6. Persist the case and audit record; show the full investigation in the UI.
7. Show measured evaluation results (rules vs ML vs agentic).

## Hero demo scenario (BRD §25)

Customer with 2–4 txns/day, median ≈ ₹6,000 → ₹185,000 transfer from a never-seen device, after
rapid transactions within minutes, to a recipient linked to confirmed-fraud accounts → the first
stage flags it → agents gather behavior, velocity, and network evidence → Gemini explains an
account-compromise pattern → the policy assigns **Tier 3 Contain** → the UI shows a *simulated*
restriction, an analyst alert, and the audit trail.

## Rubric mapping

| Weight | Criterion | FraudLens proof points |
|---|---|---|
| 40% | Tech & Gen AI | ADK multi-agent orchestration with real tools, Gemini structured output with evidence IDs, hybrid ML + LLM architecture, Cloud Run, logging, cost per 1k txns, Gemini escalation rate |
| 25% | Alignment & Impact | Analyst time per case, false positives per 10k, fraud value captured (measured on synthetic data), safe human-in-the-loop |
| 25% | Innovation | LLM only for the ~1–5% of candidates; customer-specific baselines; network intelligence; evidence validity rate; missing/conflicting evidence handling |
| 10% | UX | Investigation timeline, clickable evidence references, graph view, clear tier and action panel, keyboard-friendly, demo mode |

## Non-negotiables

- **Never invent numbers.** Metrics in the UI, deck, or video come only from `docs/metrics/*.json`
  produced by the eval scripts.
- **Never claim production readiness** or real account freezing. Label all actions "SIMULATED".
- **No LLM-only high-impact action.** Gemini recommends; the policy engine decides; the analyst confirms.
- **Graceful degradation:** if Gemini fails, keep the ML/rules score and route to manual review.

## Decisions log

Record decisions in `docs/DECISIONS.md` (date, decision, reason, rubric criterion).
