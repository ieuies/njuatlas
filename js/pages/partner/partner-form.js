import { showToast, escapeHtml } from '../../utils.js';
import { isLoggedIn } from '../../auth.js';
import { createPost, updatePost } from '../../api.js';
import { API_BASE } from '../../config.js';
import { partnerStore, debounce } from './shared.js';
import { loadPostsByPage } from './list.js';
import { refreshPreviewMarkers } from './map.js';

function _pad2(n) { return String(n).padStart(2, '0'); }
function _toLocalDateInputValue(d) {
    return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
}
function _toLocalTimeInputValue(d) {
    return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
}

export function openEditPostModal(post) {
    const modal = document.getElementById('partnerModal');
    if (!modal) return;
    document.getElementById('postDetailModal').style.display = 'none';

    document.getElementById('partnerCategory').value = (post.tags && post.tags[0]) ? post.tags[0] : '';
    document.getElementById('partnerTitle').value = post.title || '';
    document.getElementById('partnerDesc').value = post.content || '';
    document.getElementById('partnerLocation').value = post.location_name || '';
    document.getElementById('partnerBudget').value = post.budget || '';
    document.getElementById('partnerSlots').value = Math.max(post.max_participants || 2, 2);
    document.getElementById('partnerContact').value = post.contact || '';

    partnerStore.modalDuration = (post.type === 'forum') ? 'long' : 'short';
    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-duration') === partnerStore.modalDuration);
    });
    const timeModeRow = document.getElementById('timeModeRow');
    if (timeModeRow) timeModeRow.style.display = partnerStore.modalDuration === 'long' ? 'none' : 'flex';

    const hasScheduledRange = Boolean(post.event_time || post.event_end_time);
    partnerStore.modalUrgency = (post.urgency === 'scheduled' || (post.type !== 'forum' && hasScheduledRange)) ? 'scheduled' : 'now';
    const timeModeBtns = document.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-mode') === partnerStore.modalUrgency);
    });
    const scheduledRow = document.getElementById('scheduledTimeRow');
    if (scheduledRow) {
        scheduledRow.style.display = partnerStore.modalUrgency === 'scheduled' ? 'flex' : 'none';
    }
    document.getElementById('partnerDate').value = '';
    document.getElementById('partnerTimePicker').value = '';
    document.getElementById('partnerEndDate').value = '';
    document.getElementById('partnerEndTimePicker').value = '';
    if (post.event_time) {
        const start = new Date(post.event_time);
        document.getElementById('partnerDate').value = _toLocalDateInputValue(start);
        document.getElementById('partnerTimePicker').value = _toLocalTimeInputValue(start);
    }
    if (post.event_end_time) {
        const end = new Date(post.event_end_time);
        document.getElementById('partnerEndDate').value = _toLocalDateInputValue(end);
        document.getElementById('partnerEndTimePicker').value = _toLocalTimeInputValue(end);
    } else if (post.event_time) {
        // 兼容旧帖仅有开始时间：默认给 2 小时结束时间，避免误提交为空。
        const start = new Date(post.event_time);
        const fallbackEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        document.getElementById('partnerEndDate').value = _toLocalDateInputValue(fallbackEnd);
        document.getElementById('partnerEndTimePicker').value = _toLocalTimeInputValue(fallbackEnd);
    }

    partnerStore.modalLocationCoords = post.location || null;
    modal.setAttribute('data-edit-id', post.id);
    modal.style.display = 'flex';
}

