import { searchPlaces, addRestaurant, getRestaurantStats, toggleLike, toggleFavorite, addReview, getRecommendSlogan } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentRestaurants = [];   // 存储搜索结果
let map = null;
let markers = [];

// 渲染餐厅卡片
function renderRestaurantList(restaurants) {
    const container = document.getElementById('restoList');
    if (!restaurants.length) {
        container.innerHTML = '<p>暂无餐厅，试试搜索其他关键词</p>';
        return;
    }
    container.innerHTML = restaurants.map(r => `
        <div class="resto-card" data-poi='${JSON.stringify(r)}'>
            <div class="resto-img" style="background-image: url('${r.photos?.[0]?.url || 'https://picsum.photos/300/160?random='+r.id}');"></div>
            <div class="resto-info">
                <div class="resto-name">${escapeHtml(r.name)}</div>
                <div>${escapeHtml(r.address)}</div>
                <div>⭐ ${r.biz_ext?.rating || '暂无评分'} | 💰 ${r.biz_ext?.cost || '未知'}</div>
            </div>
        </div>
    `).join('');
    // 绑定点击事件
    document.querySelectorAll('.resto-card').forEach(card => {
        card.addEventListener('click', () => {
            const poi = JSON.parse(card.getAttribute('data-poi'));
            showRestaurantDetail(poi);
        });
    });
}

// 显示餐厅详情（模态框）
async function showRestaurantDetail(poi) {
    // 检查本地是否已存在该餐厅（通过poi_id）
    let localRestaurantId = null;
    // 调用后端添加餐厅（如果已存在会返回已有id）
    try {
        const addRes = await addRestaurant(poi.name, poi.address, poi.location, poi.id);
        localRestaurantId = addRes.id;
    } catch(e) {
        showToast('无法获取餐厅信息');
        return;
    }
    // 获取统计信息（点赞、收藏、评论）
    let stats = { likes: 0, favorites: 0, reviews: [] };
    try {
        stats = await getRestaurantStats(localRestaurantId);
    } catch(e) {}
    
    document.getElementById('modalTitle').innerText = poi.name;
    document.getElementById('modalDesc').innerHTML = `${escapeHtml(poi.address)}<br>👍 ${stats.likes} 点赞 | ⭐ ${stats.favorites} 收藏`;
    const reviewsHtml = stats.reviews.map(r => `<div><b>用户${r.user_id}</b>: ${escapeHtml(r.content)} <small>${new Date(r.created_at).toLocaleString()}</small></div>`).join('');
    document.getElementById('modalReviews').innerHTML = reviewsHtml || '暂无评论';
    
    // 绑定点赞收藏按钮
    const likeBtn = document.getElementById('likeRestoBtn');
    const favBtn = document.getElementById('favRestoBtn');
    likeBtn.onclick = async () => {
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        await toggleLike(localRestaurantId);
        showToast('已切换点赞');
        // 刷新详情
        showRestaurantDetail(poi);
    };
    favBtn.onclick = async () => {
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        await toggleFavorite(localRestaurantId);
        showToast('已切换收藏');
        showRestaurantDetail(poi);
    };
    // 发表评论
    const postBtn = document.getElementById('postReviewBtn');
    const newReview = document.getElementById('newReview');
    postBtn.onclick = async () => {
        if (!isLoggedIn()) { showToast('请先登录'); return; }
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

// 搜索餐厅（默认关键词“美食”）
export async function refreshRestaurants(keyword = '美食', city = '南京') {
    const container = document.getElementById('restoList');
    container.innerHTML = '加载中...';
    try {
        const data = await searchPlaces(keyword, city);
        if (data.status === '1' && data.pois) {
            currentRestaurants = data.pois;
            renderRestaurantList(currentRestaurants);
        } else {
            container.innerHTML = '<p>未找到餐厅，试试其他关键词</p>';
        }
    } catch(e) {
        container.innerHTML = '<p>加载失败</p>';
    }
}

// 地图初始化与标记
export async function initMapPage() {
    if (!window.AMap) {
        setTimeout(initMapPage, 500);
        return;
    }
    const mapContainer = document.getElementById('mapContainer');
    if (!map) {
        map = new AMap.Map('mapContainer', { zoom: 14, center: [118.788, 32.042] });
    }
    // 加载餐厅并打点
    if (!currentRestaurants.length) await refreshRestaurants();
    if (markers.length) map.remove(markers);
    markers = [];
    currentRestaurants.forEach(poi => {
        if (poi.location) {
            const lnglat = poi.location.split(',');
            const marker = new AMap.Marker({ position: [parseFloat(lnglat[0]), parseFloat(lnglat[1])], title: poi.name });
            marker.on('click', () => showRestaurantDetail(poi));
            map.add(marker);
            markers.push(marker);
        }
    });
    if (markers.length) map.setFitView(markers);
}

export function initRestaurantsPage() {
    document.getElementById('refreshRestosBtn').onclick = () => refreshRestaurants();
    refreshRestaurants();
}