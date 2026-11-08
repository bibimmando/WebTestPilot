"""Bounded queries preserve mailbox counts, historical messages and visibility."""
import json
import pytest
from uuid import uuid4
from sqlalchemy import event as sql_event
from backend.models import InternalMail, ChatRoom, ChatMessage, CalendarEvent, User
from backend.tests.test_auth import application, client, register, login, csrf


def mail(uid, folder, labels):
    return {"id": str(uuid4()), "accountId": uid, "messageId": None, "threadId": "thread",
        "from": {"name": "Owner", "address": "alice@adminator.test"}, "to": [], "cc": [], "bcc": [],
        "subject": "Search value", "bodyText": "secret body", "bodyHtml": "", "labels": labels,
        "folderId": folder, "isRead": False, "isStarred": False, "category": "primary",
        "receivedAt": "2030-01-01T00:00:00Z", "sentAt": None, "updatedAt": "2030-01-01T00:00:00Z",
        "attachments": [], "references": [], "inReplyTo": None, "deliveryStatus": "received"}


def test_mail_page_and_counts_share_owner_snapshot(client, application):
    uid = register(client).json()["user"]["id"]; login(client)
    with application.state.session_factory() as db:
        for folder, labels in [("inbox", ["important"]), ("inbox", []), ("inbox", []), ("trash", ["important", "important"])]:
            data = mail(uid, folder, labels)
            db.add(InternalMail(id=data["id"], owner_id=uid, data_json=json.dumps(data)))
        other = User(username="other", display_name="Other", email_address="other@adminator.test", password_hash="unused")
        db.add(other); db.flush(); data = mail(other.id, "inbox", ["success"])
        db.add(InternalMail(id=data["id"], owner_id=other.id, data_json=json.dumps(data))); db.commit()
    result = client.get('/api/mail/emails?folderId=inbox&limit=2&offset=0&summary=true').json()
    assert len(result["items"]) == 2
    assert result["total"] == 3
    assert next(x for x in result["folders"] if x["id"] == "inbox")["total"] == 3
    assert next(x for x in result["labels"] if x["id"] == "important")["total"] == 2
    assert next(x for x in result["labels"] if x["id"] == "success")["total"] == 0
    assert all(x["accountId"] == uid for x in result["items"])
    assert len(client.get('/api/mail/emails?folderId=inbox&label=important&summary=true&limit=25').json()["items"]) == 1
    assert len(client.get('/api/mail/emails').json()["items"]) == 4  # legacy all-record contract



@pytest.mark.parametrize('query', ['öwner', '%_literal', 'adminator.test Search', 'Search value secret', 'x' * 250])
def test_sql_mail_search_matches_client_haystack(client, application, query):
    uid = register(client).json()['user']['id']; login(client)
    data = mail(uid, 'inbox', []); data['from']['name'] = 'Öwner'; data['bodyText'] += ' %_literal ' + 'x' * 250
    with application.state.session_factory() as db:
        db.add(InternalMail(id=data['id'], owner_id=uid, data_json=json.dumps(data))); db.commit()
    result = client.get('/api/mail/emails', params={'query':query,'summary':'true'}).json()
    assert result['total'] == 1, result
    assert result['items'][0]['id'] == data['id']


def test_legacy_non_array_labels_do_not_count_and_thread_query_keeps_all_items(client, application):
    uid = register(client).json()['user']['id']; login(client)
    with application.state.session_factory() as db:
        for labels in ['important', {'old':'important'}, None, ['important','important']]:
            data = mail(uid, 'inbox', labels)
            db.add(InternalMail(id=data['id'],owner_id=uid,data_json=json.dumps(data)))
        db.commit()
    result = client.get('/api/mail/emails?summary=true&label=important').json()
    assert result['total'] == 1
    assert next(x for x in result['labels'] if x['id']=='important')['total'] == 1
    assert len(client.get('/api/mail/emails?threadId=thread&sort=oldest').json()['items']) == 4

