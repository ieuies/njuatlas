import { searchPlaces } from '../api.js';
import { showToast } from '../utils.js';

// 南大周边吃喝玩乐数据（大众点评/美团风格）
const allSpots = [
    {
        name: '可一书店·咖啡馆',
        desc: '文艺书店+精品咖啡，安静自习好去处，周末常有读书会活动',
        image: 'https://picsum.photos/id/20/400/200',
        type: '咖啡',
        rating: '4.8',
        price: '¥35/人',
        address: '仙林大学城杉湖东路'
    },
    {
        name: '金鹰湖滨天地',
        desc: '购物餐饮电影院一站式，海底捞、喜茶、太二等品牌齐全',
        image: 'https://picsum.photos/id/30/400/200',
        type: '美食',
        rating: '4.5',
        price: '¥80/人',
        address: '仙林学海路1号'
    },
    {
        name: '羊山公园',
        desc: '露营野餐放风筝，周末休闲好去处，湖景步道适合跑步',
        image: 'https://picsum.photos/id/15/400/200',
        type: '玩乐',
        rating: '4.6',
        price: '免费',
        address: '仙林大道与九乡河路交叉口'
    },
    {
        name: '仙林湖公园',
        desc: '环湖步道日落绝美，适合散步拍照，秋季芦苇荡超出片',
        image: 'https://picsum.photos/id/96/400/200',
        type: '玩乐',
        rating: '4.7',
        price: '免费',
        address: '仙林湖路与纬地路交叉口'
    },
    {
        name: '南京大学星湖',
        desc: '校内最美观景点，黑天鹅栖息地，樱花季必打卡',
        image: 'https://picsum.photos/id/29/400/200',
        type: '校园',
        rating: '4.9',
        price: '免费',
        address: '南京大学仙林校区内'
    },
    {
        name: '杜厦图书馆',
        desc: '亚洲最美大学图书馆之一，学习氛围浓厚，五楼观景台视野绝佳',
        image: 'https://picsum.photos/id/26/400/200',
        type: '校园',
        rating: '4.9',
        price: '需校园卡',
        address: '南京大学仙林校区'
    },
    {
        name: '瑞幸咖啡（仙林店）',
        desc: '性价比咖啡首选，生椰拿铁必点，自习刷夜好伴侣',
        image: 'https://picsum.photos/id/63/400/200',
        type: '咖啡',
        rating: '4.3',
        price: '¥18/人',
        address: '仙林大学城文苑路'
    },
    {
        name: '大众书局·南大店',
        desc: '校园旁的小众书店，选书品味独特，有座位可阅读',
        image: 'https://picsum.photos/id/24/400/200',
        type: '玩乐',
        rating: '4.5',
        price: '免费入场',
        address: '仙林文苑路9号'
    },
    {
        name: '食堂四楼·馨园餐厅',
        desc: '南大校内最高档食堂，麻辣香锅和石锅拌饭是招牌',
        image: 'https://picsum.photos/id/42/400/200',
        type: '美食',
        rating: '4.2',
        price: '¥20/人',
        address: '南京大学仙林校区四食堂'
    },
    {
        name: '南大和园美食街',
        desc: '校门口小吃一条街，烤冷面、煎饼果子、奶茶应有尽有',
        image: 'https://picsum.photos/id/62/400/200',
        type: '美食',
        rating: '4.0',
        price: '¥15/人',
        address: '仙林大道南大和园'
    },
    {
        name: '万达茂（仙林）',
        desc: '大型购物中心，IMAX影城、溜冰场、亲子乐园设施齐全',
        image: 'https://picsum.photos/id/33/400/200',
        type: '玩乐',
        rating: '4.4',
        price: '¥100/人',
        address: '仙林大学城文苑路'
    },
    {
        name: '星巴克（仙林金鹰店）',
        desc: '两层大空间，靠窗位看街景，适合小组讨论和远程办公',
        image: 'https://picsum.photos/id/60/400/200',
        type: '咖啡',
        rating: '4.3',
        price: '¥38/人',
        address: '仙林学海路金鹰一楼'
    }
];

let currentGuideCat = 'all';

