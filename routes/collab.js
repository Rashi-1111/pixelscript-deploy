const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const Collaboration = require('../models/Collaboration');
const User = require('../models/User');
const auth = require('../middleware/auth');
const Room = require('../models/Room');
const Story = require('../models/Story');
const Workspace = require('../models/Workspace');
const { uploadBuffer, uploadDataUri } = require('../services/cloudinary');

const collaborationCoverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed for collaboration covers'));
        }
        cb(null, true);
    }
});

function getPartnerRole(role) {
    return role === 'artist' ? 'writer' : 'artist';
}

function normalizeChapterNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return Math.max(1, Math.floor(parsed));
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return parsed;
}

function normalizeChapterPanels(chapterPanels = [], fallbackCanvas = '', fallbackArtwork = []) {
    const fromPanels = (chapterPanels || [])
        .filter(panel => panel && panel.imageUrl)
        .map((panel, index) => ({
            title: String(panel.title || '').trim(),
            imageUrl: panel.imageUrl,
            order: Number(panel.order) || index + 1
        }))
        .sort((a, b) => a.order - b.order);

    if (fromPanels.length) {
        return fromPanels.map((panel, index) => ({
            ...panel,
            order: index + 1
        }));
    }

    const fallbackPanels = [];
    if (fallbackCanvas) {
        fallbackPanels.push({
            title: 'Panel 1',
            imageUrl: fallbackCanvas,
            order: 1
        });
    }

    (fallbackArtwork || [])
        .filter(asset => String(asset.type || '').startsWith('image/') && asset.url && asset.url !== fallbackCanvas)
        .forEach(asset => {
            fallbackPanels.push({
                title: asset.name || `Panel ${fallbackPanels.length + 1}`,
                imageUrl: asset.url,
                order: fallbackPanels.length + 1
            });
        });

    return fallbackPanels.map((panel, index) => ({
        ...panel,
        order: index + 1
    }));
}

function resolvePublicAssetPath(urlPath = '') {
    const normalized = path.posix.normalize(`/${String(urlPath || '')}`).replace(/^\/+/, '');
    if (!normalized.startsWith('uploads/')) {
        return null;
    }
    return path.resolve(__dirname, '..', 'public', normalized);
}

function getMimeTypeFromPath(filePath) {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    const mimeByExt = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };
    return mimeByExt[extension] || 'image/jpeg';
}

async function uploadImageUrlIfNeeded(imageUrl, folder) {
    const value = String(imageUrl || '').trim();
    if (!value) {
        return '';
    }

    if (value.startsWith('https://') || value.startsWith('http://')) {
        return value;
    }

    if (value.startsWith('data:image/')) {
        const uploaded = await uploadDataUri(value, { folder, resourceType: 'image' });
        return uploaded.secure_url || value;
    }

    const filePath = resolvePublicAssetPath(value);
    if (filePath && fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        const uploaded = await uploadBuffer(fileBuffer, { folder, resourceType: 'image' });
        return uploaded.secure_url || value;
    }

    return value;
}

async function buildEmbeddedStoryPanels(chapterPanels = []) {
    const mappedPanels = await Promise.all((chapterPanels || []).map(async panel => ({
        title: String(panel?.title || '').trim(),
        imageUrl: await uploadImageUrlIfNeeded(panel?.imageUrl || '', 'story-panels'),
        order: Number(panel?.order) || 1
    })));

    return mappedPanels;
}

