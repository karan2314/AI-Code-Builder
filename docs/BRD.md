FraudLens AI
Business Requirements Document (BRD)
Agentic AI Fraud Detection, Investigation & Response Platform

Document Attribute
Value
Document purpose
Business and functional blueprint for the FraudLens AI hackathon solution
Industry
Banking, Financial Services & Insurance (BFSI)
Hackathon theme
Intelligent Risk, Fraud & Financial Experiences
Primary users
Fraud analysts, banking operations teams, risk teams
Primary AI
Google Gemini / Google AI services
Deployment target
Google Cloud – Cloud Run; supporting Google Cloud services as appropriate
Delivery model
2–3 member team; hackathon MVP with scalable architecture
Submission target
AI Builder Cup 2026 – 18 October 2026
Document status
Proposed / MVP baseline

Executive Summary
FraudLens AI is an agentic fraud detection and investigation platform designed to identify suspicious financial transactions at scale, investigate them using customer context and relationship intelligence, explain why they are suspicious, and recommend a controlled response.
The core design deliberately separates high-volume machine processing from deeper AI reasoning. Rules, statistical features, anomaly detection and supervised ML screen large transaction volumes. Only suspicious candidates are escalated to an agentic investigation layer. A Gemini-based orchestrator coordinates specialized agents and tools that retrieve customer history, calculate behavioral deviations, inspect transaction relationships and known fraud connections, and assemble an evidence package. A policy-controlled decision engine then maps the evidence to an operational risk tier such as Monitor, Verify/Investigate, or Contain.
The platform is designed for a hackathon prototype using synthetic or appropriately anonymized data. It must not be represented as a production banking system or as an autonomous authority to freeze real customer accounts. Critical actions are simulated and policy-controlled in the prototype.
1. Business Problem
Financial institutions process very large volumes of legitimate transactions while a relatively small fraction require fraud investigation. A useful fraud platform must therefore solve two different problems simultaneously: high-throughput screening and high-quality investigation.
Large transaction volumes make it impractical and expensive to send every transaction to an LLM.
Simple fixed rules generate false positives because legitimate customers have different spending patterns.
A transaction that is unusual in isolation may be normal for a particular customer, while a modest transaction can be risky when combined with velocity, device, network, or account-compromise signals.
Analysts need evidence, context and traceability rather than a black-box 'fraud/not fraud' answer.
High-risk responses require controlled policies, auditability and human oversight; an LLM should not independently freeze real accounts.
2. Vision
Build an evidence-grounded, agentic fraud investigation copilot that can screen large transaction volumes, identify meaningful candidates, investigate customer-specific behavior and fraud networks, and provide an auditable recommendation to banking teams.
Core product statement:
FraudLens AI turns a suspicious transaction into an evidence-backed, reviewable fraud case in seconds.
3. Objectives
Detect suspicious transaction behavior with a high-throughput first-stage risk pipeline.
Reduce the number of transactions requiring expensive deep investigation.
Compare transactions against each customer's historical behavior, limits and context.
Identify suspicious relationships among accounts, devices, merchants and recipients.
Use Gemini to reason over retrieved evidence, summarize cases and recommend next actions.
Provide explainable evidence and confidence/uncertainty rather than unsupported LLM conclusions.
Route cases through a deterministic policy engine and auditable risk tiers.
Demonstrate measurable model performance, operational efficiency and end-to-end cloud deployment.
Provide a polished prototype suitable for the AI Builder Cup judging criteria.
4. Scope
4.1 In Scope
Synthetic or properly anonymized transaction and customer data.
Batch and API-style transaction scoring for the prototype.
Customer behavioral baselines and deviation features.
Transaction velocity and amount anomaly analysis.
Device, merchant, recipient and account relationship analysis.
Known-compromise / known-fraud relationship lookup in the prototype dataset.
First-stage rules + ML/anomaly detection.
Optional Jev decision/routing experiment, benchmarked against conventional ML rather than assumed superior.
Gemini-based agentic investigation.
Tool calling and multi-agent orchestration.
Risk-tier recommendation and simulated response actions.
Analyst dashboard, evidence view, graph view and case management.
Audit trail and case export.
Google Cloud deployment, logging and monitoring.
4.2 Out of Scope for MVP
Real banking core-system integration.
Autonomous freezing of real accounts.
Use of real customer PII or confidential banking records.
Production-grade regulatory certification.
Fully autonomous multi-agent decisions without policy controls.
Graph neural networks or complex custom deep-learning architectures unless time remains after MVP.
Large-scale streaming infrastructure before the batch/API MVP is stable.
Fine-tuning a foundation model unless evaluation proves it is necessary.
5. Target Users & Personas
Persona
Needs
FraudLens Value
Fraud Analyst
Review alerts quickly; understand evidence; prioritize cases
Case workspace, evidence timeline, network graph, AI investigation summary
Risk / Banking Operations
Understand risk and take consistent action
Risk tiers, policy recommendations, audit trail
Customer Protection Team
Identify possible account compromise and verify customers
Behavior change signals, linked-risk context, verification recommendation
Engineering / ML Team
Measure model quality and operational performance
Evaluation metrics, model versioning, traceable decisions
Hackathon Judge
See real AI innovation and working product
End-to-end demo, agents, tools, measurable results, Google Cloud deployment

