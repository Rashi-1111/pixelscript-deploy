(function initHomeStories() {
    const grid = document.getElementById('yourStoriesGrid');
    if (!grid) {
        return;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeImage(value) {
        const image = String(value || '').trim();
        if (!image) {
            return 'images/work1.jpeg';
        }

        if (image.startsWith('http://') || image.startsWith('https://') || image.startsWith('/')) {
            return image;
        }

        return image;
    }

    function resolveEntityId(value) {
        if (!value) {
            return '';
        }

        if (typeof value === 'string') {
            return value;
        }

        if (typeof value === 'number') {
            return String(value);
        }

        if (typeof value === 'object') {
            if (typeof value._id === 'string') {
                return value._id;
            }
            if (value._id && typeof value._id === 'object') {
                if (typeof value._id.$oid === 'string') {
                    return value._id.$oid;
                }
                if (typeof value._id.toString === 'function') {
                    const idText = value._id.toString();
                    if (idText && idText !== '[object Object]') {
                        return idText;
                    }
                }
            }
            if (typeof value.id === 'string') {
                return value.id;
            }
            if (typeof value.$oid === 'string') {
                return value.$oid;
            }
            if (typeof value.toString === 'function') {
                const raw = value.toString();
                if (raw && raw !== '[object Object]') {
                    return raw;
                }
            }
        }

        return '';
    }

    function renderCards(collaborations) {
        const chapterSuffixPattern = /\s*-\s*chapter\s*\d+\s*$/i;

        const workedStories = collaborations
            .filter(item => ['active', 'completed'].includes(item.status))
            .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

        const storyWiseLatest = [];
        const seenStoryKeys = new Set();

        for (const item of workedStories) {
            const preferredTitle = String(item.storyTitle || '').trim();
            const fallbackTitle = String(item.title || '').trim().replace(chapterSuffixPattern, '');
            const storyTitle = preferredTitle || fallbackTitle || 'Untitled Story';
            const normalizedKey = storyTitle.toLowerCase();

            if (seenStoryKeys.has(normalizedKey)) {
                continue;
            }

            seenStoryKeys.add(normalizedKey);
            storyWiseLatest.push({
                ...item,
                __storyCardTitle: storyTitle
            });

            if (storyWiseLatest.length >= 6) {
                break;
            }
        }

        if (!storyWiseLatest.length) {
            grid.innerHTML = '<p class="stories-loading">No active/completed stories yet. Start one from Collaborate.</p>';
            return;
        }

        grid.innerHTML = storyWiseLatest.map(item => {
            const partner = item.partner || {};
            const partnerId = resolveEntityId(partner._id || partner.id || partner);
            const partnerName = partner.name || partner.username || 'Collaborator';
            const storyTitle = item.__storyCardTitle || item.storyTitle || item.title || 'Untitled Story';
            const cover = normalizeImage(item.coverImage);
            const partnerAvatar = normalizeImage(partner.profilePicture, 'images/user-1.png');
            const partnerRole = String(partner.role || '').toLowerCase();
            const profileHref = partnerId
                ? `collaborator-profile.html?userId=${encodeURIComponent(partnerId)}&name=${encodeURIComponent(partnerName)}&avatar=${encodeURIComponent(partnerAvatar)}&role=${encodeURIComponent(partnerRole)}`
                : '#';

            return `
                <div class="box">
                    <img src="${escapeHtml(cover)}" alt="${escapeHtml(storyTitle)} cover">
                    <h3>${escapeHtml(storyTitle)}</h3>
                    <p>Collaborated with ${escapeHtml(partnerName)}</p>
                    <a href="${profileHref}" class="btn">Collaborate</a>
                </div>
            `;
        }).join('');
    }

    async function loadStories() {
        try {
            const response = await fetch('/api/collab/my-collaborations', {
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Pragma: 'no-cache',
                    Expires: '0'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load collaborations');
            }

            const collaborations = await response.json();
            renderCards(Array.isArray(collaborations) ? collaborations : []);
        } catch (error) {
            console.error('Home stories load error:', error);
            grid.innerHTML = '<p class="stories-loading">Could not load your stories right now.</p>';
        }
    }

    loadStories();
})();
