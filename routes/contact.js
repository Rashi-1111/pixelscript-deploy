const router = require('express').Router();
const Contact = require('../models/Contact');
const auth = require('../middleware/auth');
const nodemailer = require('nodemailer');

const PIXELSCRIPT_EMAIL = 'pixelscript.info@gmail.com';

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    return next();
}

function getTransporter() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
    try {
        return nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    } catch (e) {
        console.warn('Nodemailer transport error:', e.message);
        return null;
    }
}

// POST /api/contact — submit contact form, send to pixelscript.info@gmail.com
router.post('/', async (req, res) => {
    try {
        const { name, username, email, subject, message } = req.body;
        if (!name || !message) {
            return res.status(400).json({ message: 'Name and message are required' });
        }

        // Save to DB
        const contact = new Contact({ name, email, subject, message });
        await contact.save();

        // Send email
        const transporter = getTransporter();
        if (transporter) {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: PIXELSCRIPT_EMAIL,
                subject: `PixelScript Contact: ${subject || 'New Message'} — from ${username || name}`,
                html: `
                    <h2 style="color:#3f6d71;">New Contact Form Submission</h2>
                    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:15px;">
                        <tr><td style="padding:8px;font-weight:bold;">Name</td><td style="padding:8px;">${name}</td></tr>
                        ${username ? `<tr><td style="padding:8px;font-weight:bold;">Username</td><td style="padding:8px;">@${username}</td></tr>` : ''}
                        ${email ? `<tr><td style="padding:8px;font-weight:bold;">Email</td><td style="padding:8px;">${email}</td></tr>` : ''}
                        <tr><td style="padding:8px;font-weight:bold;">Subject</td><td style="padding:8px;">${subject || '—'}</td></tr>
                        <tr><td style="padding:8px;font-weight:bold;vertical-align:top;">Message</td><td style="padding:8px;white-space:pre-wrap;">${message}</td></tr>
                    </table>
                `
            });
        }

        res.status(201).json({ message: 'Your message has been sent successfully!' });
    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({ message: 'Error sending message. Please try again.' });
    }
});

// POST /api/contact/review — submit a platform review (authenticated users only)
router.post('/review', auth, async (req, res) => {
    try {
        const { rating, text } = req.body;
        if (!text || !rating) return res.status(400).json({ message: 'Rating and review text required' });
        if (rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be 1–5' });
        if (text.length > 800) return res.status(400).json({ message: 'Review must be 800 chars or less' });

        // Save as a contact record tagged as a review
        const review = new Contact({
            name: req.user.name || req.user.username || 'Anonymous',
            email: req.user.email || '',
            subject: 'PLATFORM_REVIEW',
            message: text,
            rating: Number(rating),
            userId: req.user.id,
            avatar: req.user.profilePicture || '',
            role: req.user.role || ''
        });
        await review.save();

        res.status(201).json({
            _id: review._id,
            name: review.name,
            avatar: review.avatar,
            rating: review.rating,
            role: review.role,
            message: review.message,
            createdAt: review.createdAt
        });
    } catch (error) {
        console.error('Review error:', error);
        res.status(500).json({ message: 'Error saving review' });
    }
});

// GET /api/contact/reviews — public endpoint to list approved platform reviews
router.get('/reviews', async (req, res) => {
    try {
        const reviews = await Contact.find({ subject: 'PLATFORM_REVIEW' })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();
        res.json(reviews);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching reviews' });
    }
});

// GET /api/contact — admin: all contact submissions
router.get('/', auth, requireAdmin, async (req, res) => {
    try {
        const contacts = await Contact.find({ subject: { $ne: 'PLATFORM_REVIEW' } }).sort({ createdAt: -1 });
        res.json(contacts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching contact submissions' });
    }
});

// PUT /api/contact/:id — admin: update contact status
router.put('/:id', auth, requireAdmin, async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
        if (!contact) return res.status(404).json({ message: 'Not found' });
        res.json(contact);
    } catch (error) {
        res.status(500).json({ message: 'Error updating contact' });
    }
});

module.exports = router;