6. Proposed Solution
FraudLens uses a layered architecture. The first layer is optimized for scale; the second is optimized for investigation; the third is optimized for safe decisioning.
Layer
Responsibility
Primary Technology
1. Ingestion
Receive transaction records and normalize schema
FastAPI / Cloud Run; batch files
2. Feature Enrichment
Customer history, limits, velocity, device, merchant and network features
Python, BigQuery/Firestore as appropriate
3. Detection
Rules, anomaly model and supervised ML candidate scoring
scikit-learn / LightGBM or XGBoost
4. Optional Jev Layer
Structured classification/routing experiment
Jev, if validated and compatible with submission architecture
5. Agentic Investigation
Orchestrate evidence retrieval and specialized analysis
Gemini + agent framework/tool calling
6. Evidence Synthesis
Explain findings and uncertainty
Gemini
7. Policy Decision
Map evidence to approved response tiers
Deterministic Python policy engine
8. Case Management
Persist case, reviewer action and audit trail
Firestore / Cloud Storage
9. UI
Analyst dashboard, graph, evidence and case actions
React + TypeScript
10. Deployment/Observability
Public prototype and operational visibility
Cloud Run + Google Cloud logging/monitoring

7. End-to-End Functional Flow
A transaction enters the FraudLens ingestion API or batch pipeline.
The system validates the transaction ID, customer ID, timestamp, amount and required fields.
Customer and transaction context is retrieved or loaded from the feature store/data layer.
The feature engine calculates behavioral, velocity, limit, device, merchant and network features.
Rules and the first-stage ML/anomaly models calculate a candidate risk score.
Low-risk transactions are recorded and passed through the normal monitoring path.
Suspicious candidates are sent to the investigation queue.
The FraudLens Orchestrator Agent receives the candidate and decides which investigation tools or specialist agents are needed.
The Customer Behavior Agent evaluates the transaction against the customer's historical baseline.
The Transaction Analysis Agent calculates transaction-level anomalies and contextual statistics.
The Fraud Network Agent investigates connected accounts, devices, recipients, merchants and known fraud relationships.
The orchestrator gathers the resulting evidence and passes a bounded evidence package to Gemini.
Gemini generates an evidence-grounded investigation summary, identifies conflicting or missing evidence, and recommends a risk tier.
The deterministic Policy Engine evaluates the evidence and maps the case to the allowed response.
The system stores the decision, evidence references, model versions, agent outputs and reviewer action in the audit record.
The analyst can review, approve, modify or close the case.
The system exposes case metrics and model-performance metrics for evaluation.
8. Agentic Architecture
The agentic layer should be purposeful rather than ornamental. Each agent has a narrow responsibility, uses tools to obtain evidence, returns structured data, and can be evaluated independently.
8.1 FraudLens Orchestrator Agent
Receives a suspicious transaction and initial risk context.
Plans the investigation steps.
Chooses which tools or specialist agents to call.
Maintains the investigation state.
Requests additional evidence when required.
Sends only relevant, structured evidence to Gemini for synthesis.
Does not independently authorize account blocking.
8.2 Customer Behavior Agent
Retrieves historical customer behavior.
Compares current amount to median, percentiles and normal ranges.
Analyzes transaction frequency and rolling windows.
Checks customer limits and recent behavior changes.
Returns structured baseline and deviation evidence.
8.3 Transaction Analysis Agent
Analyzes amount, time, velocity, merchant category and transaction sequence.
Calls statistical/ML tools rather than relying on LLM arithmetic.
Returns feature values, anomalies and model signals.
8.4 Fraud Network Agent
Builds and queries relationships among accounts, devices, merchants and recipients.
Looks for shared devices, suspicious recipients and links to known fraud cases.
Returns graph evidence and relationship strength.
Treats relationships as evidence, not automatic proof of fraud.
8.5 Decision / Risk Agent
Synthesizes investigation evidence into a structured risk assessment.
Produces rationale, confidence/uncertainty, evidence references and recommended response.
Hands the final action to the deterministic policy engine.
9. Agent Tools / Services
Tool / Service
Input
Output
Purpose
get_customer_profile
customer_id
profile, limits, status
Customer context
get_transaction_history
customer_id, time_window
historical transactions
Behavior baseline
get_account_limits
account_id
limits and utilization
Policy/context
calculate_customer_deviation
customer_id, transaction
median, p95, ratios, deviation
Behavioral anomaly
calculate_velocity
account_id, windows
count/value per window
Velocity anomaly
get_device_history
device_id
linked accounts and history
Compromise signals
get_merchant_history
customer_id, merchant
historical interaction
Merchant familiarity
get_related_accounts
entity_id
related entities
Network analysis
search_known_fraud_cases
entity identifiers
matched cases
Known-risk evidence
analyze_fraud_network
transaction/account
graph metrics and paths
Relationship intelligence
get_ml_risk_score
feature vector
score + model version
First-stage ML
get_jev_decision
structured case features
decision/probability where supported
Experimental routing/classification
create_case
evidence package
case_id
Case management
record_action
case_id, action
audit record
Auditability
simulate_restriction
account_id, policy
simulated result
Hackathon demonstration

