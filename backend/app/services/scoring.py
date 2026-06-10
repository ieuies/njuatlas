"""
帖子热度计算与过期过滤 —— 独立于 NoteSystem 的推荐引擎。

所有阈值从 Flask config 读取，可通过 .env 覆盖，无需改代码。
模块内函数无副作用，只做计算和过滤，不操作数据库。
"""

from datetime import datetime, timezone

from flask import current_app


def _utcnow():
    return datetime.now(timezone.utc)


def _ensure_aware(dt):
    """SQLite 不保存时区 —— 读出 naive datetime 时补上 UTC。"""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _half_life(post):
    """根据 urgency 返回对应的时间衰减半衰期（小时）。"""
    urgency = getattr(post, "urgency", None)
    if urgency == "long_term":
        return current_app.config["HOT_LONG_TERM_HALF_LIFE_HOURS"]
    # now / scheduled / None → 均使用标准半衰期
    return current_app.config["HOT_SCHEDULED_HALF_LIFE_HOURS"]


def _time_decay(post):
    """计算时间衰减因子。半衰期由 urgency 决定。"""
    created_at = _ensure_aware(getattr(post, "created_at", None))
    if created_at is None:
        return 1.0
    half_life = _half_life(post)
    delta_hours = (_utcnow() - created_at).total_seconds() / 3600
    return 1.0 / (1.0 + delta_hours / half_life)


def _now_boost(post):
    """立即帖子的短期加权。在 boost 窗口内返回倍率，否则返回 1.0。"""
    urgency = getattr(post, "urgency", None)
    if urgency != "now":
        return 1.0
    created_at = _ensure_aware(getattr(post, "created_at", None))
    if created_at is None:
        return 1.0
    delta_hours = (_utcnow() - created_at).total_seconds() / 3600
    window = current_app.config["HOT_NOW_BOOST_WINDOW_HOURS"]
    if delta_hours <= window:
        return current_app.config["HOT_NOW_BOOST"]
    return 1.0


# ═══════════════════════════════════════════════════════════════
# 公开 API
# ═══════════════════════════════════════════════════════════════

def compute_hot(post):
    """计算一条帖子的热度分，直接写入 post.hot_score。

    公式:
      raw = view×Wv + like×Wl + comment×Wc + participant×Wp
      hot = raw × now_boost × time_decay

    权重和阈值全部从 Flask config 读取。
    """
    raw = (
        (getattr(post, "view_count", 0) or 0) * current_app.config["HOT_WEIGHT_VIEW"]
        + (getattr(post, "like_count", 0) or 0) * current_app.config["HOT_WEIGHT_LIKE"]
        + (getattr(post, "comment_count", 0) or 0) * current_app.config["HOT_WEIGHT_COMMENT"]
        + (getattr(post, "participant_count", 0) or 0) * current_app.config["HOT_WEIGHT_PARTICIPANT"]
    )
    post.hot_score = round(raw * _now_boost(post) * _time_decay(post), 2)
    return post.hot_score


def is_expired(post):
    """判断帖子是否已过期，应从推荐列表中移除。

    - urgency='now'      → 超过 NOW_EXPIRY_HOURS 即过期（默认 3h）
    - urgency='scheduled' → event_end_time（优先）或 event_time 已过即过期
    - urgency='long_term' → 永不过期
    - urgency=None       → 按 scheduled 逻辑（有结束/开始时间则按其判断）
    """
    urgency = getattr(post, "urgency", None)

    if urgency == "now":
        created_at = _ensure_aware(getattr(post, "created_at", None))
        if created_at is None:
            return False
        delta_hours = (_utcnow() - created_at).total_seconds() / 3600
        return delta_hours > current_app.config["HOT_NOW_EXPIRY_HOURS"]

    if urgency == "long_term":
        return False

    # scheduled 或 None：优先用结束时间判断，其次用开始时间
    event_end_time = _ensure_aware(getattr(post, "event_end_time", None))
    if event_end_time is not None:
        return event_end_time <= _utcnow()

    event_time = _ensure_aware(getattr(post, "event_time", None))
    if event_time is not None:
        return event_time <= _utcnow()

    return False


def filter_active(query, model):
    """从 SQLAlchemy query 中排除已过期的帖子。

    参数:
        query: 已有的 SQLAlchemy query 对象
        model: EventPost 模型类

    返回:
        追加了过期过滤条件的 query
    """
    now = _utcnow()
    expiry_hours = current_app.config["HOT_NOW_EXPIRY_HOURS"]
    from datetime import timedelta
    now_cutoff = now - timedelta(hours=expiry_hours)

    from sqlalchemy import or_, and_

    return query.filter(
        or_(
            # long_term 永不过期
            model.urgency == "long_term",
            # now 且在有效窗口内
            and_(
                model.urgency == "now",
                model.created_at >= now_cutoff,
            ),
            # scheduled 且活动未结束（优先 event_end_time，无则回退 event_time）
            and_(
                model.urgency == "scheduled",
                or_(
                    and_(model.event_end_time.isnot(None), model.event_end_time > now),
                    and_(model.event_end_time.is_(None), model.event_time > now),
                ),
            ),
            # 无 urgency 的旧帖子：有时间则必须未结束，无时间则保留
            and_(
                model.urgency.is_(None),
                or_(
                    and_(model.event_end_time.is_(None), model.event_time.is_(None)),
                    and_(model.event_end_time.isnot(None), model.event_end_time > now),
                    and_(model.event_end_time.is_(None), model.event_time > now),
                ),
            ),
        )
    )
