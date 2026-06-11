"""add social performance indexes

Revision ID: f7a2c8d1e904
Revises: c4e8a1f2b903
Create Date: 2026-06-11 00:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "f7a2c8d1e904"
down_revision = "c4e8a1f2b903"
branch_labels = None
depends_on = None


def _create_index_if_table(table_name, index_name, columns):
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    if table_name not in inspector.get_table_names():
        return
    existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
    if index_name not in existing:
        op.create_index(index_name, table_name, columns, unique=False)


def sa_inspect(bind):
    from sqlalchemy import inspect
    return inspect(bind)


def upgrade():
    _create_index_if_table("friendships", "ix_friendships_status_requester", ["status", "requester_id"])
    _create_index_if_table("friendships", "ix_friendships_status_addressee", ["status", "addressee_id"])
    _create_index_if_table("direct_messages", "ix_dm_receiver_read", ["receiver_id", "is_read"])
    _create_index_if_table("direct_messages", "ix_dm_thread", ["sender_id", "receiver_id", "created_at"])
    _create_index_if_table("notifications", "ix_notifications_user_read", ["user_id", "is_read"])


def downgrade():
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    for table_name, index_name in (
        ("notifications", "ix_notifications_user_read"),
        ("direct_messages", "ix_dm_thread"),
        ("direct_messages", "ix_dm_receiver_read"),
        ("friendships", "ix_friendships_status_addressee"),
        ("friendships", "ix_friendships_status_requester"),
    ):
        if table_name in inspector.get_table_names():
            existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
            if index_name in existing:
                op.drop_index(index_name, table_name=table_name)