10. Google AI / LLM Design
Gemini should be used for tasks that benefit from reasoning and language synthesis, not for raw numerical processing that deterministic code can perform more reliably.
Interpret structured evidence.
Identify patterns across multiple evidence sources.
Explain why a case is unusual in customer-specific context.
Identify contradictory or missing evidence.
Generate an analyst-readable case summary.
Recommend the next investigative question or action.
Return structured JSON matching a strict schema.
LLM guardrails:
Every factual claim must reference an evidence ID.
The model must not invent transaction values, customer attributes or relationships.
Numerical calculations must come from tools.
The model must distinguish observed facts from interpretation.
The model must return uncertainty where evidence is insufficient.
Final high-impact actions must pass through deterministic policy controls.
11. Risk Decision Framework
Tier
Meaning
Typical Evidence
Prototype Action
Level 1 – Monitor
Unusual but insufficient evidence of compromise
Single behavioral anomaly; low/medium model score
Analyst monitoring / alert
Level 2 – Verify / Investigate
Multiple independent indicators
Behavior anomaly + new device + velocity/network signal
Customer verification simulation + analyst escalation
Level 3 – Contain
Strong evidence of compromise or explicit critical policy condition
Known-compromise link + suspicious activity / multiple critical indicators
Simulated restriction + immediate escalation

Risk tiers are prototype policy categories. Thresholds must be calibrated against validation data and should not be presented as universal banking standards.
12. Data Requirements
Data Domain
Key Fields / Features
Purpose
Transaction
transaction_id, customer_id, account_id, timestamp, amount, merchant, recipient
Transaction analysis
Customer
customer_id, segment, account age, normal ranges
Customer baseline
Limits
transaction limit, daily limit, utilization
Policy context
Device
device_id, first_seen, linked accounts
Compromise/network signal
Merchant
merchant_id, category, historical interaction
Familiarity and anomaly
Fraud Labels
fraud/legitimate, case_id, confirmation time
Model training/evaluation
Network
source, destination, shared entity relationships
Graph intelligence

