"""add cover_url to users

Revision ID: 4f2d9b7a1c11
Revises: e3a1b12f4c9d
Create Date: 2026-06-10 15:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "4f2d9b7a1c11"
down_revision = "e3a1b12f4c9d"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("cover_url", sa.String(length=500), nullable=True))


def downgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("cover_url")
