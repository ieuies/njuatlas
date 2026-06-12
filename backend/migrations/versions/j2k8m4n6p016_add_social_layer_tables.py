"""add social layer tables (friendships, direct_messages, notifications)

Revision ID: j2k8m4n6p016
Revises: i1j6k4l8m015
Create Date: 2026-06-12 16:00:00.000000

Social models were previously created only via db.create_all() in local dev.
Production (flask db upgrade only) never received CREATE TABLE for these.
"""
from alembic import op
import sqlalchemy as sa


revision = "j2k8m4n6p016"
down_revision = "i1j6k4l8m015"
branch_labels = None
depends_on = None


def _table_exists(table_name):
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _index_exists(table_name, index_name):
    if not _table_exists(table_name):
        return False
    names = {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes(table_name)}
    return index_name in names


def _create_index_if_missing(table_name, index_name, columns):
    if _table_exists(table_name) and not _index_exists(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade():
    if not _table_exists("friendships"):
        op.create_table(
            "friendships",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("requester_id", sa.Integer(), nullable=False),
            sa.Column("addressee_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["requester_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["addressee_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("requester_id", "addressee_id", name="_friendship_pair_uc"),
        )
        op.create_index("ix_friendships_requester_id", "friendships", ["requester_id"], unique=False)
        op.create_index("ix_friendships_addressee_id", "friendships", ["addressee_id"], unique=False)
        op.create_index("ix_friendships_created_at", "friendships", ["created_at"], unique=False)

    _create_index_if_missing("friendships", "ix_friendships_status_requester", ["status", "requester_id"])
    _create_index_if_missing("friendships", "ix_friendships_status_addressee", ["status", "addressee_id"])
    _create_index_if_missing("friendships", "ix_friendships_addressee_status", ["addressee_id", "status"])

    if not _table_exists("direct_messages"):
        op.create_table(
            "direct_messages",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("sender_id", sa.Integer(), nullable=False),
            sa.Column("receiver_id", sa.Integer(), nullable=False),
            sa.Column("content", sa.String(length=1000), nullable=False),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["receiver_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_direct_messages_sender_id", "direct_messages", ["sender_id"], unique=False)
        op.create_index("ix_direct_messages_receiver_id", "direct_messages", ["receiver_id"], unique=False)
        op.create_index("ix_direct_messages_created_at", "direct_messages", ["created_at"], unique=False)

    _create_index_if_missing("direct_messages", "ix_dm_receiver_read", ["receiver_id", "is_read"])
    _create_index_if_missing("direct_messages", "ix_dm_thread", ["sender_id", "receiver_id", "created_at"])
    _create_index_if_missing("direct_messages", "ix_dm_thread_rev", ["receiver_id", "sender_id", "created_at"])
    _create_index_if_missing(
        "direct_messages", "ix_dm_receiver_unread_sender", ["receiver_id", "is_read", "sender_id"]
    )

    if not _table_exists("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("actor_id", sa.Integer(), nullable=False),
            sa.Column("type", sa.String(length=30), nullable=False),
            sa.Column("post_id", sa.Integer(), nullable=True),
            sa.Column("friendship_id", sa.Integer(), nullable=True),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["post_id"], ["event_posts.id"]),
            sa.ForeignKeyConstraint(["friendship_id"], ["friendships.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)
        op.create_index("ix_notifications_created_at", "notifications", ["created_at"], unique=False)

    _create_index_if_missing("notifications", "ix_notifications_user_read", ["user_id", "is_read"])
    _create_index_if_missing("notifications", "ix_notifications_user_read_type", ["user_id", "is_read", "type"])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "notifications" in tables:
        for idx in (
            "ix_notifications_user_read_type",
            "ix_notifications_user_read",
            "ix_notifications_created_at",
            "ix_notifications_user_id",
        ):
            existing = {i["name"] for i in inspector.get_indexes("notifications")}
            if idx in existing:
                op.drop_index(idx, table_name="notifications")
        op.drop_table("notifications")

    if "direct_messages" in tables:
        for idx in (
            "ix_dm_receiver_unread_sender",
            "ix_dm_thread_rev",
            "ix_dm_thread",
            "ix_dm_receiver_read",
            "ix_direct_messages_created_at",
            "ix_direct_messages_receiver_id",
            "ix_direct_messages_sender_id",
        ):
            existing = {i["name"] for i in inspector.get_indexes("direct_messages")}
            if idx in existing:
                op.drop_index(idx, table_name="direct_messages")
        op.drop_table("direct_messages")

    if "friendships" in tables:
        for idx in (
            "ix_friendships_addressee_status",
            "ix_friendships_status_addressee",
            "ix_friendships_status_requester",
            "ix_friendships_created_at",
            "ix_friendships_addressee_id",
            "ix_friendships_requester_id",
        ):
            existing = {i["name"] for i in inspector.get_indexes("friendships")}
            if idx in existing:
                op.drop_index(idx, table_name="friendships")
        op.drop_table("friendships")
