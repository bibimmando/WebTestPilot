"""Fresh-clone credentials, retired routes and the reduced mailbox contract."""
import json

from fastapi.testclient import TestClient
from sqlalchemy import select
from backend.app import create_app
from backend.models import User, InternalMail, MockMailbox
from backend.tests.test_auth import application, client, csrf, login


def test_fixed_accounts_survive_restart_without_duplicate_or_lost_mail(application):
    identities = {}
    with TestClient(application) as browser:
        for username, password in [("test", "testtesttest"), ("admin", "adminadminadmin")]:
            response = login(browser, username, password)
            assert response.status_code == 200
            identities[username] = response.json()["user"]["id"]
        response = browser.post("/api/mail/send", headers=csrf(browser), json={
            "to": [{"address": "test@adminator.test"}], "subject": "Fixed account delivery",
            "bodyText": "Available after restart", "labels": ["important", "success"],
        })
        assert response.status_code == 201
        assert response.json()["email"]["labels"] == ["important", "success"]
    restarted = create_app(application.state.settings)
    with TestClient(restarted) as browser:
        for username, password in [("test", "testtesttest"), ("admin", "adminadminadmin")]:
            response = login(browser, username, password)
            assert response.status_code == 200
            assert response.json()["user"]["id"] == identities[username]
        login(browser, "test", "testtesttest")
        result = browser.get("/api/mail/emails?folderId=inbox&summary=true").json()
        assert [m["subject"] for m in result["items"]] == ["Fixed account delivery"]
        assert {label["id"] for label in result["labels"]} == {"important", "success"}
        assert "spam" not in {folder["id"] for folder in result["folders"]}
        with restarted.state.session_factory() as db:
            assert len(db.scalars(select(User)).all()) == 2


def test_retired_pages_and_apis_are_unavailable_even_with_stale_assets(client, application):
    login(client, "test", "testtesttest")
    for page in ["chat", "calendar", "tasks", "settings", "reports", "people", "search", "attention", "charts", "forms", "ui", "buttons", "blank", "basic-table", "datatable", "google-maps", "vector-maps", "404", "500"]:
        (application.state.settings.static_dir / f"{page}.html").write_text("stale page")
        assert client.get(f"/{page}.html").status_code == 404
    for path in ["/api/dashboard", "/api/chat/rooms", "/api/calendar/events", "/api/workspace/tasks", "/api/search", "/api/preferences"]:
        assert client.get(path).status_code == 404
    assert client.get("/", follow_redirects=False).headers["location"] == "/email.html"


def test_mail_rejects_retired_labels_and_spam(client):
    login(client, "test", "testtesttest")
    draft = client.post("/api/mail/drafts", headers=csrf(client), json={"subject": "Draft"}).json()
    for labels in [["Work"], ["Team"], ["Finance"], ["Invoices"], ["Travel"]]:
        assert client.patch(f"/api/mail/emails/{draft['id']}", headers=csrf(client), json={"labels": labels}).status_code == 422
    assert client.patch(f"/api/mail/emails/{draft['id']}", headers=csrf(client), json={"folderId": "spam"}).status_code == 422
    assert client.get("/api/mail/emails?folderId=spam").status_code == 422


def test_legacy_spam_is_preserved_in_trash_on_restart(application):
    with TestClient(application) as browser:
        uid = login(browser, "test", "testtesttest").json()["user"]["id"]
        draft = browser.post("/api/mail/drafts", headers=csrf(browser), json={"subject": "Legacy mail", "bodyText": "Keep content"}).json()
        with application.state.session_factory() as db:
            row = db.get(InternalMail, draft["id"])
            mail = json.loads(row.data_json)
            mail["folderId"] = "spam"
            row.data_json = json.dumps(mail)
            db.add(MockMailbox(user_id=uid, namespace="default", revision=1, state_json=json.dumps({"version": 1, "emails": [mail], "files": {}})))
            db.commit()
    restarted = create_app(application.state.settings)
    with TestClient(restarted) as browser:
        login(browser, "test", "testtesttest")
        mail = browser.get(f"/api/mail/emails/{draft['id']}").json()
        assert mail["folderId"] == "trash" and mail["bodyText"] == "Keep content"
        mock = browser.get("/api/mock-mailbox").json()
        assert mock["state"]["emails"][0]["folderId"] == "trash"
        assert mock["revision"] == 2