function serializeCollaboration(collaboration, currentUserId) {
    const currentId = currentUserId ? currentUserId.toString() : '';
    const requesterId = collaboration.requester ? collaboration.requester.toString() : '';
    const artistId = collaboration.artist?._id ? collaboration.artist._id.toString() : collaboration.artist?.toString();
    const writerId = collaboration.writer?._id ? collaboration.writer._id.toString() : collaboration.writer?.toString();
    const publishedStoryId = collaboration.publishRequest?.story?._id
        ? collaboration.publishRequest.story._id.toString()
        : (collaboration.publishRequest?.story ? collaboration.publishRequest.story.toString() : null);
    const publishedChapterNumber = normalizeChapterNumber(collaboration.chapterNumber);
    const publishedChapterId = Array.isArray(collaboration.publishRequest?.story?.chapters)
        ? (collaboration.publishRequest.story.chapters.find(chapter => Number(chapter?.order) === publishedChapterNumber)?._id?.toString() || null)
        : null;
    const isPublishedLive = collaboration.status === 'completed' && Boolean(publishedStoryId);
    const fallbackFileCover = (collaboration.files || []).find(file => String(file.type || '').startsWith('image/'))?.url || '';
    const fallbackPanelCover = (collaboration.chapterPanels || [])[0]?.imageUrl || '';
    const coverImage = collaboration.coverImage || collaboration.publishRequest?.story?.coverImage || fallbackFileCover || fallbackPanelCover || 'images/work1.jpeg';

    return {
        ...collaboration.toObject(),
        canRespond: collaboration.status === 'pending' && requesterId && requesterId !== currentId,
        isRequester: requesterId === currentId,
        currentUserRole: artistId === currentId ? 'artist' : (writerId === currentId ? 'writer' : null),
        partner: artistId === currentId ? collaboration.writer : collaboration.artist,
        publishReady: Boolean(collaboration.storyTitle && collaboration.storyContent),
        chapterLabel: `Chapter ${normalizeChapterNumber(collaboration.chapterNumber)}`,
        isPublishedLive,
        publishedStoryId,
        publishedChapterId,
        coverImage
    };
}

function buildCollaborationTitle(collaboration) {
    return `${collaboration.storyTitle || collaboration.title} - Chapter ${normalizeChapterNumber(collaboration.chapterNumber)}`;
}

async function backfillPublishedStoryLinks(collaborations) {
    const collaborationsToUpdate = [];
    
    for (const collab of collaborations) {
        if (collab.status === 'completed' && !collab.publishRequest?.story) {
            const linkedStory = await Story.findOne({ sourceCollaboration: collab._id }).lean();
            if (linkedStory) {
                collab.publishRequest = collab.publishRequest || {};
                collab.publishRequest.story = linkedStory._id;
                collaborationsToUpdate.push(collab);
            }
        }
    }
    
    if (collaborationsToUpdate.length) {
        await Promise.all(
            collaborationsToUpdate.map(collab =>
                Collaboration.findByIdAndUpdate(
                    collab._id,
                    { 'publishRequest.story': collab.publishRequest.story },
                    { new: false }
                )
            )
        );
    }
    
    return collaborations;
}

async function populateCollaboration(collaborationId) {
    return Collaboration.findById(collaborationId)
        .populate('artist', 'username name profilePicture role')
        .populate('writer', 'username name profilePicture role')
    .populate('publishRequest.story', 'title isPublished coverImage chapters._id chapters.order');
}

function resetPublishApprovalsForEditing(collaboration) {
    collaboration.status = 'active';
    collaboration.publishRequest.artistApproved = false;
    collaboration.publishRequest.writerApproved = false;
    collaboration.publishRequest.requestedAt = undefined;
    collaboration.publishRequest.requestedBy = undefined;
    collaboration.publishRequest.publishedAt = undefined;
    collaboration.markModified('publishRequest');
}

function clearStoryActionRequest(collaboration, status = '') {
    collaboration.storyActionRequest.type = '';
    collaboration.storyActionRequest.status = status;
    collaboration.storyActionRequest.requestedAt = undefined;
    collaboration.storyActionRequest.requestedBy = undefined;
    collaboration.storyActionRequest.artistApproved = false;
    collaboration.storyActionRequest.writerApproved = false;
    collaboration.storyActionRequest.resolvedAt = status ? new Date() : undefined;
    collaboration.storyActionRequest.resolvedBy = undefined;
}

async function shiftChapterNumbersAfterDelete(collaboration) {
    const deletedChapterNumber = normalizeChapterNumber(collaboration.chapterNumber);

    const collaborationsToShift = await Collaboration.find({
        _id: { $ne: collaboration._id },
        writer: collaboration.writer,
        storyTitle: collaboration.storyTitle,
        chapterNumber: { $gt: deletedChapterNumber },
        status: { $in: ['active', 'completed'] }
    });

    for (const item of collaborationsToShift) {
        item.chapterNumber = normalizeChapterNumber(item.chapterNumber) - 1;
        item.title = buildCollaborationTitle(item);
        await item.save();
    }
}

