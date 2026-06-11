"""add profile and conversation indexes

Revision ID: a3b8c2d1e5f6
Revises: f7a2c8d1e904
Create Date: 2026-06-11 12:00:00.000000

"""
from alembic import op


revision = "a3b8c2d1e5f6"
down_revision = "f7a2c8d1e904"
branch_labels = None
depends_on = None


def sa_inspect(bind):
    from sqlalchemy import inspect
    return inspect(bind)


def _create_index_if_table(table_name, index_name, columns):
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    if table_name not in inspector.get_table_names():
        return
    existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
    if index_name not in existing:
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade():
    _create_index_if_table(
        "conversation_messages",
        "ix_conv_msgs_user_session_created",
        ["user_id", "session_id", "created_at"],
    )
    _create_index_if_table("favorites", "ix_favorites_user_id", ["user_id"])
    _create_index_if_table("likes", "ix_likes_user_id", ["user_id"])
    _create_index_if_table("reviews", "ix_reviews_user_id", ["user_id"])


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    for table_name, index_name in (
        ("conversation_messages", "ix_conv_msgs_user_session_created"),
        ("favorites", "ix_favorites_user_id"),
        ("likes", "ix_likes_user_id"),
        ("reviews", "ix_reviews_user_id"),
    ):
        if table_name in inspector.get_table_names():
            existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
            if index_name in existing:
                op.drop_index(index_name, table_name=table_name)
