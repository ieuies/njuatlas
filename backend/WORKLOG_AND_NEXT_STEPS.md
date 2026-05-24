# 后端工作记录与下一步计划

本文档记录本轮后端改造已经完成的事项，以及前端和后端接下来需要继续衔接的工作。

## 已完成的后端工作

### 1. 中文编码与本地开发体验

- 增加 `.editorconfig`，统一 UTF-8 和基础格式约定。
- 增加 Windows UTF-8 辅助脚本：
  - `scripts/use-utf8.ps1`
  - `scripts/run-backend-utf8.cmd`
- `backend/run.py` 对 stdout/stderr 做 UTF-8 reconfigure，降低中文日志乱码概率。

### 2. 用户账号体系

- 登录方式从旧用户名/明文密码逻辑改为邮箱 + 密码。
- 密码使用 Werkzeug 的 `generate_password_hash()` 和 `check_password_hash()`。
- 保留旧 `password` 字段用于兼容早期 SQLite 数据；旧用户登录成功后可升级为哈希密码。
- 注册和登录成功后返回 JWT access token。
- 新增邮箱验证流程：
  - 生成一次性验证 token；
  - 数据库只保存 token hash；
  - 支持 SMTP 发送；
  - 未配置 SMTP 时将邮件内容写入日志。
- 新增忘记密码/重置密码流程：
  - 生成一次性重置 token；
  - 数据库只保存 token hash；
  - 重置接口统一校验 token 有效期和使用状态。
- 新增修改密码接口。
- 新增退出登录接口。
- JWT 增加 `jti`，支持 token 黑名单。

### 3. 鉴权与安全

- 新增 `app/auth_utils.py`：
  - HS256 JWT 签发；
  - JWT 解析与签名校验；
  - Bearer token 提取；
  - token 黑名单校验；
  - 当前 token revoke。
- 需要登录的业务接口已改用 JWT 当前用户，不再信任请求体里的 `user_id`。
- 注册、登录、密码相关接口增加限流。

### 4. 配置集中管理

- 新增 `app/config.py`，集中读取和校验环境变量。
- 支持：
  - `SECRET_KEY`
  - `DATABASE_URL`
  - 高德 API Key
  - 智谱/百炼 API Key
  - JWT 有效期
  - 高德缓存配置
  - AI 对话历史条数
  - 限流配置
  - SMTP 和前端地址配置
- 启动时对关键配置做显式校验，避免接口调用时才暴露缺配置问题。

### 5. Render 部署

- 增加根目录 `render.yaml`。
- 后端部署平台从 PythonAnywhere 改为 Render。
- Render 启动命令改为：

```bash
flask db upgrade && gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
```

- 新增 Gunicorn 和 PostgreSQL 驱动依赖。

### 6. PostgreSQL 与数据库迁移

- `DATABASE_URL` 支持 PostgreSQL。
- 兼容 `postgres://` 到 `postgresql://`。
- 接入 Flask-Migrate/Alembic。
- 新增迁移目录 `backend/migrations/`。
- 已有迁移：
  - `0001_initial_schema.py`：初始业务表。
  - `0002_user_security_tokens.py`：邮箱验证、密码重置、token 黑名单相关表和字段。
- 本地 `python run.py` 仍保留自动建表，方便开发演示；生产通过迁移管理 schema。

### 7. 输入验证

- 新增 `app/validators.py`。
- 覆盖：
  - JSON 请求体必须为 object；
  - 字符串 required、长度限制、trim；
  - 正整数 ID；
  - 页码/分页大小范围；
  - 评分范围；
  - 经纬度格式；
  - AI 会话 `session_id` UUID 校验。

### 8. 全局错误处理

- 新增 `app/errors.py`。
- 统一错误响应结构：

```json
{
  "error": "error_code",
  "message": "human readable message",
  "status_code": 400
}
```

- 覆盖：
  - 参数校验错误；
  - 配置错误；
  - SQLAlchemy 错误；
  - HTTP 异常；
  - 未捕获异常。
- 数据库异常会自动 rollback。

### 9. 限流

- 新增 `app/rate_limit.py`。
- 接入 Flask-Limiter。
- 默认全局限流 `RATELIMIT_DEFAULT=200 per hour`。
- 注册/登录、邮箱验证、密码重置、地图搜索、AI 对话、互动接口、个人中心接口都有局部限流。

### 10. 日志

- 新增 `app/logging_utils.py`。
- 输出 JSON 行日志到 stdout，适配 Render 日志采集。
- 已记录：
  - 注册、登录、登录失败；
  - 邮箱验证、密码重置、修改密码；
  - 餐厅创建、点赞、收藏、评论；
  - 高德搜索；
  - AI 对话保存和错误；
  - 数据库错误、配置错误、未捕获异常。

### 11. 高德搜索优化

- `app/services/amap.py` 增加请求超时。
- 增加短期内存 TTL 缓存。
- 搜索接口支持 `page_size`。
- 搜索缓存按关键词、城市、坐标、页码、页大小区分。

### 12. AI 对话持久化

- 新增 `ConversationMessage` 表。
- `POST /api/llm/chat_recommend` 支持服务端保存对话历史。
- 前端传 `session_id` 时后端读取该会话最近历史。
- 不传 `session_id` 时后端生成新会话并返回。

### 13. 个人中心

- 新增 `app/routes/profile.py`。
- 已提供：
  - `GET /api/me/favorites`
  - `GET /api/me/likes`
  - `GET /api/me/reviews`
  - `GET /api/me/conversations`
- 返回结构已包含餐厅基础信息和会话摘要。

## 当前后端接口总览

### 用户体系

