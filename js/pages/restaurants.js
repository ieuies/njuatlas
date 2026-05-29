import { searchPlaces, addRestaurant, getRestaurantStats, toggleLike, toggleFavorite, addReview, getRecommendSlogan } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { isLoggedIn } from '../auth.js';

let currentRestaurants = [];
let map = null;
let markers = [];

// 分页相关变量
let currentPage = 1;
const pageSize = 20;
let totalPages = 1;
let currentKeyword = '美食';
let currentCity = '南京';

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

// 渲染分页按钮
function renderPagination() {
    const container = document.getElementById('pagination');
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    // 上一页
    html += `<button class="page-btn prev-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
    
    // 页码列表（最多显示5个）
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    // 下一页
    html += `<button class="page-btn next-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
    
    container.innerHTML = html;
    
    // 绑定事件
    container.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (btn.classList.contains('disabled')) return;
            let targetPage = currentPage;
            if (btn.classList.contains('prev-btn')) targetPage = currentPage - 1;
            else if (btn.classList.contains('next-btn')) targetPage = currentPage + 1;
            else targetPage = parseInt(btn.getAttribute('data-page'), 10);
            if (targetPage >= 1 && targetPage <= totalPages) {
                refreshRestaurants(currentKeyword, currentCity, targetPage);
            }
        });
    });
}

// 显示餐厅详情（保持不变，只复制你原有的代码即可）
async function showRestaurantDetail(poi) {
    // 检查本地是否已存在该餐厅（通过poi_id）
    let localRestaurantId = null;
    try {
        const addRes = await addRestaurant(poi.name, poi.address, poi.location, poi.id);
        localRestaurantId = addRes.id;
    } catch(e) {
        showToast('无法获取餐厅信息');
        return;
    }
    // 获取统计信息
    let stats = { likes: 0, favorites: 0, reviews: [] };
    try {
        stats = await getRestaurantStats(localRestaurantId);
    } catch(e) {}
    
    document.getElementById('modalTitle').innerText = poi.name;
    document.getElementById('modalDesc').innerHTML = `${escapeHtml(poi.address)}<br>👍 ${stats.likes} 点赞 | ⭐ ${stats.favorites} 收藏`;
    const reviewsHtml = stats.reviews.map(r => `<div><b>用户${r.user_id}</b>: ${escapeHtml(r.content)} <small>${new Date(r.created_at).toLocaleString()}</small></div>`).join('');
    document.getElementById('modalReviews').innerHTML = reviewsHtml || '暂无评论';
    
    const likeBtn = document.getElementById('likeRestoBtn');
    const favBtn = document.getElementById('favRestoBtn');
    likeBtn.onclick = async () => {
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        await toggleLike(localRestaurantId);
        showToast('已切换点赞');
        showRestaurantDetail(poi);
    };
    favBtn.onclick = async () => {
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        await toggleFavorite(localRestaurantId);
        showToast('已切换收藏');
        showRestaurantDetail(poi);
    };
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

// 搜索餐厅（支持分页）
export async function refreshRestaurants(keyword = '美食', city = '南京', page = 1) {
    const container = document.getElementById('restoList');
    if (container) container.innerHTML = '加载中...';
    currentKeyword = keyword;
    currentCity = city;
    currentPage = page;
    
    try {
        const data = await searchPlaces(keyword, city, null, page, pageSize);
        if (data.status === '1' && data.pois) {
            currentRestaurants = data.pois;
            renderRestaurantList(currentRestaurants);
            // 计算总页数（高德返回的count是字符串，表示符合条件的总数）
            const totalCount = parseInt(data.count, 10) || 0;
            totalPages = Math.ceil(totalCount / pageSize);
            renderPagination();
        } else {
            container.innerHTML = '<p>未找到餐厅，试试其他关键词</p>';
            totalPages = 1;
            renderPagination();
        }
    } catch(e) {
        container.innerHTML = '<p>加载失败</p>';
        totalPages = 1;
        renderPagination();
    }
}

// 地图初始化
export async function initMapPage() {
    if (!window.AMap) {
        setTimeout(initMapPage, 500);
        return;
    }
    const mapContainer = document.getElementById('mapContainer');
    if (!map) {
        map = new AMap.Map('mapContainer', { zoom: 14, center: [118.788, 32.042] });
    }
    // 加载餐厅并打点（如果没有数据则先搜索）
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
    const refreshBtn = document.getElementById('refreshRestosBtn');
    if (refreshBtn) {
        refreshBtn.onclick = () => refreshRestaurants(currentKeyword, currentCity, 1);
    }
    refreshRestaurants();
}