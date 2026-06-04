"""add forum tags posts comments likes participants match

Revision ID: 85dde7863aac
Revises: 81cb36a3f950
Create Date: 2026-06-04 12:28:22.826030
"""
from alembic import op
import sqlalchemy as sa



revision = '85dde7863aac'
down_revision = '81cb36a3f950'
branch_labels = None
depends_on = None


def upgrade():
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
    op.drop_index(op.f('ix_match_records_user_id'), table_name='match_records')
    op.drop_index(op.f('ix_match_records_created_at'), table_name='match_records')
    op.drop_table('match_records')
    op.drop_index(op.f('ix_event_participants_post_id'), table_name='event_participants')
    op.drop_table('event_participants')
    op.drop_index(op.f('ix_post_likes_post_id'), table_name='post_likes')
    op.drop_table('post_likes')
    op.drop_index(op.f('ix_post_comments_post_id'), table_name='post_comments')
    op.drop_index(op.f('ix_post_comments_created_at'), table_name='post_comments')
    op.drop_table('post_comments')
    op.drop_index(op.f('ix_post_tags_post_id'), table_name='post_tags')
    op.drop_table('post_tags')
    op.drop_index(op.f('ix_event_posts_user_id'), table_name='event_posts')
    op.drop_index(op.f('ix_event_posts_type'), table_name='event_posts')
    op.drop_index(op.f('ix_event_posts_place_id'), table_name='event_posts')
    op.drop_index(op.f('ix_event_posts_hot_score'), table_name='event_posts')
    op.drop_index(op.f('ix_event_posts_created_at'), table_name='event_posts')
    op.drop_table('event_posts')
    op.drop_index(op.f('ix_user_tags_user_id'), table_name='user_tags')
    op.drop_table('user_tags')
    op.drop_index(op.f('ix_tags_name'), table_name='tags')
    op.drop_index(op.f('ix_tags_category'), table_name='tags')
    op.drop_table('tags')