async function executeDeleteChapter(collaboration) {
    const story = await Story.findById(collaboration.publishRequest.story);
    if (!story) {
        throw new Error('Published story not found');
    }

    const deletedChapterNumber = normalizeChapterNumber(collaboration.chapterNumber);
    const existingChapterIndex = story.chapters.findIndex(chapter => Number(chapter.order) === deletedChapterNumber);

    if (existingChapterIndex === -1) {
        throw new Error('Published chapter not found');
    }

    story.chapters.splice(existingChapterIndex, 1);
    story.chapters = story.chapters
        .sort((a, b) => a.order - b.order)
        .map((chapter, index) => ({
            ...(chapter.toObject ? chapter.toObject() : chapter),
            order: index + 1,
            isFree: index + 1 <= 2
        }));

    if (story.projectBoard?.panels?.length) {
        story.projectBoard.panels = [];
    }

    if (story.chapters.length) {
        await story.save();
    } else {
        await Story.deleteOne({ _id: story._id });
    }

    await shiftChapterNumbersAfterDelete(collaboration);

    collaboration.status = 'cancelled';
    collaboration.publishRequest.artistApproved = false;
    collaboration.publishRequest.writerApproved = false;
    collaboration.publishRequest.requestedAt = undefined;
    collaboration.publishRequest.requestedBy = undefined;
    collaboration.publishRequest.publishedAt = undefined;
    collaboration.publishRequest.story = undefined;
}

async function executeEditChapter(collaboration) {
    if (!collaboration.publishRequest?.story) {
        throw new Error('Published story not found');
    }

    resetPublishApprovalsForEditing(collaboration);
}

async function finalizeStoryActionIfApproved(collaboration) {
    if (!collaboration.storyActionRequest.artistApproved || !collaboration.storyActionRequest.writerApproved) {
        return;
    }

    if (collaboration.storyActionRequest.type === 'delete') {
        await executeDeleteChapter(collaboration);
    }

    if (collaboration.storyActionRequest.type === 'edit') {
        await executeEditChapter(collaboration);
    }

    collaboration.storyActionRequest.status = 'approved';
    collaboration.storyActionRequest.resolvedAt = new Date();
}

async function ensureCollaborationUsers(collaboration) {
    await User.updateMany(
        { _id: { $in: [collaboration.artist, collaboration.writer] } },
        { $addToSet: { collaborations: collaboration._id } }
    );
}

router.get('/discover', auth, async (req, res) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 24), 50);
        const skip = (page - 1) * limit;

        const partnerRole = getPartnerRole(req.user.role);
        if (!['artist', 'writer'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Only artists and writers can discover collaborators' });
        }

        const users = await User.find({
            _id: { $ne: req.user._id },
            role: partnerRole
        })
            .skip(skip)
            .limit(limit)
            .select('name username role bio about genres skills profilePicture profileCompletion works')
            .populate('works');

        res.json(users.map(user => ({
            _id: user._id,
            name: user.name,
            username: user.username,
            role: user.role,
            bio: user.bio || user.about || '',
            about: user.about || '',
            genres: user.genres || [],
            skills: user.skills || [],
            profilePicture: user.profilePicture,
            profileCompletion: user.profileCompletion || 0,
            works: (user.works || []).slice(0, 4).map(work => ({
                _id: work._id,
                title: work.title,
                description: work.description,
                fileType: work.fileType,
                fileUrl: `/api/users/public/${user._id}/works/${work._id}/file`
            }))
        })));
    } catch (error) {
        res.status(500).json({ message: 'Error discovering collaborators' });
    }
});

