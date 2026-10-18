---
name: adk-agent-builder
description: Design, build, evaluate, and deploy multi-agent systems with Google's Agent Development Kit (ADK) on Cloud Run or Agent Runtime - orchestrator and specialist agents, tools, MCP toolsets, session state, callbacks for safety, and adk eval. Use when the solution needs an agentic workflow, tool use, or multiple AI roles.
---

# ADK Agent Builder

## When to use ADK

Use it when the hero flow has ≥ 2 steps that need reasoning, tools, or distinct roles (e.g.
intake → analysis → plan → verification). For a single structured call, use plain google-genai.

## 1. Setup

```bash
cd backend
uv init --python 3.12 && uv add google-adk==2.12.0 google-genai==2.31.0
```

Env (`backend/.env`, not committed):
```
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=<project>
GOOGLE_CLOUD_LOCATION=global
```

## 2. Layout

```
backend/app/agents/<agent_pkg>/
├── __init__.py      # from . import agent
├── agent.py         # defines root_agent
├── tools.py         # typed, documented Python functions
└── prompts.py
```

## 3. Pattern: orchestrator + specialists + verifier

```python
from google.adk.agents import LlmAgent, SequentialAgent
from .tools import fetch_guidelines, save_plan
from . import prompts
import os

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

intake = LlmAgent(name="intake", model=MODEL, instruction=prompts.INTAKE,
                  description="Extracts structured facts from user input/images.",
                  output_key="facts")
planner = LlmAgent(name="planner", model=MODEL, instruction=prompts.PLANNER,
                   tools=[fetch_guidelines], output_key="draft_plan")
verifier = LlmAgent(name="verifier", model=MODEL, instruction=prompts.VERIFIER,
                    description="Checks the plan for safety and factual grounding.",
                    tools=[save_plan], output_key="final_plan")

root_agent = SequentialAgent(name="pipeline", sub_agents=[intake, planner, verifier])
```

- State flows via `output_key` and `{facts}` placeholders in later instructions.
- Use `before_model_callback` / `before_tool_callback` for guardrails (PII redaction, blocking
  unsafe tool args). Show these in the deck as "Responsible AI".
- MCP tools: `McpToolset` lets agents call MCP servers (e.g. a Firestore toolbox).
- Long-running/human approval: return a "pending_approval" state and let the UI confirm.

## 4. Run locally

```bash
uv run adk web app/agents     # dev UI with traces – great for screenshots in the deck
uv run adk api_server app/agents
```

## 5. Evaluate

Create `*.test.json` eval sets (expected tool trajectory + final response) and run
`uv run adk eval app/agents/<agent_pkg> <evalset>`. Report scores in the deck.

## 6. Deploy

- Cloud Run (recommended here, keeps one URL with our API):
  `uv run adk deploy cloud_run --project $PROJECT_ID --region $REGION --service_name impact-agent --with_ui app/agents/<agent_pkg>`
  or wrap with `get_fast_api_app(...)` in our own FastAPI and deploy via `cloud-run-deploy`.
- Agent Runtime (managed, on Gemini Enterprise Agent Platform) if sessions/memory at scale are part of the story.
- Session service: in-memory for the prototype; mention managed sessions/Firestore for scale.

## 7. Verify

Run the hero scenario through the deployed endpoint, confirm traces in Cloud Logging/Trace,
and capture a screenshot of the agent trace for the deck.
