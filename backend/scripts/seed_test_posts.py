"""在本地数据库批量创建测试组局帖子。

用法（在 backend 目录）：
    python scripts/seed_test_posts.py
    python scripts/seed_test_posts.py --username test
    python scripts/seed_test_posts.py --count 15 --force
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from werkzeug.security import generate_password_hash

from app import create_app, db
from app.models import EventPost, User
from app.services.note import NoteSystem

DEFAULT_USERNAME = "test"
DEFAULT_EMAIL = "test@njuatlas.local"
DEFAULT_PASSWORD = "test1234"
MARKER = "[seed-test]"

# 校区大致坐标（lng,lat）
CAMPUSES = {
    "仙林": ("118.954", "32.110", "仙林校区"),
    "鼓楼": ("118.780", "32.058", "鼓楼校区"),
    "浦口": ("118.628", "32.058", "浦口校区"),
    "苏州": ("120.736", "31.277", "苏州校区"),
}


def _utcnow():
    return datetime.now(timezone.utc)


def _scheduled_range(days_ahead: int, hours: int = 2):
    start = _utcnow().replace(minute=0, second=0, microsecond=0) + timedelta(days=days_ahead, hours=1)
    end = start + timedelta(hours=hours)
    return start, end


def _build_posts():
    s1, e1 = _scheduled_range(2, 3)
    s2, e2 = _scheduled_range(5, 2)
    s3, e3 = _scheduled_range(1, 4)
    s4, e4 = _scheduled_range(7, 3)

    specs = [
        {
            "type": "forum",
            "title": "仙林火锅局，来两个能吃辣的",
            "content": f"{MARKER} 周五晚上仙林地铁站附近，人均 80 左右，已有两人，差两位饭搭子。",
            "tags": ["饭搭子", "仙林", "火锅"],
            "urgency": "long_term",
            "campus": "仙林",
            "slots": 4,
            "budget": "人均80",
            "contact": "wx: hotpot_xl",
        },
        {
            "type": "event",
            "title": "今晚仙林羽毛球，缺1人",
            "content": f"{MARKER} 体育馆 19:30 开打，水平不限，带拍子就行，先来先得。",
            "tags": ["运动搭子", "仙林", "羽毛球"],
            "urgency": "now",
            "campus": "仙林",
            "slots": 4,
            "budget": "场地AA",
            "contact": "qq: badminton_now",
        },
        {
            "type": "forum",
            "title": "鼓楼图书馆期末自习，互相监督",
            "content": f"{MARKER} 指定时间段安静自习，每 50 分钟休息 10 分钟，适合期末冲刺。",
            "tags": ["学习搭子", "鼓楼", "自习"],
            "urgency": "scheduled",
            "campus": "鼓楼",
            "event_time": s1,
            "event_end_time": e1,
            "slots": 6,
            "budget": "免费",
            "contact": "wx: study_gl",
        },
        {
            "type": "forum",
            "title": "浦口王者五排，缺辅助",
            "content": f"{MARKER} 晚上九点后在线，钻石段位，语音开黑，心态好来。",
            "tags": ["游戏搭子", "浦口", "王者"],
            "urgency": "now",
            "campus": "浦口",
            "slots": 5,
            "budget": "无",
            "contact": "游戏ID: pk_support",
        },
        {
            "type": "event",
            "title": "周末鼓楼看电影《机器人之梦》",
            "content": f"{MARKER} 先集合再一起买票，偏文艺片爱好者，看完可以顺便夜宵。",
            "tags": ["电影搭子", "鼓楼", "影院"],
            "urgency": "scheduled",
            "campus": "鼓楼",
            "event_time": s2,
            "event_end_time": e2,
            "slots": 5,
            "budget": "票钱自理",
            "contact": "wx: cinema_gl",
        },
        {
            "type": "forum",
            "title": "苏州校区周庄古镇一日游",
            "content": f"{MARKER} 长期招募，周末出发，可拼车，摄影/美食都可以一起。",
            "tags": ["旅游搭子", "苏州", "古镇"],
            "urgency": "long_term",
            "campus": "苏州",
            "slots": 8,
            "budget": "200以内",
            "contact": "wx: travel_sz",
        },
        {
            "type": "forum",
            "title": "仙林吉他对弹，民谣同好",
            "content": f"{MARKER} 有没有会弹唱的同学，校内草坪或琴房都行，自带乐器。",
            "tags": ["音乐搭子", "仙林", "吉他"],
            "urgency": "long_term",
            "campus": "仙林",
            "slots": 3,
            "budget": "免费",
            "contact": "wx: music_xl",
        },
        {
            "type": "event",
            "title": "鼓楼扫街摄影，拍老城南",
            "content": f"{MARKER} 今天下午出发，带相机或手机均可，互相当模特也行。",
            "tags": ["摄影搭子", "鼓楼", "扫街"],
            "urgency": "now",
            "campus": "鼓楼",
            "slots": 4,
            "budget": "交通自理",
            "contact": "wx: photo_gl",
        },
        {
            "type": "forum",
            "title": "仙林二手教材交换集市",
            "content": f"{MARKER} 高数、线代、计网教材互换或低价转让，当面交易。",
            "tags": ["其他", "仙林", "二手"],
            "urgency": "now",
            "campus": "仙林",
            "slots": 10,
            "budget": "面议",
            "contact": "wx: book_swap",
        },
        {
            "type": "event",
            "title": "鼓楼下午茶+桌游体验",
            "content": f"{MARKER} 指定时间集合，先喝茶聊天，再玩轻策略桌游，新手友好。",
            "tags": ["饭搭子", "鼓楼", "桌游"],
            "urgency": "scheduled",
            "campus": "鼓楼",
            "event_time": s3,
            "event_end_time": e3,
            "slots": 6,
            "budget": "人均60",
            "contact": "wx: tea_board",
        },
        {
            "type": "forum",
            "title": "仙林夜跑 5km，慢跑搭子",
            "content": f"{MARKER} 长期组队，配速 6'30\" 左右，跑完拉伸，欢迎恢复跑的同学。",
            "tags": ["运动搭子", "仙林", "跑步"],
            "urgency": "long_term",
            "campus": "仙林",
            "slots": 8,
            "budget": "免费",
            "contact": "wx: night_run",
        },
        {
            "type": "forum",
            "title": "浦口雅思口语对练",
            "content": f"{MARKER} 今晚开始，按 Part1/2/3 轮流练，目标 6.5+，请准时。",
            "tags": ["学习搭子", "浦口", "雅思"],
            "urgency": "now",
            "campus": "浦口",
            "slots": 4,
            "budget": "免费",
            "contact": "wx: ielts_pk",
        },
        {
            "type": "event",
            "title": "仙林狼人杀面杀，9人局",
            "content": f"{MARKER} 指定时间开局，有主持人，规则标准 12 人局缩 9 人，欢迎老手。",
            "tags": ["游戏搭子", "仙林", "狼人杀"],
            "urgency": "scheduled",
            "campus": "仙林",
            "event_time": s4,
            "event_end_time": e4,
            "slots": 9,
            "budget": "场地AA",
            "contact": "wx: werewolf_xl",
        },
        {
            "type": "forum",
            "title": "鼓楼纪录片分享会",
            "content": f"{MARKER} 长期活动，每周一部，看完写短评，偏人文社科题材。",
            "tags": ["电影搭子", "鼓楼", "纪录片"],
            "urgency": "long_term",
            "campus": "鼓楼",
            "slots": 12,
            "budget": "免费",
            "contact": "wx: doc_gl",
        },
        {
            "type": "forum",
            "title": "苏州校区互拍校园写真",
            "content": f"{MARKER} 互相当模特，风格清新/胶片都可以，约今天下午。",
            "tags": ["摄影搭子", "苏州", "写真"],
            "urgency": "now",
            "campus": "苏州",
            "slots": 2,
            "budget": "免费",
            "contact": "wx: portrait_sz",
        },
    ]
    return specs


def _resolve_user(username: str):
    user = User.query.filter_by(username=username).first()
    if user:
        return user
    user = User(
        email=DEFAULT_EMAIL,
        username=username,
        password_hash=generate_password_hash(DEFAULT_PASSWORD),
        email_verified=True,
        email_verified_at=_utcnow(),
        campus="仙林",
    )
    db.session.add(user)
    db.session.commit()
    return user


def _existing_seed_count(user_id: int) -> int:
    like = f"%{MARKER}%"
    return EventPost.query.filter(
        EventPost.user_id == user_id,
        EventPost.content.like(like),
    ).count()


def _delete_seed_posts(user_id: int) -> int:
    like = f"%{MARKER}%"
    rows = EventPost.query.filter(
        EventPost.user_id == user_id,
        EventPost.content.like(like),
    ).all()
    notes = NoteSystem(user_id=user_id)
    for row in rows:
        note = notes.get_post(row.id)
        if note:
            note.delete()
    return len(rows)


def parse_args():
    parser = argparse.ArgumentParser(description="Seed diverse test posts for local development.")
    parser.add_argument("--username", default=DEFAULT_USERNAME)
    parser.add_argument("--count", type=int, default=15)
    parser.add_argument(
        "--force",
        action="store_true",
        help="删除已有 [seed-test] 标记的帖子后重新创建",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.count < 1 or args.count > 50:
        print("count 须在 1–50 之间")
        sys.exit(1)

    app = create_app()
    with app.app_context():
        user = _resolve_user(args.username)
        if args.force:
            removed = _delete_seed_posts(user.id)
            if removed:
                print(f"已删除 {removed} 条旧测试帖")

        existing = _existing_seed_count(user.id)
        if existing and not args.force:
            print(f"已存在 {existing} 条测试帖（content 含 {MARKER}）。")
            print("若需重建，请加 --force")
            sys.exit(0)

        specs = _build_posts()[: args.count]
        notes = NoteSystem(user_id=user.id)
        created_ids = []

        for spec in specs:
            campus = spec.pop("campus")
            lng, lat, location_name = CAMPUSES[campus]
            location = f"{lng},{lat}"
            note = notes.create_post(
                post_type=spec["type"],
                title=spec["title"],
                content=spec["content"],
                tags=spec["tags"],
                urgency=spec["urgency"],
                location=location,
                location_name=location_name,
                max_participants=spec["slots"],
                budget=spec.get("budget"),
                contact=spec.get("contact"),
                event_time=spec.get("event_time"),
                event_end_time=spec.get("event_end_time"),
            )
            created_ids.append(note.id)
            print(f"  #{note.id} [{spec['tags'][0]}] {spec['title']}")

        print()
        print(f"完成：为用户 {user.username} (id={user.id}) 创建 {len(created_ids)} 条测试帖")
        print(f"帖子 ID: {', '.join(str(i) for i in created_ids)}")
        if user.username == DEFAULT_USERNAME:
            print(f"登录账号: {DEFAULT_EMAIL} / {DEFAULT_PASSWORD}")


if __name__ == "__main__":
    main()
