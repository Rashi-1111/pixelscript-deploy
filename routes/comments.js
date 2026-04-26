const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const Story = require('../models/Story');
const auth = require('../middleware/auth');

const MAX_COMMENTS_PER_PAGE = 50;

// GET /api/comments/:storyId/:chapterId — list comments for a chapter (paginated, newest first)
router.get('/:storyId/:chapterId', auth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_COMMENTS_PER_PAGE);
        const skip = (page - 1) * limit;

        const [comments, total] = await Promise.all([
            Comment.find({ story: req.params.storyId, chapter: req.params.chapterId })
                .populate('author', 'name username profilePicture')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Comment.countDocuments({ story: req.params.storyId, chapter: req.params.chapterId })
        ]);

        res.json({ comments, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/comments/:storyId/:chapterId/count — public comment count (no auth required)
router.get('/:storyId/:chapterId/count', async (req, res) => {
    try {
        const count = await Comment.countDocuments({
            story: req.params.storyId,
            chapter: req.params.chapterId
        });
        res.json({ count });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/comments/:storyId/:chapterId — post a comment on a published chapter
router.post('/:storyId/:chapterId', auth, async (req, res) => {
    try {
        const text = String(req.body.text || '').trim();

        if (!text) return res.status(400).json({ error: 'Comment text is required' });
        if (text.length > 1000) return res.status(400).json({ error: 'Comment must be 1000 characters or fewer' });

        // Verify story is published and chapter exists
        const story = await Story.findOne({ _id: req.params.storyId, isPublished: true })
            .select('chapters');
        if (!story) return res.status(404).json({ error: 'Story not found or not published' });

        const chapter = story.chapters.id(req.params.chapterId);
        if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

        const comment = await Comment.create({
            story: req.params.storyId,
            chapter: req.params.chapterId,
            author: req.user.id,
            text
        });

        await comment.populate('author', 'name username profilePicture');
        res.status(201).json(comment);
    } catch (error) {
        console.error('Error posting comment:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/comments/:commentId — delete own comment, or story author deletes any
router.delete('/:commentId', auth, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.commentId).populate('story', 'author');
        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        const isCommentAuthor = comment.author.toString() === req.user.id;
        const isStoryAuthor = comment.story?.author?.toString() === req.user.id;

        if (!isCommentAuthor && !isStoryAuthor) {
            return res.status(403).json({ error: 'Not authorized to delete this comment' });
        }

        await Comment.findByIdAndDelete(req.params.commentId);
        res.json({ message: 'Comment deleted' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
