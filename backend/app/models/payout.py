from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Payout(Base):
    __tablename__ = "payouts"

    __table_args__ = (
        UniqueConstraint(
            "ebay_account_id",
            "ebay_payout_id",
            name="uq_payout_account_external_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ebay_account_id: Mapped[int] = mapped_column(
        ForeignKey("ebay_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ebay_payout_id: Mapped[str] = mapped_column(String(100), nullable=False)
    payout_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    bank_reference_id: Mapped[str | None] = mapped_column(String(200))
    transaction_count: Mapped[int | None] = mapped_column(Integer)
    payout_instrument: Mapped[dict | None] = mapped_column(JSONB)
    raw_data: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
