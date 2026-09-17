from fastapi import HTTPException, Request
from firebase_admin import auth, credentials, initialize_app, get_app
import firebase_admin


def _initialize_firebase():
    try:
        get_app()
    except ValueError:
        initialize_app(credentials.ApplicationDefault())


_initialize_firebase()


def verify_request(request: Request):
    authorization = request.headers.get("Authorization", "")

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )

    token = authorization[7:].strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )

    try:
        return auth.verify_id_token(token)
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication credentials",
        )
