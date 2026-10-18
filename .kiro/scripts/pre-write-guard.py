#!/usr/bin/env python3
"""PreToolUse guard for file writes.

Reads the hook JSON from stdin and blocks (exit 2) writes that:
  1. introduce AWS / non-GCP cloud SDKs or endpoints (project is GCP-only),
  2. contain secrets (Google API keys, private keys, service-account JSON, AWS keys),
  3. use retired Gemini models or legacy Google AI SDKs.

Files under .kiro/ are skipped so steering/skills can mention these terms.
Example files (.env.example) are still scanned for secrets.
"""
import json
import re
import sys

raw = sys.stdin.read()

try:
    payload = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    payload = {}


def find_path(obj):
    """Best-effort search for a target file path anywhere in the hook payload."""
    if isinstance(obj, dict):
        for key in ("path", "file_path", "filePath", "targetFile", "file"):
            val = obj.get(key)
            if isinstance(val, str) and val:
                return val
        for val in obj.values():
            found = find_path(val)
            if found:
                return found
    elif isinstance(obj, list):
        for val in obj:
            found = find_path(val)
            if found:
                return found
    return ""


path = find_path(payload)
norm = path.replace("\\", "/")
if "/.kiro/" in norm or norm.startswith(".kiro/"):
    sys.exit(0)

NEW_CONTENT_KEYS = ("text", "newStr", "new_str", "content", "contents", "file_text", "new_string")


def collect_new_content(obj, out):
    """Gather only content being written (not oldStr), so fixes that REMOVE bad strings aren't blocked."""
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key in NEW_CONTENT_KEYS and isinstance(val, str):
                out.append(val)
            else:
                collect_new_content(val, out)
    elif isinstance(obj, list):
        for val in obj:
            collect_new_content(val, out)
    return out


chunks = collect_new_content(payload, [])
text = "\n".join(chunks) if chunks else raw

SECRET_RULES = [
    (r"AIza[0-9A-Za-z_\-]{35}", "Google API key"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----", "private key"),
    (r"\\?\"type\\?\"\s*:\s*\\?\"service_account\\?\"", "service-account key JSON"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key"),
]

AWS_RULES = [
    (r"\bboto3\b|\bbotocore\b", "boto3/botocore (AWS SDK)"),
    (r"@aws-sdk/|\baws-sdk\b|aws-cdk|@aws-cdk/|aws-amplify|@aws-amplify/", "AWS SDK/CDK/Amplify"),
    (r"amazonaws\.com", "AWS endpoint"),
    (r"\bAWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION|DEFAULT_REGION)\b", "AWS credentials env var"),
    (r"\bazure-|@azure/", "Azure SDK"),
]

LEGACY_AI_RULES = [
    (r"gemini-(?:1\.0|1\.5|2\.0|2\.5)[\w\.-]*", "retired/retiring Gemini model ID (use gemini-3.x via config)"),
    (r"\b(?:text|chat|code)-bison\b|\bgemini-pro\b", "legacy PaLM/Gemini 1.0 model"),
    (r"google-generativeai|google\.generativeai", "legacy Python SDK (use google-genai)"),
    (r"@google/generative-ai\b", "legacy JS SDK (use @google/genai)"),
    (r"vertexai\.generative_models|vertexai\.preview\.generative_models", "removed Vertex AI SDK module (use google-genai)"),
    (r"\b(?:openai|anthropic)\b\s*(?:==|>=|import|from|\")", "non-Google model SDK"),
]

PII_RULES = [
    # Indian PAN: 5 letters (4th = holder type), 4 digits, 1 letter
    (r"\b[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]\b", "PAN-like identifier (use pseudonymous IDs)"),
    # Aadhaar-like: 12 digits grouped 4-4-4 with separators
    (r"\b[2-9][0-9]{3}[ -][0-9]{4}[ -][0-9]{4}\b", "Aadhaar-like number (use pseudonymous IDs)"),
]

CARD_RE = re.compile(r"\b(?:4[0-9]{3}|5[1-5][0-9]{2}|2[2-7][0-9]{2}|3[47][0-9]{2}|6[0-9]{3})(?:[ -]?[0-9]{4}){3}\b")


def luhn_ok(number: str) -> bool:
    digits = [int(d) for d in re.sub(r"\D", "", number)]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d = d * 2 - 9 if d * 2 > 9 else d * 2
        total += d
    return total % 10 == 0


problems = []
for rules, label in ((SECRET_RULES, "SECRET"), (AWS_RULES, "NON-GCP"), (LEGACY_AI_RULES, "LEGACY-AI"), (PII_RULES, "PII")):
    for pattern, desc in rules:
        if re.search(pattern, text):
            problems.append(f"[{label}] {desc}")
if any(luhn_ok(m.group(0)) for m in CARD_RE.finditer(text)):
    problems.append("[PII] valid card number (PAN) - use tokens like CARD-0001; synthetic data only")

if problems:
    sys.stderr.write(
        f"Write blocked by pre-write guard for '{path or 'unknown file'}':\n  - "
        + "\n  - ".join(problems)
        + "\nFixes: load secrets from env/Secret Manager; use GCP services only (see tech.md AWS->GCP map);"
        " use google-genai/@google/genai with model IDs from config (gemini-3.x).\n"
    )
    sys.exit(2)

sys.exit(0)
