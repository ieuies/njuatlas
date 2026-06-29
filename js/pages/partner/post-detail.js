import { showToast, formatDate, escapeHtml, avatarHtmlForUser, atlasInlineSpinnerHtml } from '../../utils.js';
import { isLoggedIn, getUser } from '../../auth.js';
import {
    getPost, deletePost, togglePostLike, togglePostFavorite, addPostComment, deletePostComment, participateEvent,
} from '../../api.js';
import { partnerStore } from './shared.js';
import { formatPostTime, isCurrentUserOwner, safeHtmlWithBreaks, typeIcon, typeLabel } from './shared.js';
import { applyParticipationResult, silentRefreshCurrentPage, removePostFromList, syncPostInListFromApi } from './list.js';
import { isPostParticipationFull } from './shared.js';
import { refreshPreviewMarkers } from './map.js';
import { openEditPostModal } from './partner-form.js';
import {
    getCachedPartnerPostDetail,
    invalidatePartnerPostDetailCache,
    setCachedPartnerPostDetail,
    enqueuePartnerDetailPrefetch,
} from './prefetch.js';

// ============================================================
// 帖子详情模态框（保持不变，略作适配）
// ============================================================
let currentDetailPost = null;

const CATEGORY_TAG_CLASS = {
    '饭搭子': 'tag-fandazi',
    '运动搭子': 'tag-yundong',
    '学习搭子': 'tag-xuexi',
    '游戏搭子': 'tag-youxi',
    '电影搭子': 'tag-dianying',
};

function _categoryTagClass(tag) {
    return CATEGORY_TAG_CLASS[tag] || '';
}

function _postCategory(post) {
    return (post?.tags && post.tags[0]) || '其他';
}

function _slotsText(post) {
    const slots = post.max_participants || 2;
    const count = post.participant_count || 0;
    const remaining = Math.max(0, slots - count);
    if (remaining > 0) return `${count}/${slots} 人 · 还差 ${remaining} 人`;
    return `${count}/${slots} 人 · 已满员`;
}

function _renderDetailCover(post) {
    const hero = document.getElementById('detailHero');
    const coverEl = document.getElementById('detailCover');
    const coverImg = document.getElementById('detailCoverImg');
    const placeholder = document.getElementById('detailCoverPlaceholder');
    const coverIcon = document.getElementById('detailCoverIcon');
    if (!hero || !coverEl || !coverImg || !placeholder || !coverIcon) return;

    const category = _postCategory(post);
    hero.dataset.category = category;
    const coverUrl = (post.cover_image || post.coverImage || '').trim();

    if (coverUrl) {
        coverEl.hidden = false;
        placeholder.hidden = true;
        coverImg.src = coverUrl;
        coverImg.alt = post.title || '';
        hero.classList.add('has-cover');
        hero.classList.remove('has-placeholder');
    } else {
        coverEl.hidden = true;
        placeholder.hidden = false;
        coverIcon.className = `fas ${typeIcon(category)}`;
        hero.classList.remove('has-cover');
        hero.classList.add('has-placeholder');
    }
}

