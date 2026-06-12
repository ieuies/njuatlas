"""places 增加 guide 排行榜字段

Revision ID: j2k7m5n8p016
Revises: i1j6k4l8m015
Create Date: 2026-06-12

"""
from alembic import op
import sqlalchemy as sa


revision = "j2k7m5n8p016"
down_revision = "i1j6k4l8m015"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("places", schema=None) as batch_op:
        batch_op.add_column(sa.Column("campus", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("guide_category", sa.String(length=30), nullable=True))
        batch_op.create_index("ix_places_campus_guide_category", ["campus", "guide_category"], unique=False)


def downgrade():
    with op.batch_alter_table("places", schema=None) as batch_op:
        batch_op.drop_index("ix_places_campus_guide_category")
        batch_op.drop_column("guide_category")
        batch_op.drop_column("campus")
