"""Upload & Test: parsing, validation, PII guard, isolation, scoring, investigation, API, caps, export."""

import json

import pytest

import app.batches.store as store_mod
from app.batches import service as bs
from app.batches.parse import UploadError, parse_upload
from app.cases import service
from app.services import BatchNotFound, get_base_services, use_batch

HEADER = "transaction_id,customer_id,account_id,timestamp,amount_rupees,channel,counterparty_id,device_id"


def csv_rows(*rows: str) -> bytes:
    return ("\n".join([HEADER, *rows]) + "\n").encode()


GOOD = "TXN-T-0001,CUST-000123,ACC-000123,2026-09-29T10:00:00,1500,upi,MER-0001,DEV-000123A"


# ---- parsing & validation ----------------------------------------------------------------------------
def test_parse_valid_csv_and_json():
    p = parse_upload(csv_rows(GOOD), "csv")
    assert len(p.rows) == 1 and p.rows.iloc[0]["amount_paise"] == 150000 and not p.has_labels
    j = json.dumps({"transactions": [dict(zip(HEADER.split(","), GOOD.split(","), strict=True))]}).encode()
    assert len(parse_upload(j, "json").rows) == 1


@pytest.mark.parametrize("row,field", [
    ("TXN-T-0002,CUST-000123,ACC-000123,2026-09-29T10:00:00,-5,upi,MER-0001,DEV-000123A", "amount_rupees"),
    ("TXN-T-0002,CUST-000123,ACC-000123,not-a-date,10,upi,MER-0001,DEV-000123A", "timestamp"),
    ("TXN-T-0002,CUST-000123,ACC-000123,2026-09-29T10:00:00,10,cash,MER-0001,DEV-000123A", "channel"),
    ("bad id,CUST-000123,ACC-000123,2026-09-29T10:00:00,10,upi,MER-0001,DEV-000123A", "transaction_id"),
    ("TXN-T-0002,CUST-000123,ACC-000123,2020-01-01T10:00:00,10,upi,MER-0001,DEV-000123A", "timestamp"),
])
def test_row_errors_are_reported(row, field):
    with pytest.raises(UploadError) as e:
        parse_upload(csv_rows(row), "csv")
    assert e.value.errors[0]["row"] == 2 and e.value.errors[0]["field"] == field


def test_duplicate_ids_and_missing_columns():
    with pytest.raises(UploadError, match="row"):
        parse_upload(csv_rows(GOOD, GOOD), "csv")
    with pytest.raises(UploadError, match="missing required columns"):
        parse_upload(b"transaction_id,amount_rupees\nTXN-1,5\n", "csv")


@pytest.mark.parametrize("pii", ["4111 1111 1111 1111", "ABCPE1234F", "2345 6789 0123", "someone@example.com", "+91 9876543210"])
def test_pii_is_rejected(pii):
    with pytest.raises(UploadError, match="personal data"):
        parse_upload(csv_rows(GOOD) + f"# {pii}\n".encode(), "csv")


def test_limits():
    with pytest.raises(UploadError, match="too large"):
        parse_upload(b"x" * (2 * 1024 * 1024 + 1), "csv")
    with pytest.raises(UploadError):
        parse_upload(b"", "csv")
    with pytest.raises(UploadError, match="only CSV or JSON"):
        parse_upload(b"a", "xlsx")


# ---- batches: scoring, consistency, isolation ----------------------------------------------------------
@pytest.fixture
def template_batch(services):
    return bs.create_batch(bs.template_csv().encode(), "csv", "template.csv", "test")


def test_template_attack_is_flagged_and_metrics_computed(template_batch):
    s = template_batch["summary"]
    rows = {r["transaction_id"]: r for r in template_batch["rows"]}
    assert rows["TXN-UPL-ATK-BIG"]["is_candidate"] and rows["TXN-UPL-ATK-BIG"]["risk_score"] > 0.9
    assert not rows["TXN-UPL-OK-1"]["is_candidate"]
    assert "LIMITED_HISTORY" in rows["TXN-UPL-NEW-1"]["reason_codes"]
    assert s["new_customers"] == 1 and s["labelled_metrics"]["recall"] == 1.0


def test_consistency_checks(services):
    clash = "TXN-HERO-185K,CUST-000123,ACC-000123,2026-09-29T10:00:00,10,upi,MER-0001,DEV-000123A"
    with pytest.raises(UploadError, match="consistency"):
        bs.create_batch(csv_rows(clash), "csv", "x.csv", "test")
    wrong_owner = "TXN-T-0009,CUST-000124,ACC-000123,2026-09-29T10:00:00,10,upi,MER-0001,DEV-000123A"
    with pytest.raises(UploadError, match="consistency"):
        bs.create_batch(csv_rows(wrong_owner), "csv", "x.csv", "test")


def test_batches_are_isolated(services, template_batch):
    base = get_base_services()
    assert base.repo.public_transaction("TXN-UPL-ATK-BIG") is None and "DEV-UPL-NEW1" not in base.graph.g
    with use_batch(template_batch["batch_id"]) as svc:
        assert svc.repo.public_transaction("TXN-UPL-ATK-BIG") is not None and "DEV-UPL-NEW1" in svc.graph.g
    other = bs.create_batch(csv_rows(GOOD), "csv", "other.csv", "test")
    with use_batch(other["batch_id"]) as svc:
        assert svc.repo.public_transaction("TXN-UPL-ATK-BIG") is None


