"""add oauth status column

Revision ID: 8a059dcc8efe
Revises: 4f7c2a91b6e3
Create Date: 2026-09-16

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8a059dcc8efe"
down_revision: Union[str, Sequence[str], None] = "4f7c2a91b6e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ebay_accounts",
        sa.Column(
            "oauth_status",
            sa.String(length=30),
            nullable=False,
            server_default="authorized",
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "ebay_accounts",
        "oauth_status",
    )
