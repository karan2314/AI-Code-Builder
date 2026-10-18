#!/usr/bin/env python3
"""PreToolUse hook for shell commands.

Asks the user to confirm commands that change live cloud resources or cost money
(deploys, project/billing changes, deletes, IAM changes). Read-only commands pass through.
"""
import json
import re
import sys

raw = sys.stdin.read()

RISKY = [
    (r"gcloud\s+run\s+(deploy|services\s+(delete|update|update-traffic|add-iam-policy-binding))", "Cloud Run change"),
    (r"gcloud\s+projects\s+(create|delete|add-iam-policy-binding|remove-iam-policy-binding)", "project/IAM change"),
    (r"gcloud\s+billing", "billing change"),
    (r"gcloud\s+\S+(\s+\S+)*\s+delete\b", "GCP resource deletion"),
    (r"gcloud\s+builds\s+submit", "Cloud Build run"),
    (r"gcloud\s+services\s+(enable|disable)", "API enable/disable"),
    (r"gcloud\s+(secrets|iam)\s+\S+\s+(create|add-iam-policy-binding|delete|versions\s+add)", "secret/IAM change"),
    (r"firebase\s+(deploy|hosting:disable|projects:create|projects:addfirebase|firestore:delete|auth:import)", "Firebase change"),
    (r"adk\s+deploy", "ADK deploy"),
    (r"\bbq\s+(rm|mk|load|cp|update|insert)\b", "BigQuery change"),
    (r"gcloud\s+firestore\s+(databases\s+(create|delete)|import|export)", "Firestore change"),
    (r"gsutil\s+(rm|rb)|gcloud\s+storage\s+(rm|buckets\s+delete)", "Cloud Storage deletion"),
]

matches = [desc for pattern, desc in RISKY if re.search(pattern, raw)]
if matches:
    print(json.dumps({
        "hookSpecificOutput": {
            "permissionDecision": "ask",
            "permissionDecisionReason": "This command affects live Google Cloud resources ("
            + ", ".join(sorted(set(matches)))
            + "). Confirm project/region and cost impact before proceeding.",
        }
    }))
sys.exit(0)