router.post('/', auth, async (req, res) => {
    try {
        const { title, description, genre, category, partnerId, storyTitle, storySynopsis, chapterNumber, chapterTitle } = req.body;

        if (!['artist', 'writer'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Only artists and writers can create collaborations' });
        }

        const partner = await User.findById(partnerId);
        if (!partner) {
            return res.status(404).json({ message: 'Partner not found' });
        }

        if (partner.role !== getPartnerRole(req.user.role)) {
            return res.status(400).json({ message: 'Please choose a collaborator with the opposite role' });
        }

        const normalizedChapterNumber = normalizeChapterNumber(chapterNumber);
        const normalizedStoryTitle = String(storyTitle || title || '').trim();

        const existing = await Collaboration.findOne({
            $or: [
                {
                    artist: req.user._id,
                    writer: partner._id,
                    storyTitle: normalizedStoryTitle,
                    chapterNumber: normalizedChapterNumber,
                    status: { $in: ['pending', 'active'] }
                },
                {
                    artist: partner._id,
                    writer: req.user._id,
                    storyTitle: normalizedStoryTitle,
                    chapterNumber: normalizedChapterNumber,
                    status: { $in: ['pending', 'active'] }
                }
            ]
        });

        if (existing) {
            return res.status(400).json({ message: `You already have an active or pending collaboration for ${normalizedStoryTitle || 'this story'} chapter ${normalizedChapterNumber}` });
        }

        const room = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const collaboration = new Collaboration({
            title: title || `${normalizedStoryTitle || `${req.user.name} x ${partner.name}`} - Chapter ${normalizedChapterNumber}`,
            description,
            genre,
            category: category || 'other',
            requester: req.user._id,
            room,
            storyTitle: normalizedStoryTitle,
            chapterNumber: normalizedChapterNumber,
            chapterTitle: chapterTitle || `Chapter ${normalizedChapterNumber}`,
            storySynopsis: storySynopsis || description || '',
            artist: req.user.role === 'artist' ? req.user._id : partner._id,
            writer: req.user.role === 'writer' ? req.user._id : partner._id
        });

        await collaboration.save();
        await ensureCollaborationUsers(collaboration);

        res.status(201).json(serializeCollaboration(collaboration, req.user._id));
    } catch (error) {
        res.status(500).json({ message: 'Error creating collaboration' });
    }
});

router.get('/my-collaborations', auth, async (req, res) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
        const skip = (page - 1) * limit;

        const collaborations = await Collaboration.find({
            $or: [{ artist: req.user._id }, { writer: req.user._id }]
        })
            .populate('artist', 'username name profilePicture role')
            .populate('writer', 'username name profilePicture role')
            .populate('publishRequest.story', 'title isPublished coverImage chapters._id chapters.order')
            .skip(skip)
            .limit(limit)
            .sort('-updatedAt');

        await backfillPublishedStoryLinks(collaborations);

        res.json(collaborations.map(item => serializeCollaboration(item, req.user._id)));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching collaborations' });
    }
});

router.put('/:id/respond', auth, async (req, res) => {
    try {
        const { action } = req.body;
        const collaboration = await Collaboration.findById(req.params.id);

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        const isParticipant = collaboration.artist.toString() === req.user.id || collaboration.writer.toString() === req.user.id;
        if (!isParticipant) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (collaboration.requester && collaboration.requester.toString() === req.user.id) {
            return res.status(400).json({ message: 'Requester cannot respond to their own invitation' });
        }

        if (action === 'accept') {
            collaboration.status = 'active';
        } else if (action === 'reject') {
            collaboration.status = 'rejected';
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }

        await collaboration.save();

        const populated = await Collaboration.findById(collaboration._id)
            .populate('artist', 'username name profilePicture role')
            .populate('writer', 'username name profilePicture role')
            .populate('publishRequest.story', 'title isPublished coverImage chapters._id chapters.order');

        res.json(serializeCollaboration(populated, req.user._id));
    } catch (error) {
        res.status(500).json({ message: 'Error responding to collaboration' });
    }
});

router.post('/:id/cover-image', auth, collaborationCoverUpload.single('coverImage'), async (req, res) => {
    try {
        const collaboration = await Collaboration.findById(req.params.id)
            .populate('artist', 'username name profilePicture role')
            .populate('writer', 'username name profilePicture role')
            .populate('publishRequest.story', 'title isPublished coverImage');

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        if (collaboration.artist._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Only the artist can upload a story cover' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No cover image uploaded' });
        }

        const uploaded = await uploadBuffer(req.file.buffer, {
            folder: 'collaboration-covers',
            resourceType: 'image'
        });

        collaboration.coverImage = uploaded.secure_url;
        await collaboration.save();

        res.json(serializeCollaboration(collaboration, req.user._id));
    } catch (error) {
        console.error('Cover upload error:', error);
        res.status(500).json({ message: 'Failed to upload cover image' });
    }
});