export function initPostDetailModal() {
    const modal = document.getElementById('postDetailModal');
    if (!modal || modal.dataset.ready === '1') return;
    modal.dataset.ready = '1';

    const closeBtn = document.getElementById('closePostDetailBtn');
    const stickyLikeBtn = document.getElementById('detailStickyLikeBtn');
    const stickyFavoriteBtn = document.getElementById('detailStickyFavoriteBtn');
    const participateBtn = document.getElementById('detailParticipateBtn');
    const commentInput = document.getElementById('detailCommentInput');
    const commentSubmitBtn = document.getElementById('detailCommentSubmitBtn');
    const ownerActions = document.getElementById('detailOwnerActions');
    const editStickyBtn = document.getElementById('detailEditStickyBtn');

    editStickyBtn?.addEventListener('click', () => {
        if (!currentDetailPost || !currentDetailPost.is_owner) return;
        openEditPostModal(currentDetailPost);
    });

    closeBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
        currentDetailPost = null;
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            currentDetailPost = null;
        }
    });

    const handleLikeToggle = async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevLiked = currentDetailPost.is_liked;
        const prevCount = currentDetailPost.like_count || 0;
        currentDetailPost.is_liked = !prevLiked;
        currentDetailPost.like_count = prevLiked ? prevCount - 1 : prevCount + 1;
        _updateDetailStats();
        _applyDetailLikeUi(currentDetailPost.is_liked);
        _syncLikeStateToList(currentDetailPost.id, currentDetailPost.is_liked, currentDetailPost.like_count);
        try {
            const result = await togglePostLike(currentDetailPost.id);
            currentDetailPost.is_liked = result.liked;
            currentDetailPost.like_count = result.like_count;
            _updateDetailStats();
            _applyDetailLikeUi(result.liked);
            _syncLikeStateToList(currentDetailPost.id, result.liked, result.like_count);
            setCachedPartnerPostDetail(currentDetailPost.id, { ...currentDetailPost });
        } catch (err) {
            currentDetailPost.is_liked = prevLiked;
            currentDetailPost.like_count = prevCount;
            _updateDetailStats();
            _applyDetailLikeUi(prevLiked);
            _syncLikeStateToList(currentDetailPost.id, prevLiked, prevCount);
            showToast('操作失败: ' + err.message);
        }
    };
    stickyLikeBtn?.addEventListener('click', handleLikeToggle);

    const handleFavoriteToggle = async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevFavorited = Boolean(currentDetailPost.is_favorited);
        const prevCount = currentDetailPost.favorite_count || 0;
        currentDetailPost.is_favorited = !prevFavorited;
        currentDetailPost.favorite_count = prevFavorited ? Math.max(0, prevCount - 1) : prevCount + 1;
        _updateDetailStats();
        _applyDetailFavoriteUi(currentDetailPost.is_favorited);
        _syncFavoriteStateToList(currentDetailPost.id, currentDetailPost.is_favorited, currentDetailPost.favorite_count);
        try {
            const result = await togglePostFavorite(currentDetailPost.id);
            currentDetailPost.is_favorited = Boolean(result.favorited);
            currentDetailPost.favorite_count = Number(result.favorite_count || 0);
            _updateDetailStats();
            _applyDetailFavoriteUi(currentDetailPost.is_favorited);
            _syncFavoriteStateToList(currentDetailPost.id, currentDetailPost.is_favorited, currentDetailPost.favorite_count);
            setCachedPartnerPostDetail(currentDetailPost.id, { ...currentDetailPost });
        } catch (err) {
            currentDetailPost.is_favorited = prevFavorited;
            currentDetailPost.favorite_count = prevCount;
            _updateDetailStats();
            _applyDetailFavoriteUi(prevFavorited);
            _syncFavoriteStateToList(currentDetailPost.id, prevFavorited, prevCount);
            showToast('收藏失败: ' + err.message);
        }
    };
    stickyFavoriteBtn?.addEventListener('click', handleFavoriteToggle);

    participateBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevStatus = currentDetailPost.participation_status;
        const prevCount = currentDetailPost.participant_count || 0;
        const newStatus = prevStatus === 'going' ? null : 'going';
        currentDetailPost.participation_status = newStatus;
        currentDetailPost.participant_count = newStatus === 'going' ? prevCount + 1 : Math.max(0, prevCount - 1);
        currentDetailPost.is_full = isPostParticipationFull(currentDetailPost);
        _updateDetailStats();
        _applyDetailParticipateButton(currentDetailPost);
        _renderDetailContact(currentDetailPost);
        const user = getUser();
        if (user && user.username) {
            _optimisticUpdateParticipants(newStatus, user);
        }
        try {
            const result = await participateEvent(currentDetailPost.id, 'going');
            currentDetailPost.participation_status = result.status;
            currentDetailPost.participant_count = result.participant_count;
            if (typeof result.is_full === 'boolean') {
                currentDetailPost.is_full = result.is_full;
            }
            applyParticipationResult(currentDetailPost.id, result);
            _updateDetailStats();
            _applyDetailParticipateButton(currentDetailPost);
            _renderDetailContact(currentDetailPost);
            _refreshDetailParticipants(currentDetailPost.id);
            silentRefreshCurrentPage();
            invalidatePartnerPostDetailCache([currentDetailPost.id]);
        } catch (err) {
            currentDetailPost.participation_status = prevStatus;
            currentDetailPost.participant_count = prevCount;
            _updateDetailStats();
            _applyDetailParticipateButton(currentDetailPost);
            _renderDetailContact(currentDetailPost);
            _revertOptimisticParticipants(prevStatus, user);
            showToast('操作失败: ' + err.message);
        }
    });

    commentSubmitBtn?.addEventListener('click', async () => {
        const content = commentInput.value.trim();
        if (!content) { showToast('请输入评论内容'); return; }
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        try {
            await addPostComment(currentDetailPost.id, content);
            commentInput.value = '';
            showToast('评论发表成功');
            invalidatePartnerPostDetailCache([currentDetailPost.id]);
            await _refreshDetailComments(currentDetailPost.id);
        } catch (err) {
            showToast('评论失败: ' + err.message);
        }
    });

    document.getElementById('detailDeleteBtn')?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!confirm('确定要删除这条组局吗？此操作不可撤销。')) return;
        const postId = currentDetailPost.id;
        const snapshot = partnerStore.allPartnersData.slice();
        document.getElementById('postDetailModal').style.display = 'none';
        currentDetailPost = null;
        removePostFromList(postId);
        try {
            await deletePost(postId, { silent: true });
            showToast('已删除');
        } catch (err) {
            const msg = err?.message || '';
            if (msg !== '帖子不存在' && !msg.includes('404')) {
                partnerStore.allPartnersData = snapshot;
                partnerStore.partnersData = snapshot;
                showToast('删除失败: ' + msg);
                return;
            }
            showToast('该帖子已不存在，已从列表移除');
        }
        refreshPreviewMarkers();
    });
}



