"""Client for the private Laya decision service (Cloud Run, IAM-authenticated).

On Cloud Run the runtime service account mints a Google ID token for the Laya service URL from the
metadata server (no keys). Locally, `gcloud auth print-identity-token` is used when ADC can't mint one.
Only tool-computed, pseudonymous features are sent - never raw history or labels.
"""

from __future__ import annotations

import subprocess
import threading
import time

import requests

from app.config import settings

_token: dict = {"value": None, "exp": 0.0}
_lock = threading.Lock()


class LayaUnavailable(RuntimeError):
    pass


def _id_token(audience: str) -> str:
    with _lock:
        if _token["value"] and _token["exp"] > time.time() + 60:
            return _token["value"]
        try:
            from google.auth.transport.requests import Request
            from google.oauth2 import id_token

            tok = id_token.fetch_id_token(Request(), audience)
        except Exception:
            # local development with user credentials
            tok = subprocess.run(["gcloud", "auth", "print-identity-token"], capture_output=True, text=True,
                                 timeout=20, check=True).stdout.strip()
        _token.update(value=tok, exp=time.time() + 50 * 60)
        return tok


def triage(case_id: str, state: dict) -> dict:
    if not (settings.enable_laya and settings.laya_url):
        raise LayaUnavailable("Laya is disabled (ENABLE_LAYA=false)")
    url = settings.laya_url.rstrip("/")
    if not url.startswith("https://") and not url.startswith("http://localhost"):
        raise LayaUnavailable("LAYA_URL must be https")
    try:
        resp = requests.post(f"{url}/v1/fraud-triage", json={"case_id": case_id, "state": state},
                             headers={"Authorization": f"Bearer {_id_token(url)}"}, timeout=settings.laya_timeout_s)
    except requests.RequestException as e:
        raise LayaUnavailable(f"{type(e).__name__}") from e
    if resp.status_code != 200:
        raise LayaUnavailable(f"HTTP {resp.status_code}")
    return resp.json()
