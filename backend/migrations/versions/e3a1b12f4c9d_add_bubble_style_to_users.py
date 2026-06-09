"""add bubble_style to users

Revision ID: e3a1b12f4c9d
Revises: 939366cc45ba
Create Date: 2026-06-10 00:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e3a1b12f4c9d"
down_revision = "939366cc45ba"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "bubble_style",
                sa.String(length=50),
                nullable=False,
                server_default="atlas-classic",
            )
        )


def downgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("bubble_style")
