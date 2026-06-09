import { showToast, formatDate, escapeHtml } from '../../utils.js';
import { isLoggedIn, getUser } from '../../auth.js';
import {
    getPost, deletePost, togglePostLike, addPostComment, deletePostComment, participateEvent,
} from '../../api.js';
import { partnerStore } from './shared.js';
import { formatPostTime, isCurrentUserOwner, safeHtmlWithBreaks } from './shared.js';
import { loadPostsByPage, applyParticipationResult, silentRefreshCurrentPage } from './list.js';
import { refreshPreviewMarkers } from './map.js';
import { openEditPostModal } from './partner-form.js';

// ============================================================
// 帖子详情模态框（保持不变，略作适配）
// ============================================================
let currentDetailPost = null;

export function initPostDetailModal() {
    const modal = document.getElementById('postDetailModal');
    if (!modal || modal.dataset.ready === '1') return;
    modal.dataset.ready = '1';

    const closeBtn = document.getElementById('closePostDetailBtn');
    const likeBtn = document.getElementById('detailLikeBtn');
    const participateBtn = document.getElementById('detailParticipateBtn');
    const commentInput = document.getElementById('detailCommentInput');
    const commentSubmitBtn = document.getElementById('detailCommentSubmitBtn');

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

    likeBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevLiked = currentDetailPost.is_liked;
        const prevCount = currentDetailPost.like_count || 0;
        currentDetailPost.is_liked = !prevLiked;
        currentDetailPost.like_count = prevLiked ? prevCount - 1 : prevCount + 1;
        _updateDetailStats();
        likeBtn.classList.toggle('liked', currentDetailPost.is_liked);
        likeBtn.textContent = currentDetailPost.is_liked ? '已点赞' : '点赞';
        try {
            const result = await togglePostLike(currentDetailPost.id);
            currentDetailPost.is_liked = result.liked;
            currentDetailPost.like_count = result.like_count;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', result.liked);
            likeBtn.textContent = result.liked ? '已点赞' : '点赞';
        } catch (err) {
            currentDetailPost.is_liked = prevLiked;
            currentDetailPost.like_count = prevCount;
            _updateDetailStats();
            likeBtn.classList.toggle('liked', prevLiked);
            likeBtn.textContent = prevLiked ? '已点赞' : '点赞';
            showToast('操作失败: ' + err.message);
        }
    });

    participateBtn?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!isLoggedIn()) { showToast('请先登录'); return; }
        const prevStatus = currentDetailPost.participation_status;
        const prevCount = currentDetailPost.participant_count || 0;
        const newStatus = prevStatus === 'going' ? null : 'going';
        currentDetailPost.participation_status = newStatus;
        currentDetailPost.participant_count = newStatus === 'going' ? prevCount + 1 : Math.max(0, prevCount - 1);
        _updateDetailStats();
        participateBtn.textContent = newStatus === 'going' ? '已报名，点击取消' : '我要参加';
        participateBtn.classList.toggle('going', newStatus === 'going');
        const user = getUser();
        if (user && user.username) {
            _optimisticUpdateParticipants(newStatus, user);
        }
        try {
            const result = await participateEvent(currentDetailPost.id, 'going');
            currentDetailPost.participation_status = result.status;
            currentDetailPost.participant_count = result.participant_count;
            applyParticipationResult(currentDetailPost.id, result);
            _updateDetailStats();
            const going = result.status === 'going';
            participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', going);
            _refreshDetailParticipants(currentDetailPost.id);
            silentRefreshCurrentPage();
        } catch (err) {
            currentDetailPost.participation_status = prevStatus;
            currentDetailPost.participant_count = prevCount;
            _updateDetailStats();
            participateBtn.textContent = prevStatus === 'going' ? '已报名，点击取消' : '我要参加';
            participateBtn.classList.toggle('going', prevStatus === 'going');
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
            await _refreshDetailComments(currentDetailPost.id);
        } catch (err) {
            showToast('评论失败: ' + err.message);
        }
    });

    document.getElementById('detailEditBtn')?.addEventListener('click', () => {
        if (!currentDetailPost) return;
        openEditPostModal(currentDetailPost);
    });

    document.getElementById('detailDeleteBtn')?.addEventListener('click', async () => {
        if (!currentDetailPost) return;
        if (!confirm('确定要删除这条组局吗？此操作不可撤销。')) return;
        try {
            await deletePost(currentDetailPost.id);
            showToast('已删除');
            document.getElementById('postDetailModal').style.display = 'none';
            currentDetailPost = null;
            partnerStore.currentPage = 1;
            partnerStore.hasMore = true;
            await loadPostsByPage(1, false);
            refreshPreviewMarkers();
        } catch (err) {
            showToast('删除失败: ' + err.message);
        }
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
        username: cached.publisher,
        event_time: cached.time === '立即' || cached.time === '长期有效' ? null : null,
        urgency: cached.urgency,
        location_name: cached.location,
        budget: cached.budget,
        contact: cached.contact,
        is_owner: cached.isOwner,
        like_count: cached.likeCount,
        view_count: cached.views,
        comment_count: cached.commentCount,
        participant_count: cached.members,
        max_participants: cached.slots,
        is_liked: cached.isLiked,
        participation_status: cached.participationStatus,
        _fromCache: true,
    };
}

