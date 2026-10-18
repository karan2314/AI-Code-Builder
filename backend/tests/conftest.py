import os

import pytest

# Unit/API tests never call Gemini or Firestore.
os.environ.setdefault("GEMINI_ENABLED", "false")
os.environ.setdefault("FIRESTORE_ENABLED", "false")


@pytest.fixture(scope="session")
def services():
    from app.services import get_services

    return get_services()


@pytest.fixture(scope="session")
def client(services):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
