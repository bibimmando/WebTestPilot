"""V6 ground truth: unknown recipients are accepted and saved as sent."""
import json
from fastapi.testclient import TestClient
from sqlalchemy import select
from backend.app import create_app
from backend.models import InternalMail, User
from backend.tests.test_auth import application, client, csrf, login, register


def test_unknown_recipient_saved_and_not_delivered_retroactively(application):
    with TestClient(application) as browser:
        assert login(browser, "test", "testtesttest").status_code == 200
        with application.state.session_factory() as db:
            assert db.scalar(select(User).where(User.username == "hi")) is None
        headers = csrf(browser)
        body = {"to": [{"address": "hi@adminator.test"}], "cc": [{"address": "admin@adminator.test"}],
                "bcc": [{"address": "missing@adminator.test"}], "subject": "Unknown recipient", "bodyText": "Persist this", "clientId": "v6-once"}
        response = browser.post("/api/mail/send", headers=headers, json=body)
        assert response.status_code == 201
        assert response.json()["status"] == "delivered-internal"
        mid = response.json()["email"]["id"]
        assert browser.post("/api/mail/send", headers=headers, json=body).json() == response.json()
        with application.state.session_factory() as db:
            mail = json.loads(db.get(InternalMail, mid).data_json)
            assert mail["folderId"] == "sent" and mail["to"][0]["address"] == "hi@adminator.test"
    restarted = create_app(application.state.settings)
    with TestClient(restarted) as browser:
        login(browser, "test", "testtesttest")
        assert browser.get(f"/api/mail/emails/{mid}").json()["subject"] == "Unknown recipient"
        assert len(browser.get("/api/mail/emails?folderId=sent").json()["items"]) == 1
        login(browser, "admin", "adminadminadmin")
        assert len(browser.get("/api/mail/emails?folderId=inbox").json()["items"]) == 1
        assert register(browser, "missing").status_code == 201
        assert login(browser, "missing").status_code == 200
        assert browser.get("/api/mail/emails?folderId=inbox").json()["items"] == []