For the hackathon, use synthetic or properly anonymized data. A synthetic generator should create normal customers, realistic behavior variation, fraudulent scenarios, account-compromise scenarios, device sharing and relationship patterns.
13. ML / Detection Strategy
Recommended progression:
Build a transparent rules-only baseline.
Engineer customer, transaction, velocity and relationship features.
Train a supervised model such as LightGBM/XGBoost when labels are available; use anomaly detection such as Isolation Forest as a complementary experiment.
Use a time-based train/validation/test split to avoid temporal leakage.
Calibrate thresholds using validation data.
Benchmark the optional Jev layer against the ML baseline on the same held-out data.
Escalate only the required candidate fraction to deep investigation.
14. Model Evaluation
Metric
Why It Matters
Precision
Measures how many alerts are meaningful and controls analyst workload
Recall
Measures how much labelled fraud is detected
PR-AUC
Useful for rare-event fraud classification
False positives / 10k
Operational alert burden
Candidate rate
How much volume reaches expensive investigation
Fraud value captured
Shows potential business impact on labelled scenarios
P50/P95 latency
Shows responsiveness
Gemini escalation rate
Shows how efficiently LLM investigation is used
Cost per 1,000 transactions
Supports scale/efficiency story
Evidence validity rate
Percentage of AI claims traceable to actual evidence

15. Benchmark Plan
Baseline A: deterministic rules.
Baseline B: conventional ML/anomaly model.
Variant C: ML + optional Jev decision/routing.
Variant D: best screening pipeline + agentic Gemini investigation.
Compare the variants on the same held-out data. The project should report only measured results; no performance numbers should be invented for the pitch.
16. Technical Architecture
Component
Recommended Technology
Role
Frontend
React + TypeScript + Vite + Tailwind
Analyst application
API
Python + FastAPI + Pydantic
Service layer and validation
AI
Gemini through Google AI / Vertex AI supported SDK
Reasoning and synthesis
Agent framework
Google-supported agentic tooling where available
Orchestration/tool calling
ML
Python, scikit-learn, LightGBM/XGBoost
Detection
Graph
NetworkX
Relationship analysis
Data
BigQuery for scalable analytics; files for MVP where sufficient
Transaction data
State
Firestore
Cases and review state
Artifacts
Cloud Storage
Reports/datasets
Deployment
Cloud Run
Backend/public service
Observability
Google Cloud Logging/Monitoring
Operational visibility

17. API-Level Functional Requirements
Endpoint
Purpose
Example Response
POST /transactions/score
Score one transaction
risk_score, candidate, reasons
POST /transactions/batch-score
Score batch
summary metrics, candidate IDs
GET /customers/{id}/profile
Customer context
profile + limits
GET /customers/{id}/history
Historical behavior
transactions/features
GET /cases/{id}
Retrieve investigation
evidence + recommendation
POST /cases/{id}/investigate
Start agentic investigation
case status
POST /cases/{id}/action
Record analyst action
audit event
GET /network/{entity_id}
Graph evidence
nodes, edges, risk signals
GET /metrics
System/model metrics
evaluation and operational KPIs

18. UI Requirements
Operations dashboard showing transaction volume, candidate rate, open cases and risk distribution.
Suspicious transaction queue with reason codes and risk score.
Customer 360 view with recent history, limits and behavioral baseline.
Interactive fraud-network graph.
Investigation timeline showing agent/tool calls and evidence.
AI-generated case summary with clickable evidence references.
Risk tier and recommended action panel.
Analyst approve / modify / close actions.
Audit trail.
Demo mode with pre-seeded high-value scenarios.
19. Non-Functional Requirements
Requirement
Target / Principle
Availability
Prototype remains reachable throughout evaluation
Performance
Fast first-stage scoring; deep investigation only for candidates
Scalability
Stateless Cloud Run service; batch processing separated from deep investigation
Security
No secrets in source; least-privilege service identity; synthetic data
Privacy
Minimize data sent to LLM; pseudonymous IDs in demo
Auditability
Persist evidence IDs, model version, prompt/version metadata where appropriate, action and timestamp
Reliability
Retries, idempotency and graceful handling of AI/tool failures
Explainability
Every material finding traceable to evidence
Accessibility
Readable dashboard, clear states, keyboard-friendly core workflow

