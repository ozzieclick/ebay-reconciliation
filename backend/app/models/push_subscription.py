from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    __table_args__ = (
        UniqueConstraint("token", name="uq_push_subscription_token"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(500), nullable=False)
    platform: Mapped[str] = mapped_column(String(30), nullable=False, default="web")
    active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