function _mapCachedToDetailFormat(cached) {
    if (!cached) return null;
    return {
        id: cached.id,
        type: cached.type,
        title: cached.title,
        content: cached.description,
        tags: cached.tags,
        user_id: cached.publisherId,
        username: cached.publisher,
        event_time: cached.eventTime || null,
        event_end_time: cached.eventEndTime || null,
        urgency: cached.urgency,
        location_name: cached.location,
        budget: cached.budget,
        contact: cached.contact,
        is_owner: cached.isOwner,
        like_count: cached.likeCount,
        favorite_count: cached.favoriteCount,
        view_count: cached.views,
        comment_count: cached.commentCount,
        participant_count: cached.members,
        max_participants: cached.slots,
        is_liked: cached.isLiked,
        is_favorited: cached.isFavorited,
        participation_status: cached.participationStatus,
        is_full: cached.isFull,
        cover_image: cached.coverImage || '',
        _fromCache: true,
    };
}

function setDetailCommentsLoading() {
    const el = document.getElementById('detailComments');
    if (!el) return;
    el.innerHTML = `<div class="detail-comments-empty detail-comments-loading">${atlasInlineSpinnerHtml({ label: '加载评论中' })}<span>加载评论中...</span></div>`;
}

function _backgroundRefreshPostDetail(postId) {
    getPost(postId)
        .then((post) => {
            if (currentDetailPost?.id !== postId) return;
            currentDetailPost = post;
            syncPostInListFromApi(post);
            setCachedPartnerPostDetail(postId, post);
            _renderPostDetail(post);
        })
        .catch((err) => {
            console.warn('帖子详情刷新失败:', err.message);
        });
}

