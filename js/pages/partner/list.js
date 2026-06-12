import { showToast, escapeHtml, avatarHtmlForUser, getAppScroller, isMobileViewport } from '../../utils.js';
import { isLoggedIn, getUser } from '../../auth.js';
import { listPosts, deletePost, participateEvent, togglePostLike, togglePostFavorite } from '../../api.js';
import {
    partnerStore, PAGE_SIZE, LIST_CACHE_TTL_MS, FULL_LIST_CACHE_TTL_MS, LIST_RENDER_BATCH,
    partnerListCache, partnerListCacheKey,
} from './shared.js';
import { mapPost, typeLabel, isCurrentUserOwner } from './shared.js';
import { openPostDetail } from './post-detail.js';
import { refreshPreviewMarkers } from './map.js';

// ============================================================
// 数据加载：分页从后端 API 获取帖子列表
// ============================================================

const PARTNER_SESSION_CACHE_PREFIX = 'partner_list_v1_';

function _isCacheFresh(entry) {
    if (!entry?.at) return false;
    const ttl = entry.fullyLoaded ? FULL_LIST_CACHE_TTL_MS : LIST_CACHE_TTL_MS;
    return Date.now() - entry.at < ttl;
}

function _persistSessionCache(key, entry) {
    try {
        sessionStorage.setItem(PARTNER_SESSION_CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (_) { /* quota or private mode */ }
}

function _hydrateSessionCache(key) {
    try {
        const raw = sessionStorage.getItem(PARTNER_SESSION_CACHE_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function _writeListCacheFor(category, searchQuery, posts, hasMore, pagesLoaded = 1) {
    const key = partnerListCacheKey(category, searchQuery, 1);
    const entry = {
        at: Date.now(),
        posts,
        hasMore,
        pagesLoaded,
        fullyLoaded: !hasMore,
    };
    partnerListCache.set(key, entry);
    _persistSessionCache(key, entry);
}

function _getCategoryCache(category, searchQuery) {
    const key = partnerListCacheKey(category, searchQuery, 1);
    let cached = partnerListCache.get(key);
    if (!cached) {
        cached = _hydrateSessionCache(key);
        if (cached) partnerListCache.set(key, cached);
    }
    return cached;
}

function _writeListCache(posts, hasMore, pagesLoaded = partnerStore.currentPage) {
    _writeListCacheFor(
        partnerStore.currentCategory,
        partnerStore.searchQuery,
        posts,
        hasMore,
        pagesLoaded,
    );
}

function _readListCache() {
    return _getCategoryCache(partnerStore.currentCategory, partnerStore.searchQuery);
}

/** 发布/编辑/删除后清掉列表缓存，避免 loadPostsByPage 读到旧数据 */
export function invalidatePartnerListCache() {
    partnerListCache.clear();
    partnerStore._prefetchPromise = null;
    try {
        const prefix = PARTNER_SESSION_CACHE_PREFIX;
        const keys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(prefix)) keys.push(key);
        }
        keys.forEach((key) => sessionStorage.removeItem(key));
    } catch (_) { /* quota or private mode */ }
}

function _postMatchesCurrentView(post) {
    const cat = partnerStore.currentCategory;
    if (cat !== 'all' && !(post.tags || []).includes(cat)) return false;
    const q = (partnerStore.searchQuery || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [
        post.title,
        post.description,
        post.location,
        post.publisher,
        ...(post.tags || []),
    ].join(' ').toLowerCase();
    return hay.includes(q);
}

/** 用 create/update 接口返回的帖子立即更新瀑布流，无需等待整页重载 */
export function applyPostFromApi(apiPost) {
    if (!apiPost?.id) return null;
    const mapped = mapPost(apiPost);
    invalidatePartnerListCache();

    const visible = _postMatchesCurrentView(mapped);
    partnerStore.allPartnersData = partnerStore.allPartnersData.filter((p) => p.id !== mapped.id);
    if (visible) partnerStore.allPartnersData.unshift(mapped);
    partnerStore.partnersData = partnerStore.allPartnersData;

    const container = document.getElementById('partnerWaterfall');
    if (container) {
        container.querySelectorAll(`.partner-card[data-id="${mapped.id}"]`).forEach((el) => el.remove());
        if (visible) {
            const empty = container.querySelector('.partner-empty-state');
            if (empty) container.innerHTML = '';
            container.insertBefore(createPostCardElement(mapped), container.firstChild);
            bindCardEvents(container);
        }
    }

    _writeListCache(
        partnerStore.allPartnersData,
        partnerStore.hasMore,
        partnerStore.currentPage,
    );
    return mapped;
}

/** 发布前先插入占位卡片，接口返回后再替换为真实数据 */
export function applyOptimisticPost(payload) {
    const user = getUser();
    const tempId = -Date.now();
    applyPostFromApi({
        id: tempId,
        type: payload.type,
        title: payload.title,
        content: payload.content,
        tags: payload.tags || [],
        location_name: payload.location_name,
        location: payload.location,
        urgency: payload.urgency,
        event_time: payload.event_time,
        event_end_time: payload.event_end_time,
        max_participants: payload.slots,
        budget: payload.budget,
        contact: payload.contact,
        user_id: user?.id ?? user?.user_id,
        username: user?.username || '我',
        avatar_url: user?.avatar_url || '',
        view_count: 0,
        like_count: 0,
        favorite_count: 0,
        comment_count: 0,
        participant_count: 0,
        hot_score: 0,
        is_official: false,
        is_owner: true,
        is_liked: false,
        is_favorited: false,
        participation_status: null,
        created_at: new Date().toISOString(),
    });
    return tempId;
}
export function removePostFromList(postId) {
    const id = Number(postId);
    if (!id) return;
    invalidatePartnerListCache();
    partnerStore.allPartnersData = partnerStore.allPartnersData.filter((p) => p.id !== id);
    partnerStore.partnersData = partnerStore.allPartnersData;

    document.querySelectorAll(`.partner-card[data-id="${id}"]`).forEach((el) => el.remove());
    const container = document.getElementById('partnerWaterfall');
    if (container && !partnerStore.allPartnersData.length) {
        const q = partnerStore.searchQuery;
        container.innerHTML = q
            ? `<div class="partner-empty-state">未找到与「${escapeHtml(q)}」相关的帖子，试试换个关键词</div>`
            : '<div class="partner-empty-state">暂无组局，快来发起第一个吧~</div>';
    }

    _writeListCache(
        partnerStore.allPartnersData,
        partnerStore.hasMore,
        partnerStore.currentPage,
    );
    refreshPreviewMarkers();
}

function _isPostNotFoundError(err) {
    const msg = err?.message || '';
    return msg === '帖子不存在' || msg.includes('post_not_found') || msg.includes('404');
}

async function _deletePostCard(postId) {
    if (!confirm('确定要删除这条组局吗？\n\n此操作不可撤销，所有评论和报名数据将被永久删除。')) return;

    const snapshot = partnerStore.allPartnersData.slice();
    removePostFromList(postId);

    try {
        await deletePost(postId, { silent: true });
        showToast('已删除');
    } catch (err) {
        if (_isPostNotFoundError(err)) {
            showToast('该帖子已不存在，已从列表移除');
            return;
        }
        partnerStore.allPartnersData = snapshot;
        partnerStore.partnersData = snapshot;
        renderWaterfall();
        refreshPreviewMarkers();
        showToast('删除失败: ' + err.message);
    }
}

function _filterPostsByCategory(posts, category) {
    if (category === 'all') return posts;
    return posts.filter(p => p.tags.includes(category));
}

function _resolveCategoryPosts(category, searchQuery) {
    const direct = _getCategoryCache(category, searchQuery);
    if (direct?.posts) {
        return {
            posts: direct.posts,
            hasMore: direct.hasMore,
            pagesLoaded: direct.pagesLoaded || 1,
            stale: !_isCacheFresh(direct),
        };
    }

    if (category !== 'all' && !searchQuery) {
        const allCached = _getCategoryCache('all', '');
        if (allCached?.fullyLoaded && allCached.posts?.length) {
            const filtered = _filterPostsByCategory(allCached.posts, category);
            _writeListCacheFor(category, '', filtered, false, allCached.pagesLoaded || 1);
            return {
                posts: filtered,
                hasMore: false,
                pagesLoaded: allCached.pagesLoaded || 1,
                stale: !_isCacheFresh(allCached),
            };
        }
    }
    return null;
}

function _applyCachedCategoryView(category, searchQuery) {
    const resolved = _resolveCategoryPosts(category, searchQuery);
    if (!resolved) return false;

    partnerStore.allPartnersData = resolved.posts;
    partnerStore.partnersData = resolved.posts;
    partnerStore.hasMore = resolved.hasMore;
    partnerStore.currentPage = resolved.pagesLoaded;
    renderWaterfall();
    refreshPreviewMarkers();
    if (resolved.stale) {
        loadPostsByPage(1, false, { background: true });
    }
    return true;
}

export function showPartnerSkeleton(count = 6) {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () => (
        '<article class="partner-card partner-brief-card partner-card-skeleton" aria-hidden="true">'
        + '<div class="partner-skeleton-line partner-skeleton-line--sm"></div>'
        + '<div class="partner-skeleton-line partner-skeleton-line--lg"></div>'
        + '<div class="partner-skeleton-line partner-skeleton-line--md"></div>'
        + '<div class="partner-skeleton-line partner-skeleton-line--full"></div>'
        + '</article>'
    )).join('');
}

/** 空闲时预拉首屏列表，进入找搭子时可秒开 */
export function prefetchPartnerList() {
    if (partnerStore._prefetchPromise) return partnerStore._prefetchPromise;
    partnerStore._prefetchPromise = (async () => {
        try {
            const result = await listPosts({ page: 1, page_size: PAGE_SIZE, sort: 'hot' });
            const posts = (result.items || []).map(mapPost);
            _writeListCacheFor('all', '', posts, posts.length === PAGE_SIZE, 1);
        } catch (e) {
            partnerStore._prefetchPromise = null;
        }
    })();
    return partnerStore._prefetchPromise;
}

/** 根据当前分类加载指定页码的数据，append=true 时追加到缓存并追加渲染，否则重置 */
export async function loadPostsByPage(page, append = false, { background = false, forceRefresh = false } = {}) {
    if (partnerStore.isLoading && !background) return [];

    if (!append && page === 1 && !background && !forceRefresh) {
        const cached = _readListCache();
        if (cached?.posts) {
            partnerStore.allPartnersData = cached.posts;
            partnerStore.partnersData = cached.posts;
            partnerStore.hasMore = cached.hasMore;
            partnerStore.currentPage = cached.pagesLoaded || 1;
            renderWaterfall();
            if (!_isCacheFresh(cached)) {
                loadPostsByPage(1, false, { background: true });
            }
            return cached.posts;
        }
        showPartnerSkeleton();
    }

    if (!background) partnerStore.isLoading = true;

    try {
        const params = {
            page: page,
            page_size: PAGE_SIZE,
            sort: 'hot',
        };
        if (partnerStore.currentCategory !== 'all') {
            params.tags = partnerStore.currentCategory;
        }
        if (partnerStore.searchQuery) {
            params.q = partnerStore.searchQuery;
        }

        const result = await listPosts(params);
        let newPosts = (result.items || []).map(mapPost);

        if (partnerStore.currentCategory !== 'all') {
            newPosts = newPosts.filter(post => post.tags.includes(partnerStore.currentCategory));
        }

        partnerStore.hasMore = newPosts.length === PAGE_SIZE;

        if (append) {
            partnerStore.allPartnersData.push(...newPosts);
            partnerStore.partnersData = partnerStore.allPartnersData;
            appendWaterfallCards(newPosts);
            _writeListCache(partnerStore.allPartnersData, partnerStore.hasMore, page);
        } else {
            const prevIds = background
                ? partnerStore.allPartnersData.map(p => p.id).join(',')
                : '';
            partnerStore.allPartnersData = newPosts;
            partnerStore.partnersData = partnerStore.allPartnersData;
            const nextIds = newPosts.map(p => p.id).join(',');
            // 后台刷新：仅当帖子集合变化时才整页重绘，避免冲掉刚发布/删除的乐观更新
            if (!background) {
                renderWaterfall();
            } else if (prevIds !== nextIds) {
                renderWaterfall();
            }
            _writeListCache(partnerStore.allPartnersData, partnerStore.hasMore, page);
        }
        return newPosts;
    } catch (err) {
        if (!background) {
            console.warn('加载帖子失败:', err.message);
            showToast('加载失败，请稍后重试');
        }
        return [];
    } finally {
        if (!background) partnerStore.isLoading = false;
    }
}
/** 追加渲染新卡片到瀑布流末尾（不重建全部） */
function appendWaterfallCards(posts) {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;

    const fragment = document.createDocumentFragment();
    posts.forEach(p => {
        fragment.appendChild(createPostCardElement(p));
    });
    container.appendChild(fragment);
    bindCardEvents(container);
}

/** 创建单个卡片 DOM 元素 */
function createPostCardElement(p) {
    const article = document.createElement('article');
    article.className = 'partner-card partner-brief-card';
    article.setAttribute('data-id', p.id);
    article.innerHTML = `
        <div class="partner-card-content">
            <div class="partner-card-author-row">
                <div class="partner-card-author">
                    <button class="partner-card-author-avatar-btn" data-user-id="${p.publisherId}" type="button" aria-label="查看 ${escapeHtml(p.publisher)} 的主页">
                        ${avatarHtmlForUser({ id: p.publisherId, username: p.publisher, avatar_url: p.publisherAvatar }, 36, { lazy: true })}
                    </button>
                    <button class="partner-card-author-name-btn" data-user-id="${p.publisherId}" type="button" aria-label="查看 ${escapeHtml(p.publisher)} 的主页">
                        <span class="partner-card-author-name">${escapeHtml(p.publisher)}</span>
                    </button>
                </div>
                <button
                    class="partner-author-favorite-btn${p.isFavorited ? ' liked' : ''}"
                    data-id="${p.id}"
                    type="button"
                    aria-label="${p.isFavorited ? '取消收藏' : '收藏'}"
                    title="${p.isFavorited ? '取消收藏' : '收藏'}"
                >
                    <i class="${p.isFavorited ? 'fa-solid' : 'fa-regular'} fa-star" aria-hidden="true"></i>
                </button>
            </div>
            ${p.coverImage ? `<div class="partner-card-cover"><img src="${escapeHtml(p.coverImage)}" alt="" loading="lazy" decoding="async"></div>` : ''}
            <div class="partner-card-head">
                <div class="partner-card-tags">
                    ${p.tags.filter(t => !/^[\d¥￥]/.test(t) && !['AA', '免费', '自费'].includes(t)).slice(0, 3).map(t => `<span class="partner-card-tag">${escapeHtml(t)}</span>`).join('')}
                </div>
                <span class="partner-card-type">${typeLabel(p)}</span>
            </div>
            <h3 class="partner-card-title">${escapeHtml(p.title)}</h3>
            <p class="partner-card-desc">${escapeHtml(p.description).substring(0, 120)}</p>
            <div class="partner-card-meta" aria-label="组局信息">
                ${p.location ? `<span><b>地点</b><em>${escapeHtml(p.location)}</em></span>` : ''}
                ${p.budget ? `<span><b>预算</b><em>${escapeHtml(p.budget)}</em></span>` : ''}
                ${p.time ? `<span><b>时间</b><em>${escapeHtml(p.time)}</em></span>` : ''}
            </div>
            <div class="partner-card-footer">
                <div class="partner-card-stats">
                    <span><i class="fas fa-eye" aria-hidden="true"></i> ${p.views}</span>
                    <button
                        class="partner-like-mini-btn${p.isLiked ? ' liked' : ''}"
                        data-id="${p.id}"
                        type="button"
                        aria-label="${p.isLiked ? '取消点赞' : '点赞'}"
                    >
                        <i class="${p.isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up" aria-hidden="true"></i>
                        <span class="partner-like-count">${p.likeCount}</span>
                    </button>
                    <span><i class="fas fa-comment" aria-hidden="true"></i> ${p.commentCount}</span>
                    <span><i class="fas fa-user" aria-hidden="true"></i> ${p.members}/${p.slots}</span>
                </div>
                ${p.isOwner ? `
                    <button class="join-btn owner-delete-btn" data-id="${p.id}"><i class="fas fa-trash-can" aria-hidden="true"></i> 删除活动</button>
                ` : (p.type === 'event' && p.members >= p.slots && p.participationStatus !== 'going') ? `
                    <button class="join-btn" disabled style="opacity:0.5;cursor:not-allowed;"><i class="fas fa-ban" aria-hidden="true"></i> 已满员</button>
                ` : `
                    <button class="join-btn" data-id="${p.id}">${p.participationStatus === 'going' ? '<i class="fas fa-circle-check" aria-hidden="true"></i> 已报名·点此取消' : '我要参加'}</button>
                `}
            </div>
        </div>
    `;
    return article;
}

/** 绑定卡片内的按钮事件（删除、参加、卡片点击） */
function bindCardEvents(container) {
    container.querySelectorAll('.owner-delete-btn').forEach(btn => {
        btn.removeEventListener('click', _deleteHandler);
        btn.addEventListener('click', _deleteHandler);
    });
    container.querySelectorAll('.join-btn:not(.owner-delete-btn)').forEach(btn => {
        btn.removeEventListener('click', _joinHandler);
        btn.addEventListener('click', _joinHandler);
    });
    container.querySelectorAll('.partner-like-mini-btn').forEach(btn => {
        btn.removeEventListener('click', _likeHandler);
        btn.addEventListener('click', _likeHandler);
    });
    container.querySelectorAll('.partner-author-favorite-btn').forEach(btn => {
        btn.removeEventListener('click', _favoriteHandler);
        btn.addEventListener('click', _favoriteHandler);
    });
    container.querySelectorAll('.partner-card').forEach(card => {
        card.removeEventListener('click', _cardClickHandler);
        card.addEventListener('click', _cardClickHandler);
    });
    container.querySelectorAll('.partner-card-author-avatar-btn, .partner-card-author-name-btn').forEach(btn => {
        btn.removeEventListener('click', _authorProfileHandler);
        btn.addEventListener('click', _authorProfileHandler);
    });
}

function _deleteHandler(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    _deletePostCard(id);
}
function _joinHandler(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    handleParticipate(id);
}
function _likeHandler(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    handleToggleLike(id, e.currentTarget);
}
function _favoriteHandler(e) {
    e.stopPropagation();
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    handleToggleFavorite(id, e.currentTarget);
}
function _authorProfileHandler(e) {
    e.stopPropagation();
    const uid = parseInt(e.currentTarget.getAttribute('data-user-id'));
    if (uid && window.openUserProfile) window.openUserProfile(uid);
}
function _cardClickHandler(e) {
    if (e.target.closest('.partner-card-author-row')) return;
    if (e.target.closest('button')) return;
    const id = parseInt(e.currentTarget.getAttribute('data-id'));
    if (id) openPostDetail(id);
}

/** 全量渲染瀑布流（用于重置分类或首次加载）；分批插入避免首屏长任务 */
function renderWaterfall() {
    const container = document.getElementById('partnerWaterfall');
    if (!container) return;

    if (!partnerStore.allPartnersData.length) {
        const q = partnerStore.searchQuery;
        container.innerHTML = q
            ? `<div class="partner-empty-state">未找到与「${escapeHtml(q)}」相关的帖子，试试换个关键词</div>`
            : '<div class="partner-empty-state">暂无组局，快来发起第一个吧~</div>';
        return;
    }

    container.innerHTML = '';
    const posts = partnerStore.allPartnersData;
    let index = 0;

    const paintBatch = () => {
        const end = Math.min(index + LIST_RENDER_BATCH, posts.length);
        const fragment = document.createDocumentFragment();
        for (; index < end; index++) {
            fragment.appendChild(createPostCardElement(posts[index]));
        }
        container.appendChild(fragment);
        if (index < posts.length) {
            requestAnimationFrame(paintBatch);
        } else {
            bindCardEvents(container);
        }
    };

    requestAnimationFrame(paintBatch);
}

/** 客户端筛选：从全量缓存中按 partnerStore.currentCategory 过滤到 partnerStore.partnersData（已不做筛选，因为请求时已带 tags） */
function _applyCategoryFilter() {
    // 由于后端请求时已经带 tags 参数，缓存数据即当前分类数据，无需前端再过滤
    partnerStore.partnersData = partnerStore.allPartnersData;
}

/** 切换分类时优先读本地缓存，未命中再请求网络 */
export async function switchCategory(category) {
    if (partnerStore.currentCategory === category) return;

    if (partnerStore.allPartnersData.length) {
        _writeListCache(
            partnerStore.allPartnersData,
            partnerStore.hasMore,
            partnerStore.currentPage,
        );
    }

    partnerStore.currentCategory = category;
    partnerStore.currentPage = 1;

    if (_applyCachedCategoryView(category, partnerStore.searchQuery)) return;

    partnerStore.hasMore = true;
    partnerStore.allPartnersData = [];
    partnerStore.partnersData = [];

    const container = document.getElementById('partnerWaterfall');
    if (container) showPartnerSkeleton();

    await loadPostsByPage(1, false);
    refreshPreviewMarkers();
}

/** 关键词搜索：优先读本地缓存，未命中再请求网络 */
export async function switchSearch(query) {
    const next = (query || '').trim();
    if (partnerStore.searchQuery === next) return;

    if (partnerStore.allPartnersData.length) {
        _writeListCache(
            partnerStore.allPartnersData,
            partnerStore.hasMore,
            partnerStore.currentPage,
        );
    }

    partnerStore.searchQuery = next;
    partnerStore.currentPage = 1;

    if (_applyCachedCategoryView(partnerStore.currentCategory, next)) return;

    partnerStore.hasMore = true;
    partnerStore.allPartnersData = [];
    partnerStore.partnersData = [];

    const container = document.getElementById('partnerWaterfall');
    if (container) showPartnerSkeleton();

    await loadPostsByPage(1, false);
    refreshPreviewMarkers();
}


// ============================================================
// 参与活动 & 删除帖子等操作（需刷新分页缓存）
// ============================================================
function _updateSingleCardDOM(postId, status, participantCount, slots) {
    const card = document.querySelector(`.partner-card[data-id="${postId}"]`);
    if (!card) return;
    const btn = card.querySelector('.join-btn:not(.owner-delete-btn)');
    if (btn) {
        btn.innerHTML = status === 'going'
            ? '<i class="fas fa-circle-check" aria-hidden="true"></i> 已报名·点此取消'
            : '我要参加';
    }
    const statSpans = card.querySelectorAll('.partner-card-stats span');
    if (statSpans.length >= 4) {
        statSpans[3].innerHTML = `<i class="fas fa-user" aria-hidden="true"></i> ${participantCount}/${slots}`;
    }
}

export async function handleParticipate(postId) {
    if (!isLoggedIn()) {
        showToast('请先登录');
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.style.display = 'flex';
        return;
    }
    try {
        const result = await participateEvent(postId, 'going');
        applyParticipationResult(postId, result);
        if (result.status === 'going') {
            showToast('报名成功');
        } else if (result.status === null) {
            showToast('已取消报名');
        }
        const post = partnerStore.allPartnersData.find(p => p.id === postId);
        _updateSingleCardDOM(postId, result.status, post?.members || 0, post?.slots || 2);
        _writeListCache(partnerStore.allPartnersData, partnerStore.hasMore, partnerStore.currentPage);
        // 后台静默刷新当前页面数据（不重置分页，仅更新缓存）
        silentRefreshCurrentPage();
    } catch (err) {
        showToast('操作失败: ' + err.message);
    }
}

export function applyParticipationResult(postId, result) {
    const post = partnerStore.allPartnersData.find(p => p.id === postId);
    if (!post) return;
    post.participationStatus = result.status ?? null;
    if (typeof result.participant_count === 'number') {
        post.members = result.participant_count;
    } else if (result.status === 'going') {
        post.members += 1;
    } else if (result.status === null && post.members > 0) {
        post.members -= 1;
    }
}

function _syncLikeButton(btn, liked, likeCount) {
    if (!btn) return;
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-label', liked ? '取消点赞' : '点赞');
    const icon = btn.querySelector('i');
    if (icon) {
        icon.classList.remove('fas', 'far');
        icon.classList.toggle('fa-solid', liked);
        icon.classList.toggle('fa-regular', !liked);
    }
    const countEl = btn.querySelector('.partner-like-count');
    if (countEl) countEl.textContent = String(likeCount ?? 0);
}

function _syncFavoriteButton(btn, favorited, favoriteCount) {
    if (!btn) return;
    btn.classList.toggle('liked', favorited);
    btn.setAttribute('aria-label', favorited ? '取消收藏' : '收藏');
    btn.setAttribute('title', favorited ? '取消收藏' : '收藏');
    const icon = btn.querySelector('i');
    if (icon) {
        icon.classList.remove('fas', 'far');
        icon.classList.toggle('fa-solid', favorited);
        icon.classList.toggle('fa-regular', !favorited);
    }
    const countEl = btn.querySelector('.partner-favorite-count');
    if (countEl) countEl.textContent = String(favoriteCount ?? 0);
}

async function handleToggleLike(postId, clickedBtn = null) {
    if (!isLoggedIn()) {
        showToast('请先登录');
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.style.display = 'flex';
        return;
    }
    const post = partnerStore.allPartnersData.find(p => p.id === postId);
    if (!post) return;

    const prevLiked = Boolean(post.isLiked);
    const prevCount = Number(post.likeCount || 0);
    const nextLiked = !prevLiked;
    const nextCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);

    post.isLiked = nextLiked;
    post.likeCount = nextCount;
    const btn = clickedBtn || document.querySelector(`.partner-card[data-id="${postId}"] .partner-like-mini-btn`);
    _syncLikeButton(btn, nextLiked, nextCount);

    try {
        const result = await togglePostLike(postId);
        post.isLiked = Boolean(result?.liked);
        post.likeCount = Number(result?.like_count ?? post.likeCount ?? 0);
        _syncLikeButton(btn, post.isLiked, post.likeCount);
        _writeListCache(partnerStore.allPartnersData, partnerStore.hasMore, partnerStore.currentPage);
    } catch (err) {
        post.isLiked = prevLiked;
        post.likeCount = prevCount;
        _syncLikeButton(btn, prevLiked, prevCount);
        showToast('点赞失败: ' + err.message);
    }
}

async function handleToggleFavorite(postId, clickedBtn = null) {
    if (!isLoggedIn()) {
        showToast('请先登录');
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.style.display = 'flex';
        return;
    }
    const post = partnerStore.allPartnersData.find(p => p.id === postId);
    if (!post) return;

    const prevFavorited = Boolean(post.isFavorited);
    const prevCount = Number(post.favoriteCount || 0);
    const nextFavorited = !prevFavorited;
    const nextCount = nextFavorited ? prevCount + 1 : Math.max(0, prevCount - 1);

    post.isFavorited = nextFavorited;
    post.favoriteCount = nextCount;
    const btn = clickedBtn || document.querySelector(`.partner-card[data-id="${postId}"] .partner-author-favorite-btn`);
    _syncFavoriteButton(btn, nextFavorited, nextCount);

    try {
        const result = await togglePostFavorite(postId);
        post.isFavorited = Boolean(result?.favorited);
        post.favoriteCount = Number(result?.favorite_count ?? post.favoriteCount ?? 0);
        _syncFavoriteButton(btn, post.isFavorited, post.favoriteCount);
        _writeListCache(partnerStore.allPartnersData, partnerStore.hasMore, partnerStore.currentPage);
    } catch (err) {
        post.isFavorited = prevFavorited;
        post.favoriteCount = prevCount;
        _syncFavoriteButton(btn, prevFavorited, prevCount);
        showToast('收藏失败: ' + err.message);
    }
}

export async function silentRefreshCurrentPage() {
    // 静默重新加载当前页码的数据，更新缓存但不改变 UI 滚动位置
    if (partnerStore.isLoading) return;
    partnerStore.isLoading = true;
    try {
        const params = {
            page: partnerStore.currentPage,
            page_size: PAGE_SIZE,
            sort: 'hot',
        };
        if (partnerStore.currentCategory !== 'all') {
            params.tags = partnerStore.currentCategory;
        }
        if (partnerStore.searchQuery) {
            params.q = partnerStore.searchQuery;
        }
        const result = await listPosts(params);
        const newPosts = (result.items || []).map(mapPost);
        // 替换当前页在缓存中的部分（简单做法：整体重新拉取并重置全部，但保留已加载的页数？为了简单，重置整个缓存为第一页）
        // 更严谨：只更新当前页对应的条目，但为了保持简单且不错位，这里重置缓存并重新加载第一页，同时重置滚动位置。
        // 注意：这会丢失之前已加载的后续页面，但保证了数据一致性，体验尚可。
        partnerStore.currentPage = 1;
        partnerStore.allPartnersData = newPosts;
        partnerStore.partnersData = partnerStore.allPartnersData;
        partnerStore.hasMore = newPosts.length === PAGE_SIZE;
        _writeListCache(partnerStore.allPartnersData, partnerStore.hasMore, 1);
        renderWaterfall();
        refreshPreviewMarkers();
    } catch (err) {
        console.warn('静默刷新失败', err);
    } finally {
        partnerStore.isLoading = false;
    }
}

// ============================================================
// 滚动分页监听（触底加载更多）
// ============================================================
let scrollTimeout = null;
export function handleScroll() {
    if (scrollTimeout) return;
    scrollTimeout = setTimeout(async () => {
        const scroller = getAppScroller();
        const scrollTop = scroller.scrollTop;
        const winHeight = scroller.clientHeight;
        const docHeight = scroller.scrollHeight;

        if (scrollTop + winHeight >= docHeight - 300) {
            if (!partnerStore.isLoading && partnerStore.hasMore) {
                partnerStore.currentPage++;
                await loadPostsByPage(partnerStore.currentPage, true);
            }
        }
        scrollTimeout = null;
    }, 120);
}