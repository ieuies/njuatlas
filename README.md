# 🗺️ NJUAtlas · 南搭子

> 南京大学校园社交平台 — 找搭子、吃喝玩乐、AI 助手、校园地图

NJUAtlas（南搭子）是一个面向南京大学学生的多功能校园社交平台，集成了**找搭子组局**、**吃喝玩乐指南**、**AI 美食推荐**、**校园地图**和**个人空间**等核心功能，帮助南大学生发现校园周边的精彩生活。


## ✨ 核心功能

### 🎯 找搭子（组局）
按分类浏览和发布组局信息，支持 **饭搭子、运动搭子、学习搭子、游戏搭子、电影搭子、旅游搭子、音乐搭子、摄影搭子、其他** 九种类型。卡片清晰展示活动时间、地点、人数和发起人信息，支持一键参与。

- 瀑布流浏览 + 分类筛选
- 基于高德地图的附近组局分布可视化
- 短期活动 / 长期征友两种模式
- 帖子点赞、评论、报名参与

### 🍜 吃喝玩乐指南
收录南大**鼓楼、仙林、浦口、苏州**四个校区周边餐饮、咖啡饮品、休闲娱乐、运动健身、购物商圈、景点公园等场所，支持按校区和分类筛选。

- 六大分类 + 四校区交叉过滤
- 高德 POI 搜索（带服务端缓存）
- 场所详情、评分、评论、点赞、收藏

### 🤖 AI 美食推荐助手
基于**智谱 GLM-4-Flash** / **阿里云百炼 Qwen-Plus** 大模型的智能推荐系统，支持多轮对话。

- 结合用户偏好（点赞/收藏记录）+ 高德真实 POI 数据推荐餐厅
- 对话历史持久化，支持恢复历史会话
- 侧栏会话列表，支持新建/切换/删除对话
- 快速提问推荐入口

### 👤 用户体系
完整的邮箱账号体系，安全可靠。

- 邮箱注册 / 登录（含邮箱验证码）
- JWT Bearer Token 鉴权
- 邮箱验证、密码重置、修改密码
- 退出登录（Token 黑名单机制）
- 个人资料编辑（用户名、简介、兴趣标签、校区）

### 📱 个人中心
集中管理用户的平台数据。

- 我发布的帖子、我的评论、我的收藏
- 个人统计数据（发布数、获赞数、评论数、收藏数）
- AI 对话历史会话列表
- 头像自动生成（基于用户名）

### 🏷️ 智能标签与匹配
标签系统支撑精准的搭子匹配和内容发现。

- 三类标签：美食口味、活动类型、身份社群
- 用户自选兴趣标签
- 热度评分算法（浏览×1 + 点赞×3 + 评论×5 + 参与×10，时间衰减）


## 🏗 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | HTML5 + CSS3 + JavaScript（ES Modules，懒加载） |
| **UI 框架** | Font Awesome 6（图标） |
| **地图** | 高德地图 JSAPI 2.0（按需动态加载） |
| **后端框架** | Python Flask + Flask-CORS |
| **ORM** | Flask-SQLAlchemy + Flask-Migrate（Alembic） |
| **鉴权** | 自实现 HS256 JWT + Token 黑名单 |
| **密码安全** | Werkzeug password hash |
| **限流** | Flask-Limiter |
| **数据库** | SQLite（本地开发）/ PostgreSQL（生产） |
| **AI 模型** | 智谱 GLM-4-Flash / 阿里云百炼 Qwen-Plus（OpenAI 兼容 SDK） |
| **地图 API** | 高德地图 Web API（POI 搜索，带 TTL 缓存） |
| **邮件** | Resend API（未配置时写入日志） |
| **部署** | Render（静态站点 + Web Service + Gunicorn） |


## 📂 项目结构

