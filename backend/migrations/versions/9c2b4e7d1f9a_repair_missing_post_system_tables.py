"""repair missing post system tables

Revision ID: 9c2b4e7d1f9a
Revises: 85dde7863aac
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa


revision = '9c2b4e7d1f9a'
down_revision = '85dde7863aac'
branch_labels = None
depends_on = None


def _table_exists(table_name):
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade():
    # 85dde7863aac was deployed once as an empty migration. Databases that
    # reached that revision need these tables before a0ca2765ee43 can run.
    if not _table_exists('tags'):
        op.create_table(
            'tags',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=30), nullable=False),
            sa.Column('category', sa.String(length=20), nullable=False),
            sa.Column('usage_count', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_tags_category'), 'tags', ['category'], unique=False)
        op.create_index(op.f('ix_tags_name'), 'tags', ['name'], unique=True)

    if not _table_exists('user_tags'):
        op.create_table(
            'user_tags',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('tag_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['tag_id'], ['tags.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'tag_id', name='_user_tag_uc'),
        )
        op.create_index(op.f('ix_user_tags_user_id'), 'user_tags', ['user_id'], unique=False)

    if not _table_exists('event_posts'):
        op.create_table(
            'event_posts',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('type', sa.String(length=20), nullable=False),
            sa.Column('title', sa.String(length=100), nullable=False),
            sa.Column('content', sa.String(length=2000), nullable=False),
            sa.Column('cover_image', sa.String(length=500), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('place_id', sa.Integer(), nullable=True),
            sa.Column('event_time', sa.DateTime(), nullable=True),
            sa.Column('location', sa.String(length=50), nullable=True),
            sa.Column('location_name', sa.String(length=200), nullable=True),
            sa.Column('is_official', sa.Boolean(), nullable=False),
            sa.Column('view_count', sa.Integer(), nullable=False),
            sa.Column('like_count', sa.Integer(), nullable=False),
            sa.Column('comment_count', sa.Integer(), nullable=False),
            sa.Column('participant_count', sa.Integer(), nullable=False),
            sa.Column('hot_score', sa.Float(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['place_id'], ['places.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_event_posts_created_at'), 'event_posts', ['created_at'], unique=False)
        op.create_index(op.f('ix_event_posts_hot_score'), 'event_posts', ['hot_score'], unique=False)
        op.create_index(op.f('ix_event_posts_place_id'), 'event_posts', ['place_id'], unique=False)
        op.create_index(op.f('ix_event_posts_type'), 'event_posts', ['type'], unique=False)
        op.create_index(op.f('ix_event_posts_user_id'), 'event_posts', ['user_id'], unique=False)

    if not _table_exists('post_tags'):
        op.create_table(
            'post_tags',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('post_id', sa.Integer(), nullable=False),
            sa.Column('tag_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['post_id'], ['event_posts.id']),
            sa.ForeignKeyConstraint(['tag_id'], ['tags.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('post_id', 'tag_id', name='_post_tag_uc'),
        )
        op.create_index(op.f('ix_post_tags_post_id'), 'post_tags', ['post_id'], unique=False)

    if not _table_exists('post_comments'):
        op.create_table(
            'post_comments',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('post_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('content', sa.String(length=500), nullable=False),
            sa.Column('parent_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['parent_id'], ['post_comments.id']),
            sa.ForeignKeyConstraint(['post_id'], ['event_posts.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_post_comments_created_at'), 'post_comments', ['created_at'], unique=False)
        op.create_index(op.f('ix_post_comments_post_id'), 'post_comments', ['post_id'], unique=False)

    if not _table_exists('post_likes'):
        op.create_table(
            'post_likes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('post_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['post_id'], ['event_posts.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'post_id', name='_user_post_like_uc'),
        )
        op.create_index(op.f('ix_post_likes_post_id'), 'post_likes', ['post_id'], unique=False)

    if not _table_exists('event_participants'):
        op.create_table(
            'event_participants',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('post_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['post_id'], ['event_posts.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'post_id', name='_user_event_participant_uc'),
        )
        op.create_index(op.f('ix_event_participants_post_id'), 'event_participants', ['post_id'], unique=False)

    if not _table_exists('match_records'):
        op.create_table(
            'match_records',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('post_id', sa.Integer(), nullable=False),
            sa.Column('score', sa.Float(), nullable=False),
            sa.Column('reason', sa.String(length=300), nullable=True),
            sa.Column('feedback', sa.String(length=20), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['post_id'], ['event_posts.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_match_records_created_at'), 'match_records', ['created_at'], unique=False)
        op.create_index(op.f('ix_match_records_user_id'), 'match_records', ['user_id'], unique=False)


def downgrade():
    pass
