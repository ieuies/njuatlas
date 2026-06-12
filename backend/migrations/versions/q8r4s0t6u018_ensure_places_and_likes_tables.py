"""ensure places/likes/reviews/favorites tables for guide module

Revision ID: q8r4s0t6u018
Revises: p7q3r9s5t017
Create Date: 2026-06-12 18:05:00.000000

Local dev previously relied on db.create_all(); production upgrades could miss
these tables. This migration creates them idempotently.
"""
from alembic import op
import sqlalchemy as sa


revision = "q8r4s0t6u018"
down_revision = "p7q3r9s5t017"
branch_labels = None
depends_on = None


def _table_exists(table_name):
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _column_names(table_name):
    if not _table_exists(table_name):
        return set()
    return {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def _create_index_if_missing(table_name, index_name, columns, unique=False):
    if not _table_exists(table_name):
        return
    existing = {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes(table_name)}
    if index_name not in existing:
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade():
    if not _table_exists("places"):
        op.create_table(
            "places",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("address", sa.String(length=200), nullable=True),
            sa.Column("location", sa.String(length=50), nullable=True),
            sa.Column("poi_id", sa.String(length=100), nullable=True),
            sa.Column("category", sa.String(length=50), nullable=True),
            sa.Column("campus", sa.String(length=20), nullable=True),
            sa.Column("guide_category", sa.String(length=30), nullable=True),
            sa.Column("photos", sa.String(length=1000), nullable=True),
            sa.Column("avg_rating", sa.Float(), nullable=True),
            sa.Column("added_by", sa.Integer(), nullable=True),
            sa.Column("amap_updated_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["added_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_places_poi_id", "places", ["poi_id"], unique=False)
        _create_index_if_missing("places", "ix_places_campus_guide_category", ["campus", "guide_category"])
    else:
        cols = _column_names("places")
        with op.batch_alter_table("places", schema=None) as batch_op:
            if "campus" not in cols:
                batch_op.add_column(sa.Column("campus", sa.String(length=20), nullable=True))
            if "guide_category" not in cols:
                batch_op.add_column(sa.Column("guide_category", sa.String(length=30), nullable=True))
        _create_index_if_missing("places", "ix_places_campus_guide_category", ["campus", "guide_category"])

    if not _table_exists("reviews"):
        op.create_table(
            "reviews",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("content", sa.String(length=500), nullable=False),
            sa.Column("rating", sa.Integer(), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("place_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["place_id"], ["places.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        _create_index_if_missing("reviews", "ix_reviews_user_id", ["user_id"])
        _create_index_if_missing("reviews", "ix_reviews_place_id", ["place_id"])

    if not _table_exists("likes"):
        op.create_table(
            "likes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("place_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["place_id"], ["places.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "place_id", name="_user_place_like_uc"),
        )
        _create_index_if_missing("likes", "ix_likes_user_id", ["user_id"])
        _create_index_if_missing("likes", "ix_likes_place_id", ["place_id"])

    if not _table_exists("favorites"):
        op.create_table(
            "favorites",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("place_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["place_id"], ["places.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "place_id", name="_user_place_fav_uc"),
        )
        _create_index_if_missing("favorites", "ix_favorites_user_id", ["user_id"])
        _create_index_if_missing("favorites", "ix_favorites_place_id", ["place_id"])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    for table_name, indexes in (
        ("favorites", ("ix_favorites_place_id", "ix_favorites_user_id")),
        ("likes", ("ix_likes_place_id", "ix_likes_user_id")),
        ("reviews", ("ix_reviews_place_id", "ix_reviews_user_id")),
    ):
        if table_name in tables:
            existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
            for index_name in indexes:
                if index_name in existing:
                    op.drop_index(index_name, table_name=table_name)
            op.drop_table(table_name)

    if "places" in tables:
        existing = {idx["name"] for idx in inspector.get_indexes("places")}
        for index_name in ("ix_places_campus_guide_category", "ix_places_poi_id"):
            if index_name in existing:
                op.drop_index(index_name, table_name="places")
        op.drop_table("places")