```
njuatlas/
├── index.html                     # 前端入口（SPA 单页应用）
├── css/
│   └── style.css                  # 全局样式（含暗色主题变量）
├── js/
│   ├── config.js                  # 前端配置（API 地址、高德 Key）
│   ├── utils.js                   # 工具函数（Toast 提示等）
│   ├── api.js                     # API 封装（fetch + JWT 自动注入）
│   ├── auth.js                    # 认证模块（登录状态管理）
│   ├── app.js                     # 主入口（页面导航、主题切换、懒加载调度）
│   └── pages/
│       ├── home.js                # 首页（粒子特效、像素方块）
│       ├── partner.js             # 找搭子（瀑布流、地图、组局表单）
│       ├── guide.js               # 吃喝玩乐指南（筛选、详情弹窗）
│       ├── ai.js                  # AI 对话（侧栏、多轮聊天）
│       └── profile.js             # 个人中心（Tab、资料编辑、统计）
├── backend/
│   ├── run.py                     # 本地开发启动入口
│   ├── requirements.txt           # Python 依赖
│   ├── .env.example               # 环境变量模板
│   ├── app/
│   │   ├── __init__.py            # Flask app factory（蓝图注册、CORS、DB 初始化）
│   │   ├── config.py              # 配置管理（环境变量、启动校验）
│   │   ├── models.py              # 14 个数据模型（User, Place, EventPost 等）
│   │   ├── auth_utils.py          # JWT 签发/解析、Bearer 提取、Token 黑名单
│   │   ├── db_utils.py            # 数据库自动建表、旧表兼容
│   │   ├── errors.py              # 全局异常处理、统一 JSON 错误响应
│   │   ├── mail_utils.py          # 邮件发送（验证码、密码重置）
│   │   ├── rate_limit.py          # Flask-Limiter 实例与配置
│   │   ├── validators.py          # 输入校验（请求体、字符串、坐标、UUID 等）
│   │   ├── logging_utils.py       # JSON 行日志工具
│   │   ├── routes/
│   │   │   ├── auth.py            # 认证路由（注册/登录/登出/验证/密码）
│   │   │   ├── places.py          # 地图搜索（热门区域、高德 POI）
│   │   │   ├── interactions.py    # 场所互动（创建/评论/点赞/收藏/统计）
│   │   │   ├── llm_routes.py      # AI 推荐（推荐语、多轮对话、会话管理）
│   │   │   ├── note_routes.py     # 帖子系统（CRUD/标签/参与/评论/匹配）
│   │   │   └── profile.py         # 个人中心（收藏/点赞/评论/会话列表）
│   │   └── services/
│   │       ├── amap.py            # 高德地图搜索封装（缓存、超时、日志）
│   │       ├── llm.py             # LLM 调用封装（智谱/百炼自动选择）
│   │       ├── note.py            # NoteSystem（帖子/标签/匹配/热度算法）
│   │       └── scoring.py         # 智能匹配评分计算
│   └── migrations/                # Alembic 数据库迁移
│       ├── env.py
│       ├── alembic.ini
│       └── versions/
│           ├── 09141f2247b8_initial_schema.py
│           └── 939366cc45ba_add_campus_to_users.py
├── images/                        # 图片资源
├── image/
│   └── aihelper.png               # AI 助手头像
├── scripts/
│   ├── use-utf8.ps1               # Windows UTF-8 终端辅助
│   └── run-backend-utf8.cmd       # Windows UTF-8 后端启动
├── start.ps1                      # 一键启动（前后端）
├── render.yaml                    # Render 部署配置
└── .editorconfig                  # 编辑器配置（UTF-8）
```


## 🚀 本地运行