router.get('/:id', auth, async (req, res) => {
    try {
        let collaboration = await Collaboration.findById(req.params.id)
            .populate('artist', 'username name profilePicture role')
            .populate('writer', 'username name profilePicture role')
            .populate('publishRequest.story', 'title isPublished coverImage');

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        if (!collaboration.artist.equals(req.user._id) && !collaboration.writer.equals(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to view this collaboration' });
        }

        await backfillPublishedStoryLinks([collaboration]);

        res.json(serializeCollaboration(collaboration, req.user._id));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching collaboration' });
    }
});

router.put('/:id', auth, async (req, res) => {
    try {
        const updates = Object.keys(req.body);
        const allowedUpdates = ['title', 'description', 'status', 'canvas', 'storyTitle', 'chapterNumber', 'chapterTitle', 'storySynopsis', 'storyContent', 'progress', 'chapterPanels'];
        const isValidOperation = updates.every(update => allowedUpdates.includes(update));

        if (!isValidOperation) {
            return res.status(400).json({ message: 'Invalid updates' });
        }

        const collaboration = await Collaboration.findById(req.params.id);

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        if (!collaboration.artist.equals(req.user._id) && !collaboration.writer.equals(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to update this collaboration' });
        }

        updates.forEach(update => {
            if (update === 'chapterPanels') {
                collaboration.chapterPanels = normalizeChapterPanels(req.body.chapterPanels || []);
                return;
            }
            if (update === 'chapterNumber') {
                collaboration.chapterNumber = normalizeChapterNumber(req.body.chapterNumber);
                return;
            }
            collaboration[update] = req.body[update];
        });

        collaboration.title = `${collaboration.storyTitle || collaboration.title} - Chapter ${normalizeChapterNumber(collaboration.chapterNumber)}`;
        await collaboration.save();

        const populated = await Collaboration.findById(collaboration._id)
            .populate('artist', 'username name profilePicture role')
            .populate('writer', 'username name profilePicture role')
            .populate('publishRequest.story', 'title isPublished coverImage');

        res.json(serializeCollaboration(populated, req.user._id));
    } catch (error) {
        res.status(500).json({ message: 'Error updating collaboration' });
    }
});

router.put('/:id/publish-request', auth, async (req, res) => {
    try {
        const collaboration = await Collaboration.findById(req.params.id);

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        const isArtist = collaboration.artist.toString() === req.user.id;
        const isWriter = collaboration.writer.toString() === req.user.id;
        if (!isArtist && !isWriter) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (!collaboration.storyTitle || !collaboration.storyContent) {
            return res.status(400).json({ message: 'Add a story title and story content before requesting publication' });
        }

        if (!collaboration.publishRequest.requestedAt) {
            collaboration.publishRequest.requestedAt = new Date();
            collaboration.publishRequest.requestedBy = req.user._id;
        }

        if (isArtist) {
            collaboration.publishRequest.artistApproved = true;
        }

        if (isWriter) {
            collaboration.publishRequest.writerApproved = true;
        }

        if (collaboration.publishRequest.artistApproved && collaboration.publishRequest.writerApproved) {
            const workspace = await Workspace.findOne({ room: collaboration.room }).lean();
            const coverImage = collaboration.coverImage || collaboration.files.find(file => String(file.type || '').startsWith('image/'))?.url || 'images/work1.jpeg';
            const sharedCoverImage = await uploadImageUrlIfNeeded(coverImage, 'story-covers');
            const chapterPanels = normalizeChapterPanels(
                collaboration.chapterPanels,
                workspace?.canvasState || '',
                workspace?.assets || []
            );
            const storyChapterPanels = await buildEmbeddedStoryPanels(chapterPanels);
            const normalizedGenre = ['fantasy', 'scifi', 'mystery', 'romance', 'horror', 'thriller', 'other'].includes(String(collaboration.genre).toLowerCase())
                ? String(collaboration.genre).toLowerCase()
                : 'other';
            const normalizedChapterNumber = normalizeChapterNumber(collaboration.chapterNumber);
            const chapterTitle = collaboration.chapterTitle || `Chapter ${normalizedChapterNumber}`;
            let story = collaboration.publishRequest.story
                ? await Story.findById(collaboration.publishRequest.story)
                : await Story.findOne({
                    author: collaboration.writer,
                    title: collaboration.storyTitle
                });

            if (story) {
                story.description = collaboration.storySynopsis || collaboration.description || story.description || '';
                story.genre = normalizedGenre;
                if (collaboration.coverImage || !story.coverImage || story.coverImage === 'images/work1.jpeg') {
                    story.coverImage = sharedCoverImage || coverImage;
                }

                const existingChapterIndex = story.chapters.findIndex(chapter => Number(chapter.order) === normalizedChapterNumber);
                const chapterPayload = {
                    title: chapterTitle,
                    content: collaboration.storyContent,
                    isFree: normalizedChapterNumber <= 2,
                    order: normalizedChapterNumber,
                    panels: storyChapterPanels
                };

                if (existingChapterIndex >= 0) {
                    story.chapters[existingChapterIndex] = {
                        ...story.chapters[existingChapterIndex].toObject(),
                        ...chapterPayload
                    };
                } else {
                    story.chapters.push(chapterPayload);
                }

                story.chapters = story.chapters.sort((a, b) => a.order - b.order).map((chapter, index) => ({
                    ...(chapter.toObject ? chapter.toObject() : chapter),
                    isFree: chapter.order <= 2,
                    order: chapter.order || index + 1
                }));
                story.projectBoard = {
                    synopsis: story.description || '',
                    finalNotes: '',
                    canvasPreview: chapterPanels[0]?.imageUrl || workspace?.canvasState || '',
                    panels: chapterPanels,
                    artwork: (workspace?.assets || [])
                        .filter(asset => String(asset.type || '').startsWith('image/'))
                        .map(asset => ({
                            name: asset.name,
                            url: asset.url,
                            type: asset.type
                        }))
                };
                story.isPublished = true;
                await story.save();
            } else {
                story = await Story.create({
                    title: collaboration.storyTitle,
                    description: collaboration.storySynopsis || collaboration.description || '',
                    author: collaboration.writer,
                    genre: normalizedGenre,
                    coverImage: sharedCoverImage || coverImage,
                    chapters: [{
                        title: chapterTitle,
                        content: collaboration.storyContent,
                        isFree: normalizedChapterNumber <= 2,
                        order: normalizedChapterNumber,
                        panels: storyChapterPanels
                    }],
                    sourceCollaboration: collaboration._id,
                    projectBoard: {
                        synopsis: collaboration.storySynopsis || collaboration.description || '',
                        finalNotes: '',
                        canvasPreview: chapterPanels[0]?.imageUrl || workspace?.canvasState || '',
                        panels: chapterPanels,
                        artwork: (workspace?.assets || [])
                            .filter(asset => String(asset.type || '').startsWith('image/'))
                            .map(asset => ({
                                name: asset.name,
                                url: asset.url,
                                type: asset.type
                            }))
                    },
                    isPublished: true,
                    price: 0
                });
            }

            collaboration.publishRequest.story = story._id;
            collaboration.publishRequest.publishedAt = new Date();
            collaboration.status = 'completed';
            clearStoryActionRequest(collaboration);
        }

        await collaboration.save();

        const populated = await populateCollaboration(collaboration._id);

        res.json(serializeCollaboration(populated, req.user._id));
    } catch (error) {
        res.status(500).json({ message: 'Error processing publish request' });
    }
});

router.post('/:id/story-action-request', auth, async (req, res) => {
    try {
        const { type } = req.body;
        const collaboration = await Collaboration.findById(req.params.id);

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        const isParticipant = collaboration.artist.toString() === req.user.id || collaboration.writer.toString() === req.user.id;
        if (!isParticipant) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (!['edit', 'delete'].includes(type)) {
            return res.status(400).json({ message: 'Invalid story action type' });
        }

        if (!collaboration.publishRequest?.story) {
            return res.status(400).json({ message: 'Only published chapters can be edited or deleted through requests' });
        }

        if (collaboration.storyActionRequest?.status === 'pending') {
            return res.status(400).json({ message: 'There is already a pending edit/delete request for this chapter' });
        }

        collaboration.storyActionRequest.type = type;
        collaboration.storyActionRequest.status = 'pending';
        collaboration.storyActionRequest.requestedAt = new Date();
        collaboration.storyActionRequest.requestedBy = req.user._id;
        collaboration.storyActionRequest.artistApproved = collaboration.artist.toString() === req.user.id;
        collaboration.storyActionRequest.writerApproved = collaboration.writer.toString() === req.user.id;
        collaboration.storyActionRequest.resolvedAt = undefined;
        collaboration.storyActionRequest.resolvedBy = undefined;
        await collaboration.save();

        const populated = await populateCollaboration(collaboration._id);

        res.json(serializeCollaboration(populated, req.user._id));
    } catch (error) {
        console.error('Story action request error:', error);
        res.status(500).json({ message: 'Error creating story action request' });
    }
});

router.put('/:id/story-action-request', auth, async (req, res) => {
    try {
        const { action } = req.body;
        const collaboration = await Collaboration.findById(req.params.id);

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        const isParticipant = collaboration.artist.toString() === req.user.id || collaboration.writer.toString() === req.user.id;
        if (!isParticipant) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (collaboration.storyActionRequest?.status !== 'pending' || !collaboration.storyActionRequest?.type) {
            return res.status(400).json({ message: 'There is no pending story action request to respond to' });
        }

        if (collaboration.storyActionRequest.requestedBy?.toString() === req.user.id) {
            return res.status(400).json({ message: 'Requester cannot approve or reject their own request' });
        }

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: 'Invalid action' });
        }

        if (action === 'reject') {
            collaboration.storyActionRequest.status = 'rejected';
            collaboration.storyActionRequest.resolvedAt = new Date();
            collaboration.storyActionRequest.resolvedBy = req.user._id;
            await collaboration.save();
        } else {
            if (collaboration.artist.toString() === req.user.id) {
                collaboration.storyActionRequest.artistApproved = true;
            }

            if (collaboration.writer.toString() === req.user.id) {
                collaboration.storyActionRequest.writerApproved = true;
            }

            await finalizeStoryActionIfApproved(collaboration);
            await collaboration.save();
        }

        const populated = await populateCollaboration(collaboration._id);

        res.json(serializeCollaboration(populated, req.user._id));
    } catch (error) {
        console.error('Story action response error:', error);
        res.status(500).json({ message: 'Error responding to story action request' });
    }
});

