import base64
import os
from urllib.parse import urlencode

import httpx


EBAY_ENVIRONMENT = os.environ.get("EBAY_ENVIRONMENT", "sandbox").lower()

if EBAY_ENVIRONMENT == "production":
    EBAY_OAUTH_AUTHORIZE_URL = "https://auth.ebay.com/oauth2/authorize"
    EBAY_OAUTH_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
    EBAY_FINANCES_URL = "https://apiz.ebay.com/sell/finances/v1/payout"
else:
    EBAY_OAUTH_AUTHORIZE_URL = "https://auth.sandbox.ebay.com/oauth2/authorize"
    EBAY_OAUTH_TOKEN_URL = "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    EBAY_FINANCES_URL = "https://apiz.sandbox.ebay.com/sell/finances/v1/payout"

SCOPES = [
    "https://api.ebay.com/oauth/api_scope/sell.finances",
    "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
]


def build_authorization_url(state: str) -> str:
    app_id = os.environ["EBAY_APP_ID"]
    ru_name = os.environ["EBAY_RU_NAME"]

    params = {
        "client_id": app_id,
        "redirect_uri": ru_name,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "state": state,
    }

    return f"{EBAY_OAUTH_AUTHORIZE_URL}?{urlencode(params)}"


def basic_auth_header() -> str:
    app_id = os.environ["EBAY_APP_ID"]
    cert_id = os.environ["EBAY_CERT_ID"]

    credentials = f"{app_id}:{cert_id}".encode()
    encoded = base64.b64encode(credentials).decode()

    return f"Basic {encoded}"


async def exchange_code_for_tokens(code: str) -> dict:
    ru_name = os.environ["EBAY_RU_NAME"]

    headers = {
        "Authorization": basic_auth_header(),
        "Content-Type": "application/x-www-form-urlencoded",
    }

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": ru_name,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            EBAY_OAUTH_TOKEN_URL,
            headers=headers,
            data=data,
        )

    response.raise_for_status()
    return response.json()


async def refresh_access_token(refresh_token: str) -> dict:
    headers = {
        "Authorization": basic_auth_header(),
        "Content-Type": "application/x-www-form-urlencoded",
    }

    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": " ".join(SCOPES),
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            EBAY_OAUTH_TOKEN_URL,
            headers=headers,
            data=data,
        )

    response.raise_for_status()
    return response.json()


async def get_valid_access_token(account_id: int) -> str:
    from datetime import datetime, timedelta, timezone

    from app.database import SessionLocal
    from app.models import EbayAccount

    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise ValueError("eBay account not found")

        if not account.refresh_token:
            raise ValueError("eBay account has no refresh token")

        now = datetime.now(timezone.utc)

        # Refresh five minutes before expiration.
        if (
            account.access_token
            and account.access_token_expires_at
            and account.access_token_expires_at > now + timedelta(minutes=5)
        ):
            return account.access_token

        try:
            tokens = await refresh_access_token(account.refresh_token)

        except Exception as exc:
            account.oauth_status = "refresh_failed"
            account.access_token = None

            db.commit()

            raise RuntimeError(
                f"eBay refresh token failed: {exc}"
            ) from exc

        new_access_token = tokens.get("access_token")
        if not new_access_token:
            raise ValueError("eBay did not return a new access token")

        account.access_token = new_access_token
        account.oauth_status = "authorized"

        expires_in = tokens.get("expires_in")
        if expires_in is not None:
            account.access_token_expires_at = now + timedelta(
                seconds=int(expires_in)
            )

        new_refresh_token = tokens.get("refresh_token")
        if new_refresh_token:
            account.refresh_token = new_refresh_token

        refresh_token_expires_in = tokens.get("refresh_token_expires_in")
        if refresh_token_expires_in is not None:
            account.refresh_token_expires_at = now + timedelta(
                seconds=int(refresh_token_expires_in)
            )

        db.commit()

        return new_access_token

    finally:
        db.close()


async def get_ebay_user(account_id: int) -> dict:
    token = await get_valid_access_token(account_id)

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    url = (
        "https://apiz.ebay.com/commerce/identity/v1/user/"
        if EBAY_ENVIRONMENT == "production"
        else "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/"
    )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            url,
            headers=headers,
        )

    if response.status_code >= 400:
        raise RuntimeError(
            f"eBay Identity API error {response.status_code}: {response.text}"
        )

    return response.json()


async def get_payouts(
    account_id: int,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    token = await get_valid_access_token(account_id)

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    url = EBAY_FINANCES_URL

    params = {
        "limit": limit,
        "offset": offset,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            url,
            headers=headers,
            params=params,
        )

    if response.status_code >= 400:
        raise RuntimeError(
            f"eBay API error {response.status_code}: {response.text}"
        )

    return response.json()
