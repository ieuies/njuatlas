# NjuAtlas Backend

NjuAtlas 后端为校园周边美食地图与智能推荐功能提供 API 支持。当前后端基于 Flask 构建，集成了邮箱账号体系、JWT 鉴权、高德地图 POI 搜索、餐厅互动、AI 推荐、多轮对话持久化、个人中心、数据库迁移、限流、统一错误处理和 Render 部署配置。

本文档面向共同开发者，重点说明当前代码结构、运行方式、环境变量、数据库迁移、接口能力和开发约定。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| Web 框架 | Flask |
| ORM | Flask-SQLAlchemy / SQLAlchemy |
| 数据库迁移 | Flask-Migrate / Alembic |
| 鉴权 | 自实现 HS256 JWT |
| 密码安全 | Werkzeug password hash |
| 限流 | Flask-Limiter |
| 跨域 | Flask-CORS |
| 外部 API | 高德地图 Web API、智谱 AI、阿里云百炼 |
| 部署 | Render + Gunicorn |
| 生产数据库 | PostgreSQL |
| 本地数据库 | SQLite |

## 目录结构

```text
backend/
├─ app/
│  ├─ __init__.py              # Flask app factory；注册扩展、蓝图、错误处理、CORS
│  ├─ auth_utils.py            # JWT 签发/解析、Bearer token 提取、token 黑名单校验
│  ├─ config.py                # 环境变量读取、默认值、启动时配置校验
│  ├─ db_utils.py              # 本地开发自动建表和旧 SQLite 兼容补列
│  ├─ errors.py                # 全局异常处理与统一 JSON 错误响应
│  ├─ logging_utils.py         # JSON 行日志工具
│  ├─ mail_utils.py            # 邮箱验证/密码重置邮件发送；未配 Resend 时写日志
│  ├─ models.py                # SQLAlchemy 数据模型
│  ├─ rate_limit.py            # Flask-Limiter 实例和初始化
│  ├─ validators.py            # 请求体验证、字符串/ID/评分/坐标/session_id 校验
│  ├─ routes/
│  │  ├─ auth.py               # 注册、登录、邮箱验证、密码重置/修改、退出登录
│  │  ├─ interactions.py       # 餐厅创建、评论、点赞、收藏、餐厅统计
│  │  ├─ llm_routes.py         # AI 推荐语、多轮对话推荐
│  │  ├─ places.py             # 热门区域、高德 POI 搜索
│  │  └─ profile.py            # 个人中心：收藏、点赞、评论、会话列表
│  └─ services/
│     ├─ amap.py               # 高德地图搜索封装、缓存、超时和日志
│     └─ llm.py                # 智谱/百炼大模型调用封装
├─ migrations/
│  ├─ env.py                   # Alembic 迁移运行环境
│  ├─ versions/
│  │  ├─ 0001_initial_schema.py
│  │  └─ 0002_user_security_tokens.py
│  └─ README
├─ .env.example                # 本地环境变量示例
├─ requirements.txt            # Python 依赖
└─ run.py                      # 本地开发启动入口
```

仓库根目录还有：

```text
render.yaml                    # Render Web Service 部署配置
scripts/use-utf8.ps1           # Windows 终端 UTF-8 辅助脚本
scripts/run-backend-utf8.cmd   # Windows 后端 UTF-8 启动脚本
```

## 运行方式

### 1. 创建虚拟环境并安装依赖

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 2. 配置环境变量

复制示例文件：

```bash
copy .env.example .env
```

macOS / Linux:

```bash
cp .env.example .env
```

本地开发至少需要配置：

```env
GAODE_API_KEY=your-gaode-api-key
BAILIAN_API_KEY=your-bailian-api-key
ZHIPU_API_KEY=
LLM_PROVIDER=bailian
SECRET_KEY=replace-with-a-random-secret-at-least-32-chars
FLASK_APP=app:create_app
```

`SECRET_KEY` 可这样生成：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. 初始化或迁移数据库

本地开发可直接运行：

```bash
python run.py
```

`run.py` 会调用 `initialize_database()`，自动创建缺失表并兼容早期 SQLite 表结构。生产环境不要依赖这个自动建表流程，生产使用迁移：

```bash
flask db upgrade
```