20. Failure Handling & Safety
If Gemini is unavailable, preserve the ML/rules risk score and route the case to manual review.
If a tool fails, mark the evidence as unavailable rather than allowing the model to infer it.
If evidence conflicts, require review rather than escalating automatically.
If a customer has insufficient history, use cohort-level signals and explicitly mark limited history.
If a known-fraud link is stale or unverified, treat it as a signal requiring validation.
Never allow an LLM-only response to perform a real financial restriction.
Use synthetic data for the hackathon demonstration.
21. Security & Governance
Use service accounts / workload identity rather than embedded credentials.
Restrict data access by service role.
Log sensitive operations without exposing unnecessary customer information.
Version models and decision policies.
Maintain an immutable-style case history for prototype auditability.
Define data retention for prototype datasets and generated reports.
Clearly label simulated actions in the user interface.
22. Hackathon MVP Definition
The MVP is complete when the following path works end to end:
Load a synthetic transaction dataset.
Score thousands of transactions with the first-stage detection pipeline.
Identify suspicious candidates.
Open a candidate case.
Run the orchestrator.
Call at least two meaningful investigation tools/specialist capabilities.
Retrieve customer behavior and relationship evidence.
Send bounded evidence to Gemini.
Generate a structured, evidence-linked investigation summary.
Assign a risk tier through the policy engine.
Simulate the appropriate response.
Persist the case and audit record.
Display the complete investigation in the web UI.
Run the deployed application on Google Cloud.
Demonstrate measured evaluation results.
23. Team Work Allocation
Role
Primary Responsibilities
Outputs
AI/ML Lead
Feature engineering, baseline models, anomaly detection, Jev benchmark, evaluation
Model pipeline + metrics
Backend / Cloud Lead
FastAPI, Gemini integration, agents, tools, Cloud Run, persistence
Working backend + deployment
Frontend / Product Lead
React dashboard, graph, case UX, demo workflow, deck/video support
Polished UI + submission assets

24. Delivery Plan
Phase
Activities
Exit Criteria
Phase 1 – Foundation
Confirm official BFSI statement; finalize scope; data schema; repo; Cloud Run skeleton
End-to-end skeleton deployed
Phase 2 – Detection
Feature engineering, rules, baseline ML, evaluation dataset
Candidate transactions produced
Phase 3 – Investigation
Tools, customer behavior, graph/network analysis
Case evidence available
Phase 4 – Agentic AI
Orchestrator, specialist agents, Gemini synthesis, structured outputs
Agentic investigation works
Phase 5 – Decisioning
Policy engine, risk tiers, simulated actions, audit trail
Complete case lifecycle
Phase 6 – UX & Evaluation
Dashboard, graph, metrics, benchmark
Judge-ready prototype
Phase 7 – Submission
Deck, 3–4 minute demo, GitHub, description, final uptime test
All mandatory artifacts submitted

