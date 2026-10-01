"""create reading_goals"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = '0005'


def upgrade() -> None:
    op.create_table(
        "reading_goals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reading_goals")