如果旧数据库已经被 `create_all()` 建过表，但没有 `alembic_version` 表，第一次切换迁移体系时先备份数据，再执行：

```bash
flask db stamp head
```

全新数据库直接执行 `flask db upgrade`。

### 4. 启动服务

本地开发：

```bash
python run.py
```

默认地址：

```text
http://127.0.0.1:5000
```

模拟生产启动：

```bash
gunicorn "app:create_app()" --bind 0.0.0.0:8000
```

Render 启动命令：

```bash
flask db upgrade && gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
```

## 环境变量

| 变量 | 必需 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `SECRET_KEY` | 是 | 无 | JWT HS256 签名密钥，必须足够长且随机 |
| `JWT_EXPIRATION_SECONDS` | 否 | `86400` | access token 有效期 |
| `DATABASE_URL` | 生产必需 | 空 | PostgreSQL 连接串；为空时本地使用 SQLite |
| `FLASK_APP` | 迁移必需 | `app:create_app` | Flask CLI 入口 |
| `GAODE_API_KEY` | 是 | 无 | 高德地图 Web API Key |
| `ZHIPU_API_KEY` | 二选一 | 空 | 智谱 AI Key |
| `BAILIAN_API_KEY` | 二选一 | 空 | 阿里云百炼 Key |
| `LLM_PROVIDER` | 否 | `auto` | LLM 提供方：`auto`/`bailian`/`zhipu`（`auto` 默认优先百炼） |
| `AMAP_CACHE_TTL_SECONDS` | 否 | `300` | 高德搜索缓存 TTL；设为 `0` 可关闭 |
| `AMAP_CACHE_MAX_ITEMS` | 否 | `256` | 高德搜索缓存最大条目数 |
| `AMAP_REQUEST_TIMEOUT_SECONDS` | 否 | `8` | 高德请求超时 |
| `CONVERSATION_HISTORY_LIMIT` | 否 | `20` | AI 对话加载的历史消息数量 |
| `LOG_LEVEL` | 否 | `INFO` | 日志等级 |
| `RATELIMIT_DEFAULT` | 否 | `200 per hour` | 全局默认限流 |
| `RATELIMIT_STORAGE_URI` | 否 | `memory://` | 限流存储；生产可切 Redis |
| `FRONTEND_URL` | 否 | `http://localhost:8080` | 邮箱验证/重置密码链接的前端域名；生产环境使用 `https://njuatlas.cn` |
| `EMAIL_VERIFICATION_TOKEN_SECONDS` | 否 | `86400` | 邮箱验证 token 有效期 |
| `PASSWORD_RESET_TOKEN_SECONDS` | 否 | `1800` | 重置密码 token 有效期 |
| `RESEND_API_KEY` | 否 | 空 | Resend API Key；为空时邮件内容写入日志 |
| `MAIL_FROM` | 否 | `no-reply@njuatlas.local` | 发件人 |

## 数据模型

当前主要表：

| 表 | 模型 | 用途 |
| --- | --- | --- |
| `users` | `User` | 邮箱账号、昵称、密码哈希、邮箱验证状态 |
| `restaurants` | `Restaurant` | 用户添加的餐厅，本地业务侧餐厅实体 |
| `reviews` | `Review` | 用户评论和评分 |
| `likes` | `Like` | 用户点赞餐厅，`user_id + restaurant_id` 唯一 |
| `favorites` | `Favorite` | 用户收藏餐厅，`user_id + restaurant_id` 唯一 |
| `conversation_messages` | `ConversationMessage` | AI 多轮对话消息，按 `session_id` 聚合 |
| `email_verification_tokens` | `EmailVerificationToken` | 邮箱验证一次性 token 的哈希 |
| `password_reset_tokens` | `PasswordResetToken` | 忘记密码一次性 token 的哈希 |
| `revoked_tokens` | `RevokedToken` | 已退出登录或已失效 JWT 的 `jti` 黑名单 |

安全相关约定：

- 数据库只保存密码哈希，不保存新用户明文密码。
- 邮箱验证 token 和重置密码 token 只保存 SHA-256 哈希。
- JWT payload 包含 `sub`、`email`、`jti`、`iat`、`exp`。
- 退出登录和修改密码会把当前 JWT 的 `jti` 写入 `revoked_tokens`，后续请求会被拒绝。

## 通用 API 约定

### 请求格式

