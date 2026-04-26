const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Purchase = require('../models/Purchase');
const Story = require('../models/Story');
const auth = require('../middleware/auth');

const CHAPTER_UNLOCK_PRICE_INR = 1;

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

function getPurchaseAmount(story, purchaseType, chapterId) {
    if (purchaseType === 'chapter') {
        const chapter = story.chapters.id(chapterId);
        if (!chapter) {
            return { error: 'Chapter not found' };
        }
        if ((chapter.order || 0) <= 2 || chapter.isFree) {
            return { error: 'Chapter is free' };
        }
        return { amount: CHAPTER_UNLOCK_PRICE_INR, chapter };
    }

    if (purchaseType === 'full_story') {
        const paidChapters = story.chapters.filter(ch => !(ch.order <= 2 || ch.isFree));
        return { amount: paidChapters.length * CHAPTER_UNLOCK_PRICE_INR };
    }

    return { error: 'Invalid purchase type' };
}

async function findExistingPurchase(userId, storyId, chapterId) {
    return Purchase.findOne({
        consumer: userId,
        story: storyId,
        status: 'completed',
        $or: [
            { purchaseType: 'full_story' },
            ...(chapterId ? [{ chapter: chapterId }] : [])
        ]
    });
}

function buildReceiptId(purchaseType, storyId, chapterId) {
    const prefix = purchaseType === 'full_story' ? 'full' : 'chap';
    const storyToken = String(storyId || '').slice(-8);
    const chapterToken = chapterId ? String(chapterId).slice(-6) : 'all';
    const timeToken = Date.now().toString(36);
    return `${prefix}_${storyToken}_${chapterToken}_${timeToken}`.slice(0, 40);
}

router.get('/', auth, async (req, res) => {
    try {
        const purchases = await Purchase.find({ consumer: req.user.id, status: 'completed' })
            .populate('story', 'title coverImage author')
            .populate('chapter', 'title')
            .sort({ purchasedAt: -1 });

        res.json(purchases);
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/razorpay-key', auth, (req, res) => {
    if (!process.env.RAZORPAY_KEY_ID) {
        return res.status(500).json({ error: 'Razorpay key is not configured' });
    }

    res.json({ key: process.env.RAZORPAY_KEY_ID });
});

router.post('/create-order', auth, async (req, res) => {
    try {
        const { storyId, chapterId, purchaseType } = req.body;

        if (!['chapter', 'full_story'].includes(purchaseType)) {
            return res.status(400).json({ error: 'Invalid purchase type' });
        }

        const story = await Story.findById(storyId);
        if (!story || !story.isPublished) {
            return res.status(404).json({ error: 'Story not found or not published' });
        }

        const existingPurchase = await findExistingPurchase(req.user.id, storyId, chapterId);
        if (existingPurchase) {
            return res.status(400).json({ error: 'Already purchased' });
        }

        const { amount, error } = getPurchaseAmount(story, purchaseType, chapterId);
        if (error) {
            return res.status(400).json({ error });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid purchase amount' });
        }

        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100),
            currency: 'INR',
            receipt: buildReceiptId(purchaseType, storyId, chapterId),
            notes: {
                storyId,
                chapterId: chapterId || '',
                purchaseType,
                consumerId: req.user.id
            }
        });

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            purchaseType,
            storyId,
            chapterId: chapterId || null
        });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

router.post('/verify-payment', auth, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            storyId,
            chapterId,
            purchaseType
        } = req.body;

        if (!['chapter', 'full_story'].includes(purchaseType)) {
            return res.status(400).json({ error: 'Invalid purchase type' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        const story = await Story.findById(storyId);
        if (!story || !story.isPublished) {
            return res.status(404).json({ error: 'Story not found or not published' });
        }

        const existingPurchase = await findExistingPurchase(req.user.id, storyId, chapterId);
        if (existingPurchase) {
            return res.json({ success: true, message: 'Already purchased', purchase: existingPurchase });
        }

        const { amount, error } = getPurchaseAmount(story, purchaseType, chapterId);
        if (error) {
            return res.status(400).json({ error });
        }

        const purchase = new Purchase({
            consumer: req.user.id,
            story: storyId,
            ...(chapterId ? { chapter: chapterId } : {}),
            purchaseType,
            amount,
            paymentMethod: 'razorpay',
            paymentId: razorpay_payment_id,
            razorpayOrderId: razorpay_order_id,
            razorpaySignature: razorpay_signature,
            status: 'completed'
        });

        await purchase.save();

        res.json({ success: true, message: 'Payment verified and purchase completed', purchase });
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

router.get('/access/:storyId/:chapterId?', auth, async (req, res) => {
    try {
        const { storyId, chapterId } = req.params;

        const story = await Story.findById(storyId);
        if (!story) {
            return res.status(404).json({ error: 'Story not found' });
        }

        const isAuthor = story.author.toString() === req.user.id;
        if (isAuthor) {
            return res.json({ hasAccess: true, reason: 'author' });
        }

        if (chapterId) {
            const chapter = story.chapters.id(chapterId);
            if (!chapter) {
                return res.status(404).json({ error: 'Chapter not found' });
            }

            if ((chapter.order || 0) <= 2 || chapter.isFree) {
                return res.json({ hasAccess: true, reason: 'free' });
            }

            const purchase = await Purchase.findOne({
                consumer: req.user.id,
                story: storyId,
                status: 'completed',
                $or: [
                    { chapter: chapterId },
                    { purchaseType: 'full_story' }
                ]
            });

            return res.json({
                hasAccess: !!purchase,
                reason: purchase ? (purchase.purchaseType === 'full_story' ? 'full_story_purchased' : 'purchased') : 'not_purchased'
            });
        }

        const purchases = await Purchase.find({
            consumer: req.user.id,
            story: storyId,
            status: 'completed'
        });

        const hasFullAccess = purchases.some(purchase => purchase.purchaseType === 'full_story');
        return res.json({
            hasAccess: hasFullAccess,
            reason: hasFullAccess ? 'full_story_purchased' : 'not_purchased'
        });
    } catch (error) {
        console.error('Error checking access:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
