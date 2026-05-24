# run.py
from app import create_app, db

app = create_app()

if __name__ == '__main__':
    # 在当前应用上下文中创建所有数据库表（如果表已存在则跳过）
    with app.app_context():
        db.create_all()
        print("✅ 数据库表已就绪")
    app.run(debug=True)