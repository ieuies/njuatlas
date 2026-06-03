import { searchPlaces, addPlace, getPlaceStats, toggleLike, toggleFavorite, addReview } from '../api.js';
import { loadAmapScript } from '../config.js';
import { showToast, escapeHtml } from '../utils.js';
import { isLoggedIn } from '../auth.js';

const NJU_GULOU = {
    name: '南京大学鼓楼校区',
    location: '118.7784,32.0572',
    center: [118.7784, 32.0572],
};
const DEFAULT_KEYWORD = '餐厅';
const DEFAULT_RADIUS = 5000;
const PAGE_SIZE = 25;
const PAGE_COUNT = 3;

let currentRestaurants = [];
let map = null;
let markers = [];

function decodePoi(encoded) {
    return JSON.parse(decodeURIComponent(encoded));
}

function validLocation(location) {
    if (!location || !location.includes(',')) return null;
    const [lng, lat] = location.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
}

function renderRestaurantList(restaurants) {
    const container = document.getElementById('restoList');
    if (!restaurants.length) {
        container.innerHTML = '<p class="list-empty">南京大学附近暂未找到餐厅，试试刷新或稍后再试</p>';
        return;
    }

    container.innerHTML = restaurants.map(r => {
        const image = r.photos?.[0]?.url || `https://picsum.photos/300/160?random=${encodeURIComponent(r.id || r.name)}`;
        const rating = r.biz_ext?.rating || '暂无评分';
        const cost = r.biz_ext?.cost || '未知';
        return `
            <div class="resto-card" data-poi="${encodeURIComponent(JSON.stringify(r))}">
                <div class="resto-img" style="background-image: url('${image}');"></div>
                <div class="resto-info">
                    <div class="resto-name">${escapeHtml(r.name)}</div>
                    <div>${escapeHtml(r.address || '')}</div>
                    <div>评分 ${escapeHtml(String(rating))} | 人均 ${escapeHtml(String(cost))}</div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.resto-card').forEach(card => {
        card.addEventListener('click', () => {
            showRestaurantDetail(decodePoi(card.getAttribute('data-poi')));
        });
    });
}

async function showRestaurantDetail(poi) {
    let localPlaceId = null;
    try {
        const addRes = await addPlace(poi.name, poi.address, poi.location, poi.id);
        localPlaceId = addRes.id;
    } catch(e) {
        showToast('无法获取餐厅信息');
        return;
    }

    let stats = { likes: 0, favorites: 0, reviews: [] };
    try {
        stats = await getPlaceStats(localPlaceId);
    } catch(e) {}

    document.getElementById('modalTitle').innerText = poi.name;
    document.getElementById('modalDesc').innerHTML =
        `${escapeHtml(poi.address || '')}<br>点赞 ${stats.likes} | 收藏 ${stats.favorites}`;
    const reviewsHtml = stats.reviews.map(r => `
        <div><b>用户${r.user_id}</b>: ${escapeHtml(r.content)} <small>${new Date(r.created_at).toLocaleString()}</small></div>
    `).join('');
    document.getElementById('modalReviews').innerHTML = reviewsHtml || '暂无评论';

    const likeBtn = document.getElementById('likeRestoBtn');
    const favBtn = document.getElementById('favRestoBtn');
    likeBtn.onclick = async () => {
        if (!isLoggedIn()) return showToast('请先登录');
        await toggleLike(localPlaceId);
        showToast('已切换点赞');
        showRestaurantDetail(poi);
    };
    favBtn.onclick = async () => {
        if (!isLoggedIn()) return showToast('请先登录');
        await toggleFavorite(localPlaceId);
        showToast('已切换收藏');
        showRestaurantDetail(poi);
    };

    const postBtn = document.getElementById('postReviewBtn');
    const newReview = document.getElementById('newReview');
    postBtn.onclick = async () => {
        if (!isLoggedIn()) return showToast('请先登录');
        const content = newReview.value.trim();
        if (!content) return showToast('评论内容不能为空');
        await addReview(localPlaceId, content);
        showToast('评论成功');
        newReview.value = '';
        showRestaurantDetail(poi);
    };
    document.getElementById('restoModal').style.display = 'flex';
    document.getElementById('closeModalBtn').onclick = () => {
        document.getElementById('restoModal').style.display = 'none';
    };
}

async function searchNearbyRestaurants(keyword = DEFAULT_KEYWORD) {
    const results = [];
    const seen = new Set();

    for (let page = 1; page <= PAGE_COUNT; page += 1) {
        const data = await searchPlaces(keyword, null, NJU_GULOU.location, page, PAGE_SIZE, DEFAULT_RADIUS);
        if (data.status !== '1' || !Array.isArray(data.pois) || !data.pois.length) break;

        data.pois.forEach(poi => {
            const key = poi.id || `${poi.name}-${poi.location}`;
            if (!seen.has(key)) {
                seen.add(key);
                results.push(poi);
            }
        });

        if (data.pois.length < PAGE_SIZE) break;
    }

    return results;
}

export async function refreshRestaurants(keyword = DEFAULT_KEYWORD) {
    const container = document.getElementById('restoList');
    container.innerHTML = '加载南京大学附近餐厅...';
    try {
        currentRestaurants = await searchNearbyRestaurants(keyword);
        renderRestaurantList(currentRestaurants);
        // 如果地图已经存在，同时更新地图上的标记
        if (map && window.AMap) {
            renderMapMarkers();
        }
    } catch(e) {
        container.innerHTML = '<p class="list-empty">加载失败，请检查高德 API 配置或稍后重试</p>';
    }
}

/**
 * 在地图上绘制标记（同时包含南大标记和餐厅标记）
 */
function renderMapMarkers() {
    if (!map || !window.AMap) {
        console.warn('地图未初始化，无法绘制标记');
        return;
    }

    // 清除旧标记
    if (markers.length) {
        map.remove(markers);
        markers = [];
    }

    // 添加南大校区标记
    const campusMarker = new AMap.Marker({
        position: NJU_GULOU.center,
        title: NJU_GULOU.name,
        label: { content: NJU_GULOU.name, direction: 'top' },
    });
    map.add(campusMarker);
    markers.push(campusMarker);

    // 添加餐厅标记
    currentRestaurants.forEach(poi => {
        const position = validLocation(poi.location);
        if (!position) return;
        const marker = new AMap.Marker({ position, title: poi.name });
        marker.on('click', () => showRestaurantDetail(poi));
        map.add(marker);
        markers.push(marker);
    });

    // 自动调整视野
    if (markers.length > 1) {
        map.setFitView(markers, false, [60, 60, 60, 60], 16);
    } else {
        map.setZoomAndCenter(15, NJU_GULOU.center);
    }
}

/**
 * 初始化地图页面（由页面切换时调用）
 * 确保地图容器可见且高德 API 加载完成
 */
export async function initMapPage() {
    const mapContainer = document.getElementById('mapContainer');
    if (!mapContainer) {
        console.error('地图容器 #mapContainer 不存在');
        return;
    }

    // 确保容器有高度（如果为0则设置一个最小高度，防止地图渲染空白）
    const ensureHeight = () => {
        if (mapContainer.clientHeight <= 0) {
            mapContainer.style.height = '500px';
            mapContainer.style.minHeight = '500px';
        }
    };
    ensureHeight();

    // 显示加载中状态
    mapContainer.innerHTML = '<div class="map-loading">地图加载中…</div>';

    try {
        // 等待高德 JS API 加载完成
        const AMapInstance = await loadAmapScript();
        if (!AMapInstance) {
            mapContainer.innerHTML = '<div class="map-loading">高德地图 Key 未配置或无效，请检查 config.js</div>';
            return;
        }

        // 如果地图实例已存在，先销毁（避免重复创建）
        if (map) {
            map.destroy();
            map = null;
        }

        // 清空容器，创建新地图
        mapContainer.innerHTML = '';
        map = new AMapInstance.Map(mapContainer, {
            zoom: 15,
            center: NJU_GULOU.center,
            viewMode: '2D',
            resizeEnable: true,       // 允许窗口大小改变时自动调整
            showIndoorMap: false,     // 关闭室内地图，减少干扰
        });

        // 可选：添加一个简单的背景测试标记，确认地图底层已加载（正式使用时可以删除）
        // new AMapInstance.Marker({ position: NJU_GULOU.center, map: map });

        // 监听地图渲染完成事件（确保底图瓦片已加载）
        map.on('complete', () => {
            console.log('高德地图底图加载完成');
            // 如果还没有餐厅数据，就加载一次
            if (!currentRestaurants.length) {
                refreshRestaurants().then(() => {
                    renderMapMarkers();
                });
            } else {
                renderMapMarkers();
            }
        });

        // 如果地图已经完成（避免 complete 事件未触发），直接渲染标记
        if (map.getZoom()) {
            if (!currentRestaurants.length) {
                await refreshRestaurants();
            }
            renderMapMarkers();
        }

        // 监听窗口 resize 事件，避免地图容器变化后空白
        window.addEventListener('resize', () => {
            if (map) map.resize();
        });

    } catch (err) {
        console.error('地图初始化失败:', err);
        mapContainer.innerHTML = `<div class="map-loading">地图加载失败：${err.message || '请检查高德 Key 或网络'}</div>`;
        showToast('地图加载失败，请检查控制台错误', 3000);
    }
}

/**
 * 初始化餐厅页面（仅绑定刷新按钮，不直接加载地图）
 */
export function initRestaurantsPage() {
    const refreshBtn = document.getElementById('refreshRestosBtn');
    if (refreshBtn) refreshBtn.onclick = () => refreshRestaurants();
    refreshRestaurants();
}