

# 🍜 附近美食地图标注与智能推荐 — 后端 API

> 本项目为"附近美食地图标注与智能推荐"网页应用提供后端支持，基于 **Flask**（一个轻量级的 Python Web 框架，就像餐厅的前台服务员，负责接收请求并分发给后厨处理）构建，整合**高德地图 POI 搜索**（帮你找到真实存在的餐厅）与**大模型（LLM）** 智能推荐（让 AI 扮演美食评论家给你推荐好吃的），实现地图浏览、用户交互与智能对话的完整后端功能。

---

## 📁 目录结构

```
food-map-api/
├── app/                        # 应用主包（所有后端代码都在这里）
│   ├── __init__.py             # 应用工厂（创建并配置 Flask 应用）
│   ├── models.py               # 数据库模型（定义用户、餐厅、评论等"表格结构"）
│   ├── routes/                 # 路由（接口）目录——就像食堂的不同窗口
│   │   ├── __init__.py
│   │   ├── places.py           # 高德地图搜索相关接口
│   │   ├── auth.py             # 用户注册/登录接口
│   │   ├── interactions.py     # 添加餐厅、短评、点赞、收藏接口
│   │   └── llm_routes.py       # 大模型智能推荐接口
│   └── services/               # 外部服务调用封装（调用高德、大模型等）
│       ├── __init__.py
│       ├── amap.py             # 高德地图 API 封装
│       └── llm.py              # 大模型 API 封装（智谱/阿里百炼）
├── .env                        # 环境变量文件（存放 API 密钥等，⚠️ 绝对不能上传到 Git！）
├── .gitignore                  # Git 忽略规则
├── requirements.txt            # 项目依赖清单（一键安装所有需要的包）
├── run.py                      # 项目启动入口
└── foodmap.db                  # SQLite 数据库文件（本地自动生成，不上传 Git）
```

> 🔍 **如何理解这个结构？** 把整个项目想象成一家餐厅：`routes/` 里的每个文件是不同窗口（一个管地图搜索，一个管用户注册……），`services/` 是后厨里专门负责打电话给外卖平台（高德、AI）的岗位，`models.py` 是记录所有订单和顾客信息的账本（数据库）。

---

## 🧰 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| **Python** | ≥ 3.9 | 项目运行基础（建议 3.10~3.14） |
| **Flask** | 3.1.3 | Web 框架核心 |
| **Flask-SQLAlchemy** | 3.1.1 | 数据库操作工具（让你用 Python 代码代替手写 SQL） |
| **Flask-CORS** | 6.0.2 | 解决前后端分离时的跨域问题 |
| **python-dotenv** | 1.2.2 | 从 `.env` 文件读取密钥等敏感信息 |
| **requests** | ≥ 2.32 | 发送 HTTP 请求（调用高德和大模型 API） |
| **openai** | 最新版 | 调用智谱/阿里百炼等大模型 API |
| **httpx** | 最新版 | HTTP 请求库（openai 的底层依赖） |

操作系统：**Windows / macOS / Linux** 均可。

---

## 🚀 本地安装与运行

### 1. 克隆仓库

```bash
# 从 GitHub 下载项目到本地（把 YOUR_USERNAME 换成实际的 GitHub 用户名）
git clone https://github.com/YOUR_USERNAME/food-map-api.git
cd food-map-api
```

### 2. 创建并激活虚拟环境（一个独立的项目"厨房"）

**Windows（命令提示符 / Anaconda Prompt）：**
```cmd
# 方式一：使用 Python 自带 venv
python -m venv venv
venv\Scripts\activate

# 方式二（如果你在用 Conda）：
conda create -n foodmap python=3.12
conda activate foodmap
```

**macOS / Linux（终端）：**
```bash
python3 -m venv venv
source venv/bin/activate
```

> 💡 激活成功后，终端提示符前面会出现 `(venv)` 或 `(foodmap)` 字样。

### 3. 安装依赖