router.post('/:id/rate', auth, async (req, res) => {
    try {
        const { rating } = req.body;
        const collaboration = await Collaboration.findById(req.params.id);

        if (!collaboration) {
            return res.status(404).json({ message: 'Collaboration not found' });
        }

        if (!collaboration.artist.equals(req.user._id) && !collaboration.writer.equals(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to rate this collaboration' });
        }

        if (req.user.role === 'artist') {
            collaboration.rating.writer = {
                ...(collaboration.rating.writer || {}),
                rating
            };
        } else {
            collaboration.rating.artist = {
                ...(collaboration.rating.artist || {}),
                rating
            };
        }

        await collaboration.save();

        const partnerId = req.user.role === 'artist' ? collaboration.writer : collaboration.artist;
        const partner = await User.findById(partnerId);
        if (partner) {
            await partner.updateLastActive();
        }

        res.json(collaboration);
    } catch (error) {
        res.status(500).json({ message: 'Error rating collaboration' });
    }
});

router.post('/create', auth, async (req, res) => {
    try {
        const roomName = String(req.body.name || '').trim();
        if (!roomName) {
            return res.status(400).json({ error: 'Room name is required' });
        }

        const room = new Room({
            name: roomName,
            createdBy: req.user._id
        });
        await room.save();
        res.json({ roomId: room._id });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create room' });
    }
});

router.get('/join/:roomId', auth, async (req, res) => {
    try {
        const room = await Room.findById(req.params.roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const requesterId = String(req.user._id || req.user.id || req.user.userId || '');
        if (String(room.createdBy) !== requesterId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to access this room' });
        }

        res.json(room);
    } catch (error) {
        res.status(500).json({ error: 'Failed to join room' });
    }
});

router.get('/rooms', auth, async (req, res) => {
    try {
        const query = req.user.role === 'admin' ? {} : { createdBy: req.user._id };
        const rooms = await Room.find(query).sort({ createdAt: -1 }).limit(100);
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

module.exports = router;
