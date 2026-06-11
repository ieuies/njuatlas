"""add avatar_data to users (store avatars in Postgres for Render)

Revision ID: d5f2a8b3c901
Revises: a3b8c2d1e5f6
Create Date: 2026-06-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "d5f2a8b3c901"
down_revision = "a3b8c2d1e5f6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("avatar_data", sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column("avatar_mime", sa.String(length=32), nullable=True))


def downgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("avatar_mime")
        batch_op.drop_column("avatar_data")
