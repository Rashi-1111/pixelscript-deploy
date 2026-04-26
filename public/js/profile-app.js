if (!window.__pixelScriptProfileAppLoaded) {
    window.__pixelScriptProfileAppLoaded = true;
    let currentProfile = null;
    let featuredWorkIds = new Set();
    const MAX_WORK_FILE_SIZE_BYTES = 10 * 1024 * 1024;

    function authHeaders(extraHeaders = {}) {
        return {
            ...extraHeaders
        };
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    function setImage(id, value, fallback = 'images/user-1.png') {
        const element = document.getElementById(id);
        if (element) {
            element.src = value || fallback;
        }
    }

    function renderInterestTags(user) {
        const container = document.getElementById('interest-content');
        if (!container) {
            return;
        }

        const tags = [];
        (user.genres || []).forEach(genre => {
            tags.push({ label: 'Genre', value: genre });
        });
        if (user.country) {
            tags.push({ label: 'Country', value: user.country });
        }
        if (user.ageGroup) {
            tags.push({ label: 'Age', value: user.ageGroup });
        }
        if (user.experience) {
            tags.push({ label: 'Experience', value: `${user.experience} years` });
        }

        if (!tags.length) {
            container.innerHTML = '<span class="interest-empty">Add your interests here</span>';
            return;
        }

        container.innerHTML = `<div class="interest-tags">${tags
            .map(tag => `<span class="interest-chip"><span class="interest-chip-label">${escapeHtml(tag.label)}:</span>${escapeHtml(tag.value)}</span>`)
            .join('')}</div>`;
    }

    function formatRole(role) {
        return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Writer';
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeUrl(value) {
        const url = String(value || '').trim();
        if (!url) {
            return '';
        }

        if (url.startsWith('/')) {
            return url;
        }

        try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.href;
            }
        } catch (error) {
            return '';
        }

        return '';
    }

    function formatFileSize(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) {
            return `${value} B`;
        }
        if (value < 1024 * 1024) {
            return `${(value / 1024).toFixed(1)} KB`;
        }
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }

    function renderSelectedFiles(files = []) {
        const list = document.getElementById('fileList');
        if (!list) {
            return;
        }

        if (!files.length) {
            list.innerHTML = '';
            return;
        }

        list.innerHTML = `<div class="file-list">${files.map(file => `
            <div class="file-item">
                <i class="fas fa-file"></i>
                <span>${escapeHtml(file.name)} • ${escapeHtml(file.type || 'unknown')} • ${formatFileSize(file.size)}</span>
            </div>
        `).join('')}</div>`;
    }

    function updateStoredProfile(user) {
        localStorage.setItem('userProfile', JSON.stringify({
            name: user.name || 'User',
            role: formatRole(user.role),
            avatar: user.profilePicture || 'images/user-1.png'
        }));
    }

    function updateProfileCompletion(user) {
        const fields = [
            user.name,
            user.about || user.bio,
            user.bio,
            (user.genres || []).join(', '),
            user.country,
            user.ageGroup,
            user.experience,
            user.role
        ];
        const completed = fields.filter(value => value && String(value).trim()).length;
        const percentage = Math.round((completed / fields.length) * 100);

        setText('progressPercent', `${percentage}%`);
        const progressFill = document.getElementById('progressFill');
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
    }

    function renderProfile(user) {
        currentProfile = {
            ...user,
            about: user.about || user.bio || ''
        };
        featuredWorkIds = new Set((user.featuredWorks || []).map(id => String(id)));
        setText('userName', user.name || 'User');
        setText('userEmail', user.email || '');
        setText('about-content', currentProfile.about || 'Tell people about yourself');
        setText('bio-content', user.bio || 'Add your bio here');
        renderInterestTags(user);
        setText('country-content', user.country || 'Not set');
        setText('age-group-content', user.ageGroup || 'Not set');
        setText('experience-content', user.experience ? `${user.experience} years` : 'Not set');
        setImage('profilePic', user.profilePicture);

        const roleText = document.querySelector('#role-content .role-text');
        if (roleText) {
            roleText.textContent = formatRole(user.role);
        }

        updateProfileCompletion(currentProfile);
        updateStoredProfile(currentProfile);
        updateFeaturedSummary();
    }

    function updateFeaturedSummary() {
        const summary = document.getElementById('featuredWorkSummary');
        if (!summary) {
            return;
        }

        summary.textContent = `Featured works selected: ${featuredWorkIds.size}/6`;
    }

    function getDraftProfile() {
        const aboutValue = document.getElementById('edit-about')?.value?.trim();
        const bioValue = document.getElementById('edit-bio')?.value?.trim();
        const interestSelect = document.getElementById('edit-interest');
        const selectedGenres = interestSelect
            ? Array.from(interestSelect.selectedOptions || []).map(option => String(option.value || '').trim().toLowerCase()).filter(Boolean)
            : undefined;
        const countryValue = document.getElementById('edit-country')?.value?.trim();
        const ageGroupValue = document.getElementById('edit-age-group')?.value;
        const experienceValue = document.getElementById('edit-experience')?.value;
        const activeRoleOption = document.querySelector('#role-options .role-option.active');

        return {
            ...(currentProfile || {}),
            name: currentProfile?.name || document.getElementById('userName')?.textContent || '',
            about: aboutValue !== undefined ? aboutValue : (currentProfile?.about || ''),
            bio: bioValue !== undefined ? bioValue : (currentProfile?.bio || ''),
            genres: selectedGenres !== undefined ? selectedGenres : (currentProfile?.genres || []),
            country: countryValue !== undefined ? countryValue : (currentProfile?.country || ''),
            ageGroup: ageGroupValue !== undefined ? ageGroupValue : (currentProfile?.ageGroup || ''),
            experience: experienceValue !== undefined ? experienceValue : (currentProfile?.experience || ''),
            role: activeRoleOption?.dataset.role?.toLowerCase() || currentProfile?.role || 'writer'
        };
    }

    function updateCompletionFromDraft() {
        updateProfileCompletion(getDraftProfile());
    }

    function syncAboutModalFromProfile() {
        const draft = currentProfile || {};
        const aboutInput = document.getElementById('edit-about');
        const bioInput = document.getElementById('edit-bio');
        const interestInput = document.getElementById('edit-interest');
        const countryInput = document.getElementById('edit-country');
        const ageGroupInput = document.getElementById('edit-age-group');
        const experienceInput = document.getElementById('edit-experience');
        const roleOptions = document.querySelectorAll('#role-options .role-option');

        if (aboutInput) {
            aboutInput.value = draft.about || '';
        }
        if (bioInput) {
            bioInput.value = draft.bio || '';
        }
        if (interestInput) {
            const genreSet = new Set((draft.genres || []).map(item => String(item).toLowerCase()));
            Array.from(interestInput.options || []).forEach(option => {
                option.selected = genreSet.has(String(option.value || '').toLowerCase());
            });
        }
        if (countryInput) {
            countryInput.value = draft.country || '';
        }
        if (ageGroupInput) {
            ageGroupInput.value = draft.ageGroup || '';
        }
        if (experienceInput) {
            experienceInput.value = draft.experience || '';
        }

        roleOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.role.toLowerCase() === (draft.role || 'writer'));
        });

        updateCompletionFromDraft();
    }

    function openAboutModal() {
        syncAboutModalFromProfile();
        const overlay = document.getElementById('about-edit-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    function closeAboutModal() {
        const overlay = document.getElementById('about-edit-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    function createWorkCard(work) {
        const title = escapeHtml(work.title || 'Untitled');
        const description = escapeHtml(work.description || '');
        const safeFileUrl = sanitizeUrl(work.fileUrl);
        const safeFileType = escapeHtml(work.fileType || 'image');
        const workId = escapeHtml(work._id || '');

        const media = work.fileType === 'image'
            ? `<img src="${safeFileUrl}" alt="${title}">`
            : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:4rem;color:#3f6d71;"><i class="fas fa-file-alt"></i></div>`;

        return `
            <div class="work-item" data-work-id="${workId}">
                ${media}
                <div class="work-overlay">
                    <div class="work-info">
                        <h3>${title}</h3>
                        <p>${description}</p>
                    </div>
                    <div class="work-action-buttons">
                        <button class="feature-btn ${work.isFeatured ? 'active' : ''}" type="button" data-work-action="feature" data-work-id="${workId}" title="Mark as featured">
                            <i class="fas fa-star"></i>
                        </button>
                        <button
                            class="view-btn"
                            type="button"
                            data-work-action="view"
                            data-work-src="${encodeURIComponent(safeFileUrl)}"
                            data-work-type="${safeFileType}">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="delete-btn" type="button" data-work-action="delete" data-work-id="${workId}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    async function loadProfile() {
        try {
            const response = await fetch('/api/users/me', {
                headers: authHeaders({
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Pragma: 'no-cache',
                    Expires: '0'
                })
            });

            if (!response.ok) {
                if (response.status === 401) {
                    sessionStorage.removeItem('user');
                    window.location.href = '/login.html';
                    return;
                }
                throw new Error('Failed to load profile');
            }

            renderProfile(await response.json());
        } catch (error) {
            console.error('Error loading profile:', error);
        }
    }

    async function loadWorks() {
        const worksGrid = document.getElementById('worksGrid');
            if (!worksGrid) {
            return;
        }

        try {
            const response = await fetch('/api/users/works', {
                headers: authHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to load works');
            }

            const works = await response.json();
            featuredWorkIds = new Set((works || []).filter(item => item.isFeatured).map(item => String(item._id)));
            worksGrid.innerHTML = works.length ? works.map(createWorkCard).join('') : '<p>No works uploaded yet.</p>';
            setText('worksCount', String(works.length));
            updateFeaturedSummary();
        } catch (error) {
            console.error('Error loading works:', error);
        }
    }

    async function updateFeaturedWorks() {
        try {
            const response = await fetch('/api/users/featured-works', {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ workIds: Array.from(featuredWorkIds) })
            });

            if (!response.ok) {
                throw new Error('Failed to save featured works');
            }

            const data = await response.json();
            featuredWorkIds = new Set((data.featuredWorks || []).map(id => String(id)));
            updateFeaturedSummary();
        } catch (error) {
            console.error('Error updating featured works:', error);
            alert('Failed to update featured works');
        }
    }

    async function toggleFeaturedWork(workId) {
        if (!workId) {
            return;
        }

        const nextSet = new Set(featuredWorkIds);
        if (nextSet.has(workId)) {
            nextSet.delete(workId);
        } else {
            if (nextSet.size >= 6) {
                alert('You can feature up to 6 works.');
                return;
            }
            nextSet.add(workId);
        }

        featuredWorkIds = nextSet;
        await updateFeaturedWorks();
        await loadWorks();
    }

    async function loadCollaborationCount() {

        try {
            const response = await fetch('/api/users/collaborations', {
                headers: authHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to load collaborations');
            }

            const collaborations = await response.json();
            setText('collabsCount', String(collaborations.length));
        } catch (error) {
            console.error('Error loading collaborations:', error);
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildCollaborationHref(collaboration) {
        if (collaboration.status === 'active') {
            return `collab.html?room=${encodeURIComponent(collaboration.room)}&collaborationId=${encodeURIComponent(collaboration._id)}${collaboration.currentUserRole === 'artist' ? '&host=1' : ''}`;
        }

        if (collaboration.publishedStoryId) {
            return `reader.html?id=${encodeURIComponent(collaboration.publishedStoryId)}`;
        }

        return '#';
    }

    function renderCollaborations(collaborations) {
        const grid = document.getElementById('activeCollaborationsGrid');
        if (!grid) {
            return;
        }

        const activeCollaborations = collaborations.filter(item => item.status === 'active');

        if (!activeCollaborations.length) {
            grid.innerHTML = '<p>No active collaborations yet.</p>';
            return;
        }

        grid.innerHTML = activeCollaborations.map(item => {
            const partnerName = item.partner?.name || item.partner?.username || 'Collaborator';
            const title = item.storyTitle || item.title || 'Untitled collaboration';
            const subtitle = item.status === 'active' ? `with ${partnerName}` : `Published with ${partnerName}`;

            return `
                <a href="${buildCollaborationHref(item)}" class="collab-item">
                    <div class="collab-image">
                        <img src="${escapeHtml(item.coverImage || 'images/work1.jpeg')}" alt="${escapeHtml(title)}">
                    </div>
                    <div class="collab-info">
                        <h3>${escapeHtml(title)}</h3>
                        <p>${escapeHtml(subtitle)}</p>
                    </div>
                </a>
            `;
        }).join('');
    }

    async function loadCollaborations() {
        try {
            const response = await fetch('/api/collab/my-collaborations', {
                headers: authHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to load collaborations');
            }

            const collaborations = await response.json();
            setText('collabsCount', String(collaborations.length));
            renderCollaborations(collaborations);
        } catch (error) {
            console.error('Error loading collaborations:', error);
            const grid = document.getElementById('activeCollaborationsGrid');
            if (grid) {
                grid.innerHTML = '<p>Failed to load collaborations.</p>';
            }
        }
    }

    async function handleLogout() {
        try {
            await fetch('/api/users/logout', {
                method: 'POST'
            });
        } catch (error) {
            // Ignore network errors during logout request.
        }

        localStorage.removeItem('user');
        sessionStorage.removeItem('user');
        localStorage.removeItem('userProfile');
        window.location.href = 'login.html';
    }

    async function saveProfile() {

        const draft = getDraftProfile();
        const payload = {
            name: draft.name,
            about: draft.about,
            bio: draft.bio,
            role: draft.role,
            genres: draft.genres,
            country: draft.country,
            ageGroup: draft.ageGroup,
            experience: draft.experience,
            skills: []
        };

        try {
            const response = await fetch('/api/users/profile', {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Failed to save profile');
            }

            const savedUser = await response.json();
            renderProfile({
                ...savedUser,
                about: draft.about
            });
            closeAboutModal();
            alert('Profile saved successfully');
        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Failed to save profile');
        }
    }

    async function updateProfilePicture(file) {
        if (!file) {
            return;
        }

        const formData = new FormData();
        formData.append('profilePicture', file);

        try {
            const response = await fetch('/api/users/profile-picture', {
                method: 'POST',
                headers: authHeaders(),
                body: formData
            });

            if (!response.ok) {
                throw new Error('Failed to update profile picture');
            }

            renderProfile(await response.json());
        } catch (error) {
            console.error('Error updating profile picture:', error);
            alert('Failed to update profile picture');
        }
    }

    async function uploadWorks(event) {
        event.preventDefault();

        const title = document.getElementById('projectTitle')?.value?.trim();
        const description = document.getElementById('projectDescription')?.value?.trim() || '';
        const files = Array.from(document.getElementById('fileInput')?.files || []);

        if (!title || files.length === 0) {
            alert('Please add a title and select at least one file.');
            return;
        }

        const oversized = files.find(file => (Number(file.size) || 0) > MAX_WORK_FILE_SIZE_BYTES);
        if (oversized) {
            alert(`File "${oversized.name}" exceeds 10 MB. Please upload a smaller file.`);
            return;
        }

        try {
            for (const file of files) {
                const formData = new FormData();
                formData.append('title', title);
                formData.append('description', description);
                formData.append('file', file);

                const response = await fetch('/api/users/works', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Failed to upload work');
                }
            }

            document.getElementById('uploadForm')?.reset();
            renderSelectedFiles([]);
            closeUploadModal();
            await loadWorks();
        } catch (error) {
            console.error('Error uploading work:', error);
            alert('Failed to upload work');
        }
    }

    async function deleteWork(workId) {
        if (!workId) {
            return;
        }

        try {
            const response = await fetch(`/api/users/works/${workId}`, {
                method: 'DELETE',
                headers: authHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to delete work');
            }

            await loadWorks();
        } catch (error) {
            console.error('Error deleting work:', error);
            alert('Failed to delete work');
        }
    }

    function viewWork(src, fileType = 'image') {
        const safeSrc = sanitizeUrl(src);
        if (!safeSrc) {
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'view-work-modal';
        const content = document.createElement('div');
        content.className = 'modal-content';

        const closeButton = document.createElement('span');
        closeButton.className = 'close-btn';
        closeButton.textContent = '\u00d7';

        content.appendChild(closeButton);

        if (fileType === 'image') {
            const image = document.createElement('img');
            image.src = safeSrc;
            image.alt = 'Work Preview';
            image.className = 'work-preview';
            content.appendChild(image);
        } else {
            const frame = document.createElement('iframe');
            frame.src = safeSrc;
            frame.title = 'Work Preview';
            frame.style.width = '100%';
            frame.style.height = '80vh';
            frame.style.border = 'none';
            content.appendChild(frame);
        }

        modal.appendChild(content);
        document.body.appendChild(modal);

        modal.querySelector('.close-btn').onclick = () => modal.remove();
        modal.onclick = event => {
            if (event.target === modal) {
                modal.remove();
            }
        };
    }

    function openUploadModal() {
        const overlay = document.getElementById('uploadOverlay');
        const modal = document.getElementById('uploadModal');
        if (overlay) {
            overlay.style.display = 'block';
        }
        if (modal) {
            modal.style.display = 'block';
        }
    }

    function closeUploadModal() {
        const overlay = document.getElementById('uploadOverlay');
        const modal = document.getElementById('uploadModal');
        if (overlay) {
            overlay.style.display = 'none';
        }
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function bindEvents() {
        const worksGrid = document.getElementById('worksGrid');
        if (worksGrid && !worksGrid.dataset.profileAppBound) {
            worksGrid.addEventListener('click', event => {
                const trigger = event.target.closest('button[data-work-action]');
                if (!trigger) {
                    return;
                }

                const action = trigger.dataset.workAction;
                if (action === 'view') {
                    const src = decodeURIComponent(trigger.dataset.workSrc || '');
                    const type = trigger.dataset.workType || 'image';
                    viewWork(src, type);
                    return;
                }

                if (action === 'feature') {
                    toggleFeaturedWork(trigger.dataset.workId || '');
                    return;
                }

                if (action === 'delete') {
                    deleteWork(trigger.dataset.workId || '');
                }
            });
            worksGrid.dataset.profileAppBound = 'true';
        }

        const editAboutButton = document.getElementById('edit-about-btn');
        if (editAboutButton && !editAboutButton.dataset.profileAppBound) {
            editAboutButton.addEventListener('click', openAboutModal);
            editAboutButton.dataset.profileAppBound = 'true';
        }

        const cancelAboutButton = document.getElementById('cancel-about-btn');
        if (cancelAboutButton && !cancelAboutButton.dataset.profileAppBound) {
            cancelAboutButton.addEventListener('click', closeAboutModal);
            cancelAboutButton.dataset.profileAppBound = 'true';
        }

        const aboutOverlay = document.getElementById('about-edit-overlay');
        if (aboutOverlay && !aboutOverlay.dataset.profileAppBound) {
            aboutOverlay.addEventListener('click', event => {
                if (event.target === aboutOverlay) {
                    closeAboutModal();
                }
            });
            aboutOverlay.dataset.profileAppBound = 'true';
        }

        document.querySelectorAll('#role-options .role-option').forEach(option => {
            if (!option.dataset.profileAppBound) {
                option.addEventListener('click', () => {
                    document.querySelectorAll('#role-options .role-option').forEach(item => {
                        item.classList.remove('active');
                    });
                    option.classList.add('active');
                    updateCompletionFromDraft();
                });
                option.dataset.profileAppBound = 'true';
            }
        });

        ['edit-about', 'edit-bio', 'edit-interest', 'edit-country', 'edit-age-group', 'edit-experience'].forEach(id => {
            const element = document.getElementById(id);
            if (element && !element.dataset.profileAppBound) {
                element.addEventListener('input', updateCompletionFromDraft);
                element.addEventListener('change', updateCompletionFromDraft);
                element.dataset.profileAppBound = 'true';
            }
        });

        const uploadForm = document.getElementById('uploadForm');
        if (uploadForm && !uploadForm.dataset.profileAppBound) {
            uploadForm.addEventListener('submit', uploadWorks);
            uploadForm.dataset.profileAppBound = 'true';
        }

        const fileInput = document.getElementById('fileInput');
        if (fileInput && !fileInput.dataset.profileAppBound) {
            fileInput.addEventListener('change', event => {
                const files = Array.from(event.target.files || []);
                renderSelectedFiles(files);
            });
            fileInput.dataset.profileAppBound = 'true';
        }

        const profilePicInput = document.getElementById('profilePicInput');
        if (profilePicInput && !profilePicInput.dataset.profileAppBound) {
            profilePicInput.addEventListener('change', event => {
                const file = event.target.files?.[0];
                if (file) {
                    updateProfilePicture(file);
                }
            });
            profilePicInput.dataset.profileAppBound = 'true';
        }

        const saveAboutButton = document.getElementById('save-about-btn');
        if (saveAboutButton && !saveAboutButton.dataset.profileAppBound) {
            saveAboutButton.addEventListener('click', () => {
                saveProfile();
            });
            saveAboutButton.dataset.profileAppBound = 'true';
        }
    }

    function init() {
        bindEvents();
        loadProfile();
        loadWorks();
        loadCollaborations();
    }

    window.openUploadModal = openUploadModal;
    window.closeUploadModal = closeUploadModal;
    window.openEditModal = openAboutModal;
    window.closeEditModal = closeAboutModal;
    window.saveProfile = saveProfile;
    window.selectRole = function selectRole(role) {
        const option = document.querySelector(`#role-options .role-option[data-role="${role.charAt(0).toUpperCase() + role.slice(1)}"]`);
        if (option) {
            option.click();
        }
    };
    window.viewWork = viewWork;
    window.deleteWork = deleteWork;
    window.handleLogout = handleLogout;
    window.handleProfilePicChange = function handleProfilePicChange(event) {
        const file = event.target.files?.[0];
        if (file) {
            updateProfilePicture(file);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}
