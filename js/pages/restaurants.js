import { searchPlaces, addRestaurant, getRestaurantStats, toggleLike, toggleFavorite, addReview } from '../api.js';
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
    let localRestaurantId = null;
    try {
        const addRes = await addRestaurant(poi.name, poi.address, poi.location, poi.id);
        localRestaurantId = addRes.id;
    } catch(e) {
        showToast('无法获取餐厅信息');
        return;
    }

    let stats = { likes: 0, favorites: 0, reviews: [] };
    try {
        stats = await getRestaurantStats(localRestaurantId);
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
        await toggleLike(localRestaurantId);
        showToast('已切换点赞');
        showRestaurantDetail(poi);
    };
    favBtn.onclick = async () => {
        if (!isLoggedIn()) return showToast('请先登录');
        await toggleFavorite(localRestaurantId);
        showToast('已切换收藏');
        showRestaurantDetail(poi);
    };

    const postBtn = document.getElementById('postReviewBtn');
    const newReview = document.getElementById('newReview');
    postBtn.onclick = async () => {
        if (!isLoggedIn()) return showToast('请先登录');
        const content = newReview.value.trim();
        if (!content) return showToast('评论内容不能为空');
        await addReview(localRestaurantId, content);
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
        renderMapMarkers();
    } catch(e) {
        container.innerHTML = '<p class="list-empty">加载失败，请检查高德 API 配置或稍后重试</p>';
    }
}

function renderMapMarkers() {
    if (!map || !window.AMap) return;

    if (markers.length) map.remove(markers);
    markers = [];

    const campusMarker = new AMap.Marker({
        position: NJU_GULOU.center,
        title: NJU_GULOU.name,
        label: { content: NJU_GULOU.name, direction: 'top' },
    });
    map.add(campusMarker);
    markers.push(campusMarker);

    currentRestaurants.forEach(poi => {
        const position = validLocation(poi.location);
        if (!position) return;
        const marker = new AMap.Marker({ position, title: poi.name });
        marker.on('click', () => showRestaurantDetail(poi));
        map.add(marker);
        markers.push(marker);
    });

    if (markers.length > 1) {
        map.setFitView(markers, false, [60, 60, 60, 60], 16);
    } else {
        map.setZoomAndCenter(15, NJU_GULOU.center);
    }
}

export async function initMapPage() {
    const mapContainer = document.getElementById('mapContainer');
    if (!mapContainer) return;

    if (!map) mapContainer.innerHTML = '<div class="map-loading">地图加载中...</div>';

    try {
        const AMapInstance = await loadAmapScript();
        if (!AMapInstance) {
            mapContainer.innerHTML = '<div class="map-loading">高德地图 Key 未配置</div>';
            return;
        }

        if (!map) {
            mapContainer.innerHTML = '';
            map = new AMapInstance.Map(mapContainer, {
                zoom: 15,
                center: NJU_GULOU.center,
                viewMode: '2D',
            });
        } else {
            map.resize();
            map.setZoomAndCenter(15, NJU_GULOU.center);
        }

        if (!currentRestaurants.length) await refreshRestaurants();
        renderMapMarkers();
        setTimeout(() => map.resize(), 0);
    } catch(e) {
        mapContainer.innerHTML = '<div class="map-loading">地图加载失败，请检查高德 JS API Key 或安全密钥</div>';
    }
}

export function initRestaurantsPage() {
    document.getElementById('refreshRestosBtn').onclick = () => refreshRestaurants();
    refreshRestaurants();
}
