from datetime import datetime, timezone
from decimal import Decimal

from app.database import SessionLocal
from app.ebay_oauth import get_payouts
from app.models.payout import Payout
from app.models.sync_run import SyncRun
from app.models.sync_state import SyncState


PAGE_LIMIT = 100


def _parse_payout_date(value):
    if not value:
        return None

    if isinstance(value, datetime):
        return value

    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _parse_amount(payout):
    amount = payout.get("amount") or {}
    return Decimal(str(amount.get("value", "0")))


def _parse_currency(payout):
    amount = payout.get("amount") or {}
    return amount.get("currency") or ""


def _extract_payout_instrument(payout):
    instrument = payout.get("payoutInstrument")

    if instrument is None:
        return None

    if isinstance(instrument, dict):
        return instrument

    return {"value": str(instrument)}


async def sync_payouts(account_id: int) -> dict:
    db = SessionLocal()

    sync_run = SyncRun(
        ebay_account_id=account_id,
        status="running",
        records_found=0,
        records_created=0,
        records_updated=0,
    )

    db.add(sync_run)

    sync_state = (
        db.query(SyncState)
        .filter(SyncState.ebay_account_id == account_id)
        .with_for_update()
        .one_or_none()
    )

    if sync_state is None:
        sync_state = SyncState(
            ebay_account_id=account_id,
            status="syncing",
            last_attempt_at=datetime.now(timezone.utc),
        )
        db.add(sync_state)
        db.commit()
    else:
        if sync_state.status == "syncing":
            db.rollback()
            db.close()
            raise RuntimeError("Payout sync already in progress")

        sync_state.status = "syncing"
        sync_state.last_attempt_at = datetime.now(timezone.utc)
        sync_state.last_error = None
        db.commit()

    db.refresh(sync_run)
    db.refresh(sync_run)

    total_found = 0
    total_created = 0
    total_updated = 0
    offset = 0

    try:
        while True:

            data = await get_payouts(
                account_id,
                limit=PAGE_LIMIT,
                offset=offset,
            )

            payouts = data.get("payouts") or []
            total = int(data.get("total", 0))

            for payout_data in payouts:
                ebay_payout_id = str(payout_data["payoutId"])

                payout = (
                    db.query(Payout)
                    .filter(
                        Payout.ebay_account_id == account_id,
                        Payout.ebay_payout_id == ebay_payout_id,
                    )
                    .one_or_none()
                )

                values = {
                    "payout_date": _parse_payout_date(
                        payout_data.get("payoutDate")
                    ),
                    "amount": _parse_amount(payout_data),
                    "currency": _parse_currency(payout_data),
                    "status": payout_data.get("payoutStatus") or "",
                    "bank_reference_id": payout_data.get("bankReferenceId"),
                    "transaction_count": payout_data.get("transactionCount"),
                    "payout_instrument": _extract_payout_instrument(
                        payout_data
                    ),
                    "raw_data": payout_data,
                }

                if payout is None:
                    payout = Payout(
                        ebay_account_id=account_id,
                        ebay_payout_id=ebay_payout_id,
                        **values,
                    )
                    db.add(payout)
                    total_created += 1
                else:
                    changed = False

                    for field, value in values.items():
                        if getattr(payout, field) != value:
                            setattr(payout, field, value)
                            changed = True

                    if changed:
                        total_updated += 1

            total_found += len(payouts)

            db.commit()

            if offset + len(payouts) >= total or not payouts:
                break

            offset += len(payouts)

        now = datetime.now(timezone.utc)

        sync_run.status = "success"
        sync_run.finished_at = now
        sync_run.records_found = total_found
        sync_run.records_created = total_created
        sync_run.records_updated = total_updated

        sync_state.last_successful_sync_at = now
        sync_state.last_attempt_at = now
        sync_state.status = "success"
        sync_state.last_error = None

        db.commit()

        return {
            "status": "success",
            "account_id": account_id,
            "records_found": total_found,
            "records_created": total_created,
            "records_updated": total_updated,
        }

    except Exception as exc:
        db.rollback()

        now = datetime.now(timezone.utc)
        error_message = str(exc)

        sync_run.status = "failed"
        sync_run.finished_at = now
        sync_run.records_found = total_found
        sync_run.records_created = total_created
        sync_run.records_updated = total_updated
        sync_run.error_message = error_message

        sync_state.status = "failed"
        sync_state.last_attempt_at = now
        sync_state.last_error = error_message

        db.commit()

        raise

    finally:
        db.close()
