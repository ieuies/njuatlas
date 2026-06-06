var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// js/config.js
function loadAmapScript() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!AMAP_KEY || AMAP_KEY === "YOUR_AMAP_KEY") {
    console.warn("AMAP_KEY is not configured. Map view will wait until a valid key is set.");
    return Promise.resolve(null);
  }
  const existing = document.querySelector('script[data-amap-loader="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(window.AMap));
      existing.addEventListener("error", reject);
    });
  }
  return new Promise((resolve, reject) => {
    if (AMAP_SECURITY_CODE) {
      window._AMapSecurityConfig = {
        securityJsCode: AMAP_SECURITY_CODE
      };
    }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}`;
    script.async = true;
    script.defer = true;
    script.dataset.amapLoader = "true";
    script.onload = () => resolve(window.AMap);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
var LOCAL_API_BASE, RENDER_API_BASE, runtimeConfig, hostname, isLocal, API_BASE, AMAP_KEY, AMAP_SECURITY_CODE;
var init_config = __esm({
  "js/config.js"() {
    LOCAL_API_BASE = "http://localhost:5000/api";
    RENDER_API_BASE = "https://api.njuatlas.cn/api";
    runtimeConfig = window.NJUATLAS_CONFIG || {};
    hostname = window.location.hostname;
    isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "";
    API_BASE = runtimeConfig.API_BASE || (isLocal ? LOCAL_API_BASE : RENDER_API_BASE);
    AMAP_KEY = runtimeConfig.AMAP_KEY || "97ac6e711cde17463af06c10b8b05f42";
    AMAP_SECURITY_CODE = runtimeConfig.AMAP_SECURITY_CODE || "";
  }
});

// js/utils.js
function showToast(msg, duration = 2500) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>]/g, function(m) {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    return m;
  });
}
function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}
function _transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  ret += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return ret;
}
function _transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  ret += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return ret;
}
function _outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function wgs84ToGcj02(lng, lat) {
  if (_outOfChina(lng, lat)) {
    return [lng, lat];
  }
  let dlat = _transformLat(lng - 105, lat - 35);
  let dlng = _transformLng(lng - 105, lat - 35);
  const radlat = lat / 180 * PI;
  let magic = Math.sin(radlat);
  magic = 1 - EE * magic * magic;
  const sqrtmagic = Math.sqrt(magic);
  dlat = dlat * 180 / (A * (1 - EE) / (magic * sqrtmagic) * PI);
  dlng = dlng * 180 / (A / sqrtmagic * Math.cos(radlat) * PI);
  return [lng + dlng, lat + dlat];
}
var PI, X_PI, A, EE;
var init_utils = __esm({
  "js/utils.js"() {
    init_config();
    PI = Math.PI;
    X_PI = PI * 3e3 / 180;
    A = 6378245;
    EE = 0.006693421622965943;
  }
});

// js/api.js
var api_exports = {};
__export(api_exports, {
  addPostComment: () => addPostComment,
  changePassword: () => changePassword,
  chatRecommend: () => chatRecommend,
  createPost: () => createPost,
  deleteAccount: () => deleteAccount,
  deleteConversation: () => deleteConversation,
  deletePost: () => deletePost,
  deletePostComment: () => deletePostComment,
  getAuthToken: () => getAuthToken,
  getConversationList: () => getConversationList,
  getConversationMessages: () => getConversationMessages,
  getFavorites: () => getFavorites,
  getLikes: () => getLikes,
  getMyPostComments: () => getMyPostComments,
  getMyProfile: () => getMyProfile,
  getPost: () => getPost,
  getReviews: () => getReviews,
  listPosts: () => listPosts,
  listTags: () => listTags,
  login: () => login,
  logout: () => logout,
  participateEvent: () => participateEvent,
  register: () => register,
  requestEmailVerification: () => requestEmailVerification,
  requestPasswordResetCode: () => requestPasswordResetCode,
  requestRegisterCode: () => requestRegisterCode,
  resetPassword: () => resetPassword,
  searchPlaces: () => searchPlaces,
  setAuthToken: () => setAuthToken,
  togglePostLike: () => togglePostLike,
  updateMyProfile: () => updateMyProfile,
  updatePost: () => updatePost
});
function setAuthToken(token) {
  authToken = token;
  if (token) localStorage.setItem("access_token", token);
  else localStorage.removeItem("access_token");
}
function getAuthToken() {
  return authToken;
}
async function request(endpoint, method = "GET", body = null, needAuth = true, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { "Content-Type": "application/json" };
  if (needAuth && authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const options = { method, headers, signal: controller.signal };
  if (body) options.body = JSON.stringify(body);
  try {
    const res = await fetch(url, options);
    clearTimeout(timeoutId);
    let data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      const text = await res.text();
      console.error("API\u975EJSON\u54CD\u5E94:", res.status, text);
      throw new Error(`\u670D\u52A1\u5668\u8FD4\u56DE\u5F02\u5E38 (${res.status})`);
    }
    if (!res.ok) {
      if (res.status === 401 && needAuth) {
        throw new Error("UNAUTHORIZED");
      }
      throw new Error(data.message || `\u8BF7\u6C42\u5931\u8D25: ${res.status}`);
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      err = new Error("\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    }
    if (err.message === "UNAUTHORIZED") throw err;
    console.error("API\u8BF7\u6C42\u9519\u8BEF:", err);
    showToast(err.message || "\u7F51\u7EDC\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u540E\u7AEF\u662F\u5426\u542F\u52A8");
    throw err;
  }
}
async function register(username, email, password, code) {
  return request("/user/register", "POST", { username, email, password, code }, false);
}
async function login(email, password) {
  return request("/user/login", "POST", { email, password }, false, LOGIN_TIMEOUT_MS);
}
async function logout() {
  return request("/user/logout", "POST", null, true);
}
async function requestEmailVerification() {
  return request("/user/email/verification", "POST");
}
async function requestRegisterCode(email) {
  return request("/user/email/code", "POST", { email, purpose: "register" }, false);
}
async function requestPasswordResetCode(email) {
  return request("/user/email/code", "POST", { email, purpose: "reset_password" }, false);
}
async function resetPassword(email, code, newPassword) {
  return request("/user/password/reset", "POST", { email, code, new_password: newPassword }, false);
}
async function changePassword(currentPassword, newPassword) {
  return request("/user/password/change", "POST", { current_password: currentPassword, new_password: newPassword });
}
async function deleteAccount(password) {
  return request("/user/account", "DELETE", { password });
}
async function getMyProfile() {
  return request("/me/profile", "GET");
}
async function updateMyProfile({ username, bio, campus, tags } = {}) {
  return request("/me/profile", "PUT", { username, bio, campus, tags });
}
async function searchPlaces(keyword, city = "\u5357\u4EAC", location = null, page = 1, pageSize = 25, radius = null, types = null, sortrule = null) {
  let url = `/places/search?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`;
  if (city) url += `&city=${encodeURIComponent(city)}`;
  if (location) url += `&location=${encodeURIComponent(location)}`;
  if (radius) url += `&radius=${encodeURIComponent(radius)}`;
  if (types) url += `&types=${encodeURIComponent(types)}`;
  if (sortrule) url += `&sortrule=${encodeURIComponent(sortrule)}`;
  return request(url, "GET", null, false);
}
async function chatRecommend(message, sessionId = null, city = "\u5357\u4EAC") {
  const body = { message, city };
  if (sessionId) body.session_id = sessionId;
  return request("/llm/chat_recommend", "POST", body);
}
async function createPost({ type, title, content, tags, place_id, event_time, urgency, location, location_name, slots, budget, contact } = {}) {
  return request("/posts", "POST", { type, title, content, tags, place_id, event_time, urgency, location, location_name, slots, budget, contact });
}
async function listPosts({ type, tags, place_id, sort, lat, lng, radius, user_id, page, page_size } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (tags) params.set("tags", Array.isArray(tags) ? tags.join(",") : tags);
  if (place_id) params.set("place_id", place_id);
  if (sort) params.set("sort", sort);
  if (lat) params.set("lat", lat);
  if (lng) params.set("lng", lng);
  if (radius) params.set("radius", radius);
  if (user_id) params.set("user_id", user_id);
  if (page) params.set("page", page);
  if (page_size) params.set("page_size", page_size);
  const qs = params.toString();
  return request(`/posts${qs ? "?" + qs : ""}`, "GET", null, true);
}
async function getPost(postId) {
  return request(`/posts/${postId}`, "GET", null, true);
}
async function updatePost(postId, data) {
  return request(`/posts/${postId}`, "PUT", data);
}
async function deletePost(postId) {
  return request(`/posts/${postId}`, "DELETE");
}
async function togglePostLike(postId) {
  return request(`/posts/${postId}/like`, "POST");
}
async function addPostComment(postId, content, parentId = null) {
  return request(`/posts/${postId}/comments`, "POST", { content, parent_id: parentId });
}
async function deletePostComment(postId, commentId) {
  return request(`/posts/${postId}/comments/${commentId}`, "DELETE");
}
async function participateEvent(postId, status = "going") {
  return request(`/posts/${postId}/participate`, "POST", { status });
}
async function listTags(category = null) {
  const qs = category ? `?category=${category}` : "";
  return request(`/tags${qs}`, "GET", null, false);
}
async function getFavorites() {
  return request("/me/favorites", "GET");
}
async function getLikes() {
  return request("/me/likes", "GET");
}
async function getReviews() {
  return request("/me/reviews", "GET");
}
async function getMyPostComments() {
  return request("/me/post-comments", "GET");
}
async function getConversationList() {
  return request("/me/conversations", "GET");
}
async function getConversationMessages(sessionId) {
  return request(`/llm/conversation/${sessionId}/messages`, "GET");
}
async function deleteConversation(sessionId) {
  return request(`/llm/conversation/${sessionId}`, "DELETE");
}
var authToken, DEFAULT_TIMEOUT_MS, LOGIN_TIMEOUT_MS;
var init_api = __esm({
  "js/api.js"() {
    init_config();
    init_utils();
    authToken = localStorage.getItem("access_token") || null;
    DEFAULT_TIMEOUT_MS = 12e3;
    LOGIN_TIMEOUT_MS = 1e4;
  }
});

// js/auth.js
var auth_exports = {};
__export(auth_exports, {
  doLogin: () => doLogin,
  doLogout: () => doLogout,
  doRegister: () => doRegister,
  getUser: () => getUser,
  isLoggedIn: () => isLoggedIn,
  resendVerificationEmail: () => resendVerificationEmail,
  updateUserFromLogin: () => updateUserFromLogin
});
function readStoredUser() {
  try {
    const raw = localStorage.getItem("current_user");
    if (raw) return JSON.parse(raw);
    const token = getAuthToken();
    if (!token) return null;
    const payloadPart = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = payloadPart.padEnd(payloadPart.length + (4 - payloadPart.length % 4) % 4, "=");
    const payload = JSON.parse(atob(paddedPayload));
    return {
      id: Number(payload.sub) || null,
      email: payload.email || "",
      username: payload.email ? payload.email.split("@")[0] : "",
      email_verified: false,
      campus: ""
    };
  } catch (e) {
    localStorage.removeItem("current_user");
    return null;
  }
}
function persistUser(user) {
  currentUser = user;
  if (user) localStorage.setItem("current_user", JSON.stringify(user));
  else localStorage.removeItem("current_user");
}
function userFromAuthPayload(data, fallback = {}) {
  return {
    id: data.id ?? fallback.id ?? null,
    email: data.email ?? fallback.email ?? "",
    username: data.username ?? fallback.username ?? "",
    email_verified: Boolean(data.email_verified ?? fallback.email_verified),
    campus: data.campus ?? fallback.campus ?? ""
  };
}
function isLoggedIn() {
  return !!getAuthToken();
}
function getUser() {
  return currentUser;
}
async function doLogin(email, password) {
  const data = await login(email, password);
  setAuthToken(data.access_token);
  persistUser(userFromAuthPayload(data, { email }));
  return currentUser;
}
async function doRegister(username, email, password, code) {
  const data = await register(username, email, password, code);
  if (!data.access_token) {
    persistUser(data.user || {
      email,
      username,
      email_verified: false
    });
    return currentUser;
  }
  setAuthToken(data.access_token);
  persistUser(userFromAuthPayload(data, { email, username }));
  return currentUser;
}
async function doLogout() {
  try {
    await logout();
  } catch (e) {
  }
  setAuthToken(null);
  persistUser(null);
}
async function resendVerificationEmail() {
  await requestEmailVerification();
  showToast("\u9A8C\u8BC1\u90AE\u4EF6\u5DF2\u53D1\u9001\uFF0C\u8BF7\u67E5\u6536");
}
function updateUserFromLogin(data) {
  persistUser(userFromAuthPayload(data, currentUser || {}));
}
var currentUser;
var init_auth = __esm({
  "js/auth.js"() {
    init_api();
    init_utils();
    currentUser = readStoredUser();
  }
});

// js/pages/partner.js
var partner_exports = {};
__export(partner_exports, {
  initPartnerPage: () => initPartnerPage,
  loadPartnerData: () => loadPartnerData,
  openPostDetail: () => openPostDetail
});
function _getMapCenter() {
  const user = getUser();
  const campus = user?.campus || "";
  const coords = CAMPUS_COORDS[campus];
  if (coords) return wgs84ToGcj02(coords[0], coords[1]);
  return wgs84ToGcj02(118.78, 32.058);
}
function _categoryStyle(cat) {
  if (!cat) return { color: "#999", icon: "", tagClass: "tag-default" };
  if (!categoryColorCache[cat]) {
    const hue = [...cat].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    categoryColorCache[cat] = {
      color: `hsl(${hue}, 65%, 50%)`,
      icon: "",
      tagClass: "tag-dynamic"
    };
  }
  return categoryColorCache[cat];
}
function _typeEmoji(category) {
  return TYPE_EMOJI[category] || "\u{1F465}";
}
function _typeLabel(post) {
  const emoji = _typeEmoji(post.category);
  if (post.type === "event") return `${emoji} \u6D3B\u52A8\u7EC4\u5C40`;
  return `${emoji} \u957F\u671F\u62DB\u52DF`;
}
function _isCurrentUserOwner(item) {
  const user = getUser();
  if (!item || !user) return Boolean(item?.is_owner);
  const currentId = user.id ?? user.user_id;
  const ownerId = item.user_id ?? item.author_id ?? item.owner_id ?? item.user?.id;
  return Boolean(item.is_owner || currentId != null && ownerId != null && String(currentId) === String(ownerId));
}
async function loadPostsFromAPI() {
  try {
    const params = { sort: "hot", page_size: 100 };
    if (currentCategory !== "all") {
      params.tags = currentCategory;
    }
    const result = await listPosts(params);
    partnersData = (result.items || []).map(_mapPost);
    return partnersData;
  } catch (err) {
    console.warn("\u52A0\u8F7D\u5E16\u5B50\u5931\u8D25\uFF0C\u4F7F\u7528\u7A7A\u5217\u8868:", err.message);
    partnersData = [];
    return [];
  }
}
function _mapPost(p) {
  return {
    id: p.id,
    type: p.type,
    category: p.tags && p.tags.length > 0 ? p.tags[0] : "\u5176\u4ED6",
    tags: p.tags || [],
    title: p.title,
    description: p.content,
    location: p.location_name || "",
    lnglat: p.location ? p.location.split(",").map(Number) : null,
    // "lng,lat"
    urgency: p.urgency || null,
    time: _formatPostTime(p.event_time, p.urgency),
    publisher: p.username || "\u533F\u540D\u540C\u5B66",
    publisherId: p.user_id,
    members: p.participant_count || 0,
    slots: p.max_participants || 1,
    budget: p.budget || "",
    contact: p.contact || "",
    views: p.view_count || 0,
    likeCount: p.like_count || 0,
    commentCount: p.comment_count || 0,
    hotScore: p.hot_score || 0,
    isLiked: p.is_liked || false,
    isOwner: _isCurrentUserOwner(p),
    participationStatus: p.participation_status,
    createdAt: formatDate(p.created_at),
    nearby: ""
    // 预留：后续可关联场所推荐
  };
}
function _formatPostTime(iso, urgency) {
  if (urgency === "now") return "\u7ACB\u5373";
  if (urgency === "long_term") return "\u957F\u671F\u6709\u6548";
  if (!iso) return urgency === "scheduled" ? "\u5DF2\u8BBE\u5B9A" : "";
  const d = new Date(iso);
  const now = /* @__PURE__ */ new Date();
  const diffDays = Math.floor((d - now) / (1e3 * 60 * 60 * 24));
  const time = d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short" });
  if (diffDays === 0) return `\u4ECA\u5929 ${time.split(" ")[1] || ""}`;
  if (diffDays === 1) return `\u660E\u5929 ${time.split(" ")[1] || ""}`;
  return time;
}
async function ensureAMap() {
  if (window.AMap) return window.AMap;
  try {
    await loadAmapScript();
    if (window.AMap) return window.AMap;
    throw new Error("AMap SDK \u52A0\u8F7D\u540E window.AMap \u4ECD\u7136\u4E0D\u53EF\u7528");
  } catch (err) {
    console.warn("\u9AD8\u5FB7\u5730\u56FE\u52A0\u8F7D\u5931\u8D25:", err.message);
    throw err;
  }
}
function createMapInstance(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  container.innerHTML = "";
  const center = _getMapCenter();
  return new window.AMap.Map(containerId, {
    zoom: 15,
    center,
    mapStyle: "amap://styles/light",
    resizeEnable: true
  });
}
function addMarkersToMap(map, data) {
  map.clearMap();
  if (!data.length) return [];
  const markers = [];
  data.forEach((post) => {
    const coords = post.lnglat;
    if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
      return;
    }
    const style = _categoryStyle(post.category);
    const marker = new window.AMap.Marker({
      position: coords,
      title: post.title,
      icon: new window.AMap.Icon({
        size: new window.AMap.Size(32, 32),
        image: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='12' fill='${encodeURIComponent(style.color)}' stroke='white' stroke-width='3' /%3E%3C/svg%3E`,
        imageSize: new window.AMap.Size(32, 32)
      }),
      offset: new window.AMap.Pixel(-16, -16),
      zIndex: 100
    });
    marker.on("click", () => {
      const infoContent = `
                <div class="amap-info-content" style="max-width:240px;font-size:0.85rem;">
                    <strong style="color:${style.color};">${escapeHtml(post.category)}</strong>
                    <div style="font-weight:700;margin:4px 0;">${escapeHtml(post.title)}</div>
                    <div style="color:#666;">${escapeHtml(post.description).substring(0, 80)}</div>
                    ${post.time ? `<div>\u65F6\u95F4\uFF1A${escapeHtml(post.time)}</div>` : ""}
                    <button id="map-join-${post.id}" style="margin-top:8px;padding:6px 14px;background:#6B21A5;color:white;border:none;border-radius:12px;cursor:pointer;font-size:0.8rem;">\u6211\u8981\u53C2\u52A0</button>
                </div>
            `;
      const infoWindow = new window.AMap.InfoWindow({
        content: infoContent,
        offset: new window.AMap.Pixel(0, -36)
      });
      infoWindow.open(map, coords);
      setTimeout(() => {
        const btn = document.getElementById(`map-join-${post.id}`);
        if (btn) {
          btn.addEventListener("click", () => handleParticipate(post.id));
        }
      }, 100);
    });
    marker.setMap(map);
    markers.push(marker);
  });
  return markers;
}
async function initPreviewMap() {
  try {
    await ensureAMap();
    if (!previewMap) {
      previewMap = createMapInstance("previewMap");
    }
    if (previewMap) {
      const filtered = currentCategory === "all" ? partnersData : partnersData.filter((p) => p.tags.includes(currentCategory));
      addMarkersToMap(previewMap, filtered);
    }
  } catch (err) {
    console.warn("\u9884\u89C8\u5730\u56FE\u521D\u59CB\u5316\u5931\u8D25:", err);
  }
}
async function refreshPreviewMarkers() {
  if (!previewMap) {
    await initPreviewMap();
    return;
  }
  const filtered = currentCategory === "all" ? partnersData : partnersData.filter((p) => p.tags.includes(currentCategory));
  addMarkersToMap(previewMap, filtered);
}
async function initFullMapMarkers() {
  try {
    await ensureAMap();
    const container = document.getElementById("fullMap");
    if (!container || container.offsetWidth === 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!fullMapInstance) {
      fullMapInstance = createMapInstance("fullMap");
    }
    if (fullMapInstance) {
      addMarkersToMap(fullMapInstance, partnersData);
      setTimeout(() => fullMapInstance?.resize(), 100);
    }
  } catch (err) {
    console.warn("\u5168\u5C4F\u5730\u56FE\u521D\u59CB\u5316\u5931\u8D25:", err);
  }
}
function renderWaterfall() {
  const container = document.getElementById("partnerWaterfall");
  if (!container) return;
  const filtered = currentCategory === "all" ? partnersData : partnersData.filter((p) => p.tags.includes(currentCategory));
  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-tertiary);grid-column:1/-1;">\u6682\u65E0\u7EC4\u5C40\uFF0C\u5FEB\u6765\u53D1\u8D77\u7B2C\u4E00\u4E2A\u5427~</div>';
    return;
  }
  container.innerHTML = filtered.map((p) => `
        <article class="partner-card partner-brief-card" data-id="${p.id}">
            <div class="partner-card-content">
                <div class="partner-card-head">
                    <div class="partner-card-tags">
                        ${p.tags.filter((t) => !/^[\d¥￥]/.test(t) && !["AA", "\u514D\u8D39", "\u81EA\u8D39"].includes(t)).slice(0, 3).map((t) => `<span class="partner-card-tag">${escapeHtml(t)}</span>`).join("")}
                    </div>
                    <span class="partner-card-type">${_typeLabel(p)}</span>
                </div>
                <h3 class="partner-card-title">${escapeHtml(p.title)}</h3>
                <p class="partner-card-desc">${escapeHtml(p.description).substring(0, 120)}</p>
                <div class="partner-card-meta" aria-label="\u7EC4\u5C40\u4FE1\u606F">
                    ${p.location ? `<span><b>\u5730\u70B9</b><em>${escapeHtml(p.location)}</em></span>` : ""}
                    ${p.budget ? `<span><b>\u9884\u7B97</b><em>${escapeHtml(p.budget)}</em></span>` : ""}
                    ${p.time ? `<span><b>\u65F6\u95F4</b><em>${escapeHtml(p.time)}</em></span>` : ""}
                    <span><b>\u53D1\u8D77\u4EBA</b><em>${escapeHtml(p.publisher)}${p.isOwner ? " \u{1F451}" : ""}</em></span>
                </div>
                <div class="partner-card-footer">
                    <div class="partner-card-stats">
                        <span>\u{1F441} ${p.views}</span>
                        <span>\u{1F44D} ${p.likeCount}</span>
                        <span>\u{1F4AC} ${p.commentCount}</span>
                        <span>\u{1F465} ${p.members}/${p.slots}</span>
                    </div>
                    ${p.isOwner ? `
                        <button class="join-btn owner-delete-btn" data-id="${p.id}">
                            \u{1F5D1}\uFE0F \u5220\u9664\u6D3B\u52A8
                        </button>
                    ` : `
                        <button class="join-btn" data-id="${p.id}">
                            ${p.type === "event" ? p.participationStatus === "going" ? "\u2705 \u5DF2\u62A5\u540D\xB7\u70B9\u6B64\u53D6\u6D88" : "\u6211\u8981\u53C2\u52A0" : p.participationStatus === "going" ? "\u2705 \u5DF2\u5173\u6CE8\xB7\u70B9\u6B64\u53D6\u6D88" : "\u611F\u5174\u8DA3"}
                        </button>
                    `}
                </div>
            </div>
        </article>
    `).join("");
  container.querySelectorAll(".owner-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _deletePostCard(parseInt(btn.getAttribute("data-id")));
    });
  });
  container.querySelectorAll(".join-btn:not(.owner-delete-btn)").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleParticipate(parseInt(btn.getAttribute("data-id")));
    });
  });
  container.querySelectorAll(".partner-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const pid = parseInt(card.getAttribute("data-id"));
      if (pid) openPostDetail(pid);
    });
  });
}
async function handleParticipate(postId) {
  if (!isLoggedIn()) {
    showToast("\u8BF7\u5148\u767B\u5F55");
    const authModal = document.getElementById("authModal");
    if (authModal) authModal.style.display = "flex";
    return;
  }
  try {
    const result = await participateEvent(postId, "going");
    _applyParticipationResult(postId, result);
    if (result.status === "going") {
      showToast("\u62A5\u540D\u6210\u529F");
    } else if (result.status === null) {
      showToast("\u5DF2\u53D6\u6D88\u62A5\u540D");
    }
    renderWaterfall();
    const latestStatus = result.status ?? null;
    await loadPostsFromAPI();
    const updated = partnersData.find((p) => p.id === postId);
    if (updated && latestStatus === "going" && updated.participationStatus !== "going") {
      updated.participationStatus = latestStatus;
    }
    renderWaterfall();
    refreshPreviewMarkers();
  } catch (err) {
    showToast("\u64CD\u4F5C\u5931\u8D25: " + err.message);
  }
}
function _applyParticipationResult(postId, result) {
  const post = partnersData.find((p) => p.id === postId);
  if (!post) return;
  post.participationStatus = result.status ?? null;
  if (typeof result.participant_count === "number") {
    post.members = result.participant_count;
  } else if (result.status === "going") {
    post.members += 1;
  } else if (result.status === null && post.members > 0) {
    post.members -= 1;
  }
}
async function _deletePostCard(postId) {
  if (!confirm("\u26A0\uFE0F \u786E\u5B9A\u8981\u5220\u9664\u8FD9\u6761\u7EC4\u5C40\u5417\uFF1F\n\n\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\uFF0C\u6240\u6709\u8BC4\u8BBA\u548C\u62A5\u540D\u6570\u636E\u5C06\u88AB\u6C38\u4E45\u5220\u9664\u3002")) return;
  try {
    await deletePost(postId);
    showToast("\u5DF2\u5220\u9664");
    partnersData = await loadPostsFromAPI();
    renderWaterfall();
    refreshPreviewMarkers();
  } catch (err) {
    showToast("\u5220\u9664\u5931\u8D25: " + err.message);
  }
}
function initPostDetailModal() {
  const modal = document.getElementById("postDetailModal");
  if (!modal) return;
  const closeBtn = document.getElementById("closePostDetailBtn");
  const likeBtn = document.getElementById("detailLikeBtn");
  const participateBtn = document.getElementById("detailParticipateBtn");
  const commentInput = document.getElementById("detailCommentInput");
  const commentSubmitBtn = document.getElementById("detailCommentSubmitBtn");
  closeBtn?.addEventListener("click", () => {
    modal.style.display = "none";
    currentDetailPost = null;
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      currentDetailPost = null;
    }
  });
  likeBtn?.addEventListener("click", async () => {
    if (!currentDetailPost) return;
    if (!isLoggedIn()) {
      showToast("\u8BF7\u5148\u767B\u5F55");
      return;
    }
    try {
      const result = await togglePostLike(currentDetailPost.id);
      currentDetailPost.is_liked = result.liked;
      currentDetailPost.like_count = result.like_count;
      _updateDetailStats();
      likeBtn.classList.toggle("liked", result.liked);
      likeBtn.textContent = result.liked ? "\u5DF2\u70B9\u8D5E" : "\u70B9\u8D5E";
    } catch (err) {
      showToast("\u64CD\u4F5C\u5931\u8D25: " + err.message);
    }
  });
  participateBtn?.addEventListener("click", async () => {
    if (!currentDetailPost || currentDetailPost.type !== "event") return;
    if (!isLoggedIn()) {
      showToast("\u8BF7\u5148\u767B\u5F55");
      return;
    }
    try {
      const result = await participateEvent(currentDetailPost.id, "going");
      currentDetailPost.participation_status = result.status;
      currentDetailPost.participant_count = result.participant_count;
      _applyParticipationResult(currentDetailPost.id, result);
      _updateDetailStats();
      const going = result.status === "going";
      participateBtn.textContent = going ? "\u5DF2\u62A5\u540D\uFF0C\u70B9\u51FB\u53D6\u6D88" : "\u6211\u8981\u53C2\u52A0";
      participateBtn.classList.toggle("going", going);
      await _refreshDetailParticipants(currentDetailPost.id);
      renderWaterfall();
      refreshPreviewMarkers();
    } catch (err) {
      showToast("\u64CD\u4F5C\u5931\u8D25: " + err.message);
    }
  });
  commentSubmitBtn?.addEventListener("click", async () => {
    const content = commentInput.value.trim();
    if (!content) {
      showToast("\u8BF7\u8F93\u5165\u8BC4\u8BBA\u5185\u5BB9");
      return;
    }
    if (!currentDetailPost) return;
    if (!isLoggedIn()) {
      showToast("\u8BF7\u5148\u767B\u5F55");
      return;
    }
    try {
      await addPostComment(currentDetailPost.id, content);
      commentInput.value = "";
      showToast("\u8BC4\u8BBA\u53D1\u8868\u6210\u529F");
      await _refreshDetailComments(currentDetailPost.id);
    } catch (err) {
      showToast("\u8BC4\u8BBA\u5931\u8D25: " + err.message);
    }
  });
  document.getElementById("detailEditBtn")?.addEventListener("click", () => {
    if (!currentDetailPost) return;
    _openEditPostModal(currentDetailPost);
  });
  document.getElementById("detailDeleteBtn")?.addEventListener("click", async () => {
    if (!currentDetailPost) return;
    if (!confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u6761\u7EC4\u5C40\u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002")) return;
    try {
      await deletePost(currentDetailPost.id);
      showToast("\u5DF2\u5220\u9664");
      document.getElementById("postDetailModal").style.display = "none";
      currentDetailPost = null;
      partnersData = await loadPostsFromAPI();
      renderWaterfall();
      refreshPreviewMarkers();
    } catch (err) {
      showToast("\u5220\u9664\u5931\u8D25: " + err.message);
    }
  });
}
function _openEditPostModal(post) {
  const modal = document.getElementById("partnerModal");
  if (!modal) return;
  document.getElementById("postDetailModal").style.display = "none";
  document.getElementById("partnerCategory").value = post.tags && post.tags[0] ? post.tags[0] : "";
  document.getElementById("partnerTitle").value = post.title || "";
  document.getElementById("partnerDesc").value = post.content || "";
  document.getElementById("partnerLocation").value = post.location_name || "";
  document.getElementById("partnerBudget").value = post.budget || "";
  document.getElementById("partnerSlots").value = post.max_participants || 1;
  document.getElementById("partnerContact").value = post.contact || "";
  _modalDuration = post.type === "forum" ? "long" : "short";
  const durationBtns = document.querySelectorAll("#durationRow .time-mode-btn");
  durationBtns.forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-duration") === _modalDuration);
  });
  const timeModeRow = document.getElementById("timeModeRow");
  if (timeModeRow) timeModeRow.style.display = _modalDuration === "long" ? "none" : "flex";
  _modalUrgency = post.urgency === "scheduled" ? "scheduled" : "now";
  const timeModeBtns = document.querySelectorAll("#timeModeRow .time-mode-btn");
  timeModeBtns.forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-mode") === _modalUrgency);
  });
  const scheduledRow = document.getElementById("scheduledTimeRow");
  if (scheduledRow) {
    scheduledRow.style.display = _modalUrgency === "scheduled" ? "flex" : "none";
  }
  if (post.event_time) {
    const d = new Date(post.event_time);
    document.getElementById("partnerDate").value = d.toISOString().split("T")[0];
    const time = d.toTimeString().split(" ")[0].substring(0, 5);
    document.getElementById("partnerTimePicker").value = time;
  }
  _modalLocationCoords = post.location || null;
  modal.setAttribute("data-edit-id", post.id);
  modal.style.display = "flex";
}
async function openPostDetail(postId) {
  const modal = document.getElementById("postDetailModal");
  if (!modal) return;
  modal.style.display = "flex";
  _resetDetailUI();
  try {
    const post = await getPost(postId);
    currentDetailPost = post;
    _renderPostDetail(post);
  } catch (err) {
    showToast("\u52A0\u8F7D\u5E16\u5B50\u8BE6\u60C5\u5931\u8D25: " + err.message);
    modal.style.display = "none";
    currentDetailPost = null;
  }
}
function _resetDetailUI() {
  document.getElementById("detailTitle").textContent = "\u52A0\u8F7D\u4E2D...";
  document.getElementById("detailBody").textContent = "";
  document.getElementById("detailTags").innerHTML = "";
  document.getElementById("detailPublisher").textContent = "";
  document.getElementById("detailTime").textContent = "";
  document.getElementById("detailLocation").textContent = "";
  document.getElementById("detailBudget").textContent = "";
  document.getElementById("detailBudget").style.display = "none";
  document.getElementById("detailContact").textContent = "";
  document.getElementById("detailContact").style.display = "none";
  document.getElementById("detailComments").innerHTML = "";
  document.getElementById("detailParticipants").innerHTML = "";
  document.getElementById("detailParticipantsSection").style.display = "none";
  document.getElementById("detailParticipateBtn").style.display = "none";
  document.getElementById("detailLikeBtn").classList.remove("liked");
  document.getElementById("detailLikeBtn").textContent = "\u70B9\u8D5E";
  document.getElementById("detailParticipateBtn").textContent = "\u6211\u8981\u53C2\u52A0";
  document.getElementById("detailParticipateBtn").classList.remove("going");
}
function _renderPostDetail(post) {
  document.getElementById("detailTitle").textContent = post.title;
  document.getElementById("detailBody").innerHTML = safeHtmlWithBreaks(post.content || "");
  const tags = post.tags || [];
  document.getElementById("detailTags").innerHTML = tags.map(
    (t) => `<span class="post-detail-tag">${escapeHtml(t)}</span>`
  ).join("");
  document.getElementById("detailPublisher").innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.username || "\u533F\u540D")}`;
  const timeStr = _formatPostTime(post.event_time, post.urgency);
  document.getElementById("detailTime").innerHTML = `<i class="fas fa-clock"></i> ${escapeHtml(timeStr)}`;
  if (post.location_name) {
    document.getElementById("detailLocation").innerHTML = `<i class="fas fa-map-pin"></i> ${escapeHtml(post.location_name)}`;
  }
  if (post.budget) {
    document.getElementById("detailBudget").innerHTML = `<i class="fas fa-yen-sign"></i> ${escapeHtml(post.budget)}`;
    document.getElementById("detailBudget").style.display = "";
  } else {
    document.getElementById("detailBudget").style.display = "none";
  }
  if (post.contact) {
    document.getElementById("detailContact").innerHTML = `<i class="fas fa-address-book"></i> ${escapeHtml(post.contact)}`;
    document.getElementById("detailContact").style.display = "";
  } else {
    document.getElementById("detailContact").style.display = "none";
  }
  _updateDetailStats();
  const slots = post.max_participants || 1;
  document.getElementById("detailParticipantCount").textContent = `${post.participant_count || 0}/${slots}\u4EBA`;
  const likeBtn = document.getElementById("detailLikeBtn");
  if (post.is_liked) {
    likeBtn.classList.add("liked");
    likeBtn.textContent = "\u5DF2\u70B9\u8D5E";
  }
  const participateBtn = document.getElementById("detailParticipateBtn");
  const ownerActions = document.getElementById("detailOwnerActions");
  if (post.is_owner) {
    participateBtn.style.display = "none";
    if (ownerActions) ownerActions.style.display = "flex";
  } else {
    if (post.type === "event") {
      participateBtn.style.display = "block";
      const going = post.participation_status === "going";
      participateBtn.textContent = going ? "\u5DF2\u62A5\u540D\uFF0C\u70B9\u51FB\u53D6\u6D88" : "\u6211\u8981\u53C2\u52A0";
      participateBtn.classList.toggle("going", going);
    }
    if (ownerActions) ownerActions.style.display = "none";
  }
  _renderDetailParticipants(post.participants || []);
  _renderDetailComments(post.comments || { items: [] });
}
function _updateDetailStats() {
  const post = currentDetailPost;
  if (!post) return;
  document.getElementById("detailViewCount").textContent = post.view_count || 0;
  document.getElementById("detailLikeCount").textContent = post.like_count || 0;
  document.getElementById("detailCommentCount").textContent = post.comment_count || 0;
  document.getElementById("detailParticipantCount").textContent = post.participant_count || 0;
}
function _renderDetailParticipants(participants) {
  const section = document.getElementById("detailParticipantsSection");
  const container = document.getElementById("detailParticipants");
  if (!participants.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  container.innerHTML = participants.map((p) => `
        <span class="participant-chip${p.is_organizer ? " organizer" : ""}">
            ${escapeHtml(p.username || "\u7528\u6237")}
            ${p.is_organizer ? '<span class="participant-status organizer-badge" title="\u53D1\u8D77\u4EBA">\u{1F451} \u53D1\u8D77\u4EBA</span>' : ""}
            <span class="participant-status${p.status === "interested" ? " interested" : ""}">${p.status === "going" ? "\u786E\u5B9A" : "\u611F\u5174\u8DA3"}</span>
        </span>
    `).join("");
}
function _renderDetailComments(commentsData) {
  const items = commentsData.items || [];
  const container = document.getElementById("detailComments");
  document.getElementById("detailCommentTotal").textContent = commentsData.total || items.length;
  if (!items.length) {
    container.innerHTML = '<div class="detail-comments-empty">\u6682\u65E0\u8BC4\u8BBA\uFF0C\u6765\u62A2\u6C99\u53D1\u5427~</div>';
    return;
  }
  container.innerHTML = items.map((c) => {
    const canDeleteComment = _isCurrentUserOwner(c);
    return `
        <div class="detail-comment" data-comment-id="${c.id}">
            <div class="detail-comment-header">
                <span class="detail-comment-user">${escapeHtml(c.username || "\u7528\u6237")}${canDeleteComment ? ' <span class="comment-owner-badge">\u4F5C\u8005</span>' : ""}</span>
                <span class="detail-comment-time">${formatDate(c.created_at)}</span>
            </div>
            <div class="detail-comment-body">${escapeHtml(c.content)}</div>
            <div class="detail-comment-actions">
                <button class="detail-comment-reply-btn" data-comment-id="${c.id}">\u56DE\u590D</button>
                ${canDeleteComment ? `<button class="detail-comment-delete-btn" data-comment-id="${c.id}" title="\u5220\u9664\u8BC4\u8BBA">\u5220\u9664</button>` : ""}
            </div>
            ${c.replies && c.replies.length ? `
                <div class="detail-comment-replies">
                    ${c.replies.map((r) => {
      const canDeleteReply = _isCurrentUserOwner(r);
      return `
                        <div class="detail-comment" data-comment-id="${r.id}">
                            <div class="detail-comment-header">
                                <span class="detail-comment-user">${escapeHtml(r.username || "\u7528\u6237")}${canDeleteReply ? ' <span class="comment-owner-badge">\u4F5C\u8005</span>' : ""}</span>
                                <span class="detail-comment-time">${formatDate(r.created_at)}</span>
                            </div>
                            <div class="detail-comment-body">${escapeHtml(r.content)}</div>
                            <div class="detail-comment-actions">
                                ${canDeleteReply ? `<button class="detail-comment-delete-btn" data-comment-id="${r.id}" title="\u5220\u9664\u56DE\u590D">\u5220\u9664</button>` : ""}
                            </div>
                        </div>
                    `;
    }).join("")}
                </div>
            ` : ""}
        </div>
    `;
  }).join("");
  container.querySelectorAll(".detail-comment-reply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const commentId = parseInt(btn.getAttribute("data-comment-id"));
      _showReplyInput(btn.closest(".detail-comment"), commentId);
    });
  });
  container.querySelectorAll(".detail-comment-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const commentId = parseInt(btn.getAttribute("data-comment-id"));
      if (!confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u6761\u8BC4\u8BBA\u5417\uFF1F")) return;
      try {
        await deletePostComment(currentDetailPost.id, commentId);
        showToast("\u8BC4\u8BBA\u5DF2\u5220\u9664");
        await _refreshDetailComments(currentDetailPost.id);
      } catch (err) {
        showToast("\u5220\u9664\u5931\u8D25: " + err.message);
      }
    });
  });
}
function _showReplyInput(commentEl, parentId) {
  if (commentEl.querySelector(".detail-reply-input-row")) return;
  const row = document.createElement("div");
  row.className = "detail-reply-input-row";
  row.innerHTML = `
        <input type="text" placeholder="\u5199\u4E0B\u56DE\u590D..." maxlength="300">
        <button>\u53D1\u9001</button>
    `;
  commentEl.appendChild(row);
  const input = row.querySelector("input");
  const btn = row.querySelector("button");
  input.focus();
  const doReply = async () => {
    const content = input.value.trim();
    if (!content) {
      showToast("\u8BF7\u8F93\u5165\u56DE\u590D\u5185\u5BB9");
      return;
    }
    if (!isLoggedIn()) {
      showToast("\u8BF7\u5148\u767B\u5F55");
      return;
    }
    try {
      await addPostComment(currentDetailPost.id, content, parentId);
      row.remove();
      showToast("\u56DE\u590D\u6210\u529F");
      await _refreshDetailComments(currentDetailPost.id);
    } catch (err) {
      showToast("\u56DE\u590D\u5931\u8D25: " + err.message);
    }
  };
  btn.addEventListener("click", doReply);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doReply();
    if (e.key === "Escape") row.remove();
  });
}
async function _refreshDetailComments(postId) {
  try {
    const post = await getPost(postId);
    currentDetailPost = post;
    _renderDetailComments(post.comments || { items: [] });
    _updateDetailStats();
  } catch (e) {
  }
}
async function _refreshDetailParticipants(postId) {
  try {
    const post = await getPost(postId);
    currentDetailPost = post;
    _renderDetailParticipants(post.participants || []);
  } catch (e) {
  }
}
async function initFilters() {
  const container = document.getElementById("partnerFilter");
  if (!container) return;
  try {
    const result = await listTags();
    allTags = (result.items || []).filter((t) => {
      if (/^[\d¥￥]/.test(t.name) || ["AA", "\u514D\u8D39", "\u81EA\u8D39"].includes(t.name)) return false;
      if (t.category === "food" || t.category === "identity") return false;
      return true;
    });
  } catch (e) {
    allTags = [];
  }
  const chips = [
    { label: "\u5168\u90E8", category: "all" },
    ...allTags.slice(0, 10).map((t) => ({ label: t.name, category: t.name }))
  ];
  container.innerHTML = chips.map(
    (c, i) => `<span class="filter-chip${i === 0 ? " active" : ""}" data-category="${escapeHtml(c.category)}">${escapeHtml(c.label)}</span>`
  ).join("");
  container.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      currentCategory = chip.getAttribute("data-category");
      container.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      await loadPostsFromAPI();
      renderWaterfall();
      refreshPreviewMarkers();
    });
  });
}
function initPartnerModal() {
  const modal = document.getElementById("partnerModal");
  const closeBtn = document.getElementById("closePartnerModalBtn");
  const cancelBtn = document.getElementById("cancelPartnerBtn");
  const submitBtn = document.getElementById("submitPartnerBtn");
  const form = document.getElementById("partnerForm");
  if (!modal) return;
  const scheduledRow = document.getElementById("scheduledTimeRow");
  const timeModeRow = document.getElementById("timeModeRow");
  const durationBtns = document.querySelectorAll("#durationRow .time-mode-btn");
  durationBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      durationBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _modalDuration = btn.getAttribute("data-duration");
      timeModeRow.style.display = _modalDuration === "long" ? "none" : "flex";
      scheduledRow.style.display = "none";
    });
  });
  const timeModeBtns = modal.querySelectorAll("#timeModeRow .time-mode-btn");
  timeModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      timeModeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _modalUrgency = btn.getAttribute("data-mode");
      scheduledRow.style.display = _modalUrgency === "scheduled" ? "flex" : "none";
    });
  });
  let suggestionIndex = -1;
  const locationInput = document.getElementById("partnerLocation");
  const suggestionsBox = document.getElementById("locationSuggestions");
  const _doSearch = _debounce(async function(keyword) {
    const kw = keyword.trim();
    if (!kw) {
      suggestionsBox.style.display = "none";
      suggestionIndex = -1;
      return;
    }
    suggestionsBox.innerHTML = '<li class="suggestion-loading">\u641C\u7D22\u4E2D...</li>';
    suggestionsBox.style.display = "block";
    try {
      const resp = await fetch(`${API_BASE}/places/suggestions?keyword=${encodeURIComponent(kw)}&city=${encodeURIComponent("\u5357\u4EAC")}&location=118.780,32.058`);
      const data = await resp.json();
      if (!data.tips || data.tips.length === 0) {
        suggestionsBox.innerHTML = '<li class="suggestion-empty">\u672A\u627E\u5230\u5730\u70B9\uFF0C\u8BF7\u5C1D\u8BD5\u5176\u4ED6\u5173\u952E\u8BCD</li>';
        suggestionsBox.style.display = "block";
        suggestionIndex = -1;
        return;
      }
      suggestionsBox.innerHTML = data.tips.map((tip, idx) => {
        const name = escapeHtml(tip.name || "");
        const address = escapeHtml(tip.address || tip.district || "");
        return `<li data-idx="${idx}" data-location="${tip.location}" data-name="${escapeHtml(name)}">
                    <span class="suggestion-name">${name}</span>
                    <span class="suggestion-address">${address}</span>
                </li>`;
      }).join("");
      suggestionsBox.style.display = "block";
      suggestionIndex = -1;
    } catch (err) {
      console.warn("\u5730\u70B9\u641C\u7D22\u5931\u8D25:", err);
      suggestionsBox.innerHTML = '<li class="suggestion-empty">\u641C\u7D22\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5</li>';
      suggestionsBox.style.display = "block";
      suggestionIndex = -1;
    }
  }, 300);
  locationInput.addEventListener("input", () => {
    _modalLocationCoords = null;
    _doSearch(locationInput.value);
  });
  suggestionsBox.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const loc = li.getAttribute("data-location");
    const name = li.getAttribute("data-name");
    if (loc && name) {
      locationInput.value = name;
      _modalLocationCoords = loc;
      suggestionsBox.style.display = "none";
      suggestionIndex = -1;
    }
  });
  locationInput.addEventListener("keydown", (e) => {
    const items = suggestionsBox.querySelectorAll("li[data-location]");
    if (!items.length || suggestionsBox.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle("active", i === suggestionIndex));
      items[suggestionIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, 0);
      items.forEach((it, i) => it.classList.toggle("active", i === suggestionIndex));
      items[suggestionIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestionIndex >= 0 && items[suggestionIndex]) {
        items[suggestionIndex].click();
      }
    } else if (e.key === "Escape") {
      suggestionsBox.style.display = "none";
      suggestionIndex = -1;
    }
  });
  document.addEventListener("click", (e) => {
    if (!locationInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.style.display = "none";
      suggestionIndex = -1;
    }
  });
  const openModal = () => {
    if (!isLoggedIn()) {
      showToast("\u8BF7\u5148\u767B\u5F55\u540E\u518D\u53D1\u8D77\u7EC4\u5C40");
      const authModal = document.getElementById("authModal");
      if (authModal) authModal.style.display = "flex";
      return;
    }
    modal.removeAttribute("data-edit-id");
    form?.reset();
    _modalDuration = "short";
    durationBtns.forEach((b) => b.classList.remove("active"));
    const defaultDurationBtn = document.querySelector('#durationRow .time-mode-btn[data-duration="short"]');
    if (defaultDurationBtn) defaultDurationBtn.classList.add("active");
    if (timeModeRow) timeModeRow.style.display = "flex";
    timeModeBtns.forEach((b) => b.classList.remove("active"));
    const defaultTimeBtn = modal.querySelector('#timeModeRow .time-mode-btn[data-mode="now"]');
    if (defaultTimeBtn) defaultTimeBtn.classList.add("active");
    _modalUrgency = "now";
    if (scheduledRow) scheduledRow.style.display = "none";
    _modalLocationCoords = null;
    suggestionIndex = -1;
    if (suggestionsBox) suggestionsBox.style.display = "none";
    modal.style.display = "flex";
  };
  const closeModal = () => {
    modal.style.display = "none";
    form?.reset();
    _modalLocationCoords = null;
    suggestionIndex = -1;
    if (suggestionsBox) suggestionsBox.style.display = "none";
  };
  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  submitBtn?.addEventListener("click", async () => {
    const category = document.getElementById("partnerCategory")?.value;
    const title = document.getElementById("partnerTitle")?.value.trim();
    const description = document.getElementById("partnerDesc")?.value.trim();
    const location = document.getElementById("partnerLocation")?.value.trim();
    const budget = document.getElementById("partnerBudget")?.value.trim();
    const slots = parseInt(document.getElementById("partnerSlots")?.value) || 1;
    const contact = document.getElementById("partnerContact")?.value.trim();
    const editId = modal.getAttribute("data-edit-id");
    if (!category || !title) {
      showToast("\u8BF7\u81F3\u5C11\u586B\u5199\u5206\u7C7B\u548C\u6807\u9898");
      return;
    }
    if (location && !_modalLocationCoords) {
      showToast("\u26A0\uFE0F \u8BF7\u4ECE\u4E0B\u62C9\u5EFA\u8BAE\u4E2D\u9009\u62E9\u5730\u70B9\uFF0C\u5426\u5219\u5E16\u5B50\u4E0D\u4F1A\u663E\u793A\u5728\u5730\u56FE\u4E0A");
    }
    let event_time = null;
    if (_modalUrgency === "scheduled") {
      const dateVal = document.getElementById("partnerDate")?.value;
      const timeVal = document.getElementById("partnerTimePicker")?.value;
      if (!dateVal || !timeVal) {
        showToast("\u8BF7\u9009\u62E9\u5177\u4F53\u7684\u65E5\u671F\u548C\u65F6\u95F4");
        return;
      }
      event_time = (/* @__PURE__ */ new Date(`${dateVal}T${timeVal}:00`)).toISOString();
    }
    const tags = [category];
    const btnText = editId ? "\u66F4\u65B0\u4E2D..." : "\u53D1\u5E03\u4E2D...";
    submitBtn.disabled = true;
    submitBtn.innerText = btnText;
    try {
      if (editId) {
        await updatePost(parseInt(editId), {
          type: _modalDuration === "long" ? "forum" : "event",
          title,
          content: description || title,
          tags,
          location: _modalLocationCoords || null,
          location_name: location || null,
          urgency: _modalDuration === "long" ? "long_term" : _modalUrgency,
          event_time: _modalDuration === "long" ? null : event_time,
          slots,
          budget,
          contact
        });
        modal.removeAttribute("data-edit-id");
        showToast("\u7EC4\u5C40\u5DF2\u66F4\u65B0");
      } else {
        await createPost({
          type: _modalDuration === "long" ? "forum" : "event",
          title,
          content: description || title,
          tags,
          location: _modalLocationCoords || null,
          location_name: location || null,
          urgency: _modalDuration === "long" ? "long_term" : _modalUrgency,
          event_time: _modalDuration === "long" ? null : event_time,
          slots,
          budget,
          contact
        });
        showToast("\u53D1\u5E03\u6210\u529F");
      }
      closeModal();
      partnersData = await loadPostsFromAPI();
      renderWaterfall();
      refreshPreviewMarkers();
    } catch (err) {
      showToast("\u53D1\u5E03\u5931\u8D25: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = "\u53D1\u5E03\u7EC4\u5C40";
    }
  });
  window.openPartnerModal = openModal;
}
async function initPartnerPage() {
  initPartnerModal();
  initPostDetailModal();
  _ensureRightPanel();
}
async function loadPartnerData() {
  if (_partnerDataLoaded) return;
  _partnerDataLoaded = true;
  const dataPromise = partnersData.length ? Promise.resolve(partnersData) : loadPostsFromAPI();
  const filtersPromise = initFilters();
  const posts = await dataPromise;
  renderWaterfall();
  await filtersPromise;
  initPreviewMap();
}
function _ensureRightPanel() {
  const page = document.getElementById("partnerPage");
  if (!page) return;
  if (page.querySelector(".partner-right-panel")) return;
  const panel = document.createElement("div");
  panel.className = "partner-right-panel";
  const filter = page.querySelector(".partner-filter");
  const waterfall = page.querySelector(".partner-waterfall");
  if (filter && waterfall) {
    filter.parentNode.insertBefore(panel, filter);
    panel.appendChild(filter);
    panel.appendChild(waterfall);
  }
}
function safeHtmlWithBreaks(str) {
  if (!str) return "";
  let safe = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}
function _debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
var partnersData, allTags, currentCategory, _modalDuration, _modalUrgency, _modalLocationCoords, previewMap, fullMapInstance, CAMPUS_COORDS, categoryColorCache, TYPE_EMOJI, currentDetailPost, _partnerDataLoaded;
var init_partner = __esm({
  "js/pages/partner.js"() {
    init_utils();
    init_auth();
    init_api();
    init_config();
    partnersData = [];
    allTags = [];
    currentCategory = "all";
    _modalDuration = "short";
    _modalUrgency = "now";
    _modalLocationCoords = null;
    previewMap = null;
    fullMapInstance = null;
    CAMPUS_COORDS = {
      "\u9F13\u697C": [118.78, 32.058],
      "\u4ED9\u6797": [118.954, 32.114],
      "\u6D66\u53E3": [118.652, 32.157],
      "\u82CF\u5DDE": [120.385, 31.355]
    };
    categoryColorCache = {};
    TYPE_EMOJI = {
      "\u996D\u642D\u5B50": "\u{1F35A}",
      "\u8FD0\u52A8\u642D\u5B50": "\u26BD",
      "\u5B66\u4E60\u642D\u5B50": "\u{1F4DA}",
      "\u6E38\u620F\u642D\u5B50": "\u{1F3AE}",
      "\u7535\u5F71\u642D\u5B50": "\u{1F3AC}",
      "\u65C5\u6E38\u642D\u5B50": "\u2708\uFE0F",
      "\u97F3\u4E50\u642D\u5B50": "\u{1F3B5}",
      "\u6444\u5F71\u642D\u5B50": "\u{1F4F7}"
    };
    window.initFullMapMarkers = initFullMapMarkers;
    currentDetailPost = null;
    _partnerDataLoaded = false;
  }
});

// js/app.js
init_partner();

// js/pages/guide.js
init_api();
init_auth();
init_utils();
var CAMPUS_COORDS2 = {
  "\u9F13\u697C": [118.78, 32.058],
  "\u4ED9\u6797": [118.954, 32.114],
  "\u6D66\u53E3": [118.652, 32.157],
  "\u82CF\u5DDE": [120.39, 31.36]
};
var DEFAULT_CAMPUS = "\u9F13\u697C";
var CATEGORY_CONFIG = {
  "\u7F8E\u98DF": { types: "050000", keyword: "" },
  "\u5496\u5561\u996E\u54C1": { types: "050500|050600|050700|050900", keyword: "" },
  // 咖啡厅+茶艺馆+饮品冷饮+甜品烘焙
  "\u4F11\u95F2\u5A31\u4E50": { types: "080300|080600", keyword: "" },
  // 休闲娱乐+电影院剧院
  "\u8FD0\u52A8\u5065\u8EAB": { types: "080100", keyword: "" },
  // 运动场馆
  "\u8D2D\u7269\u5546\u5708": { types: "060100|061000", keyword: "" },
  // 商场购物中心+特色商业街
  "\u666F\u70B9\u516C\u56ED": { types: "110000|140000", keyword: "" }
  // 风景名胜+文化场馆
};
var SEARCH_RADIUS = 5e3;
var currentGuideCat = "all";
var currentGuideCampus = "all";
var _guideCache = {};
function _getCampusLocation(campus) {
  const coords = CAMPUS_COORDS2[campus] || CAMPUS_COORDS2[DEFAULT_CAMPUS];
  return `${coords[0]},${coords[1]}`;
}
function _resolveCampus() {
  if (currentGuideCampus !== "all") return currentGuideCampus;
  const user = getUser();
  const c = user?.campus || "";
  if (CAMPUS_COORDS2[c]) return c;
  return DEFAULT_CAMPUS;
}
function renderGuideGrid(items) {
  const container = document.getElementById("guideGrid");
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="guide-loading">\u8BE5\u5206\u7C7B\u6682\u65E0\u63A8\u8350\uFF5E</div>';
    return;
  }
  container.innerHTML = items.map((item, idx) => `
        <div class="guide-card" data-guide-idx="${idx}">
            <img class="guide-img" src="${item.image || "https://picsum.photos/400/200?random=" + idx}" alt="${esc(item.name)}" loading="lazy">
            <div class="guide-info">
                <div class="guide-title">
                    ${esc(item.name)}
                    ${item.rating ? `<span class="guide-rating">\u2B50 ${item.rating}</span>` : ""}
                </div>
                <div class="guide-desc">${esc(item.desc)}</div>
                <div class="guide-meta">
                    ${item.campus ? `<span class="guide-campus-tag">\u{1F4CD} ${esc(item.campus)}\u6821\u533A</span>` : ""}
                    <span class="guide-type">${esc(item.type)}</span>
                    ${item.address ? `<span style="font-size:0.75rem;color:var(--text-tertiary);">\u{1F4CD} ${esc(item.address)}</span>` : ""}
                    ${item.price ? `<span class="guide-price">${esc(item.price)}</span>` : ""}
                </div>
            </div>
        </div>
    `).join("");
  container.querySelectorAll(".guide-card").forEach((card) => {
    card.addEventListener("click", () => {
      const idx = parseInt(card.getAttribute("data-guide-idx"));
      openGuideDetail(items[idx]);
    });
  });
}
async function _fetchCampusData(campus) {
  if (_guideCache[campus]) return _guideCache[campus];
  const location = _getCampusLocation(campus);
  const allItems = [];
  let delay = 0;
  const promises = Object.entries(CATEGORY_CONFIG).map(async ([cat, cfg]) => {
    const ms = delay;
    delay += 100;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    try {
      const r = await searchPlaces(cfg.keyword, "\u5357\u4EAC", location, 1, 10, SEARCH_RADIUS, cfg.types, "weight");
      if (r.status === "1" && Array.isArray(r.pois)) {
        r.pois.forEach((poi) => {
          allItems.push({
            name: poi.name,
            desc: poi.address || "",
            image: poi.photos?.[0]?.url || "",
            type: cat,
            campus,
            rating: poi.biz_ext?.rating || "",
            price: poi.biz_ext?.cost ? `\xA5${poi.biz_ext.cost}/\u4EBA` : "",
            address: poi.address || ""
          });
        });
      }
    } catch (e) {
      console.warn(`\u9AD8\u5FB7\u641C\u7D22 ${cat}\uFF08${campus}\uFF09\u5931\u8D25:`, e.message);
    }
  });
  await Promise.all(promises);
  const seen = /* @__PURE__ */ new Set();
  const deduped = allItems.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
  deduped.sort((a, b) => {
    const ra = parseFloat(a.rating) || 0;
    const rb = parseFloat(b.rating) || 0;
    return rb - ra;
  });
  _guideCache[campus] = deduped;
  return deduped;
}
async function _applyGuideFilters() {
  const container = document.getElementById("guideGrid");
  if (container) container.innerHTML = '<div class="guide-loading">\u52A0\u8F7D\u4E2D...</div>';
  const campus = _resolveCampus();
  try {
    const allItems = await _fetchCampusData(campus);
    let items = allItems;
    if (currentGuideCat !== "all") {
      items = items.filter((s) => s.type === currentGuideCat);
    }
    renderGuideGrid(items);
  } catch (e) {
    console.error("\u6307\u5357\u6570\u636E\u52A0\u8F7D\u5931\u8D25:", e);
    if (container) container.innerHTML = '<div class="guide-loading">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5</div>';
  }
}
function filterGuideItems(cat) {
  currentGuideCat = cat;
  document.querySelectorAll("#guideFilter .guide-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-guide-cat") === cat);
  });
  _applyGuideFilters();
}
function _filterGuideCampus(campus) {
  currentGuideCampus = campus;
  document.querySelectorAll("#guideCampusFilter .guide-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-guide-campus") === campus);
  });
  _applyGuideFilters();
}
function openGuideDetail(item) {
  const modal = document.getElementById("guideDetailModal");
  if (!modal) return;
  document.getElementById("guideDetailImg").src = item.image || "";
  document.getElementById("guideDetailName").textContent = item.name;
  document.getElementById("guideDetailRating").textContent = item.rating ? `\u2B50 ${item.rating}` : "";
  document.getElementById("guideDetailPrice").textContent = item.price || "";
  document.getElementById("guideDetailPrice").style.cssText = item.price ? "font-weight:700;color:var(--danger);" : "";
  document.getElementById("guideDetailType").textContent = item.type || "";
  document.getElementById("guideDetailType").style.cssText = item.type ? "padding:3px 10px;border-radius:10px;font-size:0.75rem;background:var(--bg-tertiary);color:var(--text-secondary);" : "";
  document.getElementById("guideDetailDesc").textContent = item.desc || "";
  document.getElementById("guideDetailAddr").innerHTML = item.address ? `\u{1F4CD} ${esc(item.address)}` : "";
  modal.style.display = "flex";
}
function initGuideModals() {
  const modal = document.getElementById("guideDetailModal");
  if (!modal || modal.dataset.ready) return;
  modal.dataset.ready = "1";
  document.getElementById("closeGuideDetailBtn")?.addEventListener("click", () => {
    modal.style.display = "none";
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
}
function initGuideFilter() {
  const filterBar = document.getElementById("guideFilter");
  if (!filterBar || filterBar.dataset.ready) return;
  filterBar.dataset.ready = "1";
  filterBar.querySelectorAll(".guide-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cat = chip.getAttribute("data-guide-cat");
      filterGuideItems(cat);
    });
  });
}
function initGuideCampusFilter() {
  const filterBar = document.getElementById("guideCampusFilter");
  if (!filterBar || filterBar.dataset.ready) return;
  filterBar.dataset.ready = "1";
  const user = getUser();
  const userCampus = user?.campus || "";
  if (userCampus && ["\u9F13\u697C", "\u4ED9\u6797", "\u6D66\u53E3", "\u82CF\u5DDE"].includes(userCampus)) {
    currentGuideCampus = userCampus;
    document.querySelectorAll("#guideCampusFilter .guide-chip").forEach((chip) => {
      chip.classList.toggle("active", chip.getAttribute("data-guide-campus") === userCampus);
    });
  }
  filterBar.querySelectorAll(".guide-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const campus = chip.getAttribute("data-guide-campus");
      _filterGuideCampus(campus);
    });
  });
}
async function loadGuideData() {
  initGuideModals();
  initGuideFilter();
  initGuideCampusFilter();
  _applyGuideFilters();
}
function initGuidePage() {
  const container = document.getElementById("guideGrid");
  if (container && !container.querySelector(".guide-card")) {
    container.innerHTML = '<div class="guide-loading">\u52A0\u8F7D\u7CBE\u5F69\u63A8\u8350\u4E2D...</div>';
  }
  loadGuideData();
}
function esc(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// js/app.js
init_auth();
init_utils();

// js/pages/profile.js
init_api();
init_auth();
init_utils();
var currentProfileTab = "posts";
function renderProfileHeader() {
  const user = getUser();
  const email = user?.email || "";
  const username = user?.username || (email ? email.split("@")[0] : "\u540C\u5B66");
  const usernameEl = document.getElementById("profileUsername");
  if (usernameEl) usernameEl.innerText = username;
  const emailLine = document.getElementById("profileEmailLine");
  if (emailLine) emailLine.innerText = email ? `\u{1F4E7} ${email}` : "";
  renderAvatar(user);
  loadAndRenderBio();
  const statusEl = document.getElementById("profileEmailVerified");
  const resendBtn = document.getElementById("sendVerifyEmailBtn");
  const verified = Boolean(user?.email_verified);
  if (statusEl) {
    statusEl.innerText = verified ? "\u2713 \u90AE\u7BB1\u5DF2\u9A8C\u8BC1" : "\u26A0 \u90AE\u7BB1\u672A\u9A8C\u8BC1";
    statusEl.className = `profile-status ${verified ? "is-verified" : "is-unverified"}`;
  }
  if (resendBtn) resendBtn.style.display = verified ? "none" : "inline-flex";
}
function renderAvatar(user) {
  const avatarEls = [
    document.getElementById("profileAvatarLarge"),
    document.getElementById("editAvatarPreview")
  ];
  const name = user?.username || (user?.email ? user.email.split("@")[0] : "\u540C\u5B66");
  const initial = name.charAt(0).toUpperCase();
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  const bg = `hsl(${hue}, 55%, 55%)`;
  avatarEls.forEach((el) => {
    if (!el) return;
    el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2rem;font-weight:800;color:#fff;background:${bg};border-radius:50%;">${initial}</span>`;
    el.style.background = bg;
  });
}
async function loadAndRenderBio() {
  const bioEl = document.getElementById("profileBio");
  if (!bioEl) return;
  try {
    const profile = await getMyProfile();
    if (profile.bio) {
      bioEl.innerText = profile.bio;
    }
    const campusEl = document.getElementById("profileCampus");
    if (campusEl) campusEl.innerText = profile.campus ? `\u{1F4CD} ${profile.campus}\u6821\u533A` : "";
    const editUsername = document.getElementById("editUsername");
    const editBio = document.getElementById("editBio");
    const editTags = document.getElementById("editTags");
    const editCampus = document.getElementById("editCampus");
    if (editUsername) editUsername.value = profile.username || "";
    if (editBio) editBio.value = profile.bio || "";
    if (editTags) editTags.value = (profile.tags || []).join(", ");
    if (editCampus) editCampus.value = profile.campus || "";
  } catch (e) {
  }
}
function initProfileTabs() {
  const tabs = document.querySelectorAll(".profile-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.getAttribute("data-profile-tab");
      switchProfileTab(tabId);
    });
  });
}
function switchProfileTab(tabId) {
  currentProfileTab = tabId;
  document.querySelectorAll(".profile-tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-profile-tab") === tabId);
  });
  loadProfileTabContent(tabId);
}
async function loadProfileTabContent(tabId) {
  const container = document.getElementById("profileTabContent");
  if (!container) return;
  container.innerHTML = '<div class="profile-loading">\u52A0\u8F7D\u4E2D...</div>';
  try {
    switch (tabId) {
      case "posts":
        await renderMyPosts(container);
        break;
      case "comments":
        await renderMyComments(container);
        break;
      case "favorites":
        await renderMyFavorites(container);
        break;
      case "activities":
        await renderMyActivities(container);
        break;
    }
  } catch (e) {
    container.innerHTML = '<div class="profile-empty-state">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5</div>';
  }
}
async function renderMyPosts(container) {
  const user = getUser();
  if (!user?.id) {
    container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-file-alt"></i>\u8BF7\u5148\u767B\u5F55</div>';
    return;
  }
  try {
    const data = await listPosts({ user_id: user.id, page_size: 50 });
    const posts = data.items || [];
    document.getElementById("postCount").innerText = posts.length;
    if (!posts.length) {
      container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-file-alt"></i>\u8FD8\u6CA1\u6709\u53D1\u5E03\u8FC7\u7EC4\u5C40</div>';
      return;
    }
    container.innerHTML = posts.map((p) => `
            <article class="profile-content-card" data-post-id="${p.id}">
                <div class="profile-content-card-title">${escapeHtml(p.title || "\u65E0\u6807\u9898")}</div>
                <div class="profile-content-card-body">${escapeHtml((p.content || p.description || "").substring(0, 150))}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-tag"></i> ${escapeHtml(p.category || p.type || "")}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(p.created_at)}</span>
                    <span><i class="fas fa-heart"></i> ${p.like_count || 0} \u8D5E</span>
                    <span><i class="fas fa-comment"></i> ${p.comment_count || 0} \u8BC4</span>
                </div>
            </article>
        `).join("");
    container.querySelectorAll(".profile-content-card").forEach((card) => {
      card.addEventListener("click", () => {
        const postId = parseInt(card.getAttribute("data-post-id"));
        if (postId && typeof window.openPostDetail === "function") {
          window.openPostDetail(postId);
        }
      });
      card.style.cursor = "pointer";
    });
    const totalLikes = posts.reduce((sum, p) => sum + (p.like_count || 0), 0);
    document.getElementById("likeReceivedCount").innerText = totalLikes;
  } catch (e) {
    container.innerHTML = '<div class="profile-empty-state">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5</div>';
  }
}
async function renderMyComments(container) {
  try {
    const [reviewsData, postCommentsData] = await Promise.all([
      getReviews().catch(() => ({ items: [] })),
      getMyPostComments().catch(() => ({ items: [] }))
    ]);
    const reviews = reviewsData.items || [];
    const postComments = postCommentsData.items || [];
    const comments = [];
    postComments.forEach((c) => {
      comments.push({
        type: "post",
        content: c.content || "",
        postTitle: c.post_title || "\u672A\u77E5\u5E16\u5B50",
        postId: c.post_id,
        time: c.created_at
      });
    });
    reviews.forEach((r) => {
      comments.push({
        type: "place",
        content: r.content || "",
        placeName: r.place?.name || "\u672A\u77E5\u573A\u6240",
        time: r.created_at,
        rating: r.rating
      });
    });
    comments.sort((a, b) => new Date(b.time) - new Date(a.time));
    document.getElementById("commentMadeCount").innerText = comments.length;
    if (!comments.length) {
      container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-comment"></i>\u8FD8\u6CA1\u6709\u53D1\u8868\u8FC7\u8BC4\u8BBA</div>';
      return;
    }
    container.innerHTML = comments.map((c) => {
      if (c.type === "post") {
        return `
                    <article class="profile-content-card" data-post-id="${c.postId}">
                        <div class="profile-content-card-title">
                            \u{1F4AC} \u56DE\u590D\uFF1A${escapeHtml(c.postTitle)}
                        </div>
                        <div class="profile-content-card-body">${escapeHtml(c.content)}</div>
                        <div class="profile-content-card-meta">
                            <span><i class="fas fa-clock"></i> ${formatDate(c.time)}</span>
                            <span class="profile-tag">\u5E16\u5B50\u8BC4\u8BBA</span>
                        </div>
                    </article>
                `;
      }
      return `
                <article class="profile-content-card">
                    <div class="profile-content-card-title">
                        <i class="fas fa-map-marker-alt"></i> ${escapeHtml(c.placeName)}
                    </div>
                    <div class="profile-content-card-body">${escapeHtml(c.content)}</div>
                    <div class="profile-content-card-meta">
                        <span><i class="fas fa-clock"></i> ${formatDate(c.time)}</span>
                        ${c.rating ? `<span><i class="fas fa-star"></i> ${c.rating} \u5206</span>` : ""}
                    </div>
                </article>
            `;
    }).join("");
    container.querySelectorAll(".profile-content-card[data-post-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const postId = parseInt(card.getAttribute("data-post-id"));
        if (postId && typeof window.openPostDetail === "function") {
          window.openPostDetail(postId);
        }
      });
      card.style.cursor = "pointer";
    });
  } catch (e) {
    container.innerHTML = '<div class="profile-empty-state">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5</div>';
  }
}
async function renderMyFavorites(container) {
  try {
    const [favData, likeData] = await Promise.all([
      getFavorites().catch(() => ({ items: [] })),
      getLikes().catch(() => ({ items: [] }))
    ]);
    const items = [
      ...(favData.items || []).map((i) => ({ ...i, favType: "\u6536\u85CF" })),
      ...(likeData.items || []).map((i) => ({ ...i, favType: "\u70B9\u8D5E" }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    document.getElementById("favoriteCount2").innerText = items.length;
    if (!items.length) {
      container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-heart"></i>\u8FD8\u6CA1\u6709\u6536\u85CF\u6216\u70B9\u8D5E</div>';
      return;
    }
    container.innerHTML = items.map((item) => `
            <article class="profile-content-card">
                <div class="profile-content-card-title">
                    ${escapeHtml(item.place?.name || "\u672A\u77E5\u573A\u6240")}
                </div>
                <div class="profile-content-card-body">
                    ${item.place?.address ? escapeHtml(item.place.address) : ""}
                </div>
                <div class="profile-content-card-meta">
                    <span class="profile-tag">${item.favType}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(item.created_at)}</span>
                </div>
            </article>
        `).join("");
  } catch (e) {
    container.innerHTML = '<div class="profile-empty-state">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5</div>';
  }
}
async function renderMyActivities(container) {
  try {
    const data = await listPosts({ page_size: 100 });
    const user = getUser();
    const allPosts = data.items || [];
    const myActivities = allPosts.filter(
      (p) => (p.participants || []).some(
        (part) => part.user_id === user?.id || part.username === user?.username
      )
    );
    if (!myActivities.length) {
      container.innerHTML = '<div class="profile-empty-state"><i class="fas fa-calendar"></i>\u8FD8\u6CA1\u6709\u53C2\u52A0\u8FC7\u7EC4\u5C40\u6D3B\u52A8</div>';
      return;
    }
    container.innerHTML = myActivities.map((p) => `
            <article class="profile-content-card" data-post-id="${p.id}">
                <div class="profile-content-card-title">${escapeHtml(p.title || "\u65E0\u6807\u9898")}</div>
                <div class="profile-content-card-body">${escapeHtml((p.content || p.description || "").substring(0, 120))}</div>
                <div class="profile-content-card-meta">
                    <span><i class="fas fa-tag"></i> ${escapeHtml(p.category || p.type || "")}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(p.created_at)}</span>
                    <span><i class="fas fa-users"></i> ${p.participant_count || 0} \u4EBA\u53C2\u4E0E</span>
                </div>
            </article>
        `).join("");
    container.querySelectorAll(".profile-content-card").forEach((card) => {
      card.addEventListener("click", () => {
        const postId = parseInt(card.getAttribute("data-post-id"));
        if (postId && typeof window.openPostDetail === "function") {
          window.openPostDetail(postId);
        }
      });
      card.style.cursor = "pointer";
    });
  } catch (e) {
    container.innerHTML = '<div class="profile-empty-state">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5</div>';
  }
}
function initEditProfile() {
  const modal = document.getElementById("editProfileModal");
  const openBtn = document.getElementById("editProfileBtn");
  const closeBtn = document.getElementById("closeEditProfileBtn");
  const cancelBtn = document.getElementById("cancelEditProfileBtn");
  const form = document.getElementById("editProfileForm");
  const deleteBtn = document.getElementById("deleteAccountBtn");
  openBtn?.addEventListener("click", async () => {
    document.getElementById("editOldPassword").value = "";
    document.getElementById("editNewPassword").value = "";
    document.getElementById("deleteAccountPassword").value = "";
    try {
      const profile = await getMyProfile();
      document.getElementById("editUsername").value = profile.username || "";
      document.getElementById("editBio").value = profile.bio || "";
      document.getElementById("editTags").value = (profile.tags || []).join(", ");
    } catch (e) {
    }
    modal.style.display = "flex";
  });
  closeBtn?.addEventListener("click", () => {
    modal.style.display = "none";
  });
  cancelBtn?.addEventListener("click", () => {
    modal.style.display = "none";
  });
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("editUsername").value.trim();
    const bio = document.getElementById("editBio").value.trim();
    const campus = document.getElementById("editCampus")?.value || "";
    const tagsStr = document.getElementById("editTags").value.trim();
    const tags = tagsStr ? tagsStr.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];
    const oldPwd = document.getElementById("editOldPassword").value;
    const newPwd = document.getElementById("editNewPassword").value;
    const saveBtn = document.getElementById("saveProfileBtn");
    const originalText = saveBtn.innerText;
    saveBtn.disabled = true;
    saveBtn.innerText = "\u4FDD\u5B58\u4E2D...";
    try {
      await updateMyProfile({ username, bio, campus, tags });
      if (newPwd) {
        if (!oldPwd) {
          showToast("\u8BF7\u8F93\u5165\u5F53\u524D\u5BC6\u7801\u4EE5\u4FEE\u6539\u5BC6\u7801");
          saveBtn.disabled = false;
          saveBtn.innerText = originalText;
          return;
        }
        if (newPwd.length < 8) {
          showToast("\u65B0\u5BC6\u7801\u81F3\u5C11 8 \u4F4D");
          saveBtn.disabled = false;
          saveBtn.innerText = originalText;
          return;
        }
        await changePassword(oldPwd, newPwd);
        showToast("\u8D44\u6599\u548C\u5BC6\u7801\u5DF2\u66F4\u65B0");
      } else {
        showToast("\u8D44\u6599\u5DF2\u66F4\u65B0");
      }
      modal.style.display = "none";
      if (username) document.getElementById("profileUsername").innerText = username;
      if (bio) document.getElementById("profileBio").innerText = bio;
      if (campus !== void 0) {
        const user = getUser();
        if (user) {
          user.campus = campus;
          localStorage.setItem("current_user", JSON.stringify(user));
        }
      }
    } catch (err) {
      showToast(err.message || "\u4FDD\u5B58\u5931\u8D25");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerText = originalText;
    }
  });
  deleteBtn?.addEventListener("click", async () => {
    const password = document.getElementById("deleteAccountPassword").value;
    if (!password) return showToast("\u8BF7\u8F93\u5165\u5BC6\u7801\u4EE5\u786E\u8BA4\u6CE8\u9500");
    if (!confirm("\u786E\u5B9A\u8981\u6CE8\u9500\u8D26\u53F7\u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\uFF0C\u6240\u6709\u6570\u636E\u5C06\u88AB\u6C38\u4E45\u5220\u9664\uFF01")) return;
    const originalText = deleteBtn.innerText;
    deleteBtn.disabled = true;
    deleteBtn.innerText = "\u6CE8\u9500\u4E2D...";
    try {
      await deleteAccount(password);
      showToast("\u8D26\u53F7\u5DF2\u6CE8\u9500");
      modal.style.display = "none";
      await doLogout();
      window.updateNavBar();
      window.switchPage("home");
    } catch (err) {
      showToast(err.message || "\u6CE8\u9500\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4\u5BC6\u7801\u6B63\u786E");
    } finally {
      deleteBtn.disabled = false;
      deleteBtn.innerText = originalText;
    }
  });
}
async function refreshProfile() {
  if (!isLoggedIn()) return;
  renderProfileHeader();
  loadProfileTabContent(currentProfileTab);
}
function initProfilePage() {
  initProfileTabs();
  initEditProfile();
  const verifyBtn = document.getElementById("sendVerifyEmailBtn");
  if (verifyBtn) {
    verifyBtn.onclick = async () => {
      if (!isLoggedIn()) return;
      const btn = verifyBtn;
      const originalText = btn.innerText;
      btn.disabled = true;
      btn.innerText = "\u53D1\u9001\u4E2D...";
      try {
        await resendVerificationEmail();
        showToast("\u9A8C\u8BC1\u90AE\u4EF6\u5DF2\u53D1\u9001\uFF0C\u8BF7\u67E5\u6536");
      } catch (e) {
        showToast(e.message);
      } finally {
        btn.disabled = false;
        btn.innerText = originalText;
      }
    };
  }
  refreshProfile();
}

