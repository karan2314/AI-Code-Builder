---
name: gemini-integration
description: Implement Gemini features with the Google Gen AI SDK (google-genai / @google/genai) on Gemini Enterprise Agent Platform (Vertex AI) - structured JSON output, function calling, Google Search grounding, multimodal input, streaming, Live API, safety settings, retries, token logging, and evals. Use when writing or debugging any code that calls Gemini or Gemma.
---

# Gemini Integration

Follow `genai-standards.md`. This skill is the step-by-step recipe.

## 1. Dependencies (pin exact versions)

- Python: `uv add google-genai==2.31.0 pydantic pydantic-settings fastapi uvicorn`
- Node: `npm install @google/genai@2.30.0`

## 2. Config

```python
# backend/app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    google_cloud_project: str
    google_cloud_location: str = "global"
    gemini_model: str = "gemini-3.5-flash"
    gemini_model_fast: str = "gemini-3.5-flash-lite"
    gemini_model_pro: str = "gemini-3.1-pro-preview"
    gemini_live_model: str = "gemini-3.8-live"

settings = Settings()
```

Before locking in model IDs, check the current list:
https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions

## 3. Recipes

**Function calling (automatic, Python):** pass plain Python functions as tools; the SDK
executes them and loops.

```python
def lookup_scheme(state: str, need: str) -> dict:
    """Return government welfare schemes for a state and need (e.g. 'education')."""
    ...

resp = client.models.generate_content(
    model=settings.gemini_model,
    contents=question,
    config=types.GenerateContentConfig(tools=[lookup_scheme], system_instruction=SYSTEM),
)
```

**Grounding with Google Search:**
```python
config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())])
# citations: resp.candidates[0].grounding_metadata.grounding_chunks
```

**Multimodal:**
```python
contents=[types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"), "Describe hazards for a blind pedestrian."]
# large files: upload to GCS, then types.Part.from_uri(file_uri="gs://bucket/x.pdf", mime_type="application/pdf")
```

**Streaming to the browser (FastAPI SSE):**
```python
async def stream(prompt: str):
    async for chunk in await client.aio.models.generate_content_stream(model=..., contents=prompt):
        if chunk.text:
            yield f"data: {json.dumps({'delta': chunk.text})}\n\n"
# return StreamingResponse(stream(p), media_type="text/event-stream")
```

**Safety settings:**
```python
SAFETY_SETTINGS = [
    types.SafetySetting(category=c, threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE)
    for c in (types.HarmCategory.HARM_CATEGORY_HARASSMENT, types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT)
]
```
Check `resp.candidates[0].finish_reason` and `resp.prompt_feedback` for blocks.

**Embeddings / RAG:** `client.models.embed_content(model=<embedding model>, contents=[...])`,
store vectors in Firestore (`find_nearest`) or use Vertex AI Search for managed RAG.

**Live API (voice):** `async with client.aio.live.connect(model=settings.gemini_live_model, config=...) as session:` –
proxy audio over a WebSocket from the Cloud Run backend; never expose credentials to the browser.

## 4. Verify

- Unit-test services with the Gemini client mocked.
- `backend/evals/run_evals.py`: loads `cases.jsonl`, calls the real model, asserts schema +
  property checks, prints pass rate and avg latency/tokens.
- Smoke test against the deployed URL.

## 5. Debugging

- `403 PERMISSION_DENIED`: service account lacks `roles/aiplatform.user` or API not enabled.
- `404 model not found`: wrong model ID or location; use `global`.
- `429 RESOURCE_EXHAUSTED`: retries/backoff, lower concurrency, use flash-lite, request quota.
- Empty `resp.text`: blocked by safety or only function-call parts; inspect candidates.