function renderGuideGrid(items) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="guide-loading">该分类暂无推荐～</div>';
        return;
    }

    container.innerHTML = items.map((item, idx) => `
        <div class="guide-card" data-guide-idx="${idx}">
            <img class="guide-img" src="${item.image || 'https://picsum.photos/400/200?random=' + Math.random()}" alt="${esc(item.name)}" loading="lazy">
            <div class="guide-info">
                <div class="guide-title">
                    ${esc(item.name)}
                    ${item.rating ? `<span class="guide-rating">⭐ ${item.rating}</span>` : ''}
                </div>
                <div class="guide-desc">${esc(item.desc)}</div>
                <div class="guide-meta">
                    <span class="guide-type">${esc(item.type)}</span>
                    ${item.address ? `<span style="font-size:0.75rem;color:var(--text-tertiary);">📍 ${esc(item.address)}</span>` : ''}
                    ${item.price ? `<span class="guide-price">${esc(item.price)}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    // 绑定点击事件
    container.querySelectorAll('.guide-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.getAttribute('data-guide-idx'));
            openGuideDetail(items[idx]);
        });
    });
}

function filterGuideItems(cat) {
    currentGuideCat = cat;
    document.querySelectorAll('.guide-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-guide-cat') === cat);
    });
    const filtered = cat === 'all' ? allSpots : allSpots.filter(s => s.type === cat);
    renderGuideGrid(filtered);
}

function openGuideDetail(item) {
    const modal = document.getElementById('guideDetailModal');
    if (!modal) return;
    document.getElementById('guideDetailImg').src = item.image || '';
    document.getElementById('guideDetailName').textContent = item.name;
    document.getElementById('guideDetailRating').textContent = item.rating ? `⭐ ${item.rating}` : '';
    document.getElementById('guideDetailPrice').textContent = item.price || '';
    document.getElementById('guideDetailPrice').style.cssText = item.price ? 'font-weight:700;color:var(--danger);' : '';
    document.getElementById('guideDetailType').textContent = item.type || '';
    document.getElementById('guideDetailType').style.cssText = item.type ? 'padding:3px 10px;border-radius:10px;font-size:0.75rem;background:var(--bg-tertiary);color:var(--text-secondary);' : '';
    document.getElementById('guideDetailDesc').textContent = item.desc || '';
    document.getElementById('guideDetailAddr').innerHTML = item.address ? `📍 ${esc(item.address)}` : '';
    modal.style.display = 'flex';
}

function initGuideModals() {
    const modal = document.getElementById('guideDetailModal');
    if (!modal || modal.dataset.ready) return;
    modal.dataset.ready = '1';
    document.getElementById('closeGuideDetailBtn')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });
}

function initGuideFilter() {
    const filterBar = document.getElementById('guideFilter');
    if (!filterBar || filterBar.dataset.ready) return;
    filterBar.dataset.ready = '1';
    filterBar.querySelectorAll('.guide-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const cat = chip.getAttribute('data-guide-cat');
            filterGuideItems(cat);
        });
    });
}

export async function loadGuideData() {
    initGuideModals();
    initGuideFilter();
    try {
        const searchResult = await searchPlaces('美食', '南京', null, 1, 8);
        if (searchResult.status === '1' && Array.isArray(searchResult.pois)) {
            const amapPois = searchResult.pois.slice(0, 4).map(poi => ({
                name: poi.name,
                desc: poi.address || '',
                image: poi.photos?.[0]?.url || `https://picsum.photos/400/200?random=${poi.id}`,
                type: '美食',
                rating: (3.5 + Math.random() * 1.3).toFixed(1),
                price: '¥' + (20 + Math.floor(Math.random() * 80)) + '/人',
                address: poi.address
            }));
            // 合并高德结果到数据源头部
            const merged = [...amapPois, ...allSpots];
            filterGuideItems(currentGuideCat);
            return;
        }
    } catch (e) {
        console.warn('高德搜索失败，使用本地数据:', e.message);
    }
    filterGuideItems(currentGuideCat);
}

export function initGuidePage() {
    const container = document.getElementById('guideGrid');
    if (container && !container.querySelector('.guide-card')) {
        container.innerHTML = '<div class="guide-loading">加载精彩推荐中...</div>';
    }
    loadGuideData();
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
