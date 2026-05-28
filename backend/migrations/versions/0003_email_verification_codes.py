"""email verification codes

Revision ID: 0003_email_verification_codes
Revises: 0002_user_security_tokens
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_email_verification_codes"
down_revision = "0002_user_security_tokens"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "email_verification_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("purpose", sa.String(length=30), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_email_verification_codes_created_at"), "email_verification_codes", ["created_at"], unique=False)
    op.create_index(op.f("ix_email_verification_codes_email"), "email_verification_codes", ["email"], unique=False)
    op.create_index(op.f("ix_email_verification_codes_purpose"), "email_verification_codes", ["purpose"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_email_verification_codes_purpose"), table_name="email_verification_codes")
    op.drop_index(op.f("ix_email_verification_codes_email"), table_name="email_verification_codes")
    op.drop_index(op.f("ix_email_verification_codes_created_at"), table_name="email_verification_codes")
    op.drop_table("email_verification_codes")
