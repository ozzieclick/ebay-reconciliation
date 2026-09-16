def upgrade() -> None:
    """Upgrade schema."""
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
    """Downgrade schema."""
    op.drop_column(
        "ebay_accounts",
        "oauth_status",
    )