export async function openPostDetail(postId) {
    initPostDetailModal();
    const modal = document.getElementById('postDetailModal');
    if (!modal) return;

    const numericId = Number(postId);
    modal.style.display = 'flex';
    _resetDetailUI();

    const prefetched = getCachedPartnerPostDetail(numericId);
    const listCached = partnerStore.allPartnersData.find((p) => p.id === numericId);

    if (prefetched) {
        currentDetailPost = prefetched;
        _renderPostDetail(prefetched);
        _backgroundRefreshPostDetail(numericId);
        return;
    }

    enqueuePartnerDetailPrefetch([numericId], { priority: true });

    if (listCached) {
        const quick = _mapCachedToDetailFormat(listCached);
        currentDetailPost = quick;
        _renderPostDetail(quick);
        setDetailCommentsLoading();
    } else {
        setDetailCommentsLoading();
    }

    try {
        const post = await getPost(numericId);
        currentDetailPost = post;
        syncPostInListFromApi(post);
        setCachedPartnerPostDetail(numericId, post);
        _renderPostDetail(post);
    } catch (err) {
        if (!listCached) {
            showToast('加载帖子详情失败: ' + err.message);
            modal.style.display = 'none';
            currentDetailPost = null;
        } else {
            console.warn('帖子详情刷新失败:', err.message);
        }
    }
}

function _resetDetailUI() {
    document.getElementById('detailTitle').textContent = '加载中...';
    document.getElementById('detailBody').textContent = '';
    document.getElementById('detailTags').innerHTML = '';
    document.getElementById('detailPublisher').innerHTML = '';
    document.getElementById('detailTypeBadge').innerHTML = '';
    const hero = document.getElementById('detailHero');
    if (hero) {
        hero.dataset.category = '其他';
        hero.classList.remove('has-cover', 'has-placeholder');
    }
    const coverEl = document.getElementById('detailCover');
    const placeholder = document.getElementById('detailCoverPlaceholder');
    if (coverEl) coverEl.hidden = true;
    if (placeholder) placeholder.hidden = false;
    ['detailTimeRow', 'detailLocationRow', 'detailBudgetRow', 'detailContactRow'].forEach((id) => {
        const row = document.getElementById(id);
        if (row) row.hidden = true;
    });
    document.getElementById('detailTime').textContent = '';
    document.getElementById('detailLocation').textContent = '';
    document.getElementById('detailBudget').textContent = '';
    document.getElementById('detailContact').textContent = '';
    document.getElementById('detailSlotsText').textContent = '0/2 人';
    document.getElementById('detailComments').innerHTML = '';
    document.getElementById('detailParticipants').innerHTML = '';
    document.getElementById('detailParticipantsSection').style.display = 'none';
    const pb = document.getElementById('detailParticipateBtn');
    pb.style.display = 'none';
    pb.textContent = '我要参加';
    pb.classList.remove('going');
    pb.disabled = false;
    _applyDetailLikeUi(false);
    _applyDetailFavoriteUi(false);
    const editStickyBtn = document.getElementById('detailEditStickyBtn');
    if (editStickyBtn) editStickyBtn.style.display = '';
    const oa = document.getElementById('detailOwnerActions');
    if (oa) oa.style.display = 'none';
}

function _renderDetailContact(post) {
    const contactRow = document.getElementById('detailContactRow');
    const contactEl = document.getElementById('detailContact');
    if (!contactRow || !contactEl) return;
    if (!post.contact) {
        contactRow.hidden = true;
        contactEl.textContent = '';
        return;
    }
    const canSeeContact = post.is_owner || post.participation_status === 'going';
    contactRow.hidden = false;
    if (canSeeContact) {
        contactEl.innerHTML = escapeHtml(post.contact);
        contactEl.classList.remove('contact-masked');
    } else {
        contactEl.innerHTML = '<span class="contact-masked">报名后可见</span>';
    }
}

