"""add social query indexes for phase 2 performance

Revision ID: h9i5j3k6l014
Revises: e6g3b9c4d012
Create Date: 2026-06-11 23:00:00.000000

"""
from alembic import op


revision = "h9i5j3k6l014"
down_revision = "e6g3b9c4d012"
branch_labels = None
depends_on = None


def _inspect(bind):
    from sqlalchemy import inspect
    return inspect(bind)


def _create_index_if_table(table_name, index_name, columns):
    bind = op.get_bind()
    inspector = _inspect(bind)
    if table_name not in inspector.get_table_names():
        return
    existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
    if index_name not in existing:
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade():
    _create_index_if_table(
        "direct_messages", "ix_dm_thread_rev", ["receiver_id", "sender_id", "created_at"]
    )
    _create_index_if_table(
        "direct_messages", "ix_dm_receiver_unread_sender", ["receiver_id", "is_read", "sender_id"]
    )
    _create_index_if_table(
        "notifications", "ix_notifications_user_read_type", ["user_id", "is_read", "type"]
    )
    _create_index_if_table(
        "friendships", "ix_friendships_addressee_status", ["addressee_id", "status"]
    )


def downgrade():
    bind = op.get_bind()
    inspector = _inspect(bind)
    for table_name, index_name in (
        ("friendships", "ix_friendships_addressee_status"),
        ("notifications", "ix_notifications_user_read_type"),
        ("direct_messages", "ix_dm_receiver_unread_sender"),
        ("direct_messages", "ix_dm_thread_rev"),
    ):
        if table_name in inspector.get_table_names():
            existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
            if index_name in existing:
                op.drop_index(index_name, table_name=table_name)
