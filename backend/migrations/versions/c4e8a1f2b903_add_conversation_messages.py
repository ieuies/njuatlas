"""add conversation_messages table

Revision ID: c4e8a1f2b903
Revises: 8b6d1f3a9e22
Create Date: 2026-06-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "c4e8a1f2b903"
down_revision = "b1c7d4e9f203"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "conversation_messages" in inspector.get_table_names():
        return

    op.create_table(
        "conversation_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_conversation_messages_session_id", "conversation_messages", ["session_id"], unique=False)
    op.create_index("ix_conversation_messages_user_id", "conversation_messages", ["user_id"], unique=False)
    op.create_index("ix_conversation_messages_created_at", "conversation_messages", ["created_at"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "conversation_messages" not in inspector.get_table_names():
        return

    op.drop_index("ix_conversation_messages_created_at", table_name="conversation_messages")
    op.drop_index("ix_conversation_messages_user_id", table_name="conversation_messages")
    op.drop_index("ix_conversation_messages_session_id", table_name="conversation_messages")
    op.drop_table("conversation_messages")
