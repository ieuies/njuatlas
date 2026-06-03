import { searchPlaces } from '../api.js';
import { showToast } from '../utils.js';

// 静态玩乐数据（后续可接入高德景点搜索）
const funSpots = [
    {
        name: '羊山公园',
        desc: '露营、野餐、放风筝，周末好去处',
        image: 'https://picsum.photos/id/15/400/200',
        type: '玩乐',
        address: '仙林大道与九乡河路交叉口'
    },
    {
        name: '仙林湖公园',
        desc: '环湖步道，日落绝美，适合散步拍照',
        image: 'https://picsum.photos/id/96/400/200',
        type: '玩乐',
        address: '仙林湖路与纬地路交叉口'
    },
    {
        name: '可一书店·可一咖啡馆',
        desc: '文艺书店+咖啡，安静自习好去处',
        image: 'https://picsum.photos/id/20/400/200',
        type: '玩乐',
        address: '仙林大学城杉湖东路'
    },
    {
        name: '金鹰湖滨天地',
        desc: '购物、餐饮、电影院，一站式休闲',
        image: 'https://picsum.photos/id/30/400/200',
        type: '玩乐',
        address: '仙林学海路1号'
    },
    {
        name: '南京大学星湖',
        desc: '校内最美观景点，黑天鹅、樱花大道',
        image: 'https://picsum.photos/id/29/400/200',
        type: '校园',
        address: '南京大学仙林校区内'
    }
];

/**
 * 渲染指南瀑布流
 * @param {Array} items - 混合数据（餐厅+玩乐）
 */
function renderGuideGrid(items) {
    const container = document.getElementById('guideGrid');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="guide-loading">暂无推荐内容，敬请期待～</div>';
        return;
    }

    const html = items.map(item => `
        <div class="guide-card">
            <img class="guide-img" src="${item.image || 'https://picsum.photos/400/200?random=' + Math.random()}" alt="${escapeHtml(item.name)}" loading="lazy">
            <div class="guide-info">
                <div class="guide-title">${escapeHtml(item.name)}</div>
                <div class="guide-desc">${escapeHtml(item.desc || item.address || '')}</div>
                ${item.type ? `<span class="guide-type">${escapeHtml(item.type)}</span>` : ''}
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

/**
 * 加载指南数据：混合高德餐厅推荐 + 静态玩乐数据
 */
export async function loadGuideData() {
    try {
        // 1. 从高德搜索一些餐厅（关键词：美食，南京仙林附近）
        const searchResult = await searchPlaces('美食', '南京', null, 1, 10);
        let restaurants = [];
        if (searchResult.status === '1' && Array.isArray(searchResult.pois)) {
            restaurants = searchResult.pois.slice(0, 6).map(poi => ({
                name: poi.name,
                desc: poi.address || '',
                image: poi.photos?.[0]?.url || `https://picsum.photos/400/200?random=${poi.id}`,
                type: '美食',
                address: poi.address
            }));
        }

        // 2. 合并静态玩乐数据
        const allItems = [...restaurants, ...funSpots];
        // 简单打乱顺序，让美食和玩乐混合展示
        for (let i = allItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allItems[i], allItems[j]] = [allItems[j], allItems[i]];
        }

        renderGuideGrid(allItems);
    } catch (error) {
        console.error('加载指南数据失败:', error);
        showToast('加载推荐失败，请稍后重试');
        // 降级：只显示静态数据
        renderGuideGrid(funSpots);
    }
}

/**
 * 初始化指南页面（由 app.js 切换时调用）
 */
export function initGuidePage() {
    const container = document.getElementById('guideGrid');
    if (container && container.innerHTML === '') {
        container.innerHTML = '<div class="guide-loading">加载精彩推荐中...</div>';
    }
    loadGuideData();
}

// 辅助函数
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
