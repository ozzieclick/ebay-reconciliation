import os
import secrets
import asyncio
import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.firebase_auth import verify_request

from app.database import SessionLocal
from app.ebay_oauth import build_authorization_url, exchange_code_for_tokens, get_ebay_user
from app.payout_sync import sync_payouts
from app.models import EbayAccount, Payout, PushSubscription
from app.notifications import send_push_notification
from app.models.sync_run import SyncRun
from app.models.sync_state import SyncState
from app.scheduler import scheduler_loop


async def lifespan(app: FastAPI):
    scheduler_task = asyncio.create_task(scheduler_loop())

    try:
        yield
    finally:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass



class FirebaseAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path

        public_paths = {
            "/health",
            "/api/status",
            "/api/ebay/auth/callback",
            "/api/ebay/notifications/account-deletion",
        }

        if path.startswith("/api/") and path not in public_paths:
            try:
                verify_request(request)
            except HTTPException as exc:
                return JSONResponse(
                    status_code=exc.status_code,
                    content={"detail": exc.detail},
                )
            except Exception:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid authentication credentials"},
                )

        return await call_next(request)


app = FastAPI(title="eBay Reconciliation API", lifespan=lifespan)

app.add_middleware(FirebaseAuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.environ.get(
            "FRONTEND_URL",
            "https://reconcile-ebay.web.app",
        ),
        "http://100.121.44.6:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


oauth_states: dict[str, int] = {}


@app.get("/api/ebay/notifications/account-deletion")
def ebay_account_deletion_challenge(challenge_code: str = Query(...)):
    verification_token = os.environ.get("EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN")
    endpoint = os.environ.get(
        "EBAY_ACCOUNT_DELETION_ENDPOINT",
        "https://instance-20240820-0114.tail3c8a81.ts.net/prod/api/ebay/notifications/account-deletion",
    )

    if not verification_token:
        raise HTTPException(
            status_code=503,
            detail="eBay account deletion verification token not configured",
        )

    response_hash = hashlib.sha256(
        (
            challenge_code
            + verification_token
            + endpoint
        ).encode("utf-8")
    ).hexdigest()

    return {"challengeResponse": response_hash}


@app.post("/api/ebay/notifications/account-deletion")
async def ebay_account_deletion_notification():
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def api_status():
    return {
        "status": "ok",
        "service": "ebay-reconciliation-api",
    }


@app.post("/api/ebay/accounts/{account_id}/sync/payouts")
async def ebay_payout_sync(account_id: int):
    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise HTTPException(
                status_code=404,
                detail="eBay account not found",
            )

        if account.status != "active":
            raise HTTPException(
                status_code=400,
                detail="Account is inactive",
            )

    finally:
        db.close()

    try:
        return await sync_payouts(account_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        error_message = str(exc)

        if error_message.startswith("eBay refresh token failed:"):
            raise HTTPException(
                status_code=401,
                detail={
                    "message": "OAuth expired. Reauthorization required.",
                    "oauth_status": "refresh_failed",
                },
            ) from exc

        if error_message == "Payout sync already in progress":
            raise HTTPException(
                status_code=409,
                detail="Payout sync already in progress",
            ) from exc

        raise HTTPException(
            status_code=502,
            detail=f"Payout sync failed: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Payout sync failed: {exc}",
        ) from exc


@app.get("/api/ebay/accounts/{account_id}/sync/status")
def ebay_sync_status(account_id: int):
    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise HTTPException(
                status_code=404,
                detail="eBay account not found",
            )

        sync_state = (
            db.query(SyncState)
            .filter(SyncState.ebay_account_id == account_id)
            .one_or_none()
        )

        last_run = (
            db.query(SyncRun)
            .filter(SyncRun.ebay_account_id == account_id)
            .order_by(SyncRun.id.desc())
            .first()
        )

        return {
            "account_id": account_id,
            "status": sync_state.status if sync_state else "never_synced",
            "last_attempt_at": (
                sync_state.last_attempt_at.isoformat()
                if sync_state and sync_state.last_attempt_at
                else None
            ),
            "last_successful_sync_at": (
                sync_state.last_successful_sync_at.isoformat()
                if sync_state and sync_state.last_successful_sync_at
                else None
            ),
            "last_error": sync_state.last_error if sync_state else None,
            "last_run": (
                {
                    "id": last_run.id,
                    "status": last_run.status,
                    "started_at": (
                        last_run.started_at.isoformat()
                        if last_run.started_at
                        else None
                    ),
                    "finished_at": (
                        last_run.finished_at.isoformat()
                        if last_run.finished_at
                        else None
                    ),
                    "records_found": last_run.records_found,
                    "records_created": last_run.records_created,
                    "records_updated": last_run.records_updated,
                    "error_message": last_run.error_message,
                }
                if last_run
                else None
            ),
        }
    finally:
        db.close()


class PushSubscriptionCreate(BaseModel):
    token: str
    platform: str = "web"


@app.post("/api/push/subscribe")
def subscribe_push(request: Request, payload: PushSubscriptionCreate):
    user = verify_request(request)

    token = payload.token.strip()
    platform = payload.platform.strip() or "web"

    if not token:
        raise HTTPException(
            status_code=400,
            detail="Push token cannot be empty",
        )

    db = SessionLocal()

    try:
        subscription = (
            db.query(PushSubscription)
            .filter(PushSubscription.token == token)
            .one_or_none()
        )

        if subscription:
            subscription.user_id = user["uid"]
            subscription.platform = platform
            subscription.active = True
        else:
            subscription = PushSubscription(
                user_id=user["uid"],
                token=token,
                platform=platform,
                active=True,
            )
            db.add(subscription)

        db.commit()

        return {
            "status": "ok",
            "subscription_id": subscription.id,
        }
    finally:
        db.close()



@app.get("/api/ebay/accounts")
def ebay_accounts():
    db = SessionLocal()

    try:
        accounts = (
            db.query(EbayAccount)
            .order_by(EbayAccount.id)
            .all()
        )

        return {
            "accounts": [
                {
                    "id": account.id,
                    "name": account.name,
                    "ebay_username": account.ebay_username,
                    "status": account.status,
                    "authorized": bool(account.refresh_token),
                    "oauth_status": account.oauth_status,
                }
                for account in accounts
            ]
        }
    finally:
        db.close()

class EbayAccountCreate(BaseModel):
    name: str


@app.post("/api/ebay/accounts", status_code=201)
def create_ebay_account(payload: EbayAccountCreate):
    db = SessionLocal()

    try:
        name = payload.name.strip()

        if not name:
            raise HTTPException(
                status_code=400,
                detail="Account name cannot be empty",
            )

        account = EbayAccount(
            name=name,
            status="active",
        )

        db.add(account)
        db.commit()
        db.refresh(account)

        return {
            "id": account.id,
            "name": account.name,
            "ebay_username": account.ebay_username,
            "status": account.status,
        }
    finally:
        db.close()


class EbayAccountUpdate(BaseModel):
    name: str | None = None
    status: str | None = None


@app.patch("/api/ebay/accounts/{account_id}")
def update_ebay_account(
    account_id: int,
    payload: EbayAccountUpdate,
):
    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise HTTPException(status_code=404, detail="eBay account not found")

        if payload.name is not None:
            name = payload.name.strip()

            if not name:
                raise HTTPException(
                    status_code=400,
                    detail="Account name cannot be empty",
                )

            account.name = name

        if payload.status is not None:
            if payload.status not in {"active", "inactive"}:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid account status",
                )

            account.status = payload.status

        db.commit()
        db.refresh(account)

        return {
            "id": account.id,
            "name": account.name,
            "ebay_username": account.ebay_username,
            "status": account.status,
            "authorized": bool(account.refresh_token),
                    "oauth_status": account.oauth_status,
        }
    finally:
        db.close()

@app.get("/api/ebay/accounts/{account_id}/payouts")
def ebay_payouts(
    account_id: int,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise HTTPException(status_code=404, detail="eBay account not found")

        query = db.query(Payout).filter(
            Payout.ebay_account_id == account_id
        )

        if date_from is not None:
            query = query.filter(Payout.payout_date >= date_from)

        if date_to is not None:
            query = query.filter(Payout.payout_date <= date_to)

        query = query.order_by(
            Payout.payout_date.desc(),
            Payout.id.desc(),
        )

        total = query.count()
        payouts = query.offset(offset).limit(limit).all()

        return {
            "account_id": account_id,
            "total": total,
            "limit": limit,
            "offset": offset,
            "payouts": [
                {
                    "id": payout.id,
                    "ebay_payout_id": payout.ebay_payout_id,
                    "payout_date": payout.payout_date,
                    "amount": str(payout.amount),
                    "currency": payout.currency,
                    "status": payout.status,
                    "bank_reference_id": payout.bank_reference_id,
                    "transaction_count": payout.transaction_count,
                    "payout_instrument": payout.payout_instrument,
                }
                for payout in payouts
            ],
        }
    finally:
        db.close()


@app.get("/api/ebay/accounts/{account_id}/payouts/{ebay_payout_id}")
def ebay_payout_detail(
    account_id: int,
    ebay_payout_id: str,
):
    db = SessionLocal()

    try:
        payout = (
            db.query(Payout)
            .filter(
                Payout.ebay_account_id == account_id,
                Payout.ebay_payout_id == ebay_payout_id,
            )
            .one_or_none()
        )

        if payout is None:
            raise HTTPException(
                status_code=404,
                detail="Payout not found",
            )

        return {
            "id": payout.id,
            "ebay_account_id": payout.ebay_account_id,
            "ebay_payout_id": payout.ebay_payout_id,
            "payout_date": payout.payout_date,
            "amount": str(payout.amount),
            "currency": payout.currency,
            "status": payout.status,
            "bank_reference_id": payout.bank_reference_id,
            "transaction_count": payout.transaction_count,
            "payout_instrument": payout.payout_instrument,
            "raw_data": payout.raw_data,
        }

    finally:
        db.close()



@app.get("/api/ebay/auth/start")
def ebay_auth_start(account_id: int = Query(...)):
    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise HTTPException(status_code=404, detail="eBay account not found")

        state = secrets.token_urlsafe(32)
        oauth_states[state] = account.id

        return {
            "authorization_url": build_authorization_url(state),
        }
    finally:
        db.close()


@app.get("/api/ebay/auth/callback")
async def ebay_auth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        raise HTTPException(
            status_code=400,
            detail=f"eBay authorization failed: {error}",
        )

    if not code or not state:
        raise HTTPException(
            status_code=400,
            detail="Missing OAuth code or state",
        )

    account_id = oauth_states.pop(state, None)

    if account_id is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OAuth state",
        )

    try:
        tokens = await exchange_code_for_tokens(code)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"eBay token exchange failed: {exc}",
        ) from exc

    db = SessionLocal()

    try:
        account = db.get(EbayAccount, account_id)

        if account is None:
            raise HTTPException(
                status_code=404,
                detail="eBay account not found",
            )

        now = datetime.now(timezone.utc)

        account.access_token = tokens.get("access_token")
        account.refresh_token = tokens.get("refresh_token")
        account.oauth_status = "authorized"

        expires_in = tokens.get("expires_in")
        if expires_in is not None:
            account.access_token_expires_at = now + timedelta(
                seconds=int(expires_in)
            )

        refresh_token_expires_in = tokens.get("refresh_token_expires_in")
        if refresh_token_expires_in is not None:
            account.refresh_token_expires_at = now + timedelta(
                seconds=int(refresh_token_expires_in)
            )

        db.commit()

        try:
            ebay_user = await get_ebay_user(account.id)
            account.ebay_username = ebay_user.get("username")
            db.commit()
        except Exception as exc:
            print(f"eBay username lookup failed for account {account.id}: {exc}")

        frontend_url = os.environ.get(
            "FRONTEND_URL",
            "https://reconcile-ebay.web.app",
        )

        return RedirectResponse(
            url=f"{frontend_url}/?oauth=success&account_id={account.id}",
            status_code=303,
        )
    finally:
        db.close()
