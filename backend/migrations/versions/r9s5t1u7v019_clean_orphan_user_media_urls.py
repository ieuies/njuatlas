"""clear avatar/cover URLs that have no binary payload

Revision ID: r9s5t1u7v019
Revises: q8r4s0t6u018
Create Date: 2026-06-13

"""
from alembic import op


revision = "r9s5t1u7v019"
down_revision = "q8r4s0t6u018"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE users
        SET avatar_url = NULL
        WHERE avatar_data IS NULL AND avatar_url IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE users
        SET cover_url = NULL
        WHERE cover_data IS NULL AND cover_url IS NOT NULL
        """
    )


def downgrade():
    pass