export function initPartnerModal() {
    const modal = document.getElementById('partnerModal');
    const closeBtn = document.getElementById('closePartnerModalBtn');
    const cancelBtn = document.getElementById('cancelPartnerBtn');
    const submitBtn = document.getElementById('submitPartnerBtn');
    const form = document.getElementById('partnerForm');

    if (!modal || modal.dataset.ready === '1') return;
    modal.dataset.ready = '1';

    const scheduledRow = document.getElementById('scheduledTimeRow');
    const timeModeRow = document.getElementById('timeModeRow');
    const slotsInput = document.getElementById('partnerSlots');
    if (slotsInput) {
        slotsInput.min = '2';
        slotsInput.placeholder = '总人数(含自己)';
        if (!slotsInput.value || Number(slotsInput.value) < 2) slotsInput.value = '2';
    }

    const durationBtns = document.querySelectorAll('#durationRow .time-mode-btn');
    durationBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            durationBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            partnerStore.modalDuration = btn.getAttribute('data-duration');
            timeModeRow.style.display = partnerStore.modalDuration === 'long' ? 'none' : 'flex';
            scheduledRow.style.display = 'none';
        });
    });

    const timeModeBtns = modal.querySelectorAll('#timeModeRow .time-mode-btn');
    timeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            partnerStore.modalUrgency = btn.getAttribute('data-mode');
            scheduledRow.style.display = partnerStore.modalUrgency === 'scheduled' ? 'flex' : 'none';
        });
    });

    // 地点搜索自动补全
    let suggestionIndex = -1;
    const locationInput = document.getElementById('partnerLocation');
    const suggestionsBox = document.getElementById('locationSuggestions');

    const _doSearch = debounce(async function (keyword) {
        const kw = keyword.trim();
        if (!kw) {
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
            return;
        }
        suggestionsBox.innerHTML = '<li class="suggestion-loading">搜索中...</li>';
        suggestionsBox.style.display = 'block';

        try {
            const resp = await fetch(`${API_BASE}/places/suggestions?keyword=${encodeURIComponent(kw)}&city=${encodeURIComponent('南京')}&location=118.780,32.058`);
            const data = await resp.json();
            if (!data.tips || data.tips.length === 0) {
                suggestionsBox.innerHTML = '<li class="suggestion-empty">未找到地点，请尝试其他关键词</li>';
                suggestionsBox.style.display = 'block';
                suggestionIndex = -1;
                return;
            }
            suggestionsBox.innerHTML = data.tips.map((tip, idx) => {
                const name = escapeHtml(tip.name || '');
                const address = escapeHtml(tip.address || tip.district || '');
                return `<li data-idx="${idx}" data-location="${tip.location}" data-name="${escapeHtml(name)}">
                    <span class="suggestion-name">${name}</span>
                    <span class="suggestion-address">${address}</span>
                </li>`;
            }).join('');
            suggestionsBox.style.display = 'block';
            suggestionIndex = -1;
        } catch (err) {
            console.warn('地点搜索失败:', err);
            suggestionsBox.innerHTML = '<li class="suggestion-empty">搜索失败，请重试</li>';
            suggestionsBox.style.display = 'block';
            suggestionIndex = -1;
        }
    }, 300);

    locationInput.addEventListener('input', () => {
        partnerStore.modalLocationCoords = null;
        _doSearch(locationInput.value);
    });

    suggestionsBox.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        const loc = li.getAttribute('data-location');
        const name = li.getAttribute('data-name');
        if (loc && name) {
            locationInput.value = name;
            partnerStore.modalLocationCoords = loc;
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
        }
    });

    locationInput.addEventListener('keydown', (e) => {
        const items = suggestionsBox.querySelectorAll('li[data-location]');
        if (!items.length || suggestionsBox.style.display === 'none') return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
            items.forEach((it, i) => it.classList.toggle('active', i === suggestionIndex));
            items[suggestionIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            suggestionIndex = Math.max(suggestionIndex - 1, 0);
            items.forEach((it, i) => it.classList.toggle('active', i === suggestionIndex));
            items[suggestionIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestionIndex >= 0 && items[suggestionIndex]) {
                items[suggestionIndex].click();
            }
        } else if (e.key === 'Escape') {
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
        }
    });

    document.addEventListener('click', (e) => {
        if (!locationInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.style.display = 'none';
            suggestionIndex = -1;
        }
    });

    const openModal = () => {
        if (!isLoggedIn()) {
            showToast('请先登录后再发起组局');
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
        modal.removeAttribute('data-edit-id');
        form?.reset();
        partnerStore.modalDuration = 'short';
        durationBtns.forEach(b => b.classList.remove('active'));
        const defaultDurationBtn = document.querySelector('#durationRow .time-mode-btn[data-duration="short"]');
        if (defaultDurationBtn) defaultDurationBtn.classList.add('active');
        if (timeModeRow) timeModeRow.style.display = 'flex';
        timeModeBtns.forEach(b => b.classList.remove('active'));
        const defaultTimeBtn = modal.querySelector('#timeModeRow .time-mode-btn[data-mode="now"]');
        if (defaultTimeBtn) defaultTimeBtn.classList.add('active');
        partnerStore.modalUrgency = 'now';
        if (scheduledRow) scheduledRow.style.display = 'none';
        partnerStore.modalLocationCoords = null;
        if (slotsInput) slotsInput.value = '2';
        suggestionIndex = -1;
        if (suggestionsBox) suggestionsBox.style.display = 'none';
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        form?.reset();
        partnerStore.modalLocationCoords = null;
        suggestionIndex = -1;
        if (suggestionsBox) suggestionsBox.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    submitBtn?.addEventListener('click', async () => {
        const category = document.getElementById('partnerCategory')?.value;
        const title = document.getElementById('partnerTitle')?.value.trim();
        const description = document.getElementById('partnerDesc')?.value.trim();
        const location = document.getElementById('partnerLocation')?.value.trim();
        const budget = document.getElementById('partnerBudget')?.value.trim();
        const slots = parseInt(document.getElementById('partnerSlots')?.value) || 2;
        const contact = document.getElementById('partnerContact')?.value.trim();
        const editId = modal.getAttribute('data-edit-id');

        if (!category || !title) {
            showToast('请至少填写分类和标题');
            return;
        }
        if (slots < 2) {
            showToast('总人数至少为 2（包含你自己）');
            return;
        }

        if (location && !partnerStore.modalLocationCoords) {
            showToast('请从下拉建议中选择地点，否则帖子不会显示在地图上');
        }

        let event_time = null;
        let event_end_time = null;
        if (partnerStore.modalUrgency === 'scheduled') {
            const startDateVal = document.getElementById('partnerDate')?.value;
            const startTimeVal = document.getElementById('partnerTimePicker')?.value;
            const endDateVal = document.getElementById('partnerEndDate')?.value;
            const endTimeVal = document.getElementById('partnerEndTimePicker')?.value;
            if (!startDateVal || !startTimeVal || !endDateVal || !endTimeVal) {
                showToast('请填写完整的开始和结束时间');
                return;
            }
            const startAt = new Date(`${startDateVal}T${startTimeVal}:00`);
            const endAt = new Date(`${endDateVal}T${endTimeVal}:00`);
            if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
                showToast('时间格式无效，请重新选择');
                return;
            }
            if (endAt <= startAt) {
                showToast('结束时间必须晚于开始时间');
                return;
            }
            event_time = startAt.toISOString();
            event_end_time = endAt.toISOString();
        }

        const tags = [category];
        const btnText = editId ? '更新中...' : '发布中...';
        submitBtn.disabled = true;
        submitBtn.innerText = btnText;

        try {
            if (editId) {
                await updatePost(parseInt(editId), {
                    type: partnerStore.modalDuration === 'long' ? 'forum' : 'event',
                    title, content: description || title, tags,
                    location: partnerStore.modalLocationCoords || null,
                    location_name: location || null,
                    urgency: partnerStore.modalDuration === 'long' ? 'long_term' : partnerStore.modalUrgency,
                    event_time: partnerStore.modalDuration === 'long' ? null : event_time,
                    event_end_time: partnerStore.modalDuration === 'long' ? null : event_end_time,
                    slots, budget, contact,
                });
                modal.removeAttribute('data-edit-id');
                showToast('组局已更新');
            } else {
                await createPost({
                    type: partnerStore.modalDuration === 'long' ? 'forum' : 'event',
                    title, content: description || title, tags,
                    location: partnerStore.modalLocationCoords || null,
                    location_name: location || null,
                    urgency: partnerStore.modalDuration === 'long' ? 'long_term' : partnerStore.modalUrgency,
                    event_time: partnerStore.modalDuration === 'long' ? null : event_time,
                    event_end_time: partnerStore.modalDuration === 'long' ? null : event_end_time,
                    slots, budget, contact,
                });
                showToast('发布成功');
            }
            closeModal();
            // 重置分页并重新加载第一页
            partnerStore.currentPage = 1;
            partnerStore.hasMore = true;
            await loadPostsByPage(1, false);
            refreshPreviewMarkers();
        } catch (err) {
            showToast('发布失败: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = '发布组局';
        }
    });

    window.openPartnerModal = openModal;
}