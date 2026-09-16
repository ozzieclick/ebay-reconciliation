import asyncio
import os
import logging

from app.database import SessionLocal
from app.models import EbayAccount
from app.payout_sync import sync_payouts


logger = logging.getLogger(__name__)

SYNC_INTERVAL_MINUTES = int(
    os.environ.get("EBAY_SYNC_INTERVAL_MINUTES", "60")
)


async def sync_all_accounts():
    db = SessionLocal()

    try:
        accounts = (
            db.query(EbayAccount)
            .filter(
                EbayAccount.status == "active",
                EbayAccount.refresh_token.isnot(None),
            )
            .order_by(EbayAccount.id)
            .all()
        )

        account_ids = [account.id for account in accounts]

    finally:
        db.close()

    for account_id in account_ids:
        try:
            result = await sync_payouts(account_id)
            logger.info(
                "Automatic payout sync completed for account %s: %s",
                account_id,
                result,
            )
        except RuntimeError as exc:
            if str(exc) == "Payout sync already in progress":
                logger.info(
                    "Skipping account %s: sync already running",
                    account_id,
                )
            else:
                logger.exception(
                    "Automatic payout sync failed for account %s",
                    account_id,
                )
        except Exception:
            logger.exception(
                "Automatic payout sync failed for account %s",
                account_id,
            )


async def scheduler_loop():
    logger.info(
        "eBay payout scheduler started. Interval: %s minutes",
        SYNC_INTERVAL_MINUTES,
    )

    while True:
        await asyncio.sleep(SYNC_INTERVAL_MINUTES * 60)

        try:
            await sync_all_accounts()
        except Exception:
            logger.exception("Unexpected error in payout scheduler")
