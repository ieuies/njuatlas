"""add post favorites support

Revision ID: 8b6d1f3a9e22
Revises: 4f2d9b7a1c11
Create Date: 2026-06-10 16:05:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8b6d1f3a9e22"
down_revision = "4f2d9b7a1c11"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("event_posts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("favorite_count", sa.Integer(), nullable=False, server_default="0")
        )

    op.create_table(
        "post_favorites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["post_id"], ["event_posts.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "post_id", name="_user_post_favorite_uc"),
    )
    op.create_index("ix_post_favorites_post_id", "post_favorites", ["post_id"], unique=False)


def downgrade():
    op.drop_index("ix_post_favorites_post_id", table_name="post_favorites")
    op.drop_table("post_favorites")

    with op.batch_alter_table("event_posts", schema=None) as batch_op:
        batch_op.drop_column("favorite_count")
