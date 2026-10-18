---
inclusion: fileMatch
fileMatchPattern: ".kiro/specs/**"
---

# Spec Authoring Standards

Active spec: `.kiro/specs/fraudlens-mvp/` (requirements.md, design.md, tasks.md). It covers the full
BRD §22 MVP. With the 18 Oct 2026 deadline, keep **one spec** and use `*` to mark stretch tasks instead
of creating new specs. Create a new spec only for post-MVP work (e.g. `jev-benchmark`,
`bigquery-scale`, `streaming-ingest`).

## requirements.md

- Header: category/theme, problem, primary persona, success metrics (from BRD §14, §28).
- User stories: "As a <persona>, I want <capability>, so that <benefit>."
- Acceptance criteria in **EARS**: `WHEN … THE SYSTEM SHALL …`, `IF … THEN THE SYSTEM SHALL …`,
  `WHILE … THE SYSTEM SHALL …`.
- Tag requirements with the rubric criteria they serve: `[Tech40] [Impact25] [Innov25] [UX10]`, plus the BRD section (`BRD§9`).
- Non-functional requirements: latency, availability, explainability, privacy, accessibility, cost.

## design.md

- Architecture diagram (Mermaid, GCP services only), components, data model, API contracts,
  agent design (agents, tools, state, callbacks), Gemini schema and prompts, policy rules, evidence
  model, error handling and fallbacks, testing and eval plan, deployment, risks.

## tasks.md

- Ordered so that a deployed vertical slice exists early (skeleton on Cloud Run first).
- Each task: checkbox, short title, bullet details, `_Requirements: x.y_`, and a verification step.
- `*` = stretch/optional. The last tasks are always: final deploy, uptime check, submission artifacts.