export async function openPostDetail(postId) {
    const modal = document.getElementById('postDetailModal');
    if (!modal) return;

    modal.style.display = 'flex';
    _resetDetailUI();

    const cached = partnerStore.allPartnersData.find(p => p.id === postId);
    if (cached) {
        const quick = _mapCachedToDetailFormat(cached);
        _renderPostDetail(quick);
        document.getElementById('detailComments').innerHTML = '<div class="detail-comments-empty">加载评论中...</div>';
    }

    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderPostDetail(post);
    } catch (err) {
        if (!cached) {
            showToast('加载帖子详情失败: ' + err.message);
            modal.style.display = 'none';
            currentDetailPost = null;
        } else {
            console.warn('帖子详情刷新失败:', err.message);
            currentDetailPost = cached;
        }
    }
}

function _resetDetailUI() {
    document.getElementById('detailTitle').textContent = '加载中...';
    document.getElementById('detailBody').textContent = '';
    document.getElementById('detailTags').innerHTML = '';
    document.getElementById('detailPublisher').textContent = '';
    document.getElementById('detailTime').textContent = '';
    document.getElementById('detailLocation').textContent = '';
    document.getElementById('detailBudget').textContent = '';
    document.getElementById('detailBudget').style.display = 'none';
    document.getElementById('detailContact').textContent = '';
    document.getElementById('detailContact').style.display = 'none';
    document.getElementById('detailComments').innerHTML = '';
    document.getElementById('detailParticipants').innerHTML = '';
    document.getElementById('detailParticipantsSection').style.display = 'none';
    var pb = document.getElementById('detailParticipateBtn');
    pb.style.display = 'none';
    pb.textContent = '我要参加';
    pb.classList.remove('going');
    pb.disabled = false;
    document.getElementById('detailLikeBtn').classList.remove('liked');
    document.getElementById('detailLikeBtn').textContent = '点赞';
    var oa = document.getElementById('detailOwnerActions');
    if (oa) oa.style.display = 'none';
}