### 前置要求
- Python 3.10+
- 高德地图 Web API Key（[申请地址](https://lbs.amap.com/)）
- 智谱 AI API Key（[申请地址](https://open.bigmodel.cn/)）或阿里云百炼 API Key

### 1. 克隆项目

```bash
git clone <repo-url>
cd njuatlas
```

### 2. 配置后端环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `.env`，至少填写以下配置：

```env
GAODE_API_KEY=your-gaode-api-key
ZHIPU_API_KEY=your-zhipu-api-key
SECRET_KEY=your-random-secret-key-at-least-32-chars
```

生成随机 `SECRET_KEY`：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. 安装后端依赖

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 4. 启动后端

```bash
python run.py
# → http://localhost:5000
```

### 5. 启动前端

```bash
# 在项目根目录
python -m http.server 8080
# → http://localhost:8080
```

打开浏览器访问 `http://localhost:8080` 即可。

> 💡 也可以直接运行 `start.ps1` 一键启动前后端（Windows PowerShell）。


## 🌐 部署

项目已配置 Render 一键部署。

### Render 配置

`render.yaml` 包含两个服务：

| 服务 | 类型 | 说明 |
|------|------|------|
| `njuatlas-frontend` | Static Site | 静态前端，SPA 模式路由重写 |
| `njuatlas-backend` | Web Service | Python Flask + Gunicorn |

### 生产域名

| 服务 | 域名 |
|------|------|
| 前端站点 | `https://njuatlas.cn` |
| 后端 API | `https://api.njuatlas.cn` |

### 部署前检查清单

- [ ] Render 中配置 `SECRET_KEY`（生产环境强随机字符串）
- [ ] Render 中配置 `DATABASE_URL`（PostgreSQL 连接串）
- [ ] Render 中配置 `GAODE_API_KEY`
- [ ] Render 中配置 `ZHIPU_API_KEY` 或 `BAILIAN_API_KEY`
- [ ] Render 中配置 `FRONTEND_URL=https://njuatlas.cn`
- [ ] 生产环境首次部署时执行数据库迁移（启动命令自动执行 `flask db upgrade`）


## 📡 API 概览

### 用户体系

| 方法 | 路径 | 说明 | 需登录 |
|------|------|------|--------|
| POST | `/api/user/register` | 邮箱注册 | ❌ |
| POST | `/api/user/login` | 邮箱登录 | ❌ |
| POST | `/api/user/logout` | 退出登录 | ✅ |
| POST | `/api/user/email/code` | 发送邮箱验证码 | ❌ |
| POST | `/api/user/email/verification` | 重发验证邮件 | ✅ |
| POST | `/api/user/email/verify` | 提交验证 Token | ❌ |
| POST | `/api/user/password/forgot` | 忘记密码 | ❌ |
| POST | `/api/user/password/reset` | 重置密码 | ❌ |
| POST | `/api/user/password/change` | 修改密码 | ✅ |
| DELETE | `/api/user/account` | 注销账号 | ✅ |

### 个人中心

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/me/profile` | 获取个人资料 |
| PUT | `/api/me/profile` | 更新个人资料 |
| GET | `/api/me/favorites` | 我的收藏 |
| GET | `/api/me/likes` | 我的点赞 |
| GET | `/api/me/reviews` | 我的评论 |
| GET | `/api/me/conversations` | AI 对话会话列表 |

### 地图搜索

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/places/hot_areas` | 热门区域（新街口/夫子庙/仙林/江宁） |
| GET | `/api/places/search` | 高德 POI 搜索（支持缓存） |

### 帖子系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/posts` | 帖子列表（支持分类/标签/排序/分页） |
| POST | `/api/posts` | 发布帖子 |
| GET | `/api/posts/:id` | 帖子详情 |
| PUT | `/api/posts/:id` | 编辑帖子 |
| DELETE | `/api/posts/:id` | 删除帖子 |
| POST | `/api/posts/:id/like` | 点赞/取消点赞 |
| POST | `/api/posts/:id/comments` | 发表评论 |
| POST | `/api/posts/:id/participate` | 报名参加 |

### AI 推荐

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/llm/chat_recommend` | 多轮对话推荐 |
| GET | `/api/llm/conversation/:id/messages` | 获取会话详情 |
| DELETE | `/api/llm/conversation/:id` | 删除会话 |


## 🔒 安全设计

- **密码安全**：使用 Werkzeug 密码哈希存储，数据库中不保存明文密码
- **JWT 鉴权**：HS256 签名，包含 `sub`、`email`、`jti`、`iat`、`exp`
- **Token 黑名单**：退出登录和修改密码时撤销当前 Token
- **邮箱验证 Token**：数据库仅保存 SHA-256 哈希，有效期 24 小时
- **限流保护**：注册/登录 5次/分钟，AI 对话 10次/分钟，全局 200次/小时
- **输入校验**：所有接口统一校验请求体、字符串长度、坐标格式、UUID 格式等


## 🎨 前端特性

- **SPA 单页应用**：无刷新页面切换，流畅的用户体验
- **懒加载**：大模块（partner 63KB / guide 10KB / profile 21KB）按需动态加载
- **暗色模式**：支持亮色/暗色主题切换，状态持久化到 localStorage
- **响应式布局**：桌面端侧栏导航 + 移动端底部 Tab 栏
- **粒子特效**：各页面独立的动态粒子背景
- **高德地图**：按需动态加载，避免阻塞首屏渲染


## 📚 详细文档

更多技术细节请参阅：

- [后端 README](./backend/README.md) — API 详情、环境变量、数据库迁移、开发约定
- [后端工作记录](./backend/WORKLOG_AND_NEXT_STEPS.md) — 已完成事项、前端衔接指南、后续规划
- [后端环境变量模板](./backend/.env.example) — 完整的环境变量列表和说明


## 🤝 贡献指南

欢迎为 NJUAtlas 贡献代码！请遵循以下约定：

- **前端**：保持 ES Modules 结构，大模块使用动态 `import()` 懒加载
- **后端**：新接口使用 `validators.py` 做输入校验，需要登录的接口添加 `@jwt_required`
- **错误处理**：使用统一的 `error_response()` 返回结构化错误
- **日志**：重要操作通过 `log_event()` 记录 JSON 行日志
- **数据库变更**：必须创建 Alembic 迁移脚本
- **安全**：不要提交 `.env`、API Key 或数据库连接串


## 📄 许可证

本项目仅供学习和校内使用。
