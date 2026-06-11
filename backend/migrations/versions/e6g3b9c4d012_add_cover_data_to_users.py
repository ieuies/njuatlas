"""add cover_data to users (store covers in Postgres)

Revision ID: e6g3b9c4d012
Revises: d5f2a8b3c901
Create Date: 2026-06-11 12:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "e6g3b9c4d012"
down_revision = "d5f2a8b3c901"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("cover_data", sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column("cover_mime", sa.String(length=32), nullable=True))


def downgrade():
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("cover_mime")
        batch_op.drop_column("cover_data")
