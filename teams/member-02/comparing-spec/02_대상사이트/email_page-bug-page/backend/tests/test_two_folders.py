from backend.tests.test_auth import application, client, login, csrf


def test_only_inbox_and_sent(client):
    assert login(client, "test", "testtesttest").status_code == 200
    result = client.get("/api/mail/emails?summary=true").json()
    assert [folder["id"] for folder in result["folders"]] == ["inbox", "sent"]
    for folder in ["starred", "snoozed", "drafts", "spam", "trash", "archive"]:
        assert client.get(f"/api/mail/emails?folderId={folder}").status_code == 422
    assert client.post("/api/mail/drafts", headers=csrf(client), json={"subject": "Removed"}).status_code == 404
    sent = client.post("/api/mail/send", headers=csrf(client), json={"to": [{"address": "test@adminator.test"}], "subject": "Still works", "bodyText": "Message"})
    assert sent.status_code == 201
    for folder in ["inbox", "sent"]:
        assert len(client.get(f"/api/mail/emails?folderId={folder}").json()["items"]) == 1