- `POST /api/user/register`
- `POST /api/user/login`
- `POST /api/user/logout`
- `POST /api/user/email/verification`
- `POST /api/user/email/verify`
- `POST /api/user/password/forgot`
- `POST /api/user/password/reset`
- `POST /api/user/password/change`

### 个人中心

- `GET /api/me/favorites`
- `GET /api/me/likes`
- `GET /api/me/reviews`
- `GET /api/me/conversations`

### 地图搜索

- `GET /api/places/hot_areas`
- `GET /api/places/search`

### 餐厅互动

- `POST /api/restaurant`
- `POST /api/review`
- `POST /api/like`
- `POST /api/favorite`
- `GET /api/restaurant/<restaurant_id>/stats`

### AI 推荐

- `GET /api/llm/recommend_slogan`
- `POST /api/llm/chat_recommend`

## 前端下一步需要做

### 1. 认证状态管理

- 登录/注册成功后保存：
  - `access_token`
  - `token_type`
  - `expires_in`
  - `email_verified`
  - 用户基础信息
- 所有需要登录的请求添加：

```http
Authorization: Bearer <access_token>
```

- 遇到 `401` 时清理本地 token 并跳转登录页。
- 修改密码和退出登录成功后主动清理本地 token。

### 2. 邮箱验证页面

- 注册成功后提示用户查收邮箱。
- 前端新增 `/verify-email?token=...` 页面。
- 页面读取 query 中的 `token`，调用：

```text
POST /api/user/email/verify
```

- 登录后如果 `email_verified=false`，在个人中心或顶部提示用户验证邮箱。
- 提供“重新发送验证邮件”按钮，调用：

```text
POST /api/user/email/verification
```

### 3. 忘记密码和重置密码页面

- 登录页增加“忘记密码”入口。
- 忘记密码页提交邮箱，调用：

```text
POST /api/user/password/forgot
```

- 前端新增 `/reset-password?token=...` 页面。
- 页面读取 query token，用户输入新密码，调用：

```text
POST /api/user/password/reset
```

### 4. 修改密码 UI

- 个人中心增加修改密码表单。
- 表单字段：
  - 当前密码；
  - 新密码；
  - 确认新密码。
- 调用：

```text
POST /api/user/password/change
```

- 成功后提示重新登录。

### 5. 个人中心页面

前端需要新增或补齐：

- 我的收藏列表：`GET /api/me/favorites`
- 我的点赞列表：`GET /api/me/likes`
- 我的评论列表：`GET /api/me/reviews`
- 我的对话会话列表：`GET /api/me/conversations`

建议 UI 行为：

- 收藏/点赞列表点击餐厅可定位到地图或进入详情。
- 评论列表点击餐厅可打开对应餐厅详情。
- 对话会话列表点击后进入 AI 对话页，并带上 `session_id`。

### 6. AI 对话前端衔接

- 首次对话不传 `session_id`。
- 后端返回 `session_id` 后，前端保存到当前会话状态。
- 刷新页面后可以通过个人中心会话列表恢复会话。
- 之后继续对话时带上同一个 `session_id`。

### 7. 错误处理统一化

前端错误处理应优先读取：

```js
error.message
```

后端错误格式：

```json
{
  "error": "code",
  "message": "text",
  "status_code": 400
}
```

前端不应依赖旧格式 `{"error": "中文文案"}`。

## 后端下一步建议

### 高优先级

- 为个人中心列表增加分页：
  - `page`
  - `page_size`
  - `total`
  - `items`
- 邮箱验证是否应该强制：
  - 方案 A：未验证仍可登录，但限制评论、收藏、AI 等写操作；
  - 方案 B：未验证不可登录；
  - 方案 C：未验证可登录，但前端强提示。
- 增加 token 黑名单清理任务，删除 `expires_at < now` 的记录。
- 增加自动化测试：
  - 注册/登录；
  - JWT 保护接口；
  - logout 后 token 失效；
  - 密码重置；
  - 个人中心列表。

### 中优先级

- 增加 refresh token 体系，避免 access token 有效期过长。
- SMTP 发送失败时增加更明确的错误日志和重试策略。
- AI 对话增加按会话读取详情接口：

```text
GET /api/me/conversations/<session_id>/messages
```

- 增加删除会话接口。
- 餐厅详情接口独立化，减少前端依赖 stats 接口拼装。
- 添加餐厅搜索结果落库策略，统一高德 POI 和本地 Restaurant 的关系。

### 低优先级

- 增加 OpenAPI/Swagger 文档。
- 增加管理员后台：
  - 用户管理；
  - 评论管理；
  - 餐厅数据纠错；
  - API 调用统计。
- 增加更细粒度的日志字段和 request id。
- 将限流存储切换到 Redis，适配多实例部署。

## 部署前检查清单

- Render 中配置 `SECRET_KEY`。
- Render 中配置 PostgreSQL `DATABASE_URL`。
- Render 中配置 `GAODE_API_KEY`。
- Render 中至少配置一个 LLM Key：`ZHIPU_API_KEY` 或 `BAILIAN_API_KEY`。
- Render 中配置 `FRONTEND_URL` 为真实前端域名。
- 若要真实发送邮件，配置 SMTP 相关变量。
- 首次迁移确认数据库状态：
  - 全新数据库：`flask db upgrade`
  - 旧 create_all 数据库：备份后 `flask db stamp head`
- 前端确认所有登录态请求都带 `Authorization`。

## 已知风险

- 当前 SMTP 未配置时，验证/重置链接会出现在服务端日志中，只适合开发或预览环境。
- 当前个人中心接口未分页，大量数据时会变慢。
- 当前 access token 黑名单依赖数据库查询，每个受保护请求都会查 `revoked_tokens`。
- 当前没有 refresh token，用户会在 token 过期后重新登录。
- 当前尚未接入自动测试，后续重构风险较高。
