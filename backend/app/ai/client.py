"""Google Gen AI client (Gemini on Gemini Enterprise Agent Platform / Vertex AI) using ADC - no API keys."""

from functools import lru_cache

from google import genai
from google.genai import types

from app.config import settings


@lru_cache
def get_client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=settings.google_cloud_project or None,
        location=settings.google_cloud_location,
        http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=5, initial_delay=1.5, max_delay=20)),
    )
