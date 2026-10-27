from coloride_desktop.agents.linear_oauth import (
    LINEAR_AUTHORIZE_URL,
    build_authorize_url,
    _token_from_response,
    LinearOAuthError,
)
import httpx
import pytest


def test_build_authorize_url_includes_state_and_loopback_redirect() -> None:
    url = build_authorize_url(
        client_id="lin_app_test",
        redirect_uri="http://127.0.0.1:8789/oauth/linear/callback",
        state="abc123",
    )
    assert url.startswith(LINEAR_AUTHORIZE_URL)
    assert "client_id=lin_app_test" in url
    assert "state=abc123" in url
    assert "redirect_uri=http%3A%2F%2F127.0.0.1%3A8789%2Foauth%2Flinear%2Fcallback" in url
    assert "scope=read%2Cwrite" in url


def test_token_from_response_reads_access_token() -> None:
    response = httpx.Response(200, json={"access_token": "lin_oauth_xxx", "token_type": "Bearer"})
    assert _token_from_response(response) == "lin_oauth_xxx"


def test_token_from_response_rejects_error() -> None:
    response = httpx.Response(400, text="invalid_grant")
    with pytest.raises(LinearOAuthError, match="token exchange failed"):
        _token_from_response(response)