function _renderPostDetail(post) {
    document.getElementById('detailTitle').textContent = post.title;
    document.getElementById('detailBody').innerHTML = safeHtmlWithBreaks(post.content || '');

    const tags = post.tags || [];
    document.getElementById('detailTags').innerHTML = tags.map(t => `<span class="post-detail-tag">${escapeHtml(t)}</span>`).join('');

    document.getElementById('detailPublisher').innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.username || '匿名')}`;
    const timeStr = formatPostTime(post.event_time, post.urgency);
    document.getElementById('detailTime').innerHTML = `<i class="fas fa-clock"></i> ${escapeHtml(timeStr)}`;
    if (post.location_name) {
        document.getElementById('detailLocation').innerHTML = `<i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(post.location_name)}`;
    }
    if (post.budget) {
        document.getElementById('detailBudget').innerHTML = `${escapeHtml(post.budget)}`;
        document.getElementById('detailBudget').style.display = '';
    } else {
        document.getElementById('detailBudget').style.display = 'none';
    }
    if (post.contact) {
        document.getElementById('detailContact').innerHTML = `<i class="fas fa-address-book" aria-hidden="true"></i> ${escapeHtml(post.contact)}`;
        document.getElementById('detailContact').style.display = '';
    } else {
        document.getElementById('detailContact').style.display = 'none';
    }

    _updateDetailStats(post);
    const slots = post.max_participants || 1;
    document.getElementById('detailParticipantCount').textContent = `${post.participant_count || 0}/${slots}人`;

    const likeBtn = document.getElementById('detailLikeBtn');
    likeBtn.classList.remove('liked');
    likeBtn.textContent = '点赞';
    if (post.is_liked) {
        likeBtn.classList.add('liked');
        likeBtn.textContent = '已点赞';
    }

    const participateBtn = document.getElementById('detailParticipateBtn');
    const ownerActions = document.getElementById('detailOwnerActions');
    const isFull = (post.participant_count || 0) >= (post.max_participants || 1);
    if (post.is_owner) {
        participateBtn.style.display = 'none';
        if (ownerActions) ownerActions.style.display = 'flex';
    } else if (isFull && post.participation_status !== 'going') {
        participateBtn.style.display = 'block';
        participateBtn.innerHTML = '<i class="fas fa-ban" aria-hidden="true"></i> 已满员';
        participateBtn.disabled = true;
        participateBtn.classList.remove('going');
        if (ownerActions) ownerActions.style.display = 'none';
    } else {
        participateBtn.style.display = 'block';
        participateBtn.disabled = false;
        const going = post.participation_status === 'going';
        participateBtn.textContent = going ? '已报名，点击取消' : '我要参加';
        participateBtn.classList.toggle('going', going);
        if (ownerActions) ownerActions.style.display = 'none';
    }

    _renderDetailParticipants(post.participants || []);
    _renderDetailComments(post.comments || { items: [] });
}

function _updateDetailStats(postOverride) {
    const post = postOverride || currentDetailPost;
    if (!post) return;
    document.getElementById('detailViewCount').textContent = post.view_count || 0;
    document.getElementById('detailLikeCount').textContent = post.like_count || 0;
    document.getElementById('detailCommentCount').textContent = post.comment_count || 0;
    document.getElementById('detailParticipantCount').textContent = post.participant_count || 0;
}

function _renderDetailParticipants(participants) {
    const section = document.getElementById('detailParticipantsSection');
    const container = document.getElementById('detailParticipants');
    if (!participants.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    container.innerHTML = participants.map(p => `
        <span class="participant-chip${p.is_organizer ? ' organizer' : ''}">
            ${escapeHtml(p.username || '用户')}
            ${p.is_organizer ? '<span class="participant-status organizer-badge" title="发起人"><i class="fas fa-star" aria-hidden="true"></i> 发起人</span>' : ''}
            <span class="participant-status${p.status === 'interested' ? ' interested' : ''}">${p.status === 'going' ? '确定' : '感兴趣'}</span>
        </span>
    `).join('');
}

function _optimisticUpdateParticipants(newStatus, user) {
    const section = document.getElementById('detailParticipantsSection');
    const container = document.getElementById('detailParticipants');
    if (!section || !container) return;
    section.style.display = 'block';
    if (newStatus === 'going') {
        const chip = document.createElement('span');
        chip.className = 'participant-chip optimistic';
        chip.dataset.optimisticUser = user.username;
        chip.innerHTML = `${escapeHtml(user.username || '用户')}<span class="participant-status">确定</span>`;
        container.appendChild(chip);
    } else {
        const chips = container.querySelectorAll('.participant-chip');
        for (const c of chips) {
            if (c.textContent.includes(user.username) && !c.classList.contains('organizer')) {
                c.remove();
                break;
            }
        }
    }
    if (!container.querySelector('.participant-chip')) {
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
        const chip = document.createElement('span');
        chip.className = 'participant-chip';
        chip.innerHTML = `${escapeHtml(user.username || '用户')}<span class="participant-status">确定</span>`;
        container.appendChild(chip);
    }
}

function _renderDetailComments(commentsData) {
    const items = commentsData.items || [];
    const container = document.getElementById('detailComments');
    document.getElementById('detailCommentTotal').textContent = commentsData.total || items.length;

    if (!items.length) {
        container.innerHTML = '<div class="detail-comments-empty">暂无评论，来抢沙发吧~</div>';
        return;
    }

    container.innerHTML = items.map(c => {
        const canDeleteComment = isCurrentUserOwner(c);
        return `
        <div class="detail-comment" data-comment-id="${c.id}">
            <div class="detail-comment-header">
                <span class="detail-comment-user">${escapeHtml(c.username || '用户')}${canDeleteComment ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
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
                        return `
                        <div class="detail-comment" data-comment-id="${r.id}">
                            <div class="detail-comment-header">
                                <span class="detail-comment-user">${escapeHtml(r.username || '用户')}${canDeleteReply ? ' <span class="comment-owner-badge">作者</span>' : ''}</span>
                                <span class="detail-comment-time">${formatDate(r.created_at)}</span>
                            </div>
                            <div class="detail-comment-body">${escapeHtml(r.content)}</div>
                            <div class="detail-comment-actions">
                                ${canDeleteReply ? `<button class="detail-comment-delete-btn" data-comment-id="${r.id}" title="删除回复">删除</button>` : ''}
                            </div>
                        </div>
                    `}).join('')}
                </div>
            ` : ''}
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
        _renderDetailComments(post.comments || { items: [] });
        _updateDetailStats();
    } catch (e) { /* ignore */ }
}

async function _refreshDetailParticipants(postId) {
    try {
        const post = await getPost(postId);
        currentDetailPost = post;
        _renderDetailParticipants(post.participants || []);
    } catch (e) { /* ignore */ }
}