```bash
# 升级 pip（包管理器，就像手机上的"应用商店"）
python -m pip install --upgrade pip

# 一键安装所有依赖（-r 表示按清单批量安装）
pip install -r requirements.txt
```

### 4. 配置环境变量（密钥等）

在项目根目录下找到 `.env` 文件（没有就新建），填入以下内容：

```env
# 高德地图 API Key（必填）
# 获取方式：https://lbs.amap.com/ → 注册 → 创建应用 → 选择"Web服务"
GAODE_API_KEY=你的高德Key

# 大模型 API Key（至少配置一个）
# 智谱 AI（推荐首选，免费额度最足）：https://open.bigmodel.cn/
ZHIPU_API_KEY=你的智谱Key

# 阿里云百炼（备选）：https://bailian.console.aliyun.com/
BAILIAN_API_KEY=你的百炼Key
```

> 🔒 `.env` 文件已在 `.gitignore` 中排除，**绝对不会上传到 GitHub**。每位开发者需要自己申请各自的 Key。

### 5. 初始化数据库

首次运行时，数据库文件 `foodmap.db` 会自动创建。你也可以手动验证：

```bash
# 启动应用（首次启动会自动建表）
python run.py
```

看到 `✅ 数据库表已就绪` 即表示初始化成功。

### 6. 启动服务

```bash
python run.py
```

启动后访问 **`http://127.0.0.1:5000`**，如果看到 Flask 的默认提示页面（或 404），说明启动成功。按 `Ctrl+C` 可以停止服务器。

---

## 📡 API 接口文档

### 🌐 基础地址