function _renderPostDetail(post) {
    _renderDetailCover(post);

    const typeBadge = document.getElementById('detailTypeBadge');
    if (typeBadge) typeBadge.innerHTML = typeLabel({ ...post, category: _postCategory(post) });

    document.getElementById('detailTitle').textContent = post.title;
    document.getElementById('detailBody').innerHTML = safeHtmlWithBreaks(post.content || '');

    const tags = (post.tags || []).filter((t) => !/^[\d¥￥]/.test(t) && !['AA', '免费', '自费'].includes(t));
    document.getElementById('detailTags').innerHTML = tags.map((t) => {
        const cls = _categoryTagClass(t);
        return `<span class="post-detail-tag${cls ? ` ${cls}` : ''}">${escapeHtml(t)}</span>`;
    }).join('');

    const pubEl = document.getElementById('detailPublisher');
    const publishedAt = post.created_at ? formatDate(post.created_at) : '';
    if (pubEl && post.user_id) {
        pubEl.innerHTML = `<button type="button" class="detail-publisher-btn" data-user-id="${post.user_id}">
            ${avatarHtmlForUser({ id: post.user_id, username: post.username, avatar_url: post.avatar_url }, 40)}
            <span class="detail-publisher-text">
                <span class="detail-publisher-name">${escapeHtml(post.username || '匿名')}</span>
                ${publishedAt ? `<span class="detail-publisher-time">发布于 ${escapeHtml(publishedAt)}</span>` : ''}
            </span>
        </button>`;
        pubEl.querySelector('.detail-publisher-btn')?.addEventListener('click', () => {
            if (window.openUserProfile) window.openUserProfile(post.user_id);
        });
    } else if (pubEl) {
        pubEl.innerHTML = `<span class="detail-publisher-fallback"><i class="fas fa-user"></i> ${escapeHtml(post.username || '匿名')}</span>`;
    }

    const timeStr = formatPostTime(post.event_time, post.urgency, post.event_end_time);
    const timeRow = document.getElementById('detailTimeRow');
    const timeEl = document.getElementById('detailTime');
    if (timeStr && timeRow && timeEl) {
        timeEl.textContent = timeStr;
        timeRow.hidden = false;
    } else if (timeRow) {
        timeRow.hidden = true;
        if (timeEl) timeEl.textContent = '';
    }

    const locationRow = document.getElementById('detailLocationRow');
    const locationEl = document.getElementById('detailLocation');
    if (post.location_name && locationRow && locationEl) {
        locationEl.textContent = post.location_name;
        locationRow.hidden = false;
    } else if (locationRow) {
        locationRow.hidden = true;
        if (locationEl) locationEl.textContent = '';
    }

    const budgetRow = document.getElementById('detailBudgetRow');
    const budgetEl = document.getElementById('detailBudget');
    if (post.budget && budgetRow && budgetEl) {
        budgetEl.textContent = post.budget;
        budgetRow.hidden = false;
    } else if (budgetRow) {
        budgetRow.hidden = true;
        if (budgetEl) budgetEl.textContent = '';
    }

    const slotsEl = document.getElementById('detailSlotsText');
    if (slotsEl) slotsEl.textContent = _slotsText(post);
    _renderDetailContact(post);

    _updateDetailStats(post);
    _applyDetailLikeUi(Boolean(post.is_liked));
    _applyDetailFavoriteUi(Boolean(post.is_favorited));

    const ownerActions = document.getElementById('detailOwnerActions');
    const participateBtn = document.getElementById('detailParticipateBtn');
    const editStickyBtn = document.getElementById('detailEditStickyBtn');
    _applyDetailParticipateButton(post);
    if (post.is_owner) {
        if (ownerActions) ownerActions.style.display = 'flex';
        if (participateBtn) participateBtn.style.display = 'none';
        if (editStickyBtn) editStickyBtn.style.display = '';
    } else {
        if (ownerActions) ownerActions.style.display = 'none';
        if (editStickyBtn) editStickyBtn.style.display = 'none';
    }

    _renderDetailParticipants(post.participants || []);
    _renderDetailComments(post.comments || { items: [] });
}

