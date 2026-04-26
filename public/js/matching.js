/**
 * matching.js — KNN-based smart partner matching.
 * Wires the filter bar to /api/users/discover and renders
 * partner cards + a full profile modal.
 */

let allUsers = [];
let sentRequests = new Set();
let activeModalUserId = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('findMatchesBtn').addEventListener('click', findMatches);
    findMatches(); // Initial load
});

// ─── FIND MATCHES ────────────────────────────────────────────────────────────
async function findMatches() {
    const role       = (document.getElementById('partner-role')?.value || '').trim();
    const genre      = (document.getElementById('genre')?.value || '').trim();
    const country    = (document.getElementById('country')?.value || '').trim();
    const ageGroup   = (document.getElementById('age-group')?.value || '').trim();
    const experience = (document.getElementById('experience')?.value || '').trim();

    const params = new URLSearchParams();
    if (role)       params.set('role', role);
    if (genre)      params.set('genre', genre);
    if (country)    params.set('country', country);
    if (ageGroup)   params.set('ageGroup', ageGroup);
    if (experience) params.set('experience', experience);

    setLoading(true);

    try {
        const res = await fetch(`/api/users/discover?${params.toString()}`);
        if (res.status === 401) { window.location.href = 'login.html'; return; }
        if (!res.ok) throw new Error(`${res.status}`);

        allUsers = await res.json();
        renderGrid(allUsers);
    } catch (err) {
        console.error('Matching error:', err);
        document.getElementById('partnersGrid').innerHTML = `
            <div class="state-box">
                <div class="state-icon"><i class="fas fa-exclamation-circle"></i></div>
                <p>Failed to load partners. Please try again.</p>
            </div>`;
        document.getElementById('results-count').textContent = '0';
    } finally {
        setLoading(false);
    }
}

// ─── RENDER GRID ─────────────────────────────────────────────────────────────
function renderGrid(users) {
    const grid = document.getElementById('partnersGrid');
    const countEl = document.getElementById('results-count');
    countEl.textContent = `${users.length} found`;

    if (!users.length) {
        grid.innerHTML = `
            <div class="state-box">
                <div class="state-icon"><i class="fas fa-search"></i></div>
                <p>No partners found for these filters.<br>Try broadening your search.</p>
            </div>`;
        return;
    }

    grid.innerHTML = users.map(user => buildCard(user)).join('');
}

// ─── BUILD CARD HTML ──────────────────────────────────────────────────────────
function buildCard(user) {
    const avatar = escHtml(user.avatar || 'images/user-1.png');
    const name   = escHtml(user.name || user.username || 'Unknown');
    const role   = cap(user.role || 'creator');
    const bio    = escHtml(truncate(user.bio || 'No bio provided.', 100));
    const pct    = user.matchPercentage || 0;

    // Match badge class
    let badgeClass = 'match-low';
    if (pct >= 80) badgeClass = 'match-great';
    else if (pct >= 60) badgeClass = 'match-good';

    const matchBadge = pct > 0
        ? `<span class="match-badge ${badgeClass}"><i class="fas fa-bolt"></i> ${pct}%</span>`
        : '';

    const metaPills = [
        user.country    ? `<span class="meta-pill"><i class="fas fa-globe"></i>${escHtml(user.country)}</span>` : '',
        user.experience ? `<span class="meta-pill"><i class="fas fa-star"></i>${escHtml(user.experience)} yrs</span>` : '',
        user.ageGroup   ? `<span class="meta-pill"><i class="fas fa-user"></i>${escHtml(user.ageGroup)}</span>` : '',
    ].filter(Boolean).join('');

    const genrePills = (user.genres || []).slice(0, 3)
        .map(g => `<span class="genre-pill">${escHtml(cap(g))}</span>`).join('');

    return `
    <div class="partner-card" onclick="openProfileModal('${escHtml(user._id)}')">
        ${matchBadge}
        <div class="card-avatar-wrap">
            <img class="card-avatar" src="${avatar}" alt="${name}" 
                 onerror="this.src='images/user-1.png'" loading="lazy">
        </div>
        <div class="card-body">
            <div class="card-name">${name}</div>
            <span class="card-role">${role}</span>
            ${metaPills ? `<div class="card-meta">${metaPills}</div>` : ''}
            <p class="card-bio">${bio}</p>
            ${genrePills ? `<div class="card-genres">${genrePills}</div>` : ''}
        </div>
        <div class="card-footer">
            <button class="btn-request ${sentRequests.has(user._id) ? 'sent' : ''}"
                    onclick="event.stopPropagation(); sendCollabRequest('${escHtml(user._id)}', '${name}', this)"
                    ${sentRequests.has(user._id) ? 'disabled' : ''}>
                ${sentRequests.has(user._id)
                    ? '<i class="fas fa-check"></i> Request Sent'
                    : '<i class="fas fa-handshake"></i> Request Collab'}
            </button>
        </div>
    </div>`;
}

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
function openProfileModal(userId) {
    const user = allUsers.find(u => String(u._id) === String(userId));
    if (!user) return;
    activeModalUserId = userId;

    const pct = user.matchPercentage || 0;
    const avatar = user.avatar || 'images/user-1.png';

    document.getElementById('modal-avatar').src  = avatar;
    document.getElementById('modal-avatar').onerror = function() { this.src = 'images/user-1.png'; };
    document.getElementById('modal-name').textContent  = user.name || user.username || 'Unknown';
    document.getElementById('modal-role').textContent  = cap(user.role || 'creator');
    document.getElementById('modal-match-pct').textContent = pct > 0 ? `${pct}%` : '—';

    // Animate match bar
    setTimeout(() => {
        document.getElementById('modal-match-fill').style.width = `${pct}%`;
    }, 50);

    // Bio
    const bioEl = document.getElementById('modal-bio');
    bioEl.textContent = user.bio || user.about || 'No bio provided.';
    document.getElementById('modal-bio-section').style.display = bioEl.textContent === 'No bio provided.' && !user.bio ? 'none' : '';

    // Meta row
    const metaRow = document.getElementById('modal-meta-row');
    metaRow.innerHTML = [
        user.country    ? `<span class="modal-meta-chip"><i class="fas fa-globe"></i>${escHtml(user.country)}</span>` : '',
        user.experience ? `<span class="modal-meta-chip"><i class="fas fa-star"></i>${escHtml(user.experience)} yrs exp</span>` : '',
        user.ageGroup   ? `<span class="modal-meta-chip"><i class="fas fa-user"></i>Age ${escHtml(user.ageGroup)}</span>` : '',
    ].filter(Boolean).join('');

    // Genres
    const genresEl = document.getElementById('modal-genres');
    genresEl.innerHTML = (user.genres || []).map(g =>
        `<span class="modal-genre-pill">${escHtml(cap(g))}</span>`
    ).join('');
    document.getElementById('modal-genres-section').style.display = user.genres?.length ? '' : 'none';

    // Collab button state
    const modalBtn = document.getElementById('modal-collab-btn');
    if (sentRequests.has(userId)) {
        modalBtn.disabled = true;
        modalBtn.classList.add('sent');
        modalBtn.innerHTML = '<i class="fas fa-check"></i> Request Sent!';
    } else {
        modalBtn.disabled = false;
        modalBtn.classList.remove('sent');
        modalBtn.innerHTML = '<i class="fas fa-handshake"></i> Request Collaboration';
    }

    document.getElementById('profileModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('open');
    document.body.style.overflow = '';
    // Reset fill for next open
    document.getElementById('modal-match-fill').style.width = '0%';
    activeModalUserId = null;
}

// Close when clicking outside the modal inner
function closeModal(e) {
    if (e.target.id === 'profileModal') closeProfileModal();
}

// Close on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeProfileModal();
});