POST 请求一般使用 JSON：

```http
Content-Type: application/json
```

需要登录的接口必须带：

```http
Authorization: Bearer <access_token>
```

### 错误响应

全局错误处理和手写业务错误统一返回：

```json
{
  "error": "invalid_token",
  "message": "token has expired",
  "status_code": 401
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `200` | 成功 |
| `201` | 创建成功 |
| `400` | 请求参数错误 |
| `401` | 未登录、token 无效、密码错误 |
| `404` | 资源不存在 |
| `409` | 唯一性冲突 |
| `429` | 触发限流 |
| `500` | 未预期服务端错误 |
| `502` | 上游服务调用失败 |

## API 列表

### 用户体系

#### `POST /api/user/register`

邮箱注册。注册成功后返回 JWT，同时生成邮箱验证 token 并发送邮件；未配置 Resend 时邮件内容写入日志。

请求：

```json
{
  "email": "student@example.com",
  "password": "12345678",
  "username": "student"
}
```

响应：

```json
{
  "id": 1,
  "email": "student@example.com",
  "username": "student",
  "email_verified": false,
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

#### `POST /api/user/login`

邮箱密码登录。

请求：

```json
{
  "email": "student@example.com",
  "password": "12345678"
}
```

响应同注册。

#### `POST /api/user/logout`

退出登录。需要 JWT。当前 token 的 `jti` 会写入黑名单。

响应：

```json
{
  "message": "Logged out"
}
```

#### `POST /api/user/email/verification`

登录后重新发送邮箱验证邮件。

响应：

```json
{
  "message": "Verification email sent"
}
```

如果已经验证：

```json
{
  "message": "Email is already verified"
}
```

#### `POST /api/user/email/verify`

提交邮箱验证 token。

请求：

```json
{
  "token": "raw-token-from-email"
}
```

响应：

```json
{
  "message": "Email verified"
}
```

#### `POST /api/user/password/forgot`

请求重置密码。为了避免枚举邮箱，无论邮箱是否存在，都返回相同提示。

请求：

```json
{
  "email": "student@example.com"
}
```

响应：

```json
{
  "message": "If the email exists, a reset link has been sent"
}
```

#### `POST /api/user/password/reset`

使用重置 token 设置新密码。

请求：

```json
{
  "token": "raw-token-from-email",
  "new_password": "new-password"
}
```

响应：

```json
{
  "message": "Password reset completed"
}
```

#### `POST /api/user/password/change`

登录后修改密码。成功后当前 token 会失效，前端应清理本地 token 并跳转登录。

请求：

```json
{
  "current_password": "old-password",
  "new_password": "new-password"
}
```

响应：

```json
{
  "message": "Password changed. Please log in again."
}
```

### 个人中心

以下接口均需要 JWT。

#### `GET /api/me/favorites`

返回我的收藏餐厅。

响应：

```json
{
  "items": [
    {
      "id": 1,
      "created_at": "2026-05-25T12:00:00",
      "place": {
        "id": 10,
        "name": "场所名",
        "address": "地址",
        "location": "118.78,32.03",
        "poi_id": "B0..."
      }
    }
  ]
}
```

#### `GET /api/me/likes`

返回我的点赞场所。响应结构与收藏类似。

#### `GET /api/me/reviews`

返回我的评论。

```json
{
  "items": [
    {
      "id": 1,
      "content": "很好吃",
      "rating": 5,
      "created_at": "2026-05-25T12:00:00",
      "place": {
        "id": 10,
        "name": "场所名",
        "address": "地址",
        "location": "118.78,32.03",
        "poi_id": "B0..."
      }
    }
  ]
}
```

#### `GET /api/me/conversations`

返回我的 AI 对话会话列表。

```json
{
  "items": [
    {
      "session_id": "8f5d0e6d-0ecb-4a9d-8809-cf54de1ec9e1",
      "last_message": "最近一条消息",
      "last_role": "assistant",
      "last_at": "2026-05-25T12:00:00",
      "message_count": 8
    }
  ]
}
```

### 地图与搜索

#### `GET /api/places/hot_areas`

返回预设热门区域：

```json
{
  "xinjiekou": {"name": "新街口", "location": "118.78472,32.03517"},
  "fuzimiao": {"name": "夫子庙", "location": "118.78811,32.02056"},
  "xianlin": {"name": "仙林大学城", "location": "118.93021,32.10247"},
  "jiangning": {"name": "江宁大学城", "location": "118.88359,31.93439"}
}
```

#### `GET /api/places/search`

调用高德 POI 搜索。

查询参数：

| 参数 | 必需 | 说明 |
| --- | --- | --- |
| `keyword` | 是 | 搜索关键词 |
| `city` | 否 | 城市，默认南京 |
| `location` | 否 | 中心坐标，格式 `lng,lat` |
| `page` | 否 | 页码，1-50 |
| `page_size` | 否 | 每页数量，1-25 |

示例：

```text
GET /api/places/search?keyword=火锅&city=南京&page=1&page_size=20
```

后端会按关键词、城市、坐标、页码和页大小做短期缓存，减少重复请求高德 API。

### 餐厅与互动

#### `POST /api/restaurant`

登录后添加餐厅。若传入 `poi_id` 且已存在，会返回已有餐厅。

```json
{
  "name": "测试餐厅",
  "address": "仙林大道",
  "location": "118.93,32.10",
  "poi_id": "B0..."
}
```

#### `POST /api/review`

登录后新增评论。

```json
{
  "restaurant_id": 1,
  "content": "很好吃",
  "rating": 5
}
```

#### `POST /api/like`

登录后切换点赞状态。

```json
{
  "restaurant_id": 1
}
```

响应：

```json
{
  "liked": true,
  "message": "点赞成功"
}
```

#### `POST /api/favorite`

登录后切换收藏状态。

```json
{
  "restaurant_id": 1
}
```

响应：

```json
{
  "favorited": true,
  "message": "收藏成功"
}
```

#### `GET /api/restaurant/<restaurant_id>/stats`

返回餐厅点赞数、收藏数和评论列表。

### AI 推荐

#### `GET /api/llm/recommend_slogan`

为指定餐厅生成一句推荐语。

```text
GET /api/llm/recommend_slogan?restaurant_id=1
```

响应：

```json
{
  "restaurant_id": 1,
  "slogan": "一句推荐语"
}
```

#### `POST /api/llm/chat_recommend`

登录后进行多轮美食推荐对话。后端会：

- 按 JWT 识别当前用户；
- 读取该用户的点赞/收藏偏好；
- 调用高德搜索真实餐厅候选；
- 读取当前 `session_id` 的历史对话；
- 保存本轮用户消息和 AI 回复。

请求：

```json
{
  "message": "我想吃辣的，仙林附近",
  "session_id": "8f5d0e6d-0ecb-4a9d-8809-cf54de1ec9e1",
  "city": "南京"
}
```

`session_id` 可不传，不传时后端生成新会话并在响应中返回。

响应：

```json
{
  "session_id": "8f5d0e6d-0ecb-4a9d-8809-cf54de1ec9e1",
  "reply": "AI 回复内容",
  "candidates": [
    {
      "name": "餐厅名",
      "address": "地址",
      "location": "118.93,32.10",
      "rating": "4.3",
      "cost": "65"
    }
  ]
}
```

## 限流策略

全局默认限流由 `RATELIMIT_DEFAULT` 控制。当前关键接口还设置了局部限流：

| 接口 | 限流 |
| --- | --- |
| 注册、登录 | `5 per minute` |
| 请求邮箱验证 | `3 per minute` |
| 邮箱验证、忘记密码、重置密码、修改密码 | 见路由装饰器 |
| 地图搜索 | `30 per minute` |
| AI 对话推荐 | `10 per minute` |
| 餐厅互动 | `30-60 per minute` |
| 个人中心查询 | `60 per minute` |

生产环境如果有多实例，`RATELIMIT_STORAGE_URI` 建议切到 Redis；当前默认 `memory://` 只适合单实例或开发环境。

## 日志

后端通过 `logging_utils.log_event()` 输出 JSON 行日志到 stdout。Render 会自动采集 stdout。当前日志覆盖：

- 注册、登录、登录失败；
- token 黑名单、密码重置、邮箱验证；
- 餐厅创建、评论、点赞、收藏；
- AI 对话保存和失败；
- 高德/LLM 外部 API 调用；
- 配置错误、数据库错误、未捕获异常。

## 数据库迁移开发流程

修改 `models.py` 后：

```bash
flask db migrate -m "describe change"
flask db upgrade
```

提交时应包含：

- `app/models.py` 的模型变更；
- `migrations/versions/*.py` 的迁移脚本；
- 相关接口和文档更新。

注意事项：

- 不要在生产环境手动删库重建。
- 对已有生产数据的字段变更要考虑 nullable、默认值和回填策略。
- 新增唯一约束前要确认旧数据没有冲突。

## Render 部署

当前 `render.yaml` 已配置：

```yaml
rootDir: backend
buildCommand: pip install -r requirements.txt
startCommand: flask db upgrade && gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
```

部署前需要在 Render 配置环境变量，尤其是：

- `SECRET_KEY`
- `DATABASE_URL`
- `GAODE_API_KEY`
- `ZHIPU_API_KEY` 或 `BAILIAN_API_KEY`
- `FRONTEND_URL`
- Resend 相关变量，如果需要真实邮件发送

正式域名规划：

- 前端站点：`https://njuatlas.cn`
- 后端 API：`https://api.njuatlas.cn`
- 前端生产环境会请求 `https://api.njuatlas.cn/api`

## Windows 中文乱码处理

仓库提供了：

```text
scripts/use-utf8.ps1
scripts/run-backend-utf8.cmd
```

Windows 本地开发时如果终端中文乱码，可以使用这些脚本或手动切换终端到 UTF-8。代码文件按 UTF-8 保存。

## OSM 补充数据导入（可选）

为了减少“高德检索命中不足”的场景，可以把 OpenStreetMap（OSM）的周边餐饮 POI 导入本地 `places` 表，作为补充数据源（不替代高德）。

脚本位置：

```text
scripts/import_osm_places.py
```

示例：

```bash
# 仅预览（不写库）
python scripts/import_osm_places.py --dry-run

# 导入南大鼓楼周边 4km 的餐饮 POI
python scripts/import_osm_places.py --radius 4000

# 只导入名称含“饺子/水饺/锅贴/面”的店
python scripts/import_osm_places.py --name-keywords 饺子,水饺,锅贴,面
```

常用参数：

- `--lat` / `--lng`：中心坐标（默认南大鼓楼校区）
- `--radius`：半径（米）
- `--amenities`：OSM `amenity` 过滤（默认 `restaurant,fast_food,cafe,food_court`）
- `--name-keywords`：按名称关键词二次过滤
- `--dry-run`：只看结果，不写数据库

## 南大周边餐饮采集（高德 API）

如果你希望把“南京大学附近餐厅”批量沉淀到本地数据库，可使用：

```text
scripts/crawl_nju_restaurants.py
```

示例：

```bash
# 仅预览（不写库）
python scripts/crawl_nju_restaurants.py --dry-run

# 采集三校区周边 6km 餐饮数据并写入 places
python scripts/crawl_nju_restaurants.py --radius 6000

# 只采集鼓楼+仙林，偏饺子/面食方向
python scripts/crawl_nju_restaurants.py --campuses gulou,xianlin --keywords 餐厅,饺子,水饺,锅贴,面馆
```

说明：

- 使用高德官方 POI API（不是 HTML 硬爬）
- 自动按 `poi_id` 和 `name+location` 去重
- 对已存在记录执行增量更新（地址、分类、评分、图片、更新时间）
- 默认覆盖：鼓楼 / 仙林 / 浦口校区

## 当前已知限制

- 登录接口会强制要求 `email_verified=true`。
- 邮件发送依赖 Resend API；未配置时只写日志，适合开发但不适合正式生产。
- JWT 只有 access token，没有 refresh token 体系。
- token 黑名单会持续写入 `revoked_tokens`，后续需要定期清理过期记录。
- 个人中心列表当前未分页，数据量上来后需要加 `page/page_size`。
- AI 推荐仍依赖外部模型稳定性，失败时返回 `502`。
- 自动化测试尚未建立。

## 开发约定

- 所有新接口优先使用 `validators.py` 做输入校验。
- 需要登录的接口使用 `@jwt_required`。
- 业务错误使用 `error_response()`，保持统一错误结构。
- 重要行为用 `log_event()` 记录结构化日志。
- 涉及数据库结构变更必须写迁移。
- 不要把真实 `.env`、API Key、数据库连接串提交到仓库。
