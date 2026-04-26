const urlParams = new URLSearchParams(window.location.search);
const room = urlParams.get('room') || Math.random().toString(36).substring(7);
const collaborationId = urlParams.get('collaborationId');
const isPrimaryUser = urlParams.get('host') === '1' || (!urlParams.get('room'));
const socket = io();
const persistedMessages = [];
let canUseDrawingTools = isPrimaryUser;
let savedChapterPanels = [];
let currentCoverImage = '';
let lastPaintTool = 'brush';

if (isPrimaryUser && (urlParams.get('host') !== '1' || !urlParams.has('room'))) {
    const collaborationParamForHost = collaborationId ? `&collaborationId=${encodeURIComponent(collaborationId)}` : '';
    const newUrl = `${window.location.pathname}?room=${room}&host=1${collaborationParamForHost}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
}

const collaborationParam = collaborationId ? `&collaborationId=${encodeURIComponent(collaborationId)}` : '';
const roomUrl = `${window.location.origin}${window.location.pathname}?room=${room}${collaborationParam}`;

function debounce(fn, wait = 700) {
    let timeoutId = null;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), wait);
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeChapterPanels(panels = []) {
    return (Array.isArray(panels) ? panels : [])
        .filter(panel => panel && panel.imageUrl)
        .map((panel, index) => ({
            _id: panel._id,
            title: String(panel.title || '').trim(),
            imageUrl: panel.imageUrl,
            order: Number(panel.order) || index + 1
        }))
        .sort((a, b) => a.order - b.order)
        .map((panel, index) => ({
            ...panel,
            order: index + 1
        }));
}

function renderSavedPanels() {
    const list = document.getElementById('project-panels-list');
    if (!list) {
        return;
    }

    if (!savedChapterPanels.length) {
        list.innerHTML = '<div class="panel-empty">No panels saved yet. Draw on the canvas, then save each scene as a chapter panel.</div>';
        return;
    }

    list.innerHTML = savedChapterPanels.map(panel => `
        <div class="panel-card">
            <img src="${panel.imageUrl}" alt="${escapeHtml(panel.title || `Panel ${panel.order}`)}">
            <div class="panel-meta">
                <strong>${escapeHtml(panel.title || `Panel ${panel.order}`)}</strong>
                <span>Panel ${panel.order}</span>
            </div>
            <button class="panel-remove-btn" type="button" data-remove-panel="${panel.order}" aria-label="Remove panel ${panel.order}">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

function renderCoverImage(coverImage) {
    currentCoverImage = coverImage || '';

    const preview = document.getElementById('cover-image-preview');
    const image = document.getElementById('cover-image-preview-img');
    if (!preview || !image) {
        return;
    }

    if (currentCoverImage) {
        image.src = currentCoverImage;
        preview.style.display = 'block';
        return;
    }

    image.src = '';
    preview.style.display = 'none';
}

function updateReaderPreviewLink(publishedStoryId, publishedChapterId = null) {
    if (!readerPreviewLink) {
        return;
    }

    if (publishedStoryId) {
        readerPreviewLink.href = publishedChapterId
            ? `chapter-view.html?story=${publishedStoryId}&chapter=${publishedChapterId}`
            : `reader.html?id=${publishedStoryId}`;
        readerPreviewLink.style.display = 'inline-flex';
        return;
    }

    readerPreviewLink.href = 'stories.html';
    readerPreviewLink.style.display = 'none';
}

function joinCollaborationRoom() {
    socket.emit('joinRoom', {
        room,
        isPrimaryUser: canUseDrawingTools
    });
}

async function uploadCoverImage(file) {
    if (!file || !collaborationId) {
        return;
    }

    try {
        const formData = new FormData();
        formData.append('coverImage', file);

        const response = await fetch(`/api/collab/${collaborationId}/cover-image`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to upload cover image');
        }

        renderCoverImage(data.coverImage || '');
        if (projectStatus) {
            projectStatus.textContent = 'Story cover uploaded successfully.';
        }
    } catch (error) {
        console.error('Cover upload error:', error);
        alert(error.message || 'Failed to upload story cover');
    }
}

async function syncChapterPanels(statusMessage = 'Chapter panels synced.') {
    if (!collaborationId) {
        renderSavedPanels();
        return true;
    }

    try {
        const response = await fetch(`/api/collab/${collaborationId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chapterPanels: savedChapterPanels
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to sync chapter panels');
        }

        savedChapterPanels = normalizeChapterPanels(data.chapterPanels || savedChapterPanels);
        renderSavedPanels();
        if (projectStatus) {
            projectStatus.textContent = statusMessage;
        }
        return true;
    } catch (error) {
        console.error('Panel sync error:', error);
        alert(error.message || 'Failed to sync chapter panels');
        return false;
    }
}

async function saveCurrentPanel() {
    if (!canUseDrawingTools) {
        return;
    }

    const imageUrl = canvas.getPanelExportDataUrl();
    if (!imageUrl) {
        alert('Draw something on the canvas first.');
        return;
    }

    const panelTitleInput = document.getElementById('panel-title-input');
    const nextOrder = savedChapterPanels.length + 1;
    savedChapterPanels = normalizeChapterPanels([
        ...savedChapterPanels,
        {
            title: panelTitleInput?.value?.trim() || `Panel ${nextOrder}`,
            imageUrl,
            order: nextOrder
        }
    ]);
    renderSavedPanels();

    if (panelTitleInput) {
        panelTitleInput.value = '';
    }

    await syncChapterPanels(`Panel ${nextOrder} saved to the chapter storyboard.`);
}

async function saveWorkspace(payload = {}) {
    try {
        await fetch(`/api/workspaces/${room}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Workspace save error:', error);
    }
}

async function loadCollaborationDetails() {
    if (!collaborationId) {
        return;
    }

    try {
        const response = await fetch(`/api/collab/${collaborationId}`);
        if (!response.ok) {
            throw new Error('Failed to load collaboration');
        }

        const collaboration = await response.json();
        collaborationRole = collaboration.currentUserRole || null;
        currentWriterContextScope = buildWriterContextScope({
            storyTitle: collaboration.storyTitle || collaboration.title || '',
            chapterNumber: collaboration.chapterNumber || 1,
            collabId: collaborationId || collaboration._id || ''
        });
        canUseDrawingTools = collaboration.currentUserRole === 'artist' || (!collaboration.currentUserRole && isPrimaryUser);
        applyWorkspaceRoleAccess();
        updateWriterCueVisibility();
        joinCollaborationRoom();
        if (storyTitleInput) {
            storyTitleInput.value = collaboration.storyTitle || collaboration.title || '';
        }
        if (chapterNumberInput) {
            chapterNumberInput.value = collaboration.chapterNumber || 1;
        }
        if (chapterTitleInput) {
            chapterTitleInput.value = collaboration.chapterTitle || `Chapter ${collaboration.chapterNumber || 1}`;
        }
        if (storySynopsisInput) {
            storySynopsisInput.value = collaboration.storySynopsis || collaboration.description || '';
        }
        if (storyContentInput) {
            storyContentInput.value = collaboration.storyContent || '';
        }
        renderCoverImage(collaboration.coverImage || '');
        savedChapterPanels = normalizeChapterPanels(collaboration.chapterPanels || []);
        renderSavedPanels();
        const chapterLabel = collaboration.chapterLabel || `Chapter ${collaboration.chapterNumber || 1}`;
        updateWorkspacePresence(1);
        if (projectStatus) {
            const artistApproved = collaboration.publishRequest?.artistApproved ? 'artist approved' : 'artist pending';
            const writerApproved = collaboration.publishRequest?.writerApproved ? 'writer approved' : 'writer pending';
            const liveVersionNotice = collaboration.publishedStoryId && !collaboration.isPublishedLive
                ? ' A previous live version still exists in reader space while this edited draft waits for fresh approval.'
                : '';
            projectStatus.textContent = `${chapterLabel}${collaboration.chapterTitle ? ` | ${collaboration.chapterTitle}` : ''}. Status: ${collaboration.status}. Publish approvals: ${artistApproved}, ${writerApproved}.${liveVersionNotice}`;
        }
        updateReaderPreviewLink(collaboration.publishedStoryId, collaboration.publishedChapterId);
    } catch (error) {
        console.error('Collaboration load error:', error);
    }
}

async function saveCollaborationProject() {
    if (!collaborationId) {
        return;
    }

    try {
        const response = await fetch(`/api/collab/${collaborationId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                storyTitle: storyTitleInput?.value || '',
                chapterNumber: Number(chapterNumberInput?.value) || 1,
                chapterTitle: chapterTitleInput?.value || '',
                storySynopsis: storySynopsisInput?.value || '',
                storyContent: storyContentInput?.value || ''
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to save project');
        }

        if (projectStatus) {
            projectStatus.textContent = `Project notes saved for chapter ${Number(chapterNumberInput?.value) || 1}.`;
        }
    } catch (error) {
        console.error('Project save error:', error);
        alert('Failed to save project notes');
    }
}

async function requestPublishApproval() {
    if (!collaborationId) {
        return;
    }

    await saveCollaborationProject();

    try {
        const response = await fetch(`/api/collab/${collaborationId}/publish-request`, {
            method: 'PUT'
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to request publish approval');
        }

        if (projectStatus) {
            const artistApproved = data.publishRequest?.artistApproved ? 'artist approved' : 'artist pending';
            const writerApproved = data.publishRequest?.writerApproved ? 'writer approved' : 'writer pending';
            projectStatus.textContent = data.isPublishedLive
                ? 'Both collaborators approved. The story is now live in reader space.'
                : `Publish request updated: ${artistApproved}, ${writerApproved}. Fresh approval from both collaborators is required before the edited version goes live.`;
        }

        updateReaderPreviewLink(data.publishedStoryId, data.publishedChapterId);
    } catch (error) {
        console.error('Publish request error:', error);
        alert(error.message || 'Failed to request publish approval');
    }
}

const debouncedCanvasSave = debounce(canvasState => {
    saveWorkspace({ canvasState });
});

const debouncedChatSave = debounce(() => {
    saveWorkspace({ chat: persistedMessages });
}, 300);

function updateWorkspacePresence(userCount) {
    const partnerNameNode = document.getElementById('partner-name');
    if (!partnerNameNode) {
        return;
    }

    const chapterLabel = `Chapter ${Number(chapterNumberInput?.value) || 1}`;
    const titleLabel = chapterTitleInput?.value?.trim();
    partnerNameNode.textContent = userCount > 1
        ? `${chapterLabel}${titleLabel ? ` | ${titleLabel}` : ''} | ${userCount} collaborators connected`
        : `${chapterLabel}${titleLabel ? ` | ${titleLabel}` : ''} | Waiting for collaborator...`;
}

function renderAssets(assets = []) {
    const list = document.getElementById('workspace-assets');
    if (!list) {
        return;
    }

    if (!assets.length) {
        list.innerHTML = '<div class="asset-item"><span>No saved assets yet.</span></div>';
        return;
    }

    list.innerHTML = assets.map(asset => `
        <div class="asset-item">
            <a href="${asset.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(asset.name)}</a>
            <span>${escapeHtml(asset.uploadedBy || 'Collaborator')}</span>
        </div>
    `).join('');
}

class CollaborationCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentTool = 'brush';
        this.currentColor = '#000000';
        this.currentSize = 5;
        this.currentOpacity = 1;
        this.history = [];
        this.historyIndex = -1;
        this.startX = 0;
        this.startY = 0;
        this.lastX = 0;
        this.lastY = 0;
        this.previewSnapshot = null;
        this.selectedRegion = null;
        this.dragMode = null;
        this.selectionOffsetX = 0;
        this.selectionOffsetY = 0;
        this.activePointerId = null;
        this.lastInputState = null;
        this.layers = [];
        this.activeLayerId = null;
        this.layerCounter = 0;
        this.selectionMask = null;
        this.selectionBounds = null;
        this.brushConfig = {
            spacing: 0.22,
            flow: 0.85,
            stabilization: 0.5,
            pressureAffectsSize: true,
            pressureAffectsOpacity: true,
            fillTolerance: 24
        };

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.bindPointerEvents();
    }

    createLayer(name = null) {
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = this.canvas.width;
        layerCanvas.height = this.canvas.height;
        const layerCtx = layerCanvas.getContext('2d');
        layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);

        this.layerCounter += 1;
        const layer = {
            id: `layer-${Date.now()}-${this.layerCounter}`,
            name: name || `Layer ${this.layerCounter}`,
            canvas: layerCanvas,
            ctx: layerCtx,
            opacity: 1,
            blendMode: 'source-over',
            alphaLock: false,
            clipToBelow: false,
            visible: true
        };

        this.layers.push(layer);
        this.activeLayerId = layer.id;
        return layer;
    }

    setActiveLayer(layerId) {
        if (this.layers.some(layer => layer.id === layerId)) {
            this.activeLayerId = layerId;
            return true;
        }
        return false;
    }

    deleteActiveLayer() {
        if (this.layers.length <= 1) {
            return false;
        }

        const index = this.layers.findIndex(layer => layer.id === this.activeLayerId);
        if (index === -1) {
            return false;
        }

        this.layers.splice(index, 1);
        const fallback = this.layers[Math.max(0, index - 1)] || this.layers[0];
        this.activeLayerId = fallback.id;
        this.renderComposite();
        return true;
    }

    setActiveLayerBlendMode(mode) {
        const layer = this.getActiveLayer();
        if (!layer) {
            return;
        }
        layer.blendMode = mode || 'source-over';
        this.renderComposite();
    }

    setActiveLayerAlphaLock(enabled) {
        const layer = this.getActiveLayer();
        if (!layer) {
            return;
        }
        layer.alphaLock = Boolean(enabled);
    }

    setActiveLayerClipMask(enabled) {
        const layer = this.getActiveLayer();
        if (!layer) {
            return;
        }
        layer.clipToBelow = Boolean(enabled);
        this.renderComposite();
    }

    getLayersSummary() {
        return this.layers.map((layer, idx) => ({
            id: layer.id,
            name: layer.name || `Layer ${idx + 1}`,
            blendMode: layer.blendMode,
            alphaLock: layer.alphaLock,
            clipToBelow: layer.clipToBelow
        }));
    }

    getActiveLayer() {
        return this.layers.find(layer => layer.id === this.activeLayerId) || this.layers[0] || null;
    }

    getActiveLayerCtx() {
        const layer = this.getActiveLayer();
        return layer ? layer.ctx : this.ctx;
    }

    resizeLayerCanvas(layer, width, height) {
        const snapshot = layer.canvas.toDataURL('image/png');
        layer.canvas.width = width;
        layer.canvas.height = height;
        const img = new Image();
        img.onload = () => {
            layer.ctx.clearRect(0, 0, width, height);
            layer.ctx.drawImage(img, 0, 0, width, height);
            this.renderComposite();
        };
        img.src = snapshot;
    }

    renderComposite() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.layers.forEach((layer, index) => {
            if (!layer.visible) {
                return;
            }

            this.ctx.save();
            this.ctx.globalAlpha = layer.opacity;
            this.ctx.globalCompositeOperation = layer.blendMode || 'source-over';

            if (layer.clipToBelow && index > 0) {
                const clipped = document.createElement('canvas');
                clipped.width = this.canvas.width;
                clipped.height = this.canvas.height;
                const clippedCtx = clipped.getContext('2d');
                clippedCtx.clearRect(0, 0, clipped.width, clipped.height);
                clippedCtx.drawImage(layer.canvas, 0, 0);
                clippedCtx.globalCompositeOperation = 'destination-in';
                clippedCtx.drawImage(this.layers[index - 1].canvas, 0, 0);
                this.ctx.drawImage(clipped, 0, 0);
            } else {
                this.ctx.drawImage(layer.canvas, 0, 0);
            }

            this.ctx.restore();
        });

        if (this.selectionBounds) {
            this.drawSelectionOutline(this.selectionBounds);
        }
    }

    isPixelSelected(x, y) {
        if (!this.selectionMask || !this.selectionBounds) {
            return true;
        }
        const px = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
        const py = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
        return this.selectionMask[(py * this.canvas.width) + px] === 1;
    }

    bindPointerEvents() {
        this.canvas.style.touchAction = 'none';

        this.canvas.addEventListener('pointerdown', event => {
            this.startDrawing(event);

            if (this.isDrawing) {
                this.activePointerId = event.pointerId;
                this.canvas.setPointerCapture?.(event.pointerId);
            }
        });

        this.canvas.addEventListener('pointermove', event => {
            if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
                return;
            }
            this.draw(event);
        });

        const stopPointer = event => {
            if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
                return;
            }
            this.stopDrawing();
            if (this.activePointerId !== null) {
                this.canvas.releasePointerCapture?.(this.activePointerId);
                this.activePointerId = null;
            }
        };

        this.canvas.addEventListener('pointerup', stopPointer);
        this.canvas.addEventListener('pointercancel', stopPointer);
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const savedState = this.getCanvasDataUrl();
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.selectedRegion = null;

        if (!this.layers.length) {
            this.createLayer('Layer 1');
        } else {
            this.layers.forEach(layer => this.resizeLayerCanvas(layer, this.canvas.width, this.canvas.height));
        }

        if (savedState && this.layers.length === 1) {
            this.loadCanvasState(savedState, false);
        } else {
            this.renderComposite();
        }
    }

    setTool(tool) {
        this.currentTool = tool;
    }

    getEffectiveTool(tool = this.currentTool) {
        switch (tool) {
            case 'pencil':
            case 'blur':
            case 'smudge':
                return 'brush';
            case 'polygon':
                return 'polygon';
            case 'fill':
                return 'fill';
            case 'eyedropper':
                return 'eyedropper';
            case 'text':
                return 'text';
            default:
                return tool;
        }
    }

    setColor(color) {
        this.currentColor = color;
    }

    setSize(size) {
        this.currentSize = Number(size);
    }

    setOpacity(opacity) {
        this.currentOpacity = Number(opacity);
    }

    isBrushLike(tool = this.currentTool) {
        return ['brush', 'eraser', 'pencil', 'blur', 'smudge'].includes(tool);
    }

    hexToRgb(color) {
        const safeHex = String(color || '#000000').replace('#', '');
        const normalized = safeHex.length === 3
            ? safeHex.split('').map(ch => ch + ch).join('')
            : safeHex.padEnd(6, '0').slice(0, 6);
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16)
        };
    }

    getInputState(event, isStart = false) {
        const pos = this.getPointerPosition(event);
        const now = performance.now();
        const last = this.lastInputState;

        const dx = last ? (pos.x - last.rawX) : 0;
        const dy = last ? (pos.y - last.rawY) : 0;
        const dt = last ? Math.max(1, now - last.timestamp) : 16;
        const speed = Math.sqrt(dx * dx + dy * dy) / dt;

        const pointerType = event.pointerType || 'mouse';
        const rawPressure = Number(event.pressure || 0);
        const simulatedPressure = Math.max(0.2, Math.min(1, 1 - (speed * 0.45)));
        const pressure = pointerType === 'pen' && rawPressure > 0 ? rawPressure : simulatedPressure;

        let smoothedX = pos.x;
        let smoothedY = pos.y;
        if (!isStart && last) {
            const alpha = 1 - this.brushConfig.stabilization;
            smoothedX = last.x + ((pos.x - last.x) * alpha);
            smoothedY = last.y + ((pos.y - last.y) * alpha);
        }

        const state = {
            x: smoothedX,
            y: smoothedY,
            rawX: pos.x,
            rawY: pos.y,
            pressure,
            speed,
            tiltX: Number(event.tiltX || 0),
            tiltY: Number(event.tiltY || 0),
            pointerType,
            timestamp: now
        };

        this.lastInputState = state;
        return state;
    }

    stampBrush(x, y, pressure, tool = this.currentTool) {
        if (!this.isPixelSelected(x, y)) {
            return;
        }

        const activeLayer = this.getActiveLayer();
        const ctx = this.getActiveLayerCtx();
        const clampedPressure = Math.max(0.05, Math.min(1, Number(pressure || 1)));
        const size = this.brushConfig.pressureAffectsSize
            ? this.currentSize * clampedPressure
            : this.currentSize;
        let alpha = this.currentOpacity * this.brushConfig.flow;
        if (this.brushConfig.pressureAffectsOpacity) {
            alpha *= clampedPressure;
        }

        if (tool === 'blur') {
            alpha *= 0.35;
        }
        if (tool === 'smudge') {
            alpha *= 0.5;
        }

        const ix = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
        const iy = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
        if (activeLayer?.alphaLock) {
            const alpha = ctx.getImageData(ix, iy, 1, 1).data[3];
            if (alpha === 0) {
                return;
            }
        }

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, alpha)})`;
        } else if (tool === 'blur') {
            const radius = Math.max(1, Math.round(size * 0.45));
            const sx = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
            const sy = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
            const sampleX = Math.max(0, sx - radius);
            const sampleY = Math.max(0, sy - radius);
            const sampleW = Math.min(this.canvas.width - sampleX, (radius * 2) + 1);
            const sampleH = Math.min(this.canvas.height - sampleY, (radius * 2) + 1);
            const sampled = ctx.getImageData(sampleX, sampleY, sampleW, sampleH).data;

            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let count = 0;
            for (let i = 0; i < sampled.length; i += 4) {
                r += sampled[i];
                g += sampled[i + 1];
                b += sampled[i + 2];
                a += sampled[i + 3];
                count += 1;
            }

            if (count > 0) {
                ctx.fillStyle = `rgba(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)}, ${Math.max(0.04, (a / count / 255) * alpha)})`;
            } else {
                const rgb = this.hexToRgb(this.currentColor);
                ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0.04, alpha)})`;
            }
        } else if (tool === 'smudge') {
            const sx = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
            const sy = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
            const sampled = ctx.getImageData(sx, sy, 1, 1).data;
            ctx.fillStyle = `rgba(${sampled[0]}, ${sampled[1]}, ${sampled[2]}, ${Math.max(0.05, alpha)})`;
        } else {
            const rgb = this.hexToRgb(this.currentColor);
            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0.05, alpha)})`;
        }

        const radius = Math.max(0.8, size / 2);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    stampStrokeSegment(fromState, toState, tool = this.currentTool) {
        if (!fromState || !toState) {
            return;
        }

        const dx = toState.x - fromState.x;
        const dy = toState.y - fromState.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const spacingBase = Math.max(1, this.currentSize * this.brushConfig.spacing);
        const spacing = tool === 'pencil' ? Math.max(0.6, spacingBase * 0.6) : spacingBase;
        const steps = Math.max(1, Math.ceil(distance / spacing));

        for (let i = 1; i <= steps; i += 1) {
            const t = i / steps;
            const x = fromState.x + (dx * t);
            const y = fromState.y + (dy * t);
            const pressure = fromState.pressure + ((toState.pressure - fromState.pressure) * t);
            this.stampBrush(x, y, pressure, tool);
        }
    }

    applyStrokeStyle(colorOverride, toolOverride = this.currentTool) {
        const tool = toolOverride || this.currentTool;
        const effectiveTool = this.getEffectiveTool(tool);
        const opacity = Number(this.currentOpacity);
        const size = Number(this.currentSize);

        if (effectiveTool === 'eraser') {
            this.ctx.globalAlpha = 1;
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = size * 2;
        } else {
            this.ctx.globalAlpha = tool === 'blur' ? Math.min(0.35, opacity) : (tool === 'smudge' ? Math.min(0.6, opacity) : opacity);
            this.ctx.strokeStyle = colorOverride || this.currentColor;
            this.ctx.lineWidth = tool === 'pencil'
                ? Math.max(1, Math.round(size * 0.6))
                : (tool === 'blur' ? Math.max(2, Math.round(size * 1.4)) : size);
        }

        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    applyFill(x, y) {
        const activeLayer = this.getActiveLayer();
        const ctx = this.getActiveLayerCtx();
        const startX = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
        const startY = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
        const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const pixels = imageData.data;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const startIndex = (startY * width + startX) * 4;
        const target = {
            r: pixels[startIndex],
            g: pixels[startIndex + 1],
            b: pixels[startIndex + 2],
            a: pixels[startIndex + 3]
        };
        const fillRgb = this.hexToRgb(this.currentColor);
        const fillAlpha = Math.round(Math.max(0, Math.min(1, this.currentOpacity)) * 255);
        const tolerance = this.brushConfig.fillTolerance;

        const matches = idx => {
            const dr = Math.abs(pixels[idx] - target.r);
            const dg = Math.abs(pixels[idx + 1] - target.g);
            const db = Math.abs(pixels[idx + 2] - target.b);
            const da = Math.abs(pixels[idx + 3] - target.a);
            return (dr + dg + db + da) <= (tolerance * 4);
        };

        if (!matches(startIndex)) {
            return;
        }

        const visited = new Uint8Array(width * height);
        const stack = [[startX, startY]];

        while (stack.length) {
            const [cx, cy] = stack.pop();
            if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
                continue;
            }

            const index1d = (cy * width) + cx;
            if (visited[index1d]) {
                continue;
            }
            visited[index1d] = 1;

            const idx = index1d * 4;
            if (!matches(idx)) {
                continue;
            }

            if (this.selectionMask && this.selectionMask[index1d] !== 1) {
                continue;
            }

            if (activeLayer?.alphaLock && pixels[idx + 3] === 0) {
                continue;
            }

            const blend = fillAlpha / 255;
            pixels[idx] = Math.round((pixels[idx] * (1 - blend)) + (fillRgb.r * blend));
            pixels[idx + 1] = Math.round((pixels[idx + 1] * (1 - blend)) + (fillRgb.g * blend));
            pixels[idx + 2] = Math.round((pixels[idx + 2] * (1 - blend)) + (fillRgb.b * blend));
            pixels[idx + 3] = Math.round((pixels[idx + 3] * (1 - blend)) + fillAlpha);

            stack.push([cx + 1, cy]);
            stack.push([cx - 1, cy]);
            stack.push([cx, cy + 1]);
            stack.push([cx, cy - 1]);
        }

        ctx.putImageData(imageData, 0, 0);
        this.renderComposite();
    }

    pickColor(x, y) {
        const safeX = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
        const safeY = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
        const pixel = this.ctx.getImageData(safeX, safeY, 1, 1).data;

        const alpha = pixel[3] / 255;
        const blendedR = Math.round((pixel[0] * alpha) + (255 * (1 - alpha)));
        const blendedG = Math.round((pixel[1] * alpha) + (255 * (1 - alpha)));
        const blendedB = Math.round((pixel[2] * alpha) + (255 * (1 - alpha)));

        const toHex = value => value.toString(16).padStart(2, '0');
        const picked = `#${toHex(blendedR)}${toHex(blendedG)}${toHex(blendedB)}`;
        this.currentColor = picked;

        const colorPicker = document.getElementById('color-picker');
        if (colorPicker) {
            colorPicker.value = picked;
        }

        if (projectStatus) {
            projectStatus.textContent = `Eyedropper picked ${picked.toUpperCase()}.`;
        }

        return picked;
    }

    async pickColorFromScreenOrCanvas(x, y, allowCanvasFallback = true) {
        if (window.EyeDropper) {
            try {
                const eyeDropper = new EyeDropper();
                const result = await eyeDropper.open();
                if (result?.sRGBHex) {
                    this.currentColor = result.sRGBHex;
                    const colorPicker = document.getElementById('color-picker');
                    if (colorPicker) {
                        colorPicker.value = result.sRGBHex;
                    }
                    if (projectStatus) {
                        projectStatus.textContent = `Eyedropper picked ${result.sRGBHex.toUpperCase()} from screen.`;
                    }
                    return result.sRGBHex;
                }
            } catch (error) {
                // If user cancels eyedropper, do not replace color with fallback sample.
                if (error && (error.name === 'AbortError' || /abort/i.test(String(error.message || '')))) {
                    if (projectStatus) {
                        projectStatus.textContent = 'Eyedropper canceled.';
                    }
                    return null;
                }
            }
        }

        if (!allowCanvasFallback) {
            if (projectStatus && !window.EyeDropper) {
                projectStatus.textContent = 'Screen eyedropper not supported in this browser. Click on canvas to sample color.';
            }
            return null;
        }

        if (projectStatus && !window.EyeDropper) {
            projectStatus.textContent = 'Screen eyedropper not supported in this browser. Using canvas sample.';
        }

        return this.pickColor(x, y);
    }

    async handleEyedropperPick(x, y, allowCanvasFallback = true) {
        const picked = await this.pickColorFromScreenOrCanvas(x, y, allowCanvasFallback);

        if (picked && lastPaintTool && lastPaintTool !== 'eyedropper') {
            this.setTool(lastPaintTool);
            document.querySelectorAll('.tool-btn[data-tool]').forEach(item => {
                item.classList.toggle('active', item.dataset.tool === lastPaintTool);
            });
        }
    }

    drawText(x, y) {
        const text = window.prompt('Enter text');
        if (!text) {
            return null;
        }

        const ctx = this.getActiveLayerCtx();
        ctx.save();
        ctx.globalAlpha = this.currentOpacity;
        ctx.fillStyle = this.currentColor;
        ctx.font = `${Math.max(12, this.currentSize * 4)}px Arial`;
        ctx.fillText(text, x, y);
        ctx.restore();
        this.renderComposite();
        return text;
    }

    normalizeRect(x1, y1, x2, y2) {
        const x = Math.max(0, Math.round(Math.min(x1, x2)));
        const y = Math.max(0, Math.round(Math.min(y1, y2)));
        const maxX = Math.min(this.canvas.width, Math.round(Math.max(x1, x2)));
        const maxY = Math.min(this.canvas.height, Math.round(Math.max(y1, y2)));
        return {
            x,
            y,
            width: Math.max(1, maxX - x),
            height: Math.max(1, maxY - y)
        };
    }

    pointInRegion(x, y, region) {
        if (!region) {
            return false;
        }
        return x >= region.x && x <= (region.x + region.width) && y >= region.y && y <= (region.y + region.height);
    }

    imageDataToCanvas(imageData) {
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = imageData.width;
        sourceCanvas.height = imageData.height;
        sourceCanvas.getContext('2d').putImageData(imageData, 0, 0);
        return sourceCanvas;
    }

    drawSelectionOutline(region) {
        if (!region) {
            return;
        }
        this.ctx.save();
        this.ctx.setLineDash([6, 4]);
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = '#111111';
        this.ctx.strokeRect(region.x + 0.5, region.y + 0.5, region.width, region.height);
        this.ctx.restore();
    }

    applySelection(rect) {
        if (!rect || rect.width < 2 || rect.height < 2) {
            this.selectedRegion = null;
            return false;
        }

        try {
            const layerCtx = this.getActiveLayerCtx();
            const imageData = layerCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
            this.selectedRegion = {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                imageData
            };
            this.selectionMask = null;
            this.selectionBounds = {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            };
            this.renderComposite();
            if (projectStatus) {
                projectStatus.textContent = 'Selection created. Use Move or Expand tool to edit this area.';
            }
            return true;
        } catch (error) {
            this.selectedRegion = null;
            return false;
        }
    }

    renderRegionAt(region, x, y, width = region.width, height = region.height) {
        const layerCtx = this.getActiveLayerCtx();
        const sourceCanvas = this.imageDataToCanvas(region.imageData);
        layerCtx.clearRect(region.x, region.y, region.width, region.height);
        layerCtx.drawImage(sourceCanvas, x, y, width, height);
        this.selectionBounds = { x, y, width, height };
        this.renderComposite();
    }

    commitRegionAt(region, x, y, width = region.width, height = region.height) {
        const layerCtx = this.getActiveLayerCtx();
        const clampedWidth = Math.max(1, Math.min(Math.round(width), this.canvas.width));
        const clampedHeight = Math.max(1, Math.min(Math.round(height), this.canvas.height));
        const clampedX = Math.max(0, Math.min(Math.round(x), this.canvas.width - clampedWidth));
        const clampedY = Math.max(0, Math.min(Math.round(y), this.canvas.height - clampedHeight));

        layerCtx.clearRect(region.x, region.y, region.width, region.height);
        const sourceCanvas = this.imageDataToCanvas(region.imageData);
        layerCtx.drawImage(sourceCanvas, clampedX, clampedY, clampedWidth, clampedHeight);

        const imageData = layerCtx.getImageData(clampedX, clampedY, clampedWidth, clampedHeight);
        this.selectedRegion = {
            x: clampedX,
            y: clampedY,
            width: clampedWidth,
            height: clampedHeight,
            imageData
        };
        this.selectionBounds = {
            x: clampedX,
            y: clampedY,
            width: clampedWidth,
            height: clampedHeight
        };
        this.renderComposite();
    }

    getPointerPosition(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    snapshotCanvas() {
        const ctx = this.getActiveLayerCtx();
        return ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    restoreSnapshot(snapshot) {
        if (snapshot) {
            const ctx = this.getActiveLayerCtx();
            ctx.putImageData(snapshot, 0, 0);
            this.renderComposite();
        }
    }

    applyMagicWandSelection(x, y, tolerance = this.brushConfig.fillTolerance) {
        const ctx = this.getActiveLayerCtx();
        const width = this.canvas.width;
        const height = this.canvas.height;
        const sx = Math.max(0, Math.min(width - 1, Math.round(x)));
        const sy = Math.max(0, Math.min(height - 1, Math.round(y)));
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;
        const startIndex = (sy * width + sx) * 4;
        const targetR = pixels[startIndex];
        const targetG = pixels[startIndex + 1];
        const targetB = pixels[startIndex + 2];
        const targetA = pixels[startIndex + 3];

        const mask = new Uint8Array(width * height);
        const stack = [[sx, sy]];
        let minX = sx;
        let minY = sy;
        let maxX = sx;
        let maxY = sy;
        let count = 0;

        const matches = idx => {
            const dr = Math.abs(pixels[idx] - targetR);
            const dg = Math.abs(pixels[idx + 1] - targetG);
            const db = Math.abs(pixels[idx + 2] - targetB);
            const da = Math.abs(pixels[idx + 3] - targetA);
            return (dr + dg + db + da) <= (tolerance * 4);
        };

        while (stack.length) {
            const [cx, cy] = stack.pop();
            if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
                continue;
            }

            const idx1d = (cy * width) + cx;
            if (mask[idx1d] === 1) {
                continue;
            }

            const idx = idx1d * 4;
            if (!matches(idx)) {
                continue;
            }

            mask[idx1d] = 1;
            count += 1;
            if (cx < minX) minX = cx;
            if (cy < minY) minY = cy;
            if (cx > maxX) maxX = cx;
            if (cy > maxY) maxY = cy;

            stack.push([cx + 1, cy]);
            stack.push([cx - 1, cy]);
            stack.push([cx, cy + 1]);
            stack.push([cx, cy - 1]);
        }

        if (!count) {
            this.selectionMask = null;
            this.selectionBounds = null;
            this.selectedRegion = null;
            this.renderComposite();
            return;
        }

        this.selectionMask = mask;
        this.selectionBounds = {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX + 1),
            height: Math.max(1, maxY - minY + 1)
        };
        this.selectedRegion = null;
        this.renderComposite();

        if (projectStatus) {
            projectStatus.textContent = `Magic wand selected ${count} pixels (tolerance ${tolerance}).`;
        }
    }

    pushHistory() {
        const state = this.getCanvasDataUrl();
        if (!state) return;
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(state);
        this.historyIndex = this.history.length - 1;
    }

    getCanvasDataUrl() {
        try {
            return this.canvas.toDataURL('image/png');
        } catch (error) {
            return null;
        }
    }

    getPanelExportDataUrl() {
        try {
            const maxWidth = 1440;
            const scale = Math.min(1, maxWidth / this.canvas.width);
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = Math.max(1, Math.round(this.canvas.width * scale));
            exportCanvas.height = Math.max(1, Math.round(this.canvas.height * scale));

            const exportCtx = exportCanvas.getContext('2d');
            exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
            exportCtx.drawImage(this.canvas, 0, 0, exportCanvas.width, exportCanvas.height);

            return exportCanvas.toDataURL('image/png');
        } catch (error) {
            return this.getCanvasDataUrl();
        }
    }

    emitCanvasState() {
        const state = this.getCanvasDataUrl();
        socket.emit('canvasState', {
            room,
            state
        });
        debouncedCanvasSave(state);
    }

    loadCanvasState(state, saveToHistory = true) {
        if (!state) return;
        const image = new Image();
        image.onload = () => {
            if (!this.layers.length) {
                this.createLayer('Layer 1');
            }
            const baseLayer = this.layers[0];
            baseLayer.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            baseLayer.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
            for (let i = 1; i < this.layers.length; i += 1) {
                this.layers[i].ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
            this.activeLayerId = baseLayer.id;
            this.renderComposite();
            if (saveToHistory) {
                this.pushHistory();
            }
        };
        image.src = state;
    }

    startDrawing(event) {
        if (!canUseDrawingTools) return;

        const input = this.getInputState(event, true);
        const x = input.x;
        const y = input.y;
        const effectiveTool = this.getEffectiveTool();
        this.dragMode = null;

        if (effectiveTool === 'fill') {
            this.applyFill(x, y);
            this.pushHistory();
            socket.emit('draw', {
                room,
                tool: 'fill',
                color: this.currentColor,
                opacity: this.currentOpacity,
                x1: x,
                y1: y
            });
            this.emitCanvasState();
            return;
        }

        if (this.currentTool === 'wand') {
            this.applyMagicWandSelection(x, y, this.brushConfig.fillTolerance);
            return;
        }

        if (effectiveTool === 'eyedropper') {
            this.handleEyedropperPick(x, y);
            return;
        }

        if (effectiveTool === 'text') {
            const text = this.drawText(x, y);
            if (text) {
                this.pushHistory();
                socket.emit('draw', {
                    room,
                    tool: 'text',
                    color: this.currentColor,
                    opacity: this.currentOpacity,
                    size: this.currentSize,
                    x1: x,
                    y1: y,
                    text
                });
                this.emitCanvasState();
            }
            return;
        }

        if (this.currentTool === 'selection') {
            this.isDrawing = true;
            this.dragMode = 'selection';
            this.startX = x;
            this.startY = y;
            this.lastX = x;
            this.lastY = y;
            this.previewSnapshot = this.snapshotCanvas();
            return;
        }

        if (this.currentTool === 'move') {
            if (!this.selectedRegion || !this.pointInRegion(x, y, this.selectedRegion)) {
                if (projectStatus) {
                    projectStatus.textContent = 'Use Selection tool first, then click inside selected area to move it.';
                }
                return;
            }

            this.isDrawing = true;
            this.dragMode = 'move';
            this.previewSnapshot = this.snapshotCanvas();
            this.selectionOffsetX = x - this.selectedRegion.x;
            this.selectionOffsetY = y - this.selectedRegion.y;
            this.lastX = x;
            this.lastY = y;
            return;
        }

        if (this.currentTool === 'transform') {
            if (!this.selectedRegion) {
                if (projectStatus) {
                    projectStatus.textContent = 'Use Selection tool first, then drag with Expand tool to resize selection.';
                }
                return;
            }

            this.isDrawing = true;
            this.dragMode = 'transform';
            this.previewSnapshot = this.snapshotCanvas();
            this.startX = x;
            this.startY = y;
            this.lastX = x;
            this.lastY = y;
            return;
        }

        this.isDrawing = true;
        this.startX = x;
        this.startY = y;
        this.lastX = x;
        this.lastY = y;
        this.previewSnapshot = this.snapshotCanvas();

        if (this.isBrushLike(this.currentTool)) {
            this.stampBrush(x, y, input.pressure, this.currentTool);
            this.renderComposite();
        }
    }

    draw(event) {
        if (!this.isDrawing || !canUseDrawingTools) return;

        const previousInput = this.lastInputState
            ? { ...this.lastInputState }
            : { x: this.startX, y: this.startY, pressure: 1 };
        const input = this.getInputState(event);
        const x = input.x;
        const y = input.y;
        this.lastX = x;
        this.lastY = y;

        if (this.dragMode === 'selection') {
            const rect = this.normalizeRect(this.startX, this.startY, x, y);
            this.restoreSnapshot(this.previewSnapshot);
            this.drawSelectionOutline(rect);
            return;
        }

        if (this.dragMode === 'move' && this.selectedRegion) {
            const targetX = Math.round(x - this.selectionOffsetX);
            const targetY = Math.round(y - this.selectionOffsetY);
            this.restoreSnapshot(this.previewSnapshot);
            this.renderRegionAt(this.selectedRegion, targetX, targetY);
            return;
        }

        if (this.dragMode === 'transform' && this.selectedRegion) {
            const region = this.selectedRegion;
            const widthDelta = x - this.startX;
            const heightDelta = y - this.startY;
            const targetWidth = Math.max(10, region.width + widthDelta);
            const targetHeight = Math.max(10, region.height + heightDelta);
            this.restoreSnapshot(this.previewSnapshot);
            this.renderRegionAt(region, region.x, region.y, targetWidth, targetHeight);
            return;
        }

        const effectiveTool = this.getEffectiveTool();

        if (this.isBrushLike(this.currentTool)) {
            const fromState = {
                x: previousInput.x,
                y: previousInput.y,
                pressure: previousInput.pressure ?? input.pressure
            };
            this.stampStrokeSegment(fromState, input, this.currentTool);
            this.renderComposite();

            socket.emit('draw', {
                room,
                tool: this.currentTool,
                color: this.currentColor,
                size: this.currentSize,
                opacity: this.currentOpacity,
                x1: fromState.x,
                y1: fromState.y,
                x2: x,
                y2: y,
                p1: fromState.pressure,
                p2: input.pressure,
                pointerType: input.pointerType,
                tiltX: input.tiltX,
                tiltY: input.tiltY
            });

            this.startX = x;
            this.startY = y;
            this.lastX = x;
            this.lastY = y;
            return;
        }

        this.restoreSnapshot(this.previewSnapshot);
        this.drawShape({
            tool: this.currentTool,
            color: this.currentColor,
            size: this.currentSize,
            opacity: this.currentOpacity,
            x1: this.startX,
            y1: this.startY,
            x2: x,
            y2: y
        });
    }

    stopDrawing() {
        if (!this.isDrawing || !canUseDrawingTools) return;
        this.isDrawing = false;

        if (this.dragMode === 'selection') {
            const rect = this.normalizeRect(this.startX, this.startY, this.lastX, this.lastY);
            this.restoreSnapshot(this.previewSnapshot);
            this.applySelection(rect);
            this.previewSnapshot = null;
            this.dragMode = null;
            return;
        }

        if (this.dragMode === 'move' && this.selectedRegion) {
            const targetX = Math.round(this.lastX - this.selectionOffsetX);
            const targetY = Math.round(this.lastY - this.selectionOffsetY);
            this.restoreSnapshot(this.previewSnapshot);
            this.commitRegionAt(this.selectedRegion, targetX, targetY);
            this.previewSnapshot = null;
            this.dragMode = null;
            this.pushHistory();
            this.emitCanvasState();
            return;
        }

        if (this.dragMode === 'transform' && this.selectedRegion) {
            const region = this.selectedRegion;
            const widthDelta = this.lastX - this.startX;
            const heightDelta = this.lastY - this.startY;
            const targetWidth = Math.max(10, region.width + widthDelta);
            const targetHeight = Math.max(10, region.height + heightDelta);
            this.restoreSnapshot(this.previewSnapshot);
            this.commitRegionAt(region, region.x, region.y, targetWidth, targetHeight);
            this.previewSnapshot = null;
            this.dragMode = null;
            this.pushHistory();
            this.emitCanvasState();
            return;
        }

        const effectiveTool = this.getEffectiveTool();

        if (!this.isBrushLike(this.currentTool)) {
            this.restoreSnapshot(this.previewSnapshot);
            const finalShape = {
                room,
                tool: this.currentTool,
                color: this.currentColor,
                size: this.currentSize,
                opacity: this.currentOpacity,
                x1: this.startX,
                y1: this.startY,
                x2: this.lastX,
                y2: this.lastY
            };

            this.drawShape(finalShape);
            socket.emit('draw', finalShape);
        }

        this.previewSnapshot = null;
        this.dragMode = null;
        this.lastInputState = null;
        this.pushHistory();
        this.emitCanvasState();
    }

    drawShape(data) {
        const effectiveTool = this.getEffectiveTool(data.tool);
        const ctx = this.getActiveLayerCtx();

        if (this.isBrushLike(data.tool)) {
            const fromState = {
                x: data.x1,
                y: data.y1,
                pressure: data.p1 ?? 1
            };
            const toState = {
                x: data.x2,
                y: data.y2,
                pressure: data.p2 ?? fromState.pressure
            };
            this.stampStrokeSegment(fromState, toState, data.tool);
            this.renderComposite();
            this.lastX = data.x2;
            this.lastY = data.y2;
            return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.globalAlpha = effectiveTool === 'eraser' ? 1 : (data.opacity ?? 1);
        ctx.strokeStyle = effectiveTool === 'eraser' ? '#ffffff' : data.color;
        ctx.lineWidth = effectiveTool === 'eraser'
            ? (data.size || 1) * 2
            : (data.tool === 'pencil' ? Math.max(1, Math.round((data.size || 1) * 0.6)) : (data.size || 1));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (effectiveTool) {
            case 'line':
                ctx.moveTo(data.x1, data.y1);
                ctx.lineTo(data.x2, data.y2);
                break;
            case 'circle': {
                const radius = Math.sqrt(((data.x2 - data.x1) ** 2) + ((data.y2 - data.y1) ** 2));
                ctx.arc(data.x1, data.y1, radius, 0, Math.PI * 2);
                break;
            }
            case 'rectangle':
                ctx.rect(data.x1, data.y1, data.x2 - data.x1, data.y2 - data.y1);
                break;
            case 'polygon': {
                const width = data.x2 - data.x1;
                const height = data.y2 - data.y1;
                ctx.moveTo(data.x1 + width / 2, data.y1);
                ctx.lineTo(data.x2, data.y2);
                ctx.lineTo(data.x1, data.y2);
                ctx.closePath();
                break;
            }
            case 'fill':
                this.currentColor = data.color || this.currentColor;
                this.currentOpacity = Number(data.opacity ?? this.currentOpacity);
                ctx.restore();
                this.applyFill(data.x1 ?? 0, data.y1 ?? 0);
                return;
            case 'text':
                ctx.font = `${Math.max(12, (data.size || 5) * 4)}px Arial`;
                ctx.fillStyle = data.color || '#000000';
                ctx.globalAlpha = data.opacity ?? 1;
                ctx.fillText(data.text || '', data.x1, data.y1);
                ctx.restore();
                this.renderComposite();
                return;
            default:
                ctx.moveTo(data.x1, data.y1);
                ctx.lineTo(data.x2, data.y2);
                break;
        }

        ctx.stroke();
        ctx.restore();
        this.renderComposite();
        this.lastX = data.x2;
        this.lastY = data.y2;
    }

    clear() {
        this.layers.forEach(layer => {
            layer.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        });
        this.selectionMask = null;
        this.selectionBounds = null;
        this.selectedRegion = null;
        this.renderComposite();
        this.pushHistory();
        socket.emit('clear', {
            room,
            state: this.getCanvasDataUrl()
        });
        this.emitCanvasState();
    }

    undo() {
        if (this.historyIndex <= 0) return;
        this.historyIndex -= 1;
        this.loadCanvasState(this.history[this.historyIndex], false);
        socket.emit('undo', {
            room,
            state: this.history[this.historyIndex]
        });
        this.emitCanvasState();
    }

    redo() {
        if (this.historyIndex >= this.history.length - 1) return;
        this.historyIndex += 1;
        this.loadCanvasState(this.history[this.historyIndex], false);
        socket.emit('redo', {
            room,
            state: this.history[this.historyIndex]
        });
        this.emitCanvasState();
    }

    savePng() {
        const link = document.createElement('a');
        link.href = this.getCanvasDataUrl();
        link.download = `pixelscript-${room}.png`;
        link.click();
    }
}

const canvas = new CollaborationCanvas('drawing-canvas');
const drawingTools = document.getElementById('drawing-tools');
const gridOverlay = document.getElementById('canvas-grid');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-message');
const attachmentButton = document.getElementById('attach-toggle');
const chatAttachmentInput = document.getElementById('chat-attachment-input');
const emojiToggleButton = document.getElementById('emoji-toggle');
const charToggleButton = document.getElementById('char-toggle');
const emojiPanel = document.getElementById('emoji-panel');
const emojiGrid = document.getElementById('emoji-grid');
const emojiSetLabel = document.getElementById('emoji-set-label');
const emojiScrollTopButton = document.getElementById('emoji-scroll-top');
const chatMinimizeBtn = document.getElementById('chat-minimize');
const chatContainer = document.getElementById('chat-container');
const chatToggle = document.getElementById('chat-toggle');
const writerAiCuePanel = document.getElementById('writer-ai-cue');
const writerAiCueList = document.getElementById('writer-ai-cue-list');
const writerAiCueGenerateButton = document.getElementById('writer-ai-cue-generate');
const workspaceUploadButton = document.getElementById('workspace-upload-btn');
const workspaceFileInput = document.getElementById('workspace-file-input');
const projectPanel = document.getElementById('project-panel');
const projectToggle = document.getElementById('project-toggle');
const storyTitleInput = document.getElementById('story-title-input');
const chapterNumberInput = document.getElementById('chapter-number-input');
const chapterTitleInput = document.getElementById('chapter-title-input');
const storySynopsisInput = document.getElementById('story-synopsis-input');
const storyContentInput = document.getElementById('story-content-input');
const coverImageInput = document.getElementById('cover-image-input');
const panelTitleInput = document.getElementById('panel-title-input');
const saveCurrentPanelButton = document.getElementById('save-current-panel-btn');
const panelsList = document.getElementById('project-panels-list');
const saveProjectButton = document.getElementById('save-project-btn');
const publishRequestButton = document.getElementById('publish-request-btn');
const readerPreviewLink = document.getElementById('reader-preview-link');
const projectStatus = document.getElementById('project-status');
const addLayerButton = document.getElementById('add-layer-btn');
const deleteLayerButton = document.getElementById('delete-layer-btn');
const activeLayerSelect = document.getElementById('active-layer-select');
const blendModeSelect = document.getElementById('blend-mode-select');
const alphaLockToggle = document.getElementById('alpha-lock-toggle');
const clipMaskToggle = document.getElementById('clip-mask-toggle');
const toleranceSlider = document.getElementById('tolerance-slider');

const quickInsertSets = {
    emoji: [
        '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
        '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🫠', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔',
        '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😶‍🌫️', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔',
        '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '😵‍💫', '🤯', '🥳',
        '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '🥹', '😦', '😧',
        '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠',
        '🤬', '😈', '👿', '💀', '☠️', '👻', '👽', '🤖', '💩', '🙈', '🙉', '🙊', '👋', '🤚', '🖐️', '✋',
        '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆',
        '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🙏', '❤️',
        '🩷', '🧡', '💛', '💚', '🩵', '💙', '💜', '🤎', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗',
        '💖', '💘', '💝', '💟', '🔥', '✨', '⭐', '🌟', '💫', '🌈', '☀️', '🌙', '⚡', '🎉', '🎊', '🎈',
        '🎨', '🖌️', '📝', '📖', '📚', '💡', '🧠', '🧩', '🚀', '🛸', '🎯', '✅', '❌', '⚠️', '⏳', '💯'
    ],
    people: [
        '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧓', '👴', '👵', '👮', '🕵️', '💂', '👷', '🤴', '👸',
        '👳', '👲', '🧕', '🤵', '👰', '🤰', '🫄', '🫃', '🤱', '👩‍⚕️', '👨‍⚕️', '👩‍🏫', '👨‍🏫', '👩‍💻', '👨‍💻',
        '👩‍🎨', '👨‍🎨', '👩‍🍳', '👨‍🍳', '👩‍🚀', '👨‍🚀', '👩‍⚖️', '👨‍⚖️', '👩‍🔧', '👨‍🔧', '👩‍🔬', '👨‍🔬',
        '👩‍🚒', '👨‍🚒', '👩‍✈️', '👨‍✈️', '🧙', '🧝', '🧛', '🧜', '🧚', '🫅', '🤶', '🎅', '🧑‍🤝‍🧑', '👭', '👬',
        '💃', '🕺', '🧍', '🧎', '🏃', '🚶', '🙋', '🙆', '🙅', '🤷', '🤦', '💁', '🧏', '🙇', '🫶', '🫂'
    ],
    animals: [
        '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
        '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🐣', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄',
        '🐝', '🪲', '🐞', '🦋', '🐌', '🪱', '🐢', '🐍', '🦎', '🦂', '🦀', '🐙', '🦑', '🐬', '🐳', '🐋',
        '🦈', '🐊', '🦭', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦬', '🦘'
    ],
    food: [
        '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥',
        '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠',
        '🍞', '🥐', '🥖', '🫓', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🍗', '🍖', '🦴', '🌭',
        '🍔', '🍟', '🍕', '🌮', '🌯', '🥙', '🧆', '🥪', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤',
        '🍚', '🍙', '🍘', '🍥', '🥠', '🍡', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🍫', '🍿',
        '☕', '🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🍷', '🍸', '🍹', '🧉', '🥛', '🍼'
    ],
    travel: [
        '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚚', '🚛', '🚜', '🛵', '🏍️', '🛺', '🚲',
        '🛴', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈',
        '🚂', '🚆', '🚇', '🚊', '✈️', '🛫', '🛬', '🛩️', '💺', '🚁', '🚀', '🛸', '🚢', '⛴️', '🛥️', '🚤',
        '🛶', '⛵', '⚓', '🗺️', '🧭', '⛰️', '🏔️', '🏕️', '🏖️', '🏝️', '🏜️', '🏙️', '🌆', '🌉', '🌃', '🌌'
    ],
    activities: [
        '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏',
        '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂',
        '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🧘', '🏇', '🚴', '🎮', '🕹️', '🎲', '♟️', '🧩', '🃏',
        '🎯', '🎨', '🎭', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪗', '🎻', '🎪', '🎟️'
    ],
    objects: [
        '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🧮', '🧰', '🔧', '🔨', '🪛', '⚙️', '🔩', '🛠️',
        '💡', '🔦', '🕯️', '🪔', '📷', '📸', '📹', '🎥', '📼', '🔍', '🔎', '💿', '📀', '🧲', '🔋', '🔌',
        '🧯', '🪫', '📡', '📺', '📻', '🎙️', '⏱️', '⏰', '🕰️', '⌛', '⏳', '📞', '☎️', '📟', '📠', '📢',
        '📣', '🔔', '🎁', '🎈', '📦', '📬', '📮', '📁', '🗂️', '📒', '📕', '📗', '📘', '📙', '📝', '✏️',
        '🖊️', '🖋️', '🧾', '📎', '📌', '📐', '📏', '✂️', '🔒', '🔓', '🔑', '🗝️', '🪪', '💎', '🪙', '📿'
    ],
    symbol: [
        '@', '#', '&', '*', '+', '-', '_', '=', '~', '^', '|', '\\', '/', '©', '®', '™', '✓', '✔', '✕',
        '✖', '✦', '✧', '★', '☆', '•', '◦', '◆', '◇', '■', '□', '●', '○', '→', '←', '↑', '↓', '↔',
        '↕', '↗', '↘', '↙', '↖', '±', '×', '÷', '≈', '≠', '≤', '≥', '∞', '∑', '√', 'π', 'µ', '§', '¶',
        '€', '$', '₹', '£', '¥', '₩', '₽', '¢', '₿', '°', '‰', '№', '¿', '¡', '«', '»', '“', '”', '‘', '’',
        '(', ')', '[', ']', '{', '}', '<', '>', '...', '※', '†', '‡', '※', '¤', '▪', '▫', '‣', '◉', '◎'
    ]
};

const QUICK_INSERT_RECENT_KEY = `pixelscript:chat:recent:${room}`;
const QUICK_INSERT_RECENT_LIMIT = 28;
const WRITER_CONTEXT_STORE_KEY = 'pixelscript:writer-space:contexts';
const quickInsertSetLabels = {
    recent: 'Recent',
    emoji: 'Smileys',
    people: 'People',
    animals: 'Animals',
    food: 'Food',
    travel: 'Travel',
    activities: 'Activities',
    objects: 'Objects',
    symbol: 'Symbols'
};

let activeQuickInsertSet = 'emoji';
let recentQuickInserts = [];
let latestWriterMessage = '';
let collaborationRole = null;
let writerCueRequestId = 0;
let currentWriterContextScope = '';
let writerCuePanelOpen = false;

function normalizeContextScopeValue(value = '') {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildWriterContextScope({ storyTitle = '', chapterNumber = '', collabId = '' } = {}) {
    const normalizedCollabId = normalizeContextScopeValue(collabId || collaborationId || '');
    if (normalizedCollabId) {
        return `collab:${normalizedCollabId}`;
    }

    const normalizedStory = normalizeContextScopeValue(storyTitle || storyTitleInput?.value || '');
    if (!normalizedStory) {
        return '';
    }

    const normalizedChapter = normalizeContextScopeValue(chapterNumber || chapterNumberInput?.value || '1') || '1';
    return `story:${normalizedStory}:chapter:${normalizedChapter}`;
}

function formatChatTime(isoDate) {
    const date = isoDate ? new Date(isoDate) : new Date();
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function isCurrentUserSender(sender) {
    const normalized = String(sender || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return canUseDrawingTools ? normalized === 'artist' : normalized === 'writer';
}

function autoGrowMessageInput() {
    if (!messageInput) {
        return;
    }

    messageInput.style.height = '74px';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 170)}px`;
}

function updateEmojiGridMeta(setName, count) {
    if (emojiSetLabel) {
        const label = quickInsertSetLabels[setName] || 'Emoji';
        emojiSetLabel.textContent = `${label} (${count})`;
    }

    if (emojiScrollTopButton && emojiGrid) {
        emojiScrollTopButton.disabled = emojiGrid.scrollTop <= 0;
    }
}

function getWriterContext() {
    try {
        const store = JSON.parse(localStorage.getItem(WRITER_CONTEXT_STORE_KEY) || '{}');
        if (!store || typeof store !== 'object') {
            return {};
        }
        if (!currentWriterContextScope) {
            return {};
        }
        return store[currentWriterContextScope] || {};
    } catch (error) {
        return {};
    }
}

function extractPrimaryMood(text = '') {
    const source = String(text).toLowerCase();
    if (/fight|war|attack|rage|chase|run|danger|panic/.test(source)) return 'high-tension';
    if (/sad|cry|loss|grief|alone|hurt/.test(source)) return 'melancholic';
    if (/love|kiss|care|warm|comfort|hope/.test(source)) return 'warm-intimate';
    if (/mystery|secret|unknown|shadow|dark|fog/.test(source)) return 'mysterious';
    if (/fun|joke|comic|light|happy/.test(source)) return 'light-playful';
    return 'cinematic-balanced';
}

function getLightingByMood(mood) {
    const map = {
        'high-tension': 'Hard rim light with sharp shadows and dynamic contrast.',
        melancholic: 'Soft low-key lighting with cool desaturated tones.',
        'warm-intimate': 'Warm bounce light with gentle gradients and close highlights.',
        mysterious: 'Directional light through haze/fog with strong silhouettes.',
        'light-playful': 'Bright high-key lighting with clear, readable forms.',
        'cinematic-balanced': 'Balanced cinematic lighting with one strong key and subtle fill.'
    };
    return map[mood] || map['cinematic-balanced'];
}

function getShotGuideByMood(mood) {
    const map = {
        'high-tension': 'Start with a wide establishing shot, then fast medium-close cuts for action beats.',
        melancholic: 'Use wider breathing frames and one lingering close-up on the emotional reaction.',
        'warm-intimate': 'Use medium-close frames, over-shoulder exchange, and one detail close-up.',
        mysterious: 'Use foreground occlusion, tilted medium shots, and one silhouette reveal panel.',
        'light-playful': 'Use clean medium shots with expressive character pose focus.',
        'cinematic-balanced': 'Use 1 wide + 2 medium + 1 close-up rhythm for readable flow.'
    };
    return map[mood] || map['cinematic-balanced'];
}

function inferVisualCue(message, context) {
    const mood = extractPrimaryMood(`${message} ${context?.tone || ''} ${context?.chapterGoal || ''}`);
    const genre = context?.genre || 'story';
    const title = context?.storyTitle || 'current project';
    const characterFocus = context?.characters || 'Use current speaker and counterpart as focal pair.';
    const styleHint = context?.visualStyle || 'Keep silhouettes clean and expressions readable.';

    return {
        title: `${title} | ${String(genre).toUpperCase()} scene cue`,
        mood,
        shotPlan: getShotGuideByMood(mood),
        lighting: getLightingByMood(mood),
        focus: characterFocus,
        style: styleHint,
        panelFlow: 'Recommended 4 panels: establish -> interaction -> emotional turn -> hook frame.'
    };
}

function renderWriterCue(cue) {
    if (!writerAiCueList) {
        return;
    }

    const items = [
        { label: cue.title, value: cue.title },
        { label: 'Mood', value: cue.mood },
        { label: 'Shot Plan', value: cue.shotPlan },
        { label: 'Lighting', value: cue.lighting },
        { label: 'Character Focus', value: cue.focus },
        { label: 'Visual Style', value: cue.style },
        { label: 'Panel Flow', value: cue.panelFlow }
    ];

    writerAiCueList.innerHTML = items
        .map(item => `
            <div class="writer-ai-cue-item" data-cue-insert="${escapeHtml(item.value)}">
                <strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}
            </div>
        `)
        .join('');
}

function updateWriterCueVisibility() {
    if (!writerAiCuePanel) {
        return;
    }

    const canUseWriterCue = collaborationRole === 'writer';
    if (!canUseWriterCue) {
        writerCuePanelOpen = false;
    }

    writerAiCuePanel.classList.toggle('visible', canUseWriterCue);
    writerAiCuePanel.classList.toggle('expanded', canUseWriterCue && writerCuePanelOpen);

    if (writerAiCueGenerateButton) {
        writerAiCueGenerateButton.textContent = writerCuePanelOpen ? 'Close Scene Cue' : 'Suggest Scene Cue';
    }
}

function generateWriterCue(seedMessage = '') {
    return generateWriterCueWithMode(seedMessage, { preferAI: false });
}

async function requestWriterCueFromAI(message, context) {
    const response = await fetch('/api/ai/writer-scene-cue', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message, context })
    });

    if (!response.ok) {
        throw new Error('AI cue request failed');
    }

    const payload = await response.json();
    return payload?.cue || null;
}

async function generateWriterCueWithMode(seedMessage = '', options = {}) {
    const { preferAI = false } = options;
    if (collaborationRole !== 'writer') {
        return;
    }

    const draftMessage = (seedMessage || messageInput?.value || latestWriterMessage || '').trim();
    if (!draftMessage) {
        if (writerAiCueList) {
            writerAiCueList.innerHTML = '<div class="writer-ai-cue-item">Write a scene line in chat and click <strong>Suggest Scene Cue</strong>.</div>';
        }
        return;
    }

    latestWriterMessage = draftMessage;
    const context = getWriterContext();
    const requestId = ++writerCueRequestId;
    let cue = inferVisualCue(draftMessage, context);

    if (preferAI) {
        if (writerAiCueList) {
            writerAiCueList.innerHTML = '<div class="writer-ai-cue-item">Generating AI scene cue...</div>';
        }

        try {
            const aiCue = await requestWriterCueFromAI(draftMessage, context);
            if (requestId !== writerCueRequestId) {
                return;
            }
            if (aiCue) {
                cue = aiCue;
            }
        } catch (error) {
            // Fall back to local heuristic cue if request fails.
        }
    }

    renderWriterCue(cue);
}

function insertAtCursor(input, text) {
    if (!input) {
        return;
    }

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const nextPos = start + text.length;
    input.setSelectionRange(nextPos, nextPos);
    input.focus();
    autoGrowMessageInput();
}

function loadRecentQuickInserts() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUICK_INSERT_RECENT_KEY) || '[]');
        recentQuickInserts = Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, QUICK_INSERT_RECENT_LIMIT) : [];
    } catch (error) {
        recentQuickInserts = [];
    }
}

function saveRecentQuickInserts() {
    try {
        localStorage.setItem(QUICK_INSERT_RECENT_KEY, JSON.stringify(recentQuickInserts.slice(0, QUICK_INSERT_RECENT_LIMIT)));
    } catch (error) {
        // Local storage can fail in private mode; ignore safely.
    }
}

function registerQuickInsertUse(value) {
    recentQuickInserts = [value, ...recentQuickInserts.filter(item => item !== value)].slice(0, QUICK_INSERT_RECENT_LIMIT);
    saveRecentQuickInserts();
}

function renderQuickInsertGrid(setName = 'emoji') {
    if (!emojiGrid) {
        return;
    }

    const items = setName === 'recent' ? recentQuickInserts : (quickInsertSets[setName] || quickInsertSets.emoji);
    emojiGrid.innerHTML = '';
    updateEmojiGridMeta(setName, items.length);

    if (!items.length) {
        const emptyNode = document.createElement('div');
        emptyNode.textContent = setName === 'recent' ? 'No recent emoji yet' : 'No items available';
        emptyNode.style.gridColumn = '1 / -1';
        emptyNode.style.textAlign = 'center';
        emptyNode.style.color = '#6e868a';
        emptyNode.style.fontSize = '0.82rem';
        emptyNode.style.padding = '8px 0';
        emojiGrid.appendChild(emptyNode);
        return;
    }

    items.forEach(item => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'emoji-chip';
        chip.dataset.kind = setName === 'symbol' ? 'symbol' : 'emoji';
        chip.textContent = item;
        chip.title = `Insert ${item}`;
        chip.addEventListener('click', () => {
            insertAtCursor(messageInput, item);
            registerQuickInsertUse(item);
            if (activeQuickInsertSet === 'recent') {
                renderQuickInsertGrid('recent');
            }
        });
        emojiGrid.appendChild(chip);
    });
}

function setQuickInsertPanelVisible(isVisible) {
    if (!emojiPanel) {
        return;
    }

    emojiPanel.hidden = !isVisible;
    emojiToggleButton?.classList.toggle('active', isVisible && activeQuickInsertSet === 'emoji');
    charToggleButton?.classList.toggle('active', isVisible && activeQuickInsertSet === 'symbol');
}

function activateQuickInsertSet(setName) {
    activeQuickInsertSet = (setName === 'recent' || quickInsertSets[setName]) ? setName : 'emoji';

    document.querySelectorAll('.emoji-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.set === activeQuickInsertSet);
    });

    if (emojiGrid) {
        emojiGrid.scrollTop = 0;
    }

    renderQuickInsertGrid(activeQuickInsertSet);
    setQuickInsertPanelVisible(true);
}

function initializeQuickInsertPanel() {
    if (!emojiPanel) {
        return;
    }

    loadRecentQuickInserts();
    activateQuickInsertSet('emoji');
    setQuickInsertPanelVisible(false);

    emojiToggleButton?.addEventListener('click', () => {
        if (!emojiPanel.hidden && activeQuickInsertSet === 'emoji') {
            setQuickInsertPanelVisible(false);
            return;
        }
        activateQuickInsertSet('emoji');
    });

    charToggleButton?.addEventListener('click', () => {
        if (!emojiPanel.hidden && activeQuickInsertSet === 'symbol') {
            setQuickInsertPanelVisible(false);
            return;
        }
        activateQuickInsertSet('symbol');
    });

    emojiPanel.querySelectorAll('.emoji-tab').forEach(tab => {
        tab.addEventListener('click', () => activateQuickInsertSet(tab.dataset.set));
    });

    emojiGrid?.addEventListener('scroll', () => {
        if (emojiScrollTopButton) {
            emojiScrollTopButton.disabled = emojiGrid.scrollTop <= 0;
        }
    });

    emojiScrollTopButton?.addEventListener('click', () => {
        emojiGrid?.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.addEventListener('click', event => {
        if (emojiPanel.hidden) {
            return;
        }

        if (emojiPanel.contains(event.target) || emojiToggleButton?.contains(event.target) || charToggleButton?.contains(event.target)) {
            return;
        }

        setQuickInsertPanelVisible(false);
    });
}

function formatFileSize(bytes = 0) {
    const size = Number(bytes) || 0;
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildAttachmentNode(attachment) {
    if (!attachment?.url) {
        return null;
    }

    const container = document.createElement('div');
    container.className = 'chat-attachment';

    if (String(attachment.type || '').startsWith('image/')) {
        const image = document.createElement('img');
        image.src = attachment.url;
        image.alt = attachment.name || 'Image attachment';
        image.loading = 'lazy';

        const imageLink = document.createElement('a');
        imageLink.href = attachment.url;
        imageLink.target = '_blank';
        imageLink.rel = 'noopener noreferrer';
        imageLink.appendChild(image);
        container.appendChild(imageLink);
    }

    const fileLink = document.createElement('a');
    fileLink.className = 'chat-file-link';
    fileLink.href = attachment.url;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener noreferrer';
    const label = attachment.name || 'Attached file';
    const icon = document.createElement('i');
    icon.className = 'fas fa-file-alt';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    fileLink.appendChild(icon);
    fileLink.appendChild(text);
    container.appendChild(fileLink);

    if (attachment.size) {
        const meta = document.createElement('div');
        meta.className = 'chat-caption';
        meta.textContent = formatFileSize(attachment.size);
        container.appendChild(meta);
    }

    return container;
}

function refreshLayerControls() {
    if (!activeLayerSelect) {
        return;
    }

    const layers = canvas.getLayersSummary();
    activeLayerSelect.innerHTML = layers
        .map(layer => `<option value="${layer.id}">${escapeHtml(layer.name)}</option>`)
        .join('');

    const activeLayer = canvas.getActiveLayer();
    if (!activeLayer) {
        return;
    }

    activeLayerSelect.value = activeLayer.id;
    if (blendModeSelect) {
        blendModeSelect.value = activeLayer.blendMode || 'source-over';
    }
    if (alphaLockToggle) {
        alphaLockToggle.checked = Boolean(activeLayer.alphaLock);
    }
    if (clipMaskToggle) {
        clipMaskToggle.checked = Boolean(activeLayer.clipToBelow);
    }
}

function initializeToolHoverLabels() {
    const toolNames = {
        selection: 'Selection Tool',
        wand: 'Magic Wand Tool',
        move: 'Move Tool',
        transform: 'Transform Tool',
        brush: 'Brush Tool',
        pencil: 'Pencil Tool',
        eraser: 'Eraser Tool',
        blur: 'Blur Tool',
        smudge: 'Smudge Tool',
        line: 'Line Tool',
        rectangle: 'Rectangle Tool',
        circle: 'Circle Tool',
        polygon: 'Polygon Tool',
        fill: 'Fill Tool',
        eyedropper: 'Eyedropper Tool',
        text: 'Text Tool'
    };

    document.querySelectorAll('.tool-btn[data-tool]').forEach(button => {
        const tool = button.dataset.tool;
        const label = toolNames[tool] || `${tool} tool`;
        button.title = label;
        button.setAttribute('aria-label', label);
    });

    const actionLabels = [
        ['undo-btn', 'Undo'],
        ['redo-btn', 'Redo'],
        ['grid-btn', 'Toggle Grid'],
        ['clear-btn', 'Delete Entire Drawing'],
        ['save-btn', 'Download PNG'],
        ['add-layer-btn', 'Add Layer'],
        ['delete-layer-btn', 'Delete Layer']
    ];

    actionLabels.forEach(([id, label]) => {
        const node = document.getElementById(id);
        if (node) {
            node.title = label;
            node.setAttribute('aria-label', label);
        }
    });
}

function initializeToolbarScrollBehavior() {
    if (!drawingTools) {
        return;
    }

    const resetToolbarScroll = () => {
        drawingTools.scrollLeft = 0;
    };

    // Force left-most start so first tools (brush/pencil/eraser) are always visible.
    resetToolbarScroll();
    window.addEventListener('load', resetToolbarScroll, { once: true });
    window.addEventListener('resize', debounce(resetToolbarScroll, 120));

    drawingTools.addEventListener('wheel', event => {
        const canScrollHorizontally = drawingTools.scrollWidth > (drawingTools.clientWidth + 2);

        if (!canScrollHorizontally) {
            return;
        }

        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
            return;
        }

        drawingTools.scrollLeft += event.deltaY;
        event.preventDefault();
    }, { passive: false });

    let dragActive = false;
    let dragStartX = 0;
    let dragStartScroll = 0;

    const stopDrag = () => {
        dragActive = false;
        drawingTools.classList.remove('dragging');
    };

    drawingTools.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen') {
            return;
        }

        // Do not hijack pointer events from interactive controls.
        if (event.target?.closest('.tool-btn, input, select, label, button')) {
            return;
        }

        const canScrollHorizontally = drawingTools.scrollWidth > (drawingTools.clientWidth + 2);
        if (!canScrollHorizontally) {
            return;
        }

        dragActive = true;
        dragStartX = event.clientX;
        dragStartScroll = drawingTools.scrollLeft;
        drawingTools.classList.add('dragging');
        drawingTools.setPointerCapture?.(event.pointerId);
    });

    drawingTools.addEventListener('pointermove', event => {
        if (!dragActive) {
            return;
        }

        const deltaX = event.clientX - dragStartX;
        drawingTools.scrollLeft = dragStartScroll - deltaX;
    });

    drawingTools.addEventListener('pointerup', stopDrag);
    drawingTools.addEventListener('pointercancel', stopDrag);
    drawingTools.addEventListener('pointerleave', stopDrag);
}

function setProjectPanelCollapsed(collapsed) {
    if (!projectPanel || !projectToggle) {
        return;
    }

    projectPanel.classList.toggle('collapsed', collapsed);
    projectToggle.classList.toggle('panel-open', !collapsed);
    projectToggle.innerHTML = collapsed
        ? '<i class="fas fa-chevron-right"></i>'
        : '<i class="fas fa-chevron-left"></i>';
    projectToggle.setAttribute('aria-label', collapsed ? 'Open story board' : 'Close story board');
}

function setChatPanelCollapsed(collapsed) {
    if (!chatContainer || !chatToggle) {
        return;
    }

    if (collapsed) {
        setQuickInsertPanelVisible(false);
    }

    chatContainer.classList.toggle('collapsed', collapsed);
    chatToggle.classList.toggle('panel-open', !collapsed);
    chatToggle.innerHTML = collapsed
        ? '<i class="fas fa-chevron-left"></i>'
        : '<i class="fas fa-chevron-right"></i>';
    chatToggle.setAttribute('aria-label', collapsed ? 'Open chat' : 'Close chat');
}

function applyWorkspaceRoleAccess() {
    document.documentElement.style.setProperty('--toolbar-height', canUseDrawingTools ? '76px' : '0px');
    document.documentElement.style.setProperty('--floating-toggle-bottom', canUseDrawingTools ? '88px' : '20px');

    if (canUseDrawingTools) {
        if (drawingTools) {
            drawingTools.style.display = '';
            drawingTools.scrollLeft = 0;
        }
        if (!canvas.history.length) {
            canvas.pushHistory();
        }
        if (saveCurrentPanelButton) {
            saveCurrentPanelButton.style.display = '';
            saveCurrentPanelButton.disabled = false;
        }
        if (chapterNumberInput) {
            chapterNumberInput.disabled = false;
        }
        if (chapterTitleInput) {
            chapterTitleInput.disabled = false;
        }
        if (coverImageInput) {
            coverImageInput.disabled = false;
        }
        if (panelTitleInput) {
            panelTitleInput.disabled = false;
        }
        canvas.canvas.style.pointerEvents = 'auto';
        document.querySelectorAll('.tool-btn[data-tool], #color-picker, #size-slider, #opacity-slider, #tolerance-slider, #undo-btn, #redo-btn, #clear-btn, #save-btn, #grid-btn, #add-layer-btn, #delete-layer-btn, #active-layer-select, #blend-mode-select, #alpha-lock-toggle, #clip-mask-toggle')
            .forEach(control => {
                control.disabled = false;
            });
    } else {
        if (drawingTools) {
            drawingTools.style.display = 'none';
        }
        if (saveCurrentPanelButton) {
            saveCurrentPanelButton.style.display = 'none';
            saveCurrentPanelButton.disabled = true;
        }
        if (chapterNumberInput) {
            chapterNumberInput.disabled = true;
        }
        if (chapterTitleInput) {
            chapterTitleInput.disabled = true;
        }
        if (coverImageInput) {
            coverImageInput.disabled = true;
        }
        if (panelTitleInput) {
            panelTitleInput.disabled = true;
        }
        canvas.canvas.style.pointerEvents = 'none';
        document.querySelectorAll('.tool-btn[data-tool], #color-picker, #size-slider, #opacity-slider, #tolerance-slider, #undo-btn, #redo-btn, #clear-btn, #save-btn, #grid-btn, #add-layer-btn, #delete-layer-btn, #active-layer-select, #blend-mode-select, #alpha-lock-toggle, #clip-mask-toggle')
            .forEach(control => {
                control.disabled = true;
            });
    }
}

applyWorkspaceRoleAccess();

document.querySelectorAll('.tool-btn[data-tool]').forEach(button => {
    button.addEventListener('click', () => {
        if (!canUseDrawingTools) return;
        const selectedTool = button.dataset.tool;
        document.querySelectorAll('.tool-btn[data-tool]').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        canvas.setTool(selectedTool);

        if (projectStatus) {
            if (selectedTool === 'selection') {
                projectStatus.textContent = 'Selection active. Drag on canvas to select an area.';
            } else if (selectedTool === 'move') {
                projectStatus.textContent = 'Move active. Drag selected area to reposition it.';
            } else if (selectedTool === 'transform') {
                projectStatus.textContent = 'Transform active. Drag to resize selected area.';
            } else if (selectedTool === 'wand') {
                projectStatus.textContent = 'Magic wand active. Click a region to select similar pixels.';
            } else if (selectedTool === 'fill') {
                projectStatus.textContent = 'Fill active. Click any enclosed region to flood fill.';
            } else if (selectedTool === 'text') {
                projectStatus.textContent = 'Text active. Click canvas to insert text.';
            }
        }

        if (selectedTool === 'eyedropper') {
            if (projectStatus) {
                projectStatus.textContent = 'Eyedropper active. Click on canvas to sample a color.';
            }
            // Try opening the native eyedropper immediately from the toolbar click gesture.
            Promise.resolve(
                canvas.handleEyedropperPick(
                    canvas.lastX || (canvas.canvas.width / 2),
                    canvas.lastY || (canvas.canvas.height / 2),
                    false
                )
            ).catch(() => {
                // If immediate activation fails, user can still click on canvas to sample.
            });
            return;
        }

        if (selectedTool !== 'eyedropper' && selectedTool !== 'wand') {
            lastPaintTool = selectedTool;
        }
    });
});

document.getElementById('color-picker')?.addEventListener('input', event => {
    canvas.setColor(event.target.value);
});

document.getElementById('size-slider')?.addEventListener('input', event => {
    canvas.setSize(event.target.value);
});

document.getElementById('opacity-slider')?.addEventListener('input', event => {
    canvas.setOpacity(event.target.value);
});

toleranceSlider?.addEventListener('input', event => {
    canvas.brushConfig.fillTolerance = Number(event.target.value);
});

addLayerButton?.addEventListener('click', () => {
    canvas.createLayer();
    refreshLayerControls();
    canvas.renderComposite();
    if (projectStatus) {
        projectStatus.textContent = 'New layer added.';
    }
});

deleteLayerButton?.addEventListener('click', () => {
    if (!canvas.deleteActiveLayer() && projectStatus) {
        projectStatus.textContent = 'At least one layer must remain.';
    }
    refreshLayerControls();
});

activeLayerSelect?.addEventListener('change', event => {
    canvas.setActiveLayer(event.target.value);
    refreshLayerControls();
});

blendModeSelect?.addEventListener('change', event => {
    canvas.setActiveLayerBlendMode(event.target.value);
    refreshLayerControls();
});

alphaLockToggle?.addEventListener('change', event => {
    canvas.setActiveLayerAlphaLock(event.target.checked);
    refreshLayerControls();
});

clipMaskToggle?.addEventListener('change', event => {
    canvas.setActiveLayerClipMask(event.target.checked);
    refreshLayerControls();
});

document.getElementById('undo-btn')?.addEventListener('click', () => {
    if (canUseDrawingTools) canvas.undo();
});

document.getElementById('redo-btn')?.addEventListener('click', () => {
    if (canUseDrawingTools) canvas.redo();
});

document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (canUseDrawingTools) {
        canvas.clear();
    }
});

document.getElementById('save-btn')?.addEventListener('click', () => {
    if (canUseDrawingTools) canvas.savePng();
});

document.getElementById('grid-btn')?.addEventListener('click', event => {
    gridOverlay?.classList.toggle('visible');
    event.currentTarget.classList.toggle('active', gridOverlay?.classList.contains('visible'));
});

chatMinimizeBtn?.addEventListener('click', () => {
    setChatPanelCollapsed(!chatContainer?.classList.contains('collapsed'));
});

chatToggle?.addEventListener('click', () => {
    setChatPanelCollapsed(!chatContainer?.classList.contains('collapsed'));
});

workspaceUploadButton?.addEventListener('click', () => {
    workspaceFileInput?.click();
});

workspaceFileInput?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) {
        uploadWorkspaceAsset(file);
    }
    event.target.value = '';
});

projectToggle?.addEventListener('click', () => {
    setProjectPanelCollapsed(!projectPanel?.classList.contains('collapsed'));
});

chapterNumberInput?.addEventListener('input', () => updateWorkspacePresence(1));
storyTitleInput?.addEventListener('input', () => {
    currentWriterContextScope = buildWriterContextScope();
});
chapterNumberInput?.addEventListener('input', () => {
    currentWriterContextScope = buildWriterContextScope();
});
chapterTitleInput?.addEventListener('input', () => updateWorkspacePresence(1));
saveProjectButton?.addEventListener('click', saveCollaborationProject);
publishRequestButton?.addEventListener('click', requestPublishApproval);
saveCurrentPanelButton?.addEventListener('click', saveCurrentPanel);
coverImageInput?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) {
        uploadCoverImage(file);
    }
    event.target.value = '';
});
panelsList?.addEventListener('click', async event => {
    const removeButton = event.target.closest('[data-remove-panel]');
    if (!removeButton) {
        return;
    }

    const panelOrder = Number(removeButton.dataset.removePanel);
    savedChapterPanels = normalizeChapterPanels(
        savedChapterPanels.filter(panel => panel.order !== panelOrder)
    );
    renderSavedPanels();
    await syncChapterPanels('Chapter panels updated.');
});

function addMessage(message, type, sender = type === 'sent' ? 'Artist' : 'Writer', shouldPersist = false, sentAt = null, attachment = null) {
    const node = document.createElement('div');
    node.classList.add('message', type);

    if (type === 'system') {
        node.textContent = message;
    } else {
        if (type === 'received') {
            const senderLine = document.createElement('div');
            senderLine.className = 'message-sender';
            senderLine.textContent = sender || 'Collaborator';
            node.appendChild(senderLine);
        }

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        if (attachment?.url) {
            bubble.classList.add('has-media');
            const attachmentNode = buildAttachmentNode(attachment);
            if (attachmentNode) {
                bubble.appendChild(attachmentNode);
            }
            if (message) {
                const caption = document.createElement('div');
                caption.className = 'chat-caption';
                caption.textContent = message;
                bubble.appendChild(caption);
            }
        } else {
            bubble.textContent = message;
        }

        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = formatChatTime(sentAt);

        node.appendChild(bubble);
        node.appendChild(meta);
    }

    chatMessages.appendChild(node);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (shouldPersist) {
        persistedMessages.push({
            sender,
            message,
            attachment: attachment || undefined,
            sentAt: sentAt || new Date().toISOString()
        });
        debouncedChatSave();
    }
}

async function loadWorkspace() {
    try {
        const response = await fetch(`/api/workspaces/${room}`);
        if (!response.ok) {
            throw new Error('Failed to load workspace');
        }

        const workspace = await response.json();
        if (workspace.canvasState) {
            canvas.loadCanvasState(workspace.canvasState, false);
            canvas.pushHistory();
        } else if (canUseDrawingTools) {
            canvas.pushHistory();
        }

        (workspace.chat || []).forEach(item => {
            persistedMessages.push(item);
            addMessage(item.message, isCurrentUserSender(item.sender) ? 'sent' : 'received', item.sender, false, item.sentAt, item.attachment || null);
        });

        renderAssets(workspace.assets || []);
    } catch (error) {
        console.error('Workspace load error:', error);
        renderAssets([]);
        if (canUseDrawingTools) {
            canvas.pushHistory();
        }
    }
}

async function uploadWorkspaceAsset(file, options = {}) {
    if (!file) {
        return null;
    }

    const { updateAssetPanel = true, showError = true } = options;

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('uploadedBy', canUseDrawingTools ? 'Artist' : 'Writer');

        const response = await fetch(`/api/workspaces/${room}/assets`, {
            method: 'POST',
            body: formData
        });

        const asset = await response.json();
        if (!response.ok) {
            throw new Error(asset.error || 'Upload failed');
        }

        asset.size = file.size;

        if (updateAssetPanel) {
            const currentAssets = document.querySelectorAll('#workspace-assets .asset-item').length;
            if (currentAssets === 1 && document.querySelector('#workspace-assets .asset-item span')?.textContent === 'No saved assets yet.') {
                renderAssets([asset]);
                return asset;
            }

            const links = Array.from(document.querySelectorAll('#workspace-assets .asset-item')).map(item => ({
                name: item.querySelector('a')?.textContent || '',
                url: item.querySelector('a')?.getAttribute('href') || '#',
                uploadedBy: item.querySelector('span')?.textContent || 'Collaborator'
            })).filter(item => item.name);

            renderAssets([...links, asset]);
        }

        return asset;
    } catch (error) {
        console.error('Asset upload error:', error);
        if (showError) {
            alert('Failed to upload asset');
        }
        return null;
    }
}

function emitChatPayload(payload) {
    const sender = canUseDrawingTools ? 'Artist' : 'Writer';
    const sentAt = new Date().toISOString();
    const normalizedMessage = String(payload.message || '').trim();
    const attachment = payload.attachment || null;

    if (!normalizedMessage && !attachment?.url) {
        return;
    }

    const chatPayload = {
        room,
        sender,
        message: normalizedMessage,
        sentAt,
        attachment
    };

    socket.emit('chatMessage', chatPayload);
    addMessage(chatPayload.message, 'sent', sender, true, sentAt, attachment);
}

function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;
    emitChatPayload({ message });
    if (writerCuePanelOpen) {
        generateWriterCueWithMode(message, { preferAI: true });
    }
    messageInput.value = '';
    autoGrowMessageInput();
}

async function sendAttachmentMessage(file) {
    const uploaded = await uploadWorkspaceAsset(file, { updateAssetPanel: true, showError: true });
    if (!uploaded?.url) {
        return;
    }

    emitChatPayload({
        message: messageInput?.value || '',
        attachment: {
            name: uploaded.name,
            url: uploaded.url,
            type: uploaded.type,
            size: uploaded.size || file.size || 0
        }
    });

    if (messageInput) {
        messageInput.value = '';
        autoGrowMessageInput();
    }
}

sendButton?.addEventListener('click', sendMessage);
attachmentButton?.addEventListener('click', () => {
    chatAttachmentInput?.click();
});

chatAttachmentInput?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) {
        await sendAttachmentMessage(file);
    }
    event.target.value = '';
});

messageInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});
messageInput?.addEventListener('input', () => {
    autoGrowMessageInput();
    if (collaborationRole === 'writer' && writerCuePanelOpen) {
        generateWriterCue(messageInput.value);
    }
});

writerAiCueGenerateButton?.addEventListener('click', () => {
    if (collaborationRole !== 'writer') {
        return;
    }

    writerCuePanelOpen = !writerCuePanelOpen;
    updateWriterCueVisibility();
    if (writerCuePanelOpen) {
        generateWriterCueWithMode(messageInput?.value || latestWriterMessage, { preferAI: true });
    }
});

writerAiCueList?.addEventListener('click', event => {
    const cueItem = event.target.closest('.writer-ai-cue-item');
    if (!cueItem || !messageInput) {
        return;
    }

    const cueText = cueItem.getAttribute('data-cue-insert') || '';
    if (!cueText.trim()) {
        return;
    }

    const prefix = messageInput.value.trim() ? '\n' : '';
    insertAtCursor(messageInput, `${prefix}${cueText}`);
});

autoGrowMessageInput();
initializeQuickInsertPanel();
updateWriterCueVisibility();

socket.on('connect', () => {
    joinCollaborationRoom();
});

socket.on('chatMessage', data => {
    addMessage(data.message, 'received', data.sender || 'Collaborator', false, data.sentAt, data.attachment || null);
});

socket.on('userJoined', data => {
    updateWorkspacePresence(data.userCount);
});

socket.on('userLeft', data => {
    updateWorkspacePresence(data.userCount);
});

socket.on('draw', data => {
    if (canUseDrawingTools) return;
    canvas.drawShape(data);
});

socket.on('canvasState', state => {
    if (canUseDrawingTools) return;
    if (typeof state === 'string') {
        canvas.loadCanvasState(state, false);
    }
});

socket.on('clear', data => {
    if (!canUseDrawingTools) {
        if (data?.state) {
            canvas.loadCanvasState(data.state, false);
        } else {
            canvas.ctx.clearRect(0, 0, canvas.canvas.width, canvas.canvas.height);
        }
    }
});

socket.on('undo', data => {
    if (!canUseDrawingTools && data?.state) {
        canvas.loadCanvasState(data.state, false);
    }
});

socket.on('redo', data => {
    if (!canUseDrawingTools && data?.state) {
        canvas.loadCanvasState(data.state, false);
    }
});

loadWorkspace();
loadCollaborationDetails();
renderSavedPanels();
initializeToolHoverLabels();
initializeToolbarScrollBehavior();
refreshLayerControls();
if (toleranceSlider) {
    toleranceSlider.value = String(canvas.brushConfig.fillTolerance);
}
setProjectPanelCollapsed(false);
setChatPanelCollapsed(false);