// js/pages/home.js
init_utils();
var currentModalTab = "login";
function startCountdown(button, seconds = 60) {
  let remaining = seconds;
  button.disabled = true;
  const originalText = button.innerText;
  button.innerText = `${remaining}s`;
  const timer = setInterval(() => {
    remaining -= 1;
    button.innerText = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.innerText = originalText;
    }
  }, 1e3);
}
function showModal(tab) {
  const modal = document.getElementById("authModal");
  const loginDiv = document.getElementById("loginForm");
  const registerDiv = document.getElementById("registerForm");
  const forgotDiv = document.getElementById("forgotForm");
  loginDiv.style.display = "none";
  registerDiv.style.display = "none";
  forgotDiv.style.display = "none";
  if (tab === "login") loginDiv.style.display = "block";
  else if (tab === "register") registerDiv.style.display = "block";
  else if (tab === "forgot") forgotDiv.style.display = "block";
  modal.style.display = "flex";
  currentModalTab = tab;
}
function hideModal() {
  document.getElementById("authModal").style.display = "none";
}
async function handleLogin() {
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) return showToast("\u8BF7\u586B\u5199\u90AE\u7BB1\u548C\u5BC6\u7801");
  const loginBtn = document.getElementById("doLoginBtn");
  const originalText = loginBtn.innerText;
  loginBtn.disabled = true;
  loginBtn.innerText = "\u767B\u5F55\u4E2D...";
  const { doLogin: doLogin2, updateUserFromLogin: updateUserFromLogin2 } = await Promise.resolve().then(() => (init_auth(), auth_exports));
  try {
    const user = await doLogin2(email, password);
    updateUserFromLogin2(user);
    hideModal();
    window.updateNavBar();
    showToast("\u767B\u5F55\u6210\u529F");
  } catch (e) {
    showToast(e.message);
  } finally {
    loginBtn.disabled = false;
    loginBtn.innerText = originalText;
  }
}
async function handleRegister() {
  const username = document.getElementById("regUsername").value;
  const email = document.getElementById("regEmail").value;
  const code = document.getElementById("regCode").value;
  const password = document.getElementById("regPassword").value;
  if (!username || !email || !code || !password) return showToast("\u8BF7\u586B\u5199\u5B8C\u6574");
  if (password.length < 8) return showToast("\u5BC6\u7801\u81F3\u5C118\u4F4D");
  const { doRegister: doRegister2 } = await Promise.resolve().then(() => (init_auth(), auth_exports));
  try {
    await doRegister2(username, email, password, code);
    hideModal();
    showToast("\u6CE8\u518C\u6210\u529F\uFF0C\u5DF2\u81EA\u52A8\u767B\u5F55");
    window.updateNavBar();
  } catch (e) {
    showToast(e.message);
  }
}
async function handleForgot() {
  const email = document.getElementById("forgotEmail").value;
  const code = document.getElementById("forgotCode").value;
  const newPassword = document.getElementById("forgotNewPassword").value;
  if (!email || !code || !newPassword) return showToast("\u8BF7\u586B\u5199\u90AE\u7BB1\u3001\u9A8C\u8BC1\u7801\u548C\u65B0\u5BC6\u7801");
  if (newPassword.length < 8) return showToast("\u5BC6\u7801\u81F3\u5C118\u4F4D");
  const { resetPassword: resetPassword2 } = await Promise.resolve().then(() => (init_api(), api_exports));
  await resetPassword2(email, code, newPassword);
  showToast("\u5BC6\u7801\u5DF2\u91CD\u7F6E\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
  showModal("login");
}
async function sendRegisterCode() {
  const email = document.getElementById("regEmail").value;
  if (!email) return showToast("\u8BF7\u8F93\u5165\u90AE\u7BB1");
  const button = document.getElementById("sendRegCodeBtn");
  const { requestRegisterCode: requestRegisterCode2 } = await Promise.resolve().then(() => (init_api(), api_exports));
  await requestRegisterCode2(email);
  showToast("\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001\uFF0C\u8BF7\u67E5\u6536\u90AE\u7BB1");
  startCountdown(button, 60);
}
async function sendForgotCode() {
  const email = document.getElementById("forgotEmail").value;
  if (!email) return showToast("\u8BF7\u8F93\u5165\u90AE\u7BB1");
  const button = document.getElementById("sendForgotCodeBtn");
  const { requestPasswordResetCode: requestPasswordResetCode2 } = await Promise.resolve().then(() => (init_api(), api_exports));
  await requestPasswordResetCode2(email);
  showToast("\u82E5\u90AE\u7BB1\u5B58\u5728\uFF0C\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001");
  startCountdown(button, 60);
}
function showHomePage() {
  document.getElementById("showLoginBtn").onclick = () => showModal("login");
  document.getElementById("switchToRegister").onclick = (e) => {
    e.preventDefault();
    showModal("register");
  };
  document.getElementById("switchToLogin").onclick = (e) => {
    e.preventDefault();
    showModal("login");
  };
  document.getElementById("forgotPasswordLink").onclick = (e) => {
    e.preventDefault();
    showModal("forgot");
  };
  document.getElementById("backToLogin").onclick = (e) => {
    e.preventDefault();
    showModal("login");
  };
  document.getElementById("doLoginBtn").onclick = handleLogin;
  document.getElementById("doRegisterBtn").onclick = handleRegister;
  document.getElementById("doForgotBtn").onclick = handleForgot;
  document.getElementById("sendRegCodeBtn").onclick = sendRegisterCode;
  document.getElementById("sendForgotCodeBtn").onclick = sendForgotCode;
}

// js/pages/ai.js
init_api();
init_utils();
init_auth();
var currentSessionId = null;
function stripMarkdown(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`{1,3}[^`]*`{1,3}/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^[-*+]\s+/gm, "").replace(/^\d+\.\s+/gm, "").replace(/\[(.+?)\]\(.+?\)/g, "$1").replace(/```[\s\S]*?```/g, "").replace(/^>\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
var questionTemplates = [
  { base: "\u63A8\u8350\u4E00\u5BB6{type}\u9910\u5385", slot: ["\u5DDD\u83DC", "\u6E58\u83DC", "\u7CA4\u83DC", "\u6C5F\u6D59\u83DC", "\u4E1C\u5317\u83DC", "\u65E5\u6599", "\u97E9\u9910", "\u706B\u9505", "\u70E7\u70E4", "\u9EBB\u8FA3\u70EB"] },
  { base: "\u5357\u5927\u9644\u8FD1\u6709\u4EC0\u4E48\u597D\u5403\u7684{type}", slot: ["\u65E9\u9910\u5E97", "\u9762\u9986", "\u997A\u5B50\u9986", "\u5976\u8336\u5E97", "\u5496\u5561\u5385", "\u751C\u54C1\u5E97", "\u5C0F\u5403\u644A", "\u591C\u5BB5\u644A", "\u5FEB\u9910", "\u81EA\u52A9\u9910"] },
  { base: "\u6211\u60F3\u53BB{type}\uFF0C\u6709\u63A8\u8350\u5417", slot: ["\u805A\u9910", "\u7EA6\u4F1A", "\u4E00\u4E2A\u4EBA\u5403\u996D", "\u8BF7\u5BA2", "\u5403\u591C\u5BB5", "\u5403\u65E9\u9910"] },
  { base: "\u6709\u6CA1\u6709{type}\u7684\u9910\u5385", slot: ["\u5B89\u9759", "\u6027\u4EF7\u6BD4\u9AD8", "\u4E0A\u83DC\u5FEB", "\u9002\u5408\u81EA\u4E60", "\u6709\u5305\u53A2", "\u73AF\u5883\u597D", "\u4FBF\u5B9C\u53C8\u597D\u5403", "\u8BC4\u5206\u9AD8"] },
  { base: "\u5357\u5927{type}\u9644\u8FD1\u6709\u4EC0\u4E48\u5403\u7684", slot: ["\u4ED9\u6797\u6821\u533A", "\u9F13\u697C\u6821\u533A", "\u5357\u95E8", "\u5317\u95E8", "\u6C49\u53E3\u8DEF", "\u73E0\u6C5F\u8DEF"] },
  { base: "\u5357\u5927\u5468\u8FB9\u6709\u4EC0\u4E48\u503C\u5F97\u53BB\u7684{type}", slot: ["\u5496\u5561\u9986", "\u5976\u8336\u5E97", "\u706B\u9505\u5E97", "\u65E5\u6599\u5E97", "\u70E7\u70E4\u644A", "\u5C0F\u5403\u8857", "\u9762\u5305\u623F"] },
  { base: "{type}\u53BB\u54EA\u5403\u6BD4\u8F83\u597D", slot: ["\u548C\u5BA4\u53CB\u805A\u9910", "\u548C\u5BF9\u8C61\u7EA6\u4F1A", "\u4E00\u4E2A\u4EBA\u5403\u5348\u996D", "\u5468\u672B\u6539\u5584\u4F19\u98DF", "\u751F\u65E5\u8BF7\u5BA2", "\u8003\u8BD5\u540E\u653E\u677E"] }
];
function generateRandomQuestions(count) {
  count = count || 5;
  const shuffled = shuffle([...questionTemplates]);
  const questions = [];
  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const tpl = shuffled[i];
    const slotVal = tpl.slot[Math.floor(Math.random() * tpl.slot.length)];
    questions.push(tpl.base.replace("{type}", slotVal));
  }
  return questions;
}
function renderQuickQuestions() {
  const container = document.getElementById("quickQuestions");
  if (!container) return;
  container.innerHTML = "";
  const questions = generateRandomQuestions(5);
  questions.forEach((q) => {
    const btn = document.createElement("button");
    btn.className = "quick-q-btn";
    btn.textContent = q;
    btn.addEventListener("click", () => {
      const input = document.getElementById("chatInput");
      if (input) input.value = q;
      sendMessage();
    });
    container.appendChild(btn);
  });
}
function hideWelcome() {
  const welcome = document.getElementById("aiWelcome");
  if (welcome) welcome.style.display = "none";
}
function showWelcome() {
  const welcome = document.getElementById("aiWelcome");
  if (welcome) welcome.style.display = "flex";
}
function clearChatMessages() {
  const messagesDiv = document.getElementById("chatMessages");
  if (!messagesDiv) return;
  const welcome = messagesDiv.querySelector(".ai-welcome");
  messagesDiv.innerHTML = "";
  if (welcome) messagesDiv.appendChild(welcome);
  hideWelcome();
}
function renderMessages(messages) {
  const messagesDiv = document.getElementById("chatMessages");
  if (!messagesDiv) return;
  const welcome = messagesDiv.querySelector(".ai-welcome");
  messagesDiv.innerHTML = "";
  if (welcome) messagesDiv.appendChild(welcome);
  hideWelcome();
  if (!messages || messages.length === 0) {
    showWelcome();
    return;
  }
  messages.forEach((msg) => {
    const div = document.createElement("div");
    div.className = `chat-message ${msg.role === "user" ? "chat-user" : "chat-bot"}`;
    div.textContent = msg.role === "assistant" ? stripMarkdown(msg.content) : msg.content;
    messagesDiv.appendChild(div);
  });
  scrollToBottom();
}
function showThinking() {
  const messagesDiv = document.getElementById("chatMessages");
  if (!messagesDiv) return null;
  hideWelcome();
  const div = document.createElement("div");
  div.className = "chat-message chat-thinking";
  div.id = "aiThinkingMsg";
  div.innerHTML = '<span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span>';
  messagesDiv.appendChild(div);
  scrollToBottom();
  return div;
}
function removeThinking() {
  const el = document.getElementById("aiThinkingMsg");
  if (el) el.remove();
}
function scrollToBottom() {
  const div = document.getElementById("chatMessages");
  if (div) requestAnimationFrame(() => div.scrollTop = div.scrollHeight);
}
function escapeHtml2(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
async function loadConversationList() {
  if (!isLoggedIn()) return;
  const listContainer = document.getElementById("aiConversationList");
  if (!listContainer) return;
  try {
    const data = await getConversationList();
    const sessions = data.items || [];
    if (sessions.length === 0) {
      listContainer.innerHTML = '<div class="ai-conv-empty"><i class="fas fa-comment"></i> \u6682\u65E0\u5386\u53F2\u5BF9\u8BDD</div>';
      return;
    }
    listContainer.innerHTML = sessions.map((session) => `
            <div class="ai-conv-item" data-session-id="${escapeHtml2(session.session_id)}">
                <div class="ai-conv-content">
                    <div class="ai-conv-title">${escapeHtml2(session.last_message?.substring(0, 30) || "\u65B0\u5BF9\u8BDD")}</div>
                    <div class="ai-conv-preview">${escapeHtml2(formatSessionTime(session.last_at))}</div>
                </div>
                <div class="ai-conv-time">${formatRelativeTime(session.last_at)}</div>
                <button class="ai-conv-delete" data-session-id="${escapeHtml2(session.session_id)}" title="\u5220\u9664\u4F1A\u8BDD"><i class="fas fa-trash-alt"></i></button>
            </div>
        `).join("");
    listContainer.querySelectorAll(".ai-conv-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.closest(".ai-conv-delete")) return;
        const sid = item.getAttribute("data-session-id");
        if (sid) loadConversation(sid);
      });
    });
    listContainer.querySelectorAll(".ai-conv-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const sid = btn.getAttribute("data-session-id");
        if (sid && confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u4E2A\u5BF9\u8BDD\u5417\uFF1F")) await deleteConversationHandler(sid);
      });
    });
    if (currentSessionId) highlightCurrentSession(currentSessionId);
  } catch (err) {
    console.warn("\u52A0\u8F7D\u4F1A\u8BDD\u5217\u8868\u5931\u8D25:", err);
    listContainer.innerHTML = '<div class="ai-conv-empty">\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5</div>';
  }
}
function formatSessionTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = /* @__PURE__ */ new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 6e4);
  const diffHours = Math.floor(diffMs / 36e5);
  const diffDays = Math.floor(diffMs / 864e5);
  if (diffMins < 1) return "\u521A\u521A";
  if (diffMins < 60) return `${diffMins}\u5206\u949F\u524D`;
  if (diffHours < 24) return `${diffHours}\u5C0F\u65F6\u524D`;
  if (diffDays < 7) return `${diffDays}\u5929\u524D`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
function highlightCurrentSession(sessionId) {
  document.querySelectorAll(".ai-conv-item").forEach((item) => {
    const sid = item.getAttribute("data-session-id");
    item.classList.toggle("active", sid === sessionId);
  });
}
async function loadConversation(sessionId) {
  if (!sessionId) return;
  try {
    const data = await getConversationMessages(sessionId);
    const messages = data.messages || [];
    currentSessionId = sessionId;
    clearChatMessages();
    if (messages.length === 0) showWelcome();
    else renderMessages(messages);
    highlightCurrentSession(sessionId);
    if (window.innerWidth <= 768) closeMobileSidebar();
  } catch (err) {
    showToast("\u52A0\u8F7D\u5BF9\u8BDD\u5931\u8D25: " + err.message);
  }
}
async function deleteConversationHandler(sessionId) {
  try {
    await deleteConversation(sessionId);
    showToast("\u5BF9\u8BDD\u5DF2\u5220\u9664");
    if (currentSessionId === sessionId) startNewChat();
    await loadConversationList();
  } catch (err) {
    showToast("\u5220\u9664\u5931\u8D25: " + err.message);
  }
}
function startNewChat() {
  currentSessionId = null;
  clearChatMessages();
  showWelcome();
  highlightCurrentSession(null);
}
async function refreshSidebar() {
  await loadConversationList();
}
function initSidebarControls() {
  const sidebar = document.getElementById("aiSidebar");
  const toggleBtn = document.getElementById("aiSidebarToggle");
  const expandBtn = document.getElementById("aiSidebarExpand");
  const newChatBtn = document.getElementById("aiNewChatBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => sidebar?.classList.toggle("collapsed"));
  }
  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      sidebar?.classList.remove("collapsed");
      if (window.innerWidth <= 768) {
        sidebar?.classList.remove("open");
      }
    });
  }
  if (sidebar) {
    sidebar.addEventListener("click", (e) => {
      if (e.target === sidebar) closeMobileSidebar();
    });
  }
  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      startNewChat();
      if (window.innerWidth <= 768) closeMobileSidebar();
    });
  }
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      closeMobileSidebar();
      sidebar?.classList.remove("open");
    }
  });
}
function closeMobileSidebar() {
  document.getElementById("aiSidebar")?.classList.remove("open");
}
async function sendMessage() {
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendChatBtn");
  const messagesDiv = document.getElementById("chatMessages");
  if (!input || !messagesDiv || !sendBtn) return;
  const msg = input.value.trim();
  if (!msg) return;
  if (!isLoggedIn()) {
    showToast("\u8BF7\u5148\u767B\u5F55\u4F7F\u7528AI\u52A9\u624B");
    return;
  }
  sendBtn.disabled = true;
  input.value = "";
  hideWelcome();
  const userMsg = document.createElement("div");
  userMsg.className = "chat-message chat-user";
  userMsg.textContent = msg;
  messagesDiv.appendChild(userMsg);
  scrollToBottom();
  showThinking();
  try {
    const res = await chatRecommend(msg, currentSessionId);
    if (res.session_id) {
      const newSession = currentSessionId !== res.session_id;
      currentSessionId = res.session_id;
      if (newSession) await loadConversationList();
      else await refreshSidebar();
      highlightCurrentSession(currentSessionId);
    }
    removeThinking();
    const rawReply = res.reply || "\u62B1\u6B49\uFF0CAI \u6682\u65F6\u65E0\u6CD5\u56DE\u7B54";
    const cleanReply = stripMarkdown(rawReply);
    const botMsg = document.createElement("div");
    botMsg.className = "chat-message chat-bot";
    botMsg.textContent = cleanReply;
    messagesDiv.appendChild(botMsg);
    if (res.candidates && res.candidates.length) {
      const candDiv = document.createElement("div");
      candDiv.className = "chat-message chat-bot";
      let html = '<div class="ai-candidates"><div class="ai-candidates-label"><i class="fas fa-utensils"></i> \u63A8\u8350\u9910\u5385</div>';
      res.candidates.forEach((c) => {
        html += `<div class="ai-candidate-item">
                            <span class="ai-candidate-name">${escapeHtml2(c.name)}</span>
                            <span class="ai-candidate-meta">
                                <span>\u2B50 ${escapeHtml2(c.rating)}</span>
                                <span>\u{1F4B0} ${escapeHtml2(c.cost)}</span>
                            </span>
                         </div>`;
      });
      html += "</div>";
      candDiv.innerHTML = html;
      messagesDiv.appendChild(candDiv);
    }
    scrollToBottom();
    renderQuickQuestions();
    await refreshSidebar();
  } catch (e) {
    removeThinking();
    const errDiv = document.createElement("div");
    errDiv.className = "chat-message chat-bot";
    errDiv.textContent = "\u62B1\u6B49\uFF0CAI \u56DE\u590D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
    messagesDiv.appendChild(errDiv);
    scrollToBottom();
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}
function initParticles(containerId = "aiParticles") {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  const colors = ["#7c3aed", "#8b5cf6", "#a78bfa", "#c084fc", "#e9d5ff", "#f472b6", "#818cf8", "#c4b5fd"];
  const count = window.innerWidth < 600 ? 20 : 32;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "ai-particle";
    p.style.top = `-${5 + Math.random() * 20}vh`;
    p.style.left = `${Math.random() * 100}%`;
    p.style.width = `${3 + Math.random() * 6}px`;
    p.style.height = `${3 + Math.random() * 6}px`;
    p.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = `${8 + Math.random() * 14}s`;
    p.style.animationDelay = `${Math.random() * 10}s`;
    p.style.opacity = 0.15 + Math.random() * 0.35;
    frag.appendChild(p);
  }
  container.appendChild(frag);
}
function initAIPage() {
  const sendBtn = document.getElementById("sendChatBtn");
  const input = document.getElementById("chatInput");
  if (!sendBtn || !input) return;
  sendBtn.onclick = sendMessage;
  if (input.dataset.aiReady !== "true") {
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.dataset.aiReady = "true";
  }
  initSidebarControls();
  if (isLoggedIn()) loadConversationList();
  renderQuickQuestions();
  initParticles("aiParticles");
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => initParticles("aiParticles"), 400);
  });
}
window.initAIPage = initAIPage;

// js/app.js
var openPostDetailFn = null;
async function getOpenPostDetail() {
  if (!openPostDetailFn) {
    const mod = await Promise.resolve().then(() => (init_partner(), partner_exports));
    openPostDetailFn = mod.openPostDetail;
  }
  return openPostDetailFn;
}
window.openPostDetail = async (postId) => {
  const fn = await getOpenPostDetail();
  fn(postId);
};
var currentPage = "home";
var pageTitles = {
  home: "\u9996\u9875",
  partner: "\u627E\u642D\u5B50",
  ai: "AI\u52A9\u624B",
  guide: "\u5403\u559D\u73A9\u4E50",
  profile: "\u4E2A\u4EBA",
  fullMap: "\u7EC4\u5C40\u5730\u56FE"
};
function switchPage(pageId) {
  const protectedPages = ["profile"];
  if (protectedPages.includes(pageId) && !isLoggedIn()) {
    const modal = document.getElementById("authModal");
    if (modal) modal.style.display = "flex";
    return;
  }
  document.querySelectorAll(".content-area .page").forEach((page) => {
    page.classList.remove("active-page");
  });
  const pageMap = {
    home: "homePage",
    partner: "partnerPage",
    ai: "aiPage",
    guide: "guidePage",
    profile: "profilePage",
    fullMap: "fullMapPage"
  };
  const targetId = pageMap[pageId];
  if (targetId) {
    const target = document.getElementById(targetId);
    if (target) target.classList.add("active-page");
  }
  const titleEl = document.getElementById("pageTitle");
  if (titleEl && pageTitles[pageId]) titleEl.innerText = pageTitles[pageId];
  currentPage = pageId;
  document.querySelectorAll(".bottom-tab-bar .tab-item").forEach((item) => {
    const tabPage = item.getAttribute("data-page");
    item.classList.toggle("active", tabPage === pageId);
  });
  document.querySelectorAll(".desktop-nav .desktop-nav-item").forEach((item) => {
    const tabPage = item.getAttribute("data-page");
    item.classList.toggle("active", tabPage === pageId);
  });
  const particleMap = {
    home: "homeParticles",
    partner: "partnerParticles",
    ai: "aiParticles",
    guide: "guideParticles",
    profile: "profileParticles"
  };
  const particleId = particleMap[pageId];
  if (particleId) initParticles(particleId);
  if (pageId === "guide") initGuidePage();
  else if (pageId === "ai") initAIPage();
  else if (pageId === "partner") loadPartnerData();
  else if (pageId === "profile") refreshProfile();
  else if (pageId === "fullMap") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => initFullMapMarkers2());
    });
  }
  const fab = document.getElementById("fabCreateGroup");
  if (fab) {
    fab.style.display = pageId === "partner" ? "flex" : "none";
  }
}
async function initFullMapMarkers2() {
  if (typeof window.initFullMapMarkers === "function") {
    try {
      await window.initFullMapMarkers();
    } catch (err) {
      console.warn("\u5168\u5C4F\u5730\u56FE\u521D\u59CB\u5316\u5931\u8D25:", err);
    }
  }
}
function updateNavBar() {
  const guestNav = document.getElementById("navGuestTop");
  const userNav = document.getElementById("navUserTop");
  const usernameSpan = document.getElementById("usernameSpan");
  if (isLoggedIn()) {
    if (guestNav) guestNav.style.display = "none";
    if (userNav) userNav.style.display = "flex";
    document.body.classList.add("logged-in");
    const user = getUser();
    if (usernameSpan && user) {
      usernameSpan.innerText = user.username || (user.email ? user.email.split("@")[0] : "\u540C\u5B66");
      usernameSpan.onclick = () => switchPage("profile");
    }
  } else {
    if (guestNav) guestNav.style.display = "flex";
    if (userNav) userNav.style.display = "none";
    document.body.classList.remove("logged-in");
  }
  if (!currentPage || currentPage === "fullMap") {
    switchPage("home");
  }
}
function initFullMapPage() {
  const backBtn = document.getElementById("backFromMapBtn");
  backBtn?.addEventListener("click", () => {
    switchPage("partner");
  });
}
function initNavigation() {
  document.querySelectorAll("[data-page]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const page = tab.getAttribute("data-page");
      if (page) switchPage(page);
    });
  });
}
function initThemeToggle() {
  const themeButton = document.getElementById("themeToggleBtn");
  const savedTheme = localStorage.getItem("njuatlas-theme") || "light";
  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    if (themeButton) themeButton.textContent = theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}";
    localStorage.setItem("njuatlas-theme", theme);
  };
  applyTheme(savedTheme);
  themeButton?.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(currentTheme === "dark" ? "light" : "dark");
  });
}
function initPixelField() {
  const field = document.getElementById("pixelField");
  if (!field || field.dataset.ready === "true") return;
  const cellCount = 64;
  for (let i = 0; i < cellCount; i += 1) {
    const cell = document.createElement("span");
    cell.className = "pixel-cell";
    cell.style.setProperty("--i", i);
    cell.style.setProperty("--row", Math.floor(i / 8));
    cell.style.setProperty("--col", i % 8);
    cell.style.setProperty("--delay", `${i % 10 * 0.08}s`);
    field.appendChild(cell);
  }
  field.dataset.ready = "true";
}
function initFabButton() {
  const fab = document.getElementById("fabCreateGroup");
  fab?.addEventListener("click", () => {
    if (!isLoggedIn()) {
      showToast("\u8BF7\u5148\u767B\u5F55\u540E\u518D\u53D1\u8D77\u7EC4\u5C40");
      const authModal = document.getElementById("authModal");
      if (authModal) authModal.style.display = "flex";
      return;
    }
    const modal = document.getElementById("partnerModal");
    if (modal) modal.style.display = "flex";
  });
}
function initMapExpand() {
  const expandBtn = document.getElementById("mapExpandBtn");
  expandBtn?.addEventListener("click", () => {
    switchPage("fullMap");
  });
}
function init() {
  updateNavBar();
  showHomePage();
  initNavigation();
  initThemeToggle();
  initPixelField();
  initFabButton();
  initMapExpand();
  initFullMapPage();
  initProfilePage();
  switchPage("home");
  initPartnerPage();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const particleMap = {
        home: "homeParticles",
        partner: "partnerParticles",
        ai: "aiParticles",
        guide: "guideParticles",
        profile: "profileParticles"
      };
      const particleId = particleMap[currentPage];
      if (particleId) initParticles(particleId);
    }, 400);
  });
}
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await doLogout();
  updateNavBar();
  switchPage("home");
  showToast("\u5DF2\u9000\u51FA\u767B\u5F55");
});
document.getElementById("closeAuthModalBtn")?.addEventListener("click", () => {
  document.getElementById("authModal").style.display = "none";
});
document.getElementById("authModal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById("authModal").style.display = "none";
  }
});
window.switchPage = switchPage;
window.updateNavBar = updateNavBar;
init();
