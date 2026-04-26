const express = require('express');
const multer = require('multer');
const Story = require('../models/Story');
const Purchase = require('../models/Purchase');
const Collaboration = require('../models/Collaboration');
const Workspace = require('../models/Workspace');
const auth = require('../middleware/auth');
const Comment = require('../models/Comment');
const { uploadBuffer } = require('../services/cloudinary');

const router = express.Router();

const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed for story covers'));
        }
        cb(null, true);
    }
});

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return parsed;
}

function parseChapters(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    return [];
}

function normalizeChapters(chapters = []) {
    return chapters.map((chapter, index) => ({
        title: String(chapter.title || `Chapter ${index + 1}`).trim(),
        content: String(chapter.content || '').trim(),
        isFree: index < 2,
        order: index + 1,
        panels: Array.isArray(chapter.panels)
            ? chapter.panels
                .filter(panel => panel && panel.imageUrl)
                .map((panel, panelIndex) => ({
                    title: String(panel.title || '').trim(),
                    imageUrl: panel.imageUrl,
                    order: Number(panel.order) || panelIndex + 1
                }))
            : []
    })).filter(chapter => chapter.title && chapter.content);
}

function normalizeProjectPanels(panels = [], fallbackCanvas = '', fallbackArtwork = []) {
    const normalizedPanels = (Array.isArray(panels) ? panels : [])
        .filter(panel => panel && panel.imageUrl)
        .map((panel, index) => ({
            title: String(panel.title || '').trim(),
            imageUrl: panel.imageUrl,
            order: Number(panel.order) || index + 1
        }))
        .sort((a, b) => a.order - b.order);

    if (normalizedPanels.length) {
        return normalizedPanels.map((panel, index) => ({
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

    return fallbackPanels;
}

function buildCreatedBy(story) {
    const artistName = story.sourceCollaboration?.artist?.name || story.sourceCollaboration?.artist?.username;
    const writerName = story.sourceCollaboration?.writer?.name || story.sourceCollaboration?.writer?.username || story.author?.name || story.author?.username;

    if (artistName && writerName) {
        return `${artistName} and ${writerName}`;
    }

    return writerName || artistName || story.author?.name || story.author?.username || 'Unknown creator';
}

function mapPreviewStory(story) {
    const coverImage = getStoryCoverImageUrl(story);
    const projectPanels = normalizeProjectPanels(
        story.projectBoard?.panels || [],
        story.projectBoard?.canvasPreview || '',
        story.projectBoard?.artwork || []
    );

    return {
        _id: story._id,
        title: story.title,
        description: story.description,
        genre: story.genre,
        coverImage,
        price: story.price,
        createdAt: story.createdAt,
        author: story.author,
        createdBy: buildCreatedBy(story),
        chapterCount: story.chapters.length,
        freeChapterCount: Math.min(story.chapters.length, 2),
        previewImage: mapPanelsForResponse(story._id, story.chapters?.[0]?._id, story.chapters?.[0]?.panels)?.[0]?.imageUrl
            || projectPanels[0]?.imageUrl
            || coverImage,
        chapters: story.chapters.map(chapter => ({
            _id: chapter._id,
            title: chapter.title,
            order: chapter.order,
            isFree: chapter.order <= 2,
            previewImage: mapPanelsForResponse(story._id, chapter._id, chapter.panels)?.[0]?.imageUrl
                || projectPanels[0]?.imageUrl
                || coverImage
        }))
    };
}

function getStoryCoverImageUrl(story) {
    return story?.coverImage || 'images/work1.jpeg';
}

function getPanelImageUrl(storyId, chapterId, panel) {
    return panel?.imageUrl || '';
}

function mapPanelsForResponse(storyId, chapterId, panels = []) {
    if (!Array.isArray(panels)) {
        return [];
    }

    return panels.map(panel => {
        const panelData = panel?.toObject ? panel.toObject() : { ...panel };
        return {
            ...panelData,
            imageUrl: getPanelImageUrl(storyId, chapterId, panelData),
            imageData: undefined,
            imageMimeType: undefined
        };
    });
}

function buildStoryResponse(story, purchases = [], currentUserId = null, currentUserRole = null) {
    const storyData = typeof story.toObject === 'function' ? story.toObject() : story;
    const authorId = story.author?._id ? story.author._id.toString() : story.author.toString();
    const isAuthor = currentUserId ? authorId === currentUserId.toString() : false;
    const isCreator = currentUserRole && ['artist', 'writer', 'editor'].includes(currentUserRole);
    const hasFullStoryPurchase = purchases.some(purchase => purchase.purchaseType === 'full_story');
    const purchasedChapterIds = purchases
        .map(purchase => purchase.chapter ? purchase.chapter.toString() : null)
        .filter(Boolean);

    const chapters = storyData.chapters.map(chapter => {
        const chapterId = chapter._id.toString();
        const isFree = chapter.order <= 2;
        const hasAccess = isAuthor || isCreator || hasFullStoryPurchase || isFree || purchasedChapterIds.includes(chapterId);

        return {
            _id: chapter._id,
            title: chapter.title,
            order: chapter.order,
            isFree,
            hasAccess,
            content: hasAccess ? chapter.content : '',
            panels: mapPanelsForResponse(storyData._id, chapter._id, chapter.panels)
        };
    });

    return {
        ...storyData,
        coverImage: getStoryCoverImageUrl(storyData),
        createdBy: buildCreatedBy(storyData),
        chapters,
        isAuthor,
        hasFullStoryPurchase,
        purchases: purchases.map(purchase => ({
            chapter: purchase.chapter ? purchase.chapter.toString() : null,
            purchaseType: purchase.purchaseType
        }))
    };
}

async function enrichStoryProjectBoard(storyDocument) {
    const story = typeof storyDocument.toObject === 'function' ? storyDocument.toObject() : storyDocument;

    const existingProjectPanels = normalizeProjectPanels(
        story.projectBoard?.panels || [],
        story.projectBoard?.canvasPreview || '',
        story.projectBoard?.artwork || []
    );

    if (
        story.projectBoard &&
        (
            existingProjectPanels.length ||
            story.projectBoard.canvasPreview ||
            (story.projectBoard.artwork && story.projectBoard.artwork.length) ||
            story.projectBoard.synopsis
        )
    ) {
        story.projectBoard.panels = existingProjectPanels;
        if (Array.isArray(story.chapters) && story.chapters.length) {
            story.chapters = story.chapters.map((chapter, index) => ({
                ...chapter,
                panels: Array.isArray(chapter.panels) && chapter.panels.length
                    ? chapter.panels
                    : (index === 0 ? existingProjectPanels : [])
            }));
        }
        return story;
    }

    if (!story.sourceCollaboration) {
        return story;
    }

    const collaboration = await Collaboration.findById(story.sourceCollaboration).lean();
    if (!collaboration) {
        return story;
    }

    const workspace = collaboration.room
        ? await Workspace.findOne({ room: collaboration.room }).lean()
        : null;

    story.projectBoard = {
        synopsis: collaboration.storySynopsis || collaboration.description || story.projectBoard?.synopsis || '',
        finalNotes: collaboration.storyContent || story.projectBoard?.finalNotes || '',
        canvasPreview: workspace?.canvasState || story.projectBoard?.canvasPreview || '',
        panels: normalizeProjectPanels(
            story.projectBoard?.panels || collaboration.chapterPanels || story.chapters?.[0]?.panels || [],
            workspace?.canvasState || story.projectBoard?.canvasPreview || '',
            workspace?.assets || story.projectBoard?.artwork || []
        ),
        artwork: (workspace?.assets || [])
            .filter(asset => String(asset.type || '').startsWith('image/'))
            .map(asset => ({
                name: asset.name,
                url: asset.url,
                type: asset.type
            }))
    };

    if (Array.isArray(story.chapters) && story.chapters.length) {
        story.chapters = story.chapters.map((chapter, index) => ({
            ...chapter,
            panels: Array.isArray(chapter.panels) && chapter.panels.length
                ? chapter.panels
                : (index === 0 ? story.projectBoard.panels : [])
        }));
    }

    return story;
}

router.get('/published', async (req, res) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 24), 60);
        const skip = (page - 1) * limit;

        const stories = await Story.find({ isPublished: true })
            .populate('author', 'name username profilePicture')
            .populate({
                path: 'sourceCollaboration',
                populate: [
                    { path: 'artist', select: 'name username profilePicture' },
                    { path: 'writer', select: 'name username profilePicture' }
                ]
            })
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 });

        res.json(stories.map(mapPreviewStory));
    } catch (error) {
        console.error('Error fetching published stories:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/mine', auth, async (req, res) => {
    try {
        const stories = await Story.find({ author: req.user.id }).sort({ updatedAt: -1 });
        const mappedStories = stories.map(story => {
            const data = story.toObject();
            data.coverImage = getStoryCoverImageUrl(data);
            data.chapters = (data.chapters || []).map(chapter => ({
                ...chapter,
                panels: mapPanelsForResponse(data._id, chapter._id, chapter.panels)
            }));
            return data;
        });
        res.json(mappedStories);
    } catch (error) {
        console.error('Error fetching author stories:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/public/:id', async (req, res) => {
    try {
        let story = await Story.findOne({ _id: req.params.id, isPublished: true })
            .populate('author', 'name username profilePicture')
            .populate({
                path: 'sourceCollaboration',
                populate: [
                    { path: 'artist', select: 'name username profilePicture' },
                    { path: 'writer', select: 'name username profilePicture' }
                ]
            });

        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        story = await enrichStoryProjectBoard(story);
        res.json(buildStoryResponse(story));
    } catch (error) {
        console.error('Error fetching public story:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id', auth, async (req, res) => {
    try {
        let story = await Story.findById(req.params.id)
            .populate('author', 'name username profilePicture')
            .populate({
                path: 'sourceCollaboration',
                populate: [
                    { path: 'artist', select: 'name username profilePicture' },
                    { path: 'writer', select: 'name username profilePicture' }
                ]
            });

        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        const purchases = await Purchase.find({
            consumer: req.user.id,
            story: req.params.id
        });

        story = await enrichStoryProjectBoard(story);
        res.json(buildStoryResponse(story, purchases, req.user.id, req.user.role));
    } catch (error) {
        console.error('Error fetching story:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', auth, coverUpload.single('coverImage'), async (req, res) => {
    try {
        const { title, description, genre, price } = req.body;

        if (req.user.role === 'consumer') {
            return res.status(403).json({ error: 'Consumers cannot create stories' });
        }

        const story = new Story({
            title,
            description,
            genre,
            price: Number(price) || 0,
            coverImage: 'images/work1.jpeg',
            author: req.user.id,
            chapters: normalizeChapters(parseChapters(req.body.chapters))
        });

        if (req.file) {
            const uploaded = await uploadBuffer(req.file.buffer, {
                folder: 'story-covers',
                resourceType: 'image'
            });
            story.coverImage = uploaded.secure_url;
        }

        await story.save();
        res.status(201).json(story);
    } catch (error) {
        console.error('Error creating story:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/:id/chapters', auth, async (req, res) => {
    try {
        const story = await Story.findById(req.params.id);

        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        if (story.author.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const { title, content } = req.body;
        const chapterOrder = story.chapters.length + 1;

        story.chapters.push({
            title,
            content,
            isFree: chapterOrder <= 2,
            order: chapterOrder
        });

        await story.save();
        res.status(201).json(story.chapters[story.chapters.length - 1]);
    } catch (error) {
        console.error('Error adding chapter:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id', auth, coverUpload.single('coverImage'), async (req, res) => {
    try {
        const story = await Story.findById(req.params.id);

        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        if (story.author.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const { title, description, genre, isPublished, price } = req.body;
        const chapters = parseChapters(req.body.chapters);

        if (title) story.title = title;
        if (description) story.description = description;
        if (genre) story.genre = genre;
        if (price !== undefined) story.price = Number(price) || 0;
        if (isPublished !== undefined) story.isPublished = isPublished === true || isPublished === 'true';
        if (req.file) {
            const uploaded = await uploadBuffer(req.file.buffer, {
                folder: 'story-covers',
                resourceType: 'image'
            });
            story.coverImage = uploaded.secure_url;
        }
        if (chapters.length) story.chapters = normalizeChapters(chapters);

        await story.save();
        res.json(story);
    } catch (error) {
        console.error('Error updating story:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id/publish', auth, async (req, res) => {
    try {
        const story = await Story.findById(req.params.id);

        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        if (story.author.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (!story.chapters.length) {
            return res.status(400).json({ error: 'Story must have at least one chapter to be published' });
        }

        story.chapters = normalizeChapters(story.chapters);
        story.isPublished = true;
        await story.save();

        res.json({ message: 'Story published successfully', story });
    } catch (error) {
        console.error('Error publishing story:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/:id', auth, async (req, res) => {
    try {
        const story = await Story.findById(req.params.id);

        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        if (story.author.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await Story.findByIdAndDelete(req.params.id);
        res.json({ message: 'Story deleted successfully' });
    } catch (error) {
        console.error('Error deleting story:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



// GET /api/stories/:id/stats — aggregate total likes + comments across all chapters (public)
router.get('/:id/stats', async (req, res) => {
    try {
        const story = await Story.findOne({ _id: req.params.id, isPublished: true })
            .select('chapters');
        if (!story) return res.status(404).json({ error: 'Story not found' });

        // Sum likes across all chapters
        const totalLikes = story.chapters.reduce((sum, ch) => sum + (ch.likes?.length || 0), 0);

        // Count all comments for this story across all chapters
        const totalComments = await Comment.countDocuments({ story: req.params.id });

        res.json({ totalLikes, totalComments });
    } catch (error) {
        console.error('Error fetching story stats:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/stories/:id/chapters/:chapterId/like — toggle chapter like (authenticated)
router.post('/:id/chapters/:chapterId/like', auth, async (req, res) => {
    try {
        const story = await Story.findOne({ _id: req.params.id, isPublished: true })
            .select('chapters');
        if (!story) return res.status(404).json({ error: 'Story not found or not published' });

        const chapter = story.chapters.id(req.params.chapterId);
        if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

        const userId = req.user.id;
        const alreadyLiked = chapter.likes.some(id => id.toString() === userId);

        if (alreadyLiked) {
            chapter.likes.pull(userId);
        } else {
            chapter.likes.push(userId);
        }

        await story.save();
        res.json({ liked: !alreadyLiked, count: chapter.likes.length });
    } catch (error) {
        console.error('Error toggling chapter like:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/stories/:id/chapters/:chapterId/likes — public like count + whether current user liked
router.get('/:id/chapters/:chapterId/likes', async (req, res) => {
    try {
        const story = await Story.findOne({ _id: req.params.id, isPublished: true })
            .select('chapters');
        if (!story) return res.status(404).json({ error: 'Story not found' });

        const chapter = story.chapters.id(req.params.chapterId);
        if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

        let liked = false;
        try {
            const jwt = require('jsonwebtoken');
            const cookieHeader = req.headers.cookie || '';
            const authCookie = cookieHeader.split(';').map(p => p.trim()).find(p => p.startsWith('ps_auth='));
            const token = authCookie
                ? decodeURIComponent(authCookie.split('=').slice(1).join('='))
                : (req.header('Authorization') || '').replace(/^Bearer\\s+/i, '').trim();

            if (token && process.env.JWT_SECRET) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                liked = chapter.likes.some(id => id.toString() === decoded.userId.toString());
            }
        } catch (_) { /* unauthenticated */ }

        res.json({ count: chapter.likes.length, liked });
    } catch (error) {
        console.error('Error fetching chapter likes:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