function _applyDetailParticipateButton(post) {
    const participateBtn = document.getElementById('detailParticipateBtn');
    if (!participateBtn || !post) return;
    if (post.is_owner) {
        participateBtn.style.display = 'none';
        return;
    }
    participateBtn.style.display = 'block';
    const isFull = typeof post.is_full === 'boolean'
        ? post.is_full
        : isPostParticipationFull(post);
    if (isFull && post.participation_status !== 'going') {
        participateBtn.innerHTML = '<i class="fas fa-ban" aria-hidden="true"></i> 已满员';
        participateBtn.disabled = true;
        participateBtn.classList.remove('going');
        return;
    }
    participateBtn.disabled = false;
    const going = post.participation_status === 'going';
    participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
    participateBtn.classList.toggle('going', going);
}

function _updateDetailStats(postOverride) {
    const post = postOverride || currentDetailPost;
    if (!post) return;
    document.getElementById('detailViewCount').textContent = post.view_count || 0;
    document.getElementById('detailLikeCount').textContent = post.like_count || 0;
    const favoriteCountEl = document.getElementById('detailFavoriteCount');
    if (favoriteCountEl) favoriteCountEl.textContent = post.favorite_count || 0;
    document.getElementById('detailCommentCount').textContent = post.comment_count || 0;
    const slotsEl = document.getElementById('detailSlotsText');
    if (slotsEl) slotsEl.textContent = _slotsText(post);
}

function _applyDetailLikeUi(liked) {
    const stickyBtn = document.getElementById('detailStickyLikeBtn');
    if (stickyBtn) {
        stickyBtn.classList.toggle('liked', liked);
        stickyBtn.setAttribute('aria-label', liked ? '取消点赞' : '点赞');
        stickyBtn.setAttribute('title', liked ? '取消点赞' : '点赞');
        const icon = stickyBtn.querySelector('i');
        if (icon) {
            icon.classList.remove('fas', 'far', 'fa-solid', 'fa-regular');
            icon.classList.add(liked ? 'fa-solid' : 'fa-regular', 'fa-thumbs-up');
        }
    }
}

function _applyDetailFavoriteUi(favorited) {
    const favoriteBtn = document.getElementById('detailStickyFavoriteBtn');
    if (!favoriteBtn) return;
    favoriteBtn.classList.toggle('favorited', favorited);
    favoriteBtn.setAttribute('aria-label', favorited ? '取消收藏' : '收藏');
    favoriteBtn.setAttribute('title', favorited ? '取消收藏' : '收藏');
    const icon = favoriteBtn.querySelector('i');
    if (icon) {
        icon.classList.remove('fas', 'far', 'fa-solid', 'fa-regular');
        icon.classList.add(favorited ? 'fa-solid' : 'fa-regular', 'fa-star');
    }
}

function _syncLikeStateToList(postId, liked, likeCount) {
    const post = partnerStore.allPartnersData.find(p => p.id === postId);
    if (post) {
        post.isLiked = liked;
        post.likeCount = likeCount;
    }
    const likeBtn = document.querySelector(`.partner-card[data-id="${postId}"] .partner-like-mini-btn`);
    if (!likeBtn) return;
    likeBtn.classList.toggle('liked', liked);
    likeBtn.setAttribute('aria-label', liked ? '取消点赞' : '点赞');
    const icon = likeBtn.querySelector('i');
    if (icon) {
        icon.classList.remove('fas', 'far');
        icon.classList.toggle('fa-solid', liked);
        icon.classList.toggle('fa-regular', !liked);
    }
    const countEl = likeBtn.querySelector('.partner-like-count');
    if (countEl) countEl.textContent = String(likeCount ?? 0);
}