- 本地开发：`http://127.0.0.1:5000`
- 公网部署：见 [部署指南](#-部署指南本地预览公网占位)

### 🔑 鉴权说明

> ⚠️ **当前版本未实现真正的登录保护**。本项目采用极简用户标识方式：注册/登录后，前端保存返回的 `user_id`，后续请求中将其作为请求体字段传递。**这种方式仅适用于本地开发和演示，绝对不要用于公网生产环境！** 后续版本计划引入 JWT（JSON Web Token，就是一个加密的身份令牌，证明你已经登录了）。

### 📮 通用说明

- **请求格式**：除搜索类 GET 请求外，所有 POST 请求均使用 **JSON** 格式（`Content-Type: application/json`）。
- **响应格式**：所有响应均为 **JSON**。
- **状态码**：`200` 成功、`201` 创建成功、`400` 请求参数错误、`401` 未登录/密码错误、`404` 资源不存在、`409` 冲突（如用户名已存在）、`500` 服务器内部错误。

> 💡 **什么是 API 调用？** 就像你在食堂窗口点餐——你递过去一张纸条（请求），窗口给你端出来一份饭菜（响应）。纸条上写的就是"参数"，饭菜就是"返回数据"。

---

### 🗺️ 一、地图与地点搜索

#### `GET /api/places/hot_areas`

**描述**：返回预设的南京热门商圈列表（新街口、夫子庙、仙林大学城、江宁大学城），供前端快速定位。

**请求参数**：无

**成功响应示例**：
```json
{
  "xinjiekou": {"name": "新街口", "location": "118.78472,32.03517"},
  "fuzimiao":  {"name": "夫子庙", "location": "118.78811,32.02056"},
  "xianlin":   {"name": "仙林大学城", "location": "118.93021,32.10247"},
  "jiangning": {"name": "江宁大学城", "location": "118.88359,31.93439"}
}
```

---

#### `GET /api/places/search`

**描述**：调用高德地图 POI 搜索接口，按关键词搜索餐厅或地点。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|:---:|------|------|
| `keyword` | string | ✅ | 搜索关键词 | `火锅` |
| `city` | string | ❌ | 城市名（默认"南京"） | `南京` |
| `location` | string | ❌ | 中心点经纬度 | `118.78472,32.03517` |
| `page` | int | ❌ | 页码（默认 1） | `2` |

**成功响应示例**（精简）：
```json
{
  "status": "1",
  "count": "15",
  "pois": [
    {
      "name": "海底捞火锅(新街口店)",
      "address": "中山南路1号",
      "location": "118.78472,32.03517",
      "biz_ext": {"rating": "4.5", "cost": "120"}
    }
  ]
}
```

**错误响应示例**：
```json
{"error": "keyword 参数是必填的"}
```

---

### 👤 二、用户相关

#### `POST /api/user/register`

**描述**：注册新用户。

**请求体（JSON）**：
```json
{
  "username": "xiaoming",
  "password": "123456"
}
```

**成功响应（201）**：
```json
{"id": 1, "username": "xiaoming"}
```

**错误响应（409）**：
```json
{"error": "用户名已被注册"}
```

---

#### `POST /api/user/login`

**描述**：用户登录。

**请求体（JSON）**：
```json
{
  "username": "xiaoming",
  "password": "123456"
}
```

**成功响应**：
```json
{"id": 1, "username": "xiaoming"}
```

**错误响应（401）**：
```json
{"error": "用户名或密码错误"}
```

---

### 🍽️ 三、餐厅与互动

#### `POST /api/restaurant`

**描述**：添加一个新餐厅到数据库。

**请求体（JSON）**：
```json
{
  "name": "测试拉面馆",
  "address": "汉口路22号",
  "location": "118.78,32.03",
  "poi_id": "B0FFFXXXX",
  "user_id": 1
}
```

| 字段 | 必填 | 说明 |
|------|:---:|------|
| `name` | ✅ | 餐厅名称 |
| `address` | ❌ | 地址 |
| `location` | ❌ | 经纬度（`lng,lat`） |
| `poi_id` | ❌ | 高德 POI 唯一 ID（用于去重） |
| `user_id` | ✅ | 添加者用户 ID |

**成功响应（201）**：
```json
{"id": 1, "name": "测试拉面馆"}
```

---

#### `POST /api/review`

**描述**：为指定餐厅写短评。

**请求体（JSON）**：
```json
{
  "user_id": 1,
  "restaurant_id": 1,
  "content": "很好吃！",
  "rating": 5
}
```

**成功响应（201）**：
```json
{"id": 1, "content": "很好吃！"}
```

---

#### `POST /api/like`

**描述**：点赞/取消点赞（同一个接口，第一次点赞，第二次取消——即"切换"逻辑）。

**请求体（JSON）**：
```json
{
  "user_id": 1,
  "restaurant_id": 1
}
```

**成功响应（点赞）**：
```json
{"liked": true, "message": "点赞成功"}
```

**成功响应（取消）**：
```json
{"liked": false, "message": "已取消点赞"}
```

---

#### `POST /api/favorite`

**描述**：收藏/取消收藏（逻辑同点赞）。

**请求体（JSON）**：
```json
{
  "user_id": 1,
  "restaurant_id": 1
}
```

**成功响应**：
```json
{"favorited": true, "message": "收藏成功"}
```

---

#### `GET /api/restaurant/<restaurant_id>/stats`

**描述**：获取指定餐厅的统计数据（点赞数、收藏数、评论列表）。

**路径参数**：`restaurant_id`（餐厅 ID，整数）

**成功响应示例**：
```json
{
  "restaurant_id": 1,
  "likes": 5,
  "favorites": 3,
  "reviews": [
    {
      "id": 1,
      "content": "很好吃！",
      "rating": 5,
      "user_id": 1,
      "created_at": "2026-05-24T12:00:00"
    }
  ]
}
```

**错误响应（404）**：
```json
{"error": "餐厅不存在"}
```

---

### 🤖 四、大模型（LLM）智能推荐

#### `GET /api/llm/recommend_slogan`

**描述**：为指定餐厅生成一句俏皮的推荐语（点击餐厅时调用）。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `restaurant_id` | int | ✅ | 餐厅 ID |

**成功响应示例**：
```json
{
  "restaurant_id": 1,
  "slogan": "汉口路上的拉面之光，汤底香到让你翘课去吃！"
}
```

---

#### `POST /api/llm/chat_recommend`

**描述**：多轮对话推荐——用户用自然语言描述需求（如"想吃辣的川菜，在仙林那边"），AI 结合高德地图搜索结果和用户历史偏好，用对话形式推荐餐厅。

**请求体（JSON）**：
```json
{
  "user_id": 1,
  "message": "我想吃辣的川菜，在仙林那边",
  "history": [],
  "city": "南京"
}
```

| 字段 | 必填 | 说明 |
|------|:---:|------|
| `user_id` | ✅ | 当前用户 ID（用于分析偏好） |
| `message` | ✅ | 用户说的话 |
| `history` | ❌ | 之前的对话历史（前端负责保存和回传） |
| `city` | ❌ | 城市（默认"南京"） |

**成功响应示例**：
```json
{
  "reply": "嘿，爱吃辣的小伙伴！仙林这边有几家川菜馆子很不错哦……",
  "candidates": [
    {
      "name": "川味观(仙林店)",
      "address": "仙林大道168号",
      "location": "118.93,32.10",
      "rating": "4.3",
      "cost": "65"
    }
  ]
}
```

---

## ⚠️ 已知问题与安全隐患

> 以下问题均为 MVP（最小可行产品）阶段的已知限制，不影响功能演示，但**不修复之前不可用于正式生产环境**。

| # | 问题 | 风险 | 修复建议 |
|---|------|------|---------|
| 1 | **密码明文存储** | 数据库中用户密码以明文保存，一旦数据库文件泄露，所有用户密码直接暴露 | 使用 `werkzeug.security.generate_password_hash()` 和 `check_password_hash()` 对密码进行哈希处理（就像把密码锁进保险箱，只能验证对不对，看不出原文） |
| 2 | **无 JWT 登录验证** | 当前仅靠 `user_id` 识别身份，任何人拿到别人的 ID 就能冒充其操作 | 引入 Flask-JWT-Extended 或 PyJWT，登录后颁发令牌，后续请求在 Header 中携带令牌验证身份 |
| 3 | **API 密钥存于 `.env` 但代码中直接读取** | `.env` 文件虽被 Git 忽略，但部署平台的环境变量配置可能被忽略或误操作导致泄露 | 部署时在平台控制台设置环境变量，不要将 `.env` 文件上传到服务器 |
| 4 | **缺少输入验证** | 评论内容、用户名等字段无长度和格式限制，攻击者可提交超长文本或恶意内容导致崩溃 | 使用 `wtforms` 或 `marshmallow` 库对所有输入做长度限制和格式校验 |
| 5 | **无全局错误处理** | 数据库操作失败、外部 API 超时等异常会直接返回 Flask 默认的 HTML 错误页面，前端无法解析 | 在 `app/__init__.py` 中注册全局错误处理器（`@app.errorhandler`），将异常统一转换为 JSON 格式返回 |
| 6 | **数据库无密码保护** | SQLite 文件无任何访问控制，任何能访问服务器文件系统的人都可以直接读取整个数据库 | 生产环境迁移至 PostgreSQL 或 MySQL，并设置数据库用户密码 |
| 7 | **搜索结果无分页优化** | 高德搜索接口虽有分页参数，但后端未做缓存，频繁调用可能触发 API 配额限制 | 引入 Flask-Caching 对热门搜索结果做短期缓存 |
| 8 | **无操作日志记录** | 无法追踪谁在什么时间做了什么操作，出现问题时难以排查 | 使用 Python `logging` 模块记录关键操作（注册、登录、添加餐厅、API 调用失败等）到文件 |
| 9 | **多轮对话历史无服务端存储** | 对话历史完全依赖前端回传，刷新页面即丢失，无法实现真正的多轮记忆 | 在数据库新增对话记录表，按 `user_id` + `session_id` 持久化存储对话历史 |

---

## 🧩 扩展指南（如何新增功能）

### 🚫 绝对不要修改的文件

| 文件 | 原因 |
|------|------|
| `app/__init__.py` | 应用工厂核心，改动可能影响全局初始化流程。如需注册新蓝图，在 `create_app()` 函数内已有注册代码的旁边**新增一行**即可，不要修改已有逻辑 |
| `run.py` | 项目入口，改动可能导致部署失败 |

### ✅ 推荐的新增方式

#### 新增接口（路由）

1. 在 `app/routes/` 下新建一个 `.py` 文件（例如 `social.py`），写入你的新接口：

```python
# app/routes/social.py
from flask import Blueprint, request, jsonify

# 创建一个蓝图（Blueprint，就是把一组相关接口打包成一个模块）
social_bp = Blueprint('social', __name__, url_prefix='/api/social')

@social_bp.route('/share', methods=['POST'])
def share_restaurant():
    """分享餐厅给好友（示例）"""
    data = request.get_json()
    # 你的业务逻辑...
    return jsonify({'message': '分享成功'})
```

2. 在 `app/__init__.py` 中注册这个蓝图（在已有注册代码旁边加一行）：
```python
from app.routes.social import social_bp
app.register_blueprint(social_bp)
```

#### 新增外部服务调用

在 `app/services/` 下新建文件（如 `weather_service.py`），封装调用逻辑，然后在需要的路由中导入使用。

#### 新增数据库表

在 `app/models.py` 中添加新的模型类（参考已有的 `User`、`Restaurant` 等），然后删除 `foodmap.db` 文件并重新运行 `python run.py` 即可自动建表（⚠️ 这会清空已有数据）。更好的做法是引入 Flask-Migrate 做数据库迁移（就是当你的表格结构变了，能自动更新数据库，不用手动删库重建）。

---

## 🌐 部署指南（本地预览/公网占位）

### 本地生产模式运行

开发时用 `python run.py` 即可。若要模拟生产环境，可使用 **Gunicorn**（一个专业的 Python 应用服务器，就像把 Flask 这辆"玩具车"换成能上高速的"真车"）：

```bash
# 安装 Gunicorn
pip install gunicorn

# 启动（--bind 指定监听地址和端口，app:create_app() 告诉 Gunicorn 应用入口在哪里）
gunicorn --bind 0.0.0.0:8000 "app:create_app()"
```

### 公网部署

> 🔗 **公网访问地址**：`[部署后请在此填写，例如 https://foodmap-api.onrender.com]`
>
> 🖥 **部署平台**：`[Render / PythonAnywhere / Railway，待填写]`
>
> 🛠 **部署注意事项**：
> 1. **环境变量**：在部署平台的控制台（Settings → Environment Variables）中设置 `GAODE_API_KEY`、`ZHIPU_API_KEY` 等，不要上传 `.env` 文件。
> 2. **数据库路径**：确保 `foodmap.db` 的路径对应用户有写入权限。
> 3. **启动命令**：
>    - **Render**：`gunicorn "app:create_app()" --bind 0.0.0.0:$PORT`
>    - **PythonAnywhere**：需要配置 WSGI 文件指向 `app.create_app()`。
> 4. **免费额度**：Render 免费计划提供 750 小时/月运行时长，15 分钟无访问会自动休眠（下次请求需约 30~50 秒冷启动）。PythonAnywhere 免费账户的 Web 应用有效期为 1 个月，需定期登录续期。具体政策变动请以各平台官方公告为准。

---

## 📝 待办与改进计划

- [ ] 引入 JWT 实现安全的用户认证
- [ ] 密码哈希存储
- [ ] 输入验证与全局错误处理
- [ ] 对话历史服务端持久化
- [ ] 引入 Flask-Migrate 管理数据库迁移
- [ ] 添加操作日志
- [ ] 编写自动化测试用例

---

## 📞 联系与协作

- **后端负责人**：[你的名字]
- **前端协作**：请将 API 调用的 `base URL` 替换为上方公网地址
- **反馈问题**：请在 GitHub 仓库的 Issues 页面提交 Bug 或功能建议
- **API 调试工具推荐**：[Postman](https://www.postman.com/) 或直接在终端使用 `curl` 命令测试

---

