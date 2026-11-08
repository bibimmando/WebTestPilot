"""Durable fixtures for the AI tester, applied after schema migration at startup."""
import json
from sqlalchemy import select
from backend.models import User, InternalMail, MockMailbox
from backend.security import PASSWORDS, verify_password

FIXED_ACCOUNTS = (("test", "testtesttest"), ("admin", "adminadminadmin"))


def ensure_fixed_accounts(db):
    for username, password in FIXED_ACCOUNTS:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            user = User(username=username, display_name=username,
                        email_address=f"{username}@adminator.test", password_hash=PASSWORDS.hash(password))
            db.add(user)
        else:
            user.is_active = True
            user.email_address = f"{username}@adminator.test"
            if not verify_password(password, user.password_hash):
                user.password_hash = PASSWORDS.hash(password)
    db.commit()


def normalize_mailboxes(db):
    # Retire the folder without destroying messages in existing installations.
    for row in db.scalars(select(InternalMail)):
        mail = json.loads(row.data_json)
        if mail.get("folderId") not in {"inbox", "sent", "drafts"}:
            mail["folderId"] = "sent" if mail.get("sentAt") else "inbox"
            row.data_json = json.dumps(mail)
            row.revision += 1
    for row in db.scalars(select(MockMailbox)):
        state = json.loads(row.state_json)
        changed = False
        for mail in state.get("emails", []):
            if mail.get("folderId") not in {"inbox", "sent", "drafts"}:
                mail["folderId"] = "sent" if mail.get("sentAt") else "inbox"
                changed = True
        if changed:
            row.state_json = json.dumps(state)
            row.revision += 1
    db.commit()
