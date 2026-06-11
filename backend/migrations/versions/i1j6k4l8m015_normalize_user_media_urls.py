"""normalize user avatar/cover URLs for DB-backed media

Revision ID: i1j6k4l8m015
Revises: h9i5j3k6l014
Create Date: 2026-06-12 12:00:00.000000

"""
from alembic import op


revision = "i1j6k4l8m015"
down_revision = "h9i5j3k6l014"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE users
        SET avatar_url = '/api/social/users/' || id || '/avatar'
        WHERE avatar_data IS NOT NULL
        """
    )
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
        SET cover_url = '/api/social/users/' || id || '/cover'
        WHERE cover_data IS NOT NULL
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
