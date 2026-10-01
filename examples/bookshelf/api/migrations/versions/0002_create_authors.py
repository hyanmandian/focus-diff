"""create authors"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = '0001'


def upgrade() -> None:
    op.create_table(
        "authors",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("authors")
