from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "4f7c2a91b6e3"
down_revision: Union[str, Sequence[str], None] = "9a449a75952d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "payouts",
        "payout_instrument",
        existing_type=sa.String(length=100),
        type_=postgresql.JSONB(),
        postgresql_using="payout_instrument::jsonb",
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "payouts",
        "payout_instrument",
        existing_type=postgresql.JSONB(),
        type_=sa.String(length=100),
        postgresql_using="payout_instrument::text",
        existing_nullable=True,
    )