function _syncFavoriteStateToList(postId, favorited, favoriteCount) {
    const post = partnerStore.allPartnersData.find(p => p.id === postId);
    if (post) {
        post.isFavorited = favorited;
        post.favoriteCount = favoriteCount;
    }
    const favoriteBtn = document.querySelector(`.partner-card[data-id="${postId}"] .partner-author-favorite-btn`);
    if (!favoriteBtn) return;
    favoriteBtn.classList.toggle('liked', favorited);
    favoriteBtn.setAttribute('aria-label', favorited ? '取消收藏' : '收藏');
    favoriteBtn.setAttribute('title', favorited ? '取消收藏' : '收藏');
    const icon = favoriteBtn.querySelector('i');
    if (icon) {
        icon.classList.remove('fas', 'far');
        icon.classList.toggle('fa-solid', favorited);
        icon.classList.toggle('fa-regular', !favorited);
    }
    const countEl = favoriteBtn.querySelector('.partner-favorite-count');
    if (countEl) countEl.textContent = String(favoriteCount ?? 0);
}

function _renderDetailParticipants(participants) {
    const section = document.getElementById('detailParticipantsSection');
    const container = document.getElementById('detailParticipants');
    if (!participants.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    container.innerHTML = participants.map((p) => `
        <button type="button"
            class="participant-avatar-chip${p.is_organizer ? ' organizer' : ''}"
            data-user-id="${p.user_id || ''}"
            title="${escapeHtml(p.username || '用户')}${p.is_organizer ? '（发起人）' : ''}"
            aria-label="查看 ${escapeHtml(p.username || '用户')} 的主页">
            ${avatarHtmlForUser({ id: p.user_id, username: p.username, avatar_url: p.avatar_url }, 40)}
            ${p.is_organizer ? '<span class="participant-organizer-dot" aria-hidden="true"></span>' : ''}
        </button>
    `).join('');
    container.querySelectorAll('.participant-avatar-chip[data-user-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const userId = parseInt(btn.getAttribute('data-user-id'), 10);
            if (userId && window.openUserProfile) window.openUserProfile(userId);
        });
    });
}

function _optimisticUpdateParticipants(newStatus, user) {
    const section = document.getElementById('detailParticipantsSection');
    const container = document.getElementById('detailParticipants');
    if (!section || !container) return;
    section.style.display = 'block';
    if (newStatus === 'going') {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'participant-avatar-chip optimistic';
        chip.dataset.optimisticUser = user.username;
        chip.title = user.username || '用户';
        chip.innerHTML = avatarHtmlForUser({ id: user.id || user.user_id, username: user.username, avatar_url: user.avatar_url }, 40);
        container.appendChild(chip);
    } else {
        const chips = container.querySelectorAll('.participant-avatar-chip');
        for (const c of chips) {
            if (c.dataset.optimisticUser === user.username || (c.title && c.title.includes(user.username))) {
                if (!c.classList.contains('organizer')) {
                    c.remove();
                    break;
                }
            }
        }
    }
    if (!container.querySelector('.participant-avatar-chip')) {
        section.style.display = 'none';
    }
}

function _revertOptimisticParticipants(prevStatus, user) {
    const container = document.getElementById('detailParticipants');
    if (!container) return;
    if (prevStatus !== 'going') {
        const chip = container.querySelector(`[data-optimistic-user="${user.username}"]`);
        if (chip) chip.remove();
    } else {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'participant-avatar-chip';
        chip.title = user.username || '用户';
        chip.innerHTML = avatarHtmlForUser({ id: user.id || user.user_id, username: user.username, avatar_url: user.avatar_url }, 40);
        container.appendChild(chip);
    }
}