25. Demo Scenario
The primary demo should use a customer whose current transaction is not suspicious based on amount alone, but becomes high-risk when multiple independent signals are combined.
Customer normally makes 2–4 transactions per day with a median amount of approximately ₹6,000.
A new transaction for ₹185,000 arrives from a previously unseen device.
The account has several rapid transactions within minutes.
The recipient is connected to other accounts with suspicious/confirmed-fraud history in the synthetic dataset.
The first-stage model flags the transaction.
The Orchestrator requests customer behavior, velocity and network evidence.
The specialist capabilities return structured evidence.
Gemini synthesizes the evidence and explains the likely account-compromise pattern.
The policy engine assigns Level 3 / Contain for the synthetic scenario.
The UI displays a simulated restriction, analyst alert and full audit trail.
26. Competitive Differentiation
Hybrid architecture: ML for scale + agents for investigation + deterministic policy for action.
Customer-specific behavioral baselines instead of only global transaction thresholds.
Fraud-network analysis using linked entities.
Evidence-grounded Gemini reasoning with tool calls.
Explicit uncertainty and missing-evidence handling.
Measured comparison of rules, ML, optional Jev, and agentic investigation.
Auditable action pathway rather than an opaque autonomous blocker.
Strong visual demonstration: transaction → evidence → network → AI investigation → decision → response.
27. Key Risks & Mitigations
Risk
Impact
Mitigation
LLM hallucination
False investigation claims
Evidence IDs, tool-grounded facts, structured outputs
False positives
Analyst overload
Precision/recall threshold tuning and cost-aware evaluation
False negatives
Missed fraud
Recall/PR-AUC evaluation and multiple signal families
Data leakage
Inflated benchmark
Time-based splits and strict feature cutoff
Agent complexity
Unreliable demo
Narrow agent responsibilities and deterministic fallbacks
Cloud/API failure
Demo interruption
Pre-seeded cases, retries and graceful degradation
Jev underperformance
Architecture complexity without benefit
Benchmark it and remove it from critical path if it adds no value
Unsafe automated blocking
Operational/regulatory risk
Policy engine + simulated action + human oversight
Deadline risk
Incomplete submission
Prioritize end-to-end MVP before advanced features

28. Success Criteria
The deployed application completes a full suspicious-transaction investigation without manual backend intervention.
The system can screen a large synthetic transaction set and route a small candidate subset to deeper analysis.
The investigation output is traceable to actual data and tool results.
The agentic layer demonstrates meaningful orchestration and tool calling.
Gemini provides useful synthesis rather than generic chatbot responses.
The system demonstrates customer-specific behavioral analysis and network intelligence.
The prototype produces measurable ML and operational evaluation results.
The complete solution runs on Google Cloud and satisfies the hackathon's Google AI/deployment requirements.
All submission artifacts are complete and the prototype remains reachable during evaluation.
29. Final Product Positioning
FraudLens AI should be positioned as an agentic fraud investigation and response platform, not merely a fraud classifier. Its core value proposition is the ability to move from high-volume detection to context-rich investigation and controlled response without requiring an LLM to process every transaction.
The central design principle is: ML handles scale; tools provide verified evidence; agents orchestrate the investigation; Gemini synthesizes and explains; policy controls the action.
30. Recommended Build Order – Immediate Next Steps
Confirm the exact official BFSI problem statement in the Hack2skill dashboard and map each requirement to this BRD.
Freeze the MVP scope and team responsibilities.
Create the synthetic customer, account, transaction, device, merchant and fraud-case schema.
Implement the rules + ML first-stage detector and establish baseline metrics.
Build the FastAPI service and Cloud Run deployment immediately.
Implement the investigation tools with deterministic outputs.
Implement the Orchestrator and two specialist agents first: Customer Behavior and Fraud Network.
Integrate Gemini with strict structured output and evidence references.
Add the deterministic risk policy engine and simulated actions.
Build the investigation UI and network graph.
Benchmark rules vs ML vs optional Jev vs agentic investigation.
Create the final demo scenario, deck, GitHub documentation and video.
Perform a final submission dry run using the deployed public URL.
Appendix A – Reference Architecture Summary
Transaction → ingestion → feature enrichment → rules/ML/anomaly detection → suspicious candidate → FraudLens Orchestrator → Customer Behavior / Transaction Analysis / Fraud Network capabilities → Gemini evidence synthesis → deterministic policy engine → Monitor / Verify / Contain → case + audit trail.
Appendix B – Design Principle
Do not use an LLM where a deterministic calculation or validated ML model is better. Do not use an ML model where a hard policy rule is required. Use agents where dynamic investigation and tool selection add value. Use Gemini where contextual reasoning and synthesis add value. Keep high-impact actions policy-controlled and auditable.
