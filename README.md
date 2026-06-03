## 📁 项目名称：njuatlas（南搭子）
---

## 🏗 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | 纯静态 HTML + CSS + JavaScript（ES Modules） |
| **后端** | Python Flask + JWT + SQLAlchemy |
| **数据库** | 本地 SQLite / 生产 PostgreSQL |
| **外部 API** | 高德地图 POI 搜索、智谱 AI、阿里云百炼 |
| **邮件** | Resend API（未配置时写入日志） |
| **部署** | Render（render.yaml 已配置） |

---

## 📂 项目结构（核心）

```
njuatlas/
├── index.html                  # 前端入口（含登录/注册/找搭子/个人中心）
├── css/style.css               # 样式
├── js/
│   ├── config.js               # 前端配置
│   ├── utils.js                # 工具函数
│   ├── api.js                  # API 封装
│   ├── auth.js                 # 认证模块
│   ├── app.js                  # 主入口
│   └── pages/
│       ├── partner.js          # 找搭子页面
│       ├── home.js             # 首页
│       ├── restaurants.js      # 餐厅
│       ├── profile.js          # 个人中心
│       └── ai.js               # AI 对话
├── backend/
│   ├── run.py                  # 本地启动
│   ├── requirements.txt        # Python 依赖
│   ├── app/
│   │   ├── __init__.py         # Flask app factory
│   │   ├── config.py           # 配置管理
│   │   ├── models.py           # 数据模型
│   │   ├── auth_utils.py       # JWT 鉴权
│   │   ├── db_utils.py         # 数据库工具
│   │   ├── errors.py           # 全局错误处理
│   │   ├── mail_utils.py       # 邮件发送
│   │   ├── rate_limit.py       # 限流
│   │   ├── validators.py       # 输入校验
│   │   ├── logging_utils.py    # 日志
│   │   ├── routes/
│   │   │   ├── auth.py         # 注册/登录/密码
│   │   │   ├── places.py       # 地图搜索
│   │   │   ├── interactions.py # 餐厅互动
│   │   │   ├── llm_routes.py   # AI 推荐
│   │   │   └── profile.py      # 个人中心
│   │   └── services/
│   │       ├── amap.py         # 高德地图封装
│   │       └── llm.py          # LLM 调用封装
│   └── migrations/             # 数据库迁移
├── images/                     # 图片资源
├── start.ps1                   # 一键启动脚本（前后端）
└── render.yaml                 # Render 部署配置
```

---

## 🚀 核心功能

### 1️⃣ 找搭子（组局）
- 分类：饭搭子、运动搭子、学习搭子、游戏搭子、电影搭子
- 前端 `js/pages/partner.js` 处理展示和发起组局

### 2️⃣ 用户体系
- 邮箱注册/登录
- JWT 鉴权（Bearer token）
- 邮箱验证、密码重置、修改密码
- token 黑名单（退出登录/修改密码后失效）

### 3️⃣ 校园地图 & 餐厅
- 高德地图 POI 搜索（带缓存）
- 餐厅创建、评论、点赞、收藏
- 个人中心查看我的收藏/点赞/评论

### 4️⃣ AI 推荐
- 单餐厅生成推荐语
- 多轮对话推荐（基于个人偏好 + 高德真实数据）
- 对话持久化到数据库，支持恢复历史会话

---

## 🛠 本地运行

```bash
# 1. 启动后端（Windows）
cd backend
python run.py
# → http://localhost:5000

# 2. 启动前端
python -m http.server 8080
# → http://localhost:8080

# 或直接用 start.ps1（一键启动前后端）
```

需要配置 `.env`（至少 `GAODE_API_KEY`、`ZHIPU_API_KEY`、`SECRET_KEY`）

---

## 🌐 部署

Render 已配置好：
- 前端站点：`https://njuatlas.cn`
- 后端 API：`https://api.njuatlas.cn`