function _renderDetailComments(commentsData) {
    const items = commentsData.items || [];
    const container = document.getElementById('detailComments');
    document.getElementById('detailCommentTotal').textContent = commentsData.total || items.length;
    const postAuthorId = currentDetailPost?.user_id;

    if (!items.length) {
        container.innerHTML = '<div class="detail-comments-empty">暂无评论，来抢沙发吧~</div>';
        return;
    }

    container.innerHTML = items.map(c => {
        const canDeleteComment = isCurrentUserOwner(c);
        const isPostAuthorComment = postAuthorId != null && String(c.user_id) === String(postAuthorId);
        return `
        <div class="detail-comment" data-comment-id="${c.id}">
            <div class="detail-comment-avatar">
                ${avatarHtmlForUser({ id: c.user_id, username: c.username, avatar_url: c.avatar_url }, 32)}
            </div>
            <div class="detail-comment-main">
                <div class="detail-comment-header">
                    <span class="detail-comment-user">${escapeHtml(c.username || '用户')}${isPostAuthorComment ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                    <span class="detail-comment-time">${formatDate(c.created_at)}</span>
                </div>
                <div class="detail-comment-body">${escapeHtml(c.content)}</div>
                <div class="detail-comment-actions">
                    <button class="detail-comment-reply-btn" data-comment-id="${c.id}">回复</button>
                    ${canDeleteComment ? `<button class="detail-comment-delete-btn" data-comment-id="${c.id}" title="删除评论">删除</button>` : ''}
                </div>
                ${(c.replies && c.replies.length) ? `
                    <div class="detail-comment-replies">
                        ${c.replies.map(r => {
                            const canDeleteReply = isCurrentUserOwner(r);
                            const isPostAuthorReply = postAuthorId != null && String(r.user_id) === String(postAuthorId);
                            return `
                            <div class="detail-comment" data-comment-id="${r.id}">
                                <div class="detail-comment-avatar">
                                    ${avatarHtmlForUser({ id: r.user_id, username: r.username, avatar_url: r.avatar_url }, 28)}
                                </div>
                                <div class="detail-comment-main">
                                    <div class="detail-comment-header">
                                        <span class="detail-comment-user">${escapeHtml(r.username || '用户')}${isPostAuthorReply ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                                        <span class="detail-comment-time">${formatDate(r.created_at)}</span>
                                    </div>
                                    <div class="detail-comment-body">${escapeHtml(r.content)}</div>
                                    <div class="detail-comment-actions">
                                        ${canDeleteReply ? `<button class="detail-comment-delete-btn" data-comment-id="${r.id}" title="删除回复">删除</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `}).join('');

    container.querySelectorAll('.detail-comment-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const commentId = parseInt(btn.getAttribute('data-comment-id'));
            _showReplyInput(btn.closest('.detail-comment'), commentId);
        });
    });

    container.querySelectorAll('.detail-comment-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const commentId = parseInt(btn.getAttribute('data-comment-id'));
            if (!confirm('确定要删除这条评论吗？')) return;
            try {
                await deletePostComment(currentDetailPost.id, commentId);
                showToast('评论已删除');
                invalidatePartnerPostDetailCache([currentDetailPost.id]);
                await _refreshDetailComments(currentDetailPost.id);
            } catch (err) {
                showToast('删除失败: ' + err.message);
            }
        });
    });
}

function _showReplyInput(commentEl, parentId) {
    if (commentEl.querySelector('.detail-reply-input-row')) return;
    const row = document.createElement('div');
    row.className = 'detail-reply-input-row';
    row.innerHTML = `
        <input type="text" placeholder="写下回复..." maxlength="300">
        <button>发送</button>
    `;
    commentEl.appendChild(row);
    const input = row.querySelector('input');
    const btn = row.querySelector('button');
    input.focus();

    const doReply = async () => {
        const content = input.value.trim();
        if (!content) { showToast('请输入回复内容'); return; }
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        try {
            await addPostComment(currentDetailPost.id, content, parentId);
            row.remove();
            showToast('回复成功');
            invalidatePartnerPostDetailCache([currentDetailPost.id]);
            await _refreshDetailComments(currentDetailPost.id);
        } catch (err) {
            showToast('回复失败: ' + err.message);
        }
    };
    btn.addEventListener('click', doReply);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doReply();
        if (e.key === 'Escape') row.remove();
    });
}

async function _refreshDetailComments(postId) {
    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        setCachedPartnerPostDetail(postId, post);
        _renderDetailComments(post.comments || { items: [] });
        _updateDetailStats();
    } catch (e) { /* ignore */ }
}

async function _refreshDetailParticipants(postId) {
    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        setCachedPartnerPostDetail(postId, post);
        _renderDetailParticipants(post.participants || []);
    } catch (e) { /* ignore */ }
}