def test_batch_reloads_from_store_on_another_instance(services, template_batch):
    from app import services as svc_mod

    svc_mod._cache.clear()  # simulate a different Cloud Run instance
    with use_batch(template_batch["batch_id"]) as svc:
        assert svc.scorer.score_existing("TXN-UPL-ATK-BIG").is_candidate


def test_unknown_or_expired_batch(services, template_batch):
    with pytest.raises(BatchNotFound):
        with use_batch("BATCH-DOESNOTEXIST"):
            pass
    store_mod.get_batch_store().update(template_batch["batch_id"], {"expires_at": "2000-01-01T00:00:00+00:00"})
    from app import services as svc_mod

    svc_mod._cache.clear()
    with pytest.raises(BatchNotFound):
        bs.batch_view(template_batch["batch_id"])


# ---- investigation of uploaded rows ----------------------------------------------------------------
def test_investigate_uploaded_attack(services, template_batch):
    bid = template_batch["batch_id"]
    case = service.investigate(service.create_case("TXN-UPL-ATK-BIG", bid).case_id, use_ai=False)
    assert case.batch_id == bid and case.decision.tier == 3
    kinds = {e.kind for e in case.evidence}
    assert {"amount_deviation", "velocity", "device_novelty", "known_fraud_link"} <= kinds
    ok = service.investigate(service.create_case("TXN-UPL-OK-1", bid).case_id, use_ai=False)
    assert ok.decision.tier == 1
    # same transaction id in another batch is a different case
    again = bs.create_batch(bs.template_csv().encode(), "csv", "t2.csv", "test")
    assert service.create_case("TXN-UPL-ATK-BIG", again["batch_id"]).case_id != case.case_id


def test_per_batch_ai_cap(services, template_batch, monkeypatch):
    monkeypatch.setattr(service.settings, "max_ai_investigations_per_batch", 0)
    case = service.investigate(service.create_case("TXN-UPL-ATK-2", template_batch["batch_id"]).case_id, use_ai=True)
    assert case.investigation_mode == "deterministic_fallback" and "per-upload AI limit" in case.ai_error


def test_case_for_expired_batch_explains(services):
    bid = bs.create_batch(csv_rows(GOOD), "csv", "x.csv", "test")["batch_id"]
    case = service.create_case("TXN-T-0001", bid)
    store_mod.get_batch_store().update(bid, {"expires_at": "2000-01-01T00:00:00+00:00"})
    from app import services as svc_mod

    svc_mod._cache.clear()
    with pytest.raises(service.CaseError, match="upload the file again"):
        service.investigate(case.case_id, use_ai=False)


# ---- API -------------------------------------------------------------------------------------------
def test_api_upload_flow(client):
    tpl = client.get("/api/batches/template.csv")
    assert tpl.status_code == 200 and tpl.headers["content-type"].startswith("text/csv")
    r = client.post("/api/batches?format=csv&filename=my%20file.csv", content=tpl.content,
                    headers={"Content-Type": "text/csv"})
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["summary"]["candidates"] >= 5 and b["rows"][0]["is_candidate"]
    c = client.post("/api/cases", json={"transaction_id": "TXN-UPL-ATK-BIG", "batch_id": b["batch_id"]}).json()
    inv = client.post(f"/api/cases/{c['case_id']}/investigate").json()
    assert inv["decision"]["tier"] == 3 and inv["batch_id"] == b["batch_id"]
    net = client.get("/api/network/RCP-UPL-01", params={"transaction_id": "TXN-UPL-ATK-BIG", "batch_id": b["batch_id"]})
    assert net.status_code == 200
    assert client.get("/api/customers/CUST-UPL-NEW1/profile", params={"batch_id": b["batch_id"]}).status_code == 200
    assert client.get("/api/customers/CUST-UPL-NEW1/profile").status_code == 404  # not in base
    view = client.get(f"/api/batches/{b['batch_id']}").json()
    assert next(x for x in view["rows"] if x["transaction_id"] == "TXN-UPL-ATK-BIG")["tier"] == 3
    exp = client.get(f"/api/batches/{b['batch_id']}/results.csv")
    assert exp.status_code == 200 and "TXN-UPL-ATK-BIG" in exp.text


def test_api_rejections(client):
    bad = client.post("/api/batches?format=csv", content=csv_rows(GOOD.replace("1500", "-1")))
    assert bad.status_code == 422 and bad.json()["errors"][0]["field"] == "amount_rupees"
    assert client.post("/api/batches?format=xlsx", content=b"x").status_code == 415
    assert client.get("/api/batches/not-an-id").status_code == 404
    assert client.get("/api/batches/BATCH-0000000000AA").status_code == 404
    assert client.post("/api/batches?format=csv", content=b"x" * (2 * 1024 * 1024 + 10)).status_code == 413


def test_export_is_formula_safe():
    assert bs._safe_cell("=HYPERLINK(1)") == "'=HYPERLINK(1)" and bs._safe_cell("TXN-1") == "TXN-1"
