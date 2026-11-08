"""V8: registration accepts short passwords despite its 12–128 hint."""
import pytest
from sqlalchemy import select
from backend.models import User
from backend.tests.test_auth import application, client, register, login


@pytest.mark.parametrize("password", ["x", "abc", "test", "x" * 11, "x" * 12, "x" * 128])
def test_short_password_registration_and_login(client, application, password):
    result = register(client, "short_user", password=password, confirmPassword=password)
    assert result.status_code == 201
    assert login(client, "short_user", password).status_code == 200
    with application.state.session_factory() as db:
        user = db.scalar(select(User).where(User.username == "short_user"))
        assert user.password_hash.startswith("$argon2id$")
        assert user.password_hash != password


@pytest.mark.parametrize("password,confirmation", [("", ""), ("x" * 129, "x" * 129), ("test", "different")])
def test_remaining_password_checks(client, password, confirmation):
    assert register(client, "invalid_user", password=password, confirmPassword=confirmation).status_code == 422