// ─── SEND COLLAB REQUEST (card button) ───────────────────────────────────────
async function sendCollabRequest(userId, userName, btn) {
    if (sentRequests.has(userId)) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';

    try {
        const user = allUsers.find(u => String(u._id) === String(userId));
        const res = await fetch('/api/collab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                partnerId: userId,
                title: `Collaboration with ${userName}`,
                description: "Let's create something amazing together!",
                category: 'comic',
                genre: user?.genres?.[0] || 'fantasy'
            })
        });

        if (res.status === 401) { window.location.href = 'login.html'; return; }

        if (res.ok) {
            sentRequests.add(userId);
            btn.innerHTML = '<i class="fas fa-check"></i> Request Sent';
            btn.classList.add('sent');
        } else {
            const data = await res.json();
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-handshake"></i> Request Collab';
            alert(data.error || data.message || 'Failed to send request');
        }
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-handshake"></i> Request Collab';
        alert('Failed to send request. Please try again.');
    }
}

// ─── SEND COLLAB REQUEST (modal button) ──────────────────────────────────────
async function sendModalCollabRequest() {
    if (!activeModalUserId) return;
    const user = allUsers.find(u => String(u._id) === String(activeModalUserId));
    if (!user) return;

    const btn = document.getElementById('modal-collab-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';

    try {
        const res = await fetch('/api/collab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                partnerId: activeModalUserId,
                title: `Collaboration with ${user.name || user.username}`,
                description: "Let's create something amazing together!",
                category: 'comic',
                genre: user?.genres?.[0] || 'fantasy'
            })
        });

        if (res.status === 401) { window.location.href = 'login.html'; return; }

        if (res.ok) {
            sentRequests.add(activeModalUserId);
            btn.innerHTML = '<i class="fas fa-check"></i> Request Sent!';
            btn.classList.add('sent');
            // Also update the card in the grid
            renderGrid(allUsers);
        } else {
            const data = await res.json();
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-handshake"></i> Request Collaboration';
            alert(data.error || data.message || 'Failed to send request');
        }
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-handshake"></i> Request Collaboration';
        alert('Failed to send. Please try again.');
    }
}

// ─── LOADING STATE ────────────────────────────────────────────────────────────
function setLoading(on) {
    const btn = document.getElementById('findMatchesBtn');
    if (btn) {
        btn.disabled = on;
        btn.innerHTML = on
            ? '<i class="fas fa-spinner fa-spin"></i> Searching…'
            : '<i class="fas fa-bolt"></i> Find Matches';
    }
    if (on) {
        document.getElementById('partnersGrid').innerHTML = `
            <div class="state-box">
                <div class="state-icon"><i class="fas fa-spinner fa-spin"></i></div>
                <p>Finding your perfect creative partner…</p>
            </div>`;
        document.getElementById('results-count').textContent = '—';
    }
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function cap(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function truncate(str, max) {
    return str && str.length > max ? str.slice(0, max) + '…' : (str || '');
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
