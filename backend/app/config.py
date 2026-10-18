"""Application settings loaded from environment variables (see .env.example)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Google Cloud / Gemini
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    gemini_enabled: bool = True
    gemini_model: str = "gemini-3.5-flash"
    gemini_model_synth: str = "gemini-3.5-flash"
    agent_thinking_level: str = "LOW"      # MINIMAL | LOW | MEDIUM | HIGH
    synthesis_thinking_level: str = "LOW"

    # Investigation limits
    max_tool_calls: int = 12
    investigation_timeout_s: float = 45.0

    # Data / models
    data_dir: Path = BACKEND_DIR / "data"
    models_dir: Path = BACKEND_DIR / "models"
    metrics_dir: Path = BACKEND_DIR.parent / "docs" / "metrics"
    static_dir: Path = BACKEND_DIR / "static"
    dataset_seed: int = 42

    # Persistence
    firestore_enabled: bool = False
    firestore_database: str = "(default)"

    # Laya decision service (Variant C, optional, advisory). Private Cloud Run service, IAM-authenticated.
    enable_laya: bool = False
    laya_url: str = ""                 # e.g. https://fraudlens-laya-xxxx.run.app
    laya_timeout_s: float = 30.0       # first call may hit a cold start (model load)

    # Demo / safety / cost control
    demo_mode: bool = True
    rate_limit_per_min: int = 20
    max_ai_investigations_per_day: int = 60  # hard cap on Gemini spend; beyond it -> deterministic fallback
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

# ADK's Gemini model class builds its own genai client from environment variables, so mirror the settings
# there: Vertex AI (Gemini Enterprise Agent Platform) with ADC - never the API-key Developer API.
import os  # noqa: E402

os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
if settings.google_cloud_project:
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.google_cloud_project)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.google_cloud_location)
