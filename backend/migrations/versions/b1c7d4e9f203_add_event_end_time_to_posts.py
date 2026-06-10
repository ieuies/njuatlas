"""add event_end_time to event_posts

Revision ID: b1c7d4e9f203
Revises: 8b6d1f3a9e22
Create Date: 2026-06-10 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b1c7d4e9f203"
down_revision = "8b6d1f3a9e22"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("event_posts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("event_end_time", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("event_posts", schema=None) as batch_op:
        batch_op.drop_column("event_end_time")
