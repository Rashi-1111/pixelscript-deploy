const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Work = require('../models/Work');
const Collaboration = require('../models/Collaboration');
const auth = require('../middleware/auth');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { uploadBuffer } = require('../services/cloudinary');

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET environment variable');
}

const AUTH_COOKIE_NAME = 'ps_auth';
const AUTH_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
};

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many authentication attempts. Please try again later.' }
});

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedDocumentTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];
const allowedRoles = ['artist', 'writer', 'editor', 'admin', 'consumer'];

const profileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter(req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only images are allowed for profile pictures'));
        }
        cb(null, true);
    }
});

const collaborationFileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter(req, file, cb) {
        if (!allowedDocumentTypes.includes(file.mimetype)) {
            return cb(new Error('Invalid file type. Only images, PDFs, and Word documents are allowed.'));
        }
        cb(null, true);
    }
});

const workUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter(req, file, cb) {
        if (!allowedDocumentTypes.includes(file.mimetype)) {
            return cb(new Error('Invalid file type. Only images, PDFs, and Word documents are allowed.'));
        }
        cb(null, true);
    }
});

function parseArrayField(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }

    if (typeof value === 'string') {
        try {
            const parsedValue = JSON.parse(value);
            return Array.isArray(parsedValue) ? parsedValue.filter(Boolean) : [];
        } catch (error) {
            return value
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
        }
    }

    return [];
}

function sanitizeUser(user) {
    return {
        _id: user._id,
        id: user._id.toString(),
        username: user.username,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        about: user.about || '',
        bio: user.bio || '',
        role: user.role,
        genres: user.genres || [],
        country: user.country || '',
        ageGroup: user.ageGroup || '',
        experience: user.experience || '',
        skills: user.skills || [],
        featuredWorks: (user.featuredWorks || []).map(workId => workId.toString()),
        featuredCollaborations: (user.featuredCollaborations || []).map(collabId => collabId.toString()),
        profileCompletion: user.profileCompletion || 0,
        createdAt: user.createdAt
    };
}

function sanitizeWork(work, options = {}) {
    const featuredSet = options.featuredSet || new Set();

    return {
        _id: work._id,
        title: work.title,
        description: work.description,
        mimeType: work.mimeType,
        fileType: work.fileType,
        createdAt: work.createdAt,
        isFeatured: featuredSet.has(work._id.toString()),
        fileUrl: work.fileUrl || `/api/users/works/${work._id}/file`
    };
}

// Login user
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        await user.updateLastActive();

        const token = jwt.sign(
            { userId: user._id, role: user.role },
            jwtSecret,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

        res.json({
            success: true,
            message: 'Login successful',
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: AUTH_COOKIE_OPTIONS.httpOnly,
        secure: AUTH_COOKIE_OPTIONS.secure,
        sameSite: AUTH_COOKIE_OPTIONS.sameSite,
        path: AUTH_COOKIE_OPTIONS.path
    });

    res.json({ success: true, message: 'Logged out' });
});

// Register new user
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { username, email, password, name, role } = req.body;

        if (!username || !email || !password || !name || !role) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        const normalizedRole = String(role).toLowerCase();
        if (!allowedRoles.includes(normalizedRole)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role selected'
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        const existingUser = await User.findOne({
            $or: [
                { email: email.toLowerCase() },
                { username: username.toLowerCase() }
            ]
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email or username'
            });
        }

        const user = new User({
            username: username.toLowerCase(),
            email: email.toLowerCase(),
            password,
            name,
            role: normalizedRole,
            profilePicture: 'images/default-avatar.png'
        });

        await user.save();

        res.status(201).json({
            success: true,
            message: 'Registration successful! Please login.'
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error during registration'
        });
    }
});

// Get current user's profile
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(sanitizeUser(user));
    } catch (error) {
        console.error('Error in /me endpoint:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/public/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('name username role bio about genres country ageGroup experience skills profilePicture works featuredWorks featuredCollaborations')
            .lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const workIds = (user.works || []).map(id => id.toString());
        const featuredIds = (user.featuredWorks || []).map(id => id.toString());
        const featuredSet = new Set(featuredIds);
        const works = await Work.find({ _id: { $in: workIds } }).sort('-createdAt').lean();
        const worksById = new Map(works.map(work => [work._id.toString(), work]));

        const featuredWorks = featuredIds
            .map(id => worksById.get(id))
            .filter(Boolean)
            .map(work => ({
                _id: work._id,
                title: work.title,
                description: work.description,
                fileType: work.fileType,
                fileUrl: work.fileUrl || `/api/users/public/${user._id}/works/${work._id}/file`
            }));

        const featuredCollabIds = (user.featuredCollaborations || []).map(id => id.toString());
        const featuredCollabs = await Collaboration.find({
            _id: { $in: featuredCollabIds },
            status: 'completed',
            $or: [{ artist: user._id }, { writer: user._id }]
        })
            .select('title storyTitle storySynopsis description coverImage chapterNumber publishRequest.story')
            .populate('publishRequest.story', '_id coverImage title')
            .lean();

        const collabById = new Map(featuredCollabs.map(collab => [collab._id.toString(), collab]));
        const featuredCollaborations = featuredCollabIds
            .map(id => collabById.get(id))
            .filter(Boolean)
            .map(collab => ({
                _id: collab._id,
                title: collab.storyTitle || collab.title || `Chapter ${collab.chapterNumber || 1}`,
                description: collab.storySynopsis || collab.description || '',
                fileType: 'image',
                fileUrl: collab.publishRequest?.story?.coverImage || collab.coverImage || 'images/default-cover.png',
                publishedStoryId: collab.publishRequest?.story?._id ? String(collab.publishRequest.story._id) : '',
                collaborationId: String(collab._id)
            }));

        const allWorks = works.map(work => ({
            _id: work._id,
            title: work.title,
            description: work.description,
            fileType: work.fileType,
            isFeatured: featuredSet.has(work._id.toString()),
            fileUrl: work.fileUrl || `/api/users/public/${user._id}/works/${work._id}/file`
        }));

        const collaborationCount = await Collaboration.countDocuments({
            status: { $in: ['active', 'completed'] },
            $or: [{ artist: user._id }, { writer: user._id }]
        });

        res.json({
            _id: user._id,
            name: user.name || user.username,
            username: user.username,
            role: user.role,
            about: user.about || user.bio || '',
            bio: user.bio || '',
            genres: user.genres || [],
            country: user.country || '',
            ageGroup: user.ageGroup || '',
            experience: user.experience || '',
            skills: user.skills || [],
            profilePicture: user.profilePicture || 'images/default-avatar.png',
            stats: {
                worksCount: works.length,
                featuredCount: featuredWorks.length + featuredCollaborations.length,
                collaborationsCount: collaborationCount
            },
            featuredWorks,
            featuredCollaborations,
            works: allWorks
        });
    } catch (error) {
        console.error('Error fetching public profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update profile
router.put('/profile', auth, async (req, res) => {
    try {
        const { name, about, bio, role, country, ageGroup, experience } = req.body;
        const genres = parseArrayField(req.body.genres);
        const skills = parseArrayField(req.body.skills);
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (typeof name === 'string' && name.trim()) {
            user.name = name.trim();
        }
        if (about !== undefined) {
            user.about = String(about).trim();
        }
        if (bio !== undefined) {
            user.bio = String(bio).trim();
        }
        if (role) {
            const normalizedRole = String(role).toLowerCase();
            if (!allowedRoles.includes(normalizedRole)) {
                return res.status(400).json({ error: 'Invalid role selected' });
            }
            user.role = normalizedRole;
        }

        if (country !== undefined) {
            user.country = String(country || '').trim();
        }

        if (ageGroup !== undefined) {
            const normalizedAgeGroup = String(ageGroup || '').trim();
            const allowedAgeGroups = new Set(['18-24', '25-34', '35-44', '45+', '']);
            if (!allowedAgeGroups.has(normalizedAgeGroup)) {
                return res.status(400).json({ error: 'Invalid age group selected' });
            }
            user.ageGroup = normalizedAgeGroup;
        }

        if (experience !== undefined) {
            const normalizedExperience = String(experience || '').trim();
            const allowedExperience = new Set(['0-1', '1-5', '5-10', '10+', '']);
            if (!allowedExperience.has(normalizedExperience)) {
                return res.status(400).json({ error: 'Invalid experience range selected' });
            }
            user.experience = normalizedExperience;
        }

        user.genres = genres;
        user.skills = skills;

        await user.save();

        res.json(sanitizeUser(user));
    } catch (error) {
        console.error('Error updating profile:', error);
        if (error && error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message || 'Invalid profile data' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// Update user settings
router.put('/settings', auth, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: { settings: req.body } },
            { new: true }
        ).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Error updating settings' });
    }
});

// Get user's works
router.get('/works', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('featuredWorks');
        const featuredSet = new Set((user?.featuredWorks || []).map(id => id.toString()));
        const works = await Work.find({ user: req.user.id }).sort('-createdAt');
        res.json(works.map(work => sanitizeWork(work, { featuredSet })));
    } catch (error) {
        console.error('Error fetching works:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/featured-works', auth, async (req, res) => {
    try {
        const incomingWorkIds = Array.isArray(req.body.workIds) ? req.body.workIds : [];
        const uniqueIds = [...new Set(incomingWorkIds.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 6);

        const ownedWorks = await Work.find({
            _id: { $in: uniqueIds },
            user: req.user.id
        }).select('_id');
        const ownedSet = new Set(ownedWorks.map(work => work._id.toString()));
        const validWorkIds = uniqueIds.filter(id => ownedSet.has(id));

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.featuredWorks = validWorkIds;
        await user.save();

        res.json({ featuredWorks: (user.featuredWorks || []).map(id => id.toString()) });
    } catch (error) {
        console.error('Error updating featured works:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/published-collaborations', auth, async (req, res) => {
    try {
        const collaborations = await Collaboration.find({
            status: 'completed',
            $or: [{ artist: req.user.id }, { writer: req.user.id }]
        })
            .select('title storyTitle storySynopsis description coverImage chapterNumber publishRequest.story updatedAt createdAt')
            .populate('publishRequest.story', '_id coverImage title')
            .sort('-updatedAt')
            .lean();

        res.json(collaborations.map(collab => ({
            _id: collab._id,
            title: collab.storyTitle || collab.title || `Chapter ${collab.chapterNumber || 1}`,
            description: collab.storySynopsis || collab.description || '',
            coverImage: collab.publishRequest?.story?.coverImage || collab.coverImage || 'images/default-cover.png',
            chapterNumber: collab.chapterNumber || 1,
            publishedStoryId: collab.publishRequest?.story?._id ? String(collab.publishRequest.story._id) : '',
            updatedAt: collab.updatedAt,
            createdAt: collab.createdAt
        })));
    } catch (error) {
        console.error('Error fetching published collaborations:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/featured-collaborations', auth, async (req, res) => {
    try {
        const incomingIds = Array.isArray(req.body.collaborationIds) ? req.body.collaborationIds : [];
        const uniqueIds = [...new Set(incomingIds.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 6);

        const chapterSuffixPattern = /\s*-\s*chapter\s*\d+\s*$/i;
        const normalizeStoryKey = collaboration => {
            const publishedStoryId = collaboration?.publishRequest?.story
                ? String(collaboration.publishRequest.story)
                : '';

            if (publishedStoryId) {
                return `story:${publishedStoryId}`;
            }

            const normalizedTitle = String(collaboration?.storyTitle || collaboration?.title || '')
                .trim()
                .replace(chapterSuffixPattern, '')
                .trim()
                .toLowerCase();

            return normalizedTitle ? `title:${normalizedTitle}` : '';
        };

        const published = await Collaboration.find({
            _id: { $in: uniqueIds },
            status: 'completed',
            $or: [{ artist: req.user.id }, { writer: req.user.id }]
        }).select('_id storyTitle title publishRequest.story');

        const validSet = new Set(published.map(item => item._id.toString()));
        const validIds = uniqueIds.filter(id => validSet.has(id));

        const byId = new Map(published.map(item => [item._id.toString(), item]));
        const seenStories = new Set();
        for (const id of validIds) {
            const collaboration = byId.get(id);
            const storyKey = normalizeStoryKey(collaboration);
            if (!storyKey) {
                continue;
            }

            if (seenStories.has(storyKey)) {
                return res.status(400).json({
                    error: 'Another chapter from this same story is already featured. You cannot feature two chapters of the same story.'
                });
            }

            seenStories.add(storyKey);
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.featuredCollaborations = validIds;
        await user.save();

        res.json({ featuredCollaborations: (user.featuredCollaborations || []).map(id => id.toString()) });
    } catch (error) {
        console.error('Error updating featured collaborations:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user's collaborations
router.get('/collaborations', auth, async (req, res) => {
    try {
        const collaborations = await Collaboration.find({
            $or: [
                { artist: req.user.id },
                { writer: req.user.id }
            ]
        })
        .populate('artist', 'name profilePicture')
        .populate('writer', 'name profilePicture')
        .sort('-createdAt');

        res.json(collaborations);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching collaborations' });
    }
});

// Update collaboration progress
router.put('/collaborations/:id/progress', auth, async (req, res) => {
    try {
        const collaboration = await Collaboration.findById(req.params.id);
        
        if (!collaboration) {
            return res.status(404).json({ error: 'Collaboration not found' });
        }

        // Check if user is part of the collaboration
        if (collaboration.artist.toString() !== req.user.id && 
            collaboration.writer.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        collaboration.progress = req.body.progress;
        await collaboration.save();

        res.json(collaboration);
    } catch (error) {
        res.status(500).json({ error: 'Error updating progress' });
    }
});

// Add file to collaboration
router.post('/collaborations/:id/files', auth, collaborationFileUpload.single('file'), async (req, res) => {
    try {
        const collaboration = await Collaboration.findById(req.params.id);
        
        if (!collaboration) {
            return res.status(404).json({ error: 'Collaboration not found' });
        }

        // Check if user is part of the collaboration
        if (collaboration.artist.toString() !== req.user.id && 
            collaboration.writer.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const uploaded = await uploadBuffer(req.file.buffer, {
            folder: 'collaboration-files',
            resourceType: 'auto'
        });

        collaboration.files.push({
            name: req.file.originalname,
            url: uploaded.secure_url,
            type: uploaded.resource_type || req.file.mimetype,
            uploadedBy: req.user.id
        });

        await collaboration.save();
        res.json(collaboration);
    } catch (error) {
        res.status(500).json({ error: 'Error adding file' });
    }
});

// Get user matches
router.get('/matches', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate('matches.user', 'name profilePicture role');
        res.json(user.matches);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Discover users for matching UI (real data source) using KNN algorithm
router.get('/discover', auth, async (req, res) => {
    try {
        const role = String(req.query.role || '').trim().toLowerCase();
        const genre = String(req.query.genre || '').trim().toLowerCase();
        const country = String(req.query.country || '').trim().toLowerCase();
        const ageGroup = String(req.query.ageGroup || '').trim();
        const experience = String(req.query.experience || '').trim();

        // 1. Fetch Candidates (Hard filter on Role)
        const query = {
            _id: { $ne: req.user.id }
        };

        if (role && allowedRoles.includes(role)) {
            query.role = role;
        }

        const candidates = await User.find(query)
            .select('name username role profilePicture bio about genres country ageGroup experience skills createdAt')
            .limit(1000); // Fetch a sufficient pool for KNN scoring

        // 2. KNN Feature Weights & Scaling
        const WEIGHTS = {
            genre: 4.0,
            experience: 2.0,
            country: 1.0,
            ageGroup: 1.0
        };

        // Calculate maximum theoretical distance for normalizing to 0-100%
        const maxPossibleDistanceSq = Math.pow(1 * WEIGHTS.genre, 2) + 
                                      Math.pow(3 * WEIGHTS.experience, 2) + 
                                      Math.pow(1 * WEIGHTS.country, 2) + 
                                      Math.pow(3 * WEIGHTS.ageGroup, 2);
        const maxDistance = Math.sqrt(maxPossibleDistanceSq);

        // Ordinal mappings
        const ageMap = { '18-24': 1, '25-34': 2, '35-44': 3, '45+': 4, '': 0 };
        const expMap = { '0-1': 1, '1-5': 2, '5-10': 3, '10+': 4, '': 0 };

        const targetAge = ageMap[ageGroup] || 0;
        const targetExp = expMap[experience] || 0;
        const hasFilters = genre || country || ageGroup || experience;

        // 3. Calculate Euclidean Distance
        const scoredUsers = candidates.map(user => {
            let distSq = 0;

            if (genre) {
                const hasGenre = (user.genres || []).map(g => g.toLowerCase()).includes(genre);
                if (!hasGenre) distSq += Math.pow(1 * WEIGHTS.genre, 2);
            }

            if (country) {
                const userCountry = (user.country || '').trim().toLowerCase();
                if (userCountry !== country) distSq += Math.pow(1 * WEIGHTS.country, 2);
            }

            if (targetAge > 0) {
                const userAge = ageMap[user.ageGroup] || 0;
                const ageGap = userAge > 0 ? Math.abs(userAge - targetAge) : 3;
                distSq += Math.pow(ageGap * WEIGHTS.ageGroup, 2);
            }

            if (targetExp > 0) {
                const userExp = expMap[user.experience] || 0;
                const expGap = userExp > 0 ? Math.abs(userExp - targetExp) : 3;
                distSq += Math.pow(expGap * WEIGHTS.experience, 2);
            }

            const distance = Math.sqrt(distSq);
            
            // 4. Convert Distance to Match Percentage
            let matchPercentage = hasFilters 
                ? Math.round(100 * (1 - (distance / maxDistance))) 
                : 100; // If no filters provided, everyone is a 100% match structurally
            
            matchPercentage = Math.max(0, Math.min(100, matchPercentage));

            return { user, matchPercentage, distance };
        });

        // 5. Sort by Match Percentage DESC, then Recency DESC
        scoredUsers.sort((a, b) => {
            if (b.matchPercentage !== a.matchPercentage) {
                return b.matchPercentage - a.matchPercentage;
            }
            return new Date(b.user.createdAt) - new Date(a.user.createdAt);
        });

        // 6. Return top K results
        const topUsers = scoredUsers.slice(0, 50).map(({ user, matchPercentage }) => ({
            _id: user._id,
            name: user.name || user.username,
            username: user.username,
            role: user.role,
            avatar: user.profilePicture || 'images/user-1.png',
            bio: user.bio || user.about || '',
            genres: user.genres || [],
            country: user.country || '',
            ageGroup: user.ageGroup || '',
            experience: user.experience || '',
            skills: user.skills || [],
            createdAt: user.createdAt,
            matchPercentage // Include the ML calculated score
        }));

        res.json(topUsers);
    } catch (error) {
        console.error('Error discovering users (KNN):', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update match status
router.put('/matches/:userId', auth, async (req, res) => {
    try {
        const { status } = req.body;
        const user = await User.findById(req.user.id);
        
        const matchIndex = user.matches.findIndex(
            match => match.user.toString() === req.params.userId
        );

        if (matchIndex === -1) {
            return res.status(404).json({ message: 'Match not found' });
        }

        user.matches[matchIndex].status = status;
        await user.save();

        res.json(user.matches[matchIndex]);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Get profile picture
router.get('/profile-picture', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || !user.profilePicture) {
            return res.status(404).json({ error: 'Profile picture not found' });
        }

        res.json({ profilePicture: user.profilePicture });
    } catch (error) {
        console.error('Error fetching profile picture:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/public/:userId/works/:workId/file', auth, async (req, res) => {
    try {
        const work = await Work.findOne({ _id: req.params.workId, user: req.params.userId });
        if (!work) {
            return res.status(404).json({ error: 'Work not found' });
        }

        if (work.fileUrl) {
            return res.redirect(work.fileUrl);
        }

        if (!work.fileData) {
            return res.status(404).json({ error: 'Work file not found' });
        }

        res.set('Content-Type', work.mimeType);
        res.send(work.fileData);
    } catch (error) {
        console.error('Error fetching public work file:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upload profile picture
router.post('/profile-picture', auth, profileUpload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const uploaded = await uploadBuffer(req.file.buffer, {
            folder: 'profile-pictures',
            resourceType: 'image'
        });

        user.profilePicture = uploaded.secure_url;

        await user.save();

        res.json(sanitizeUser(user));
    } catch (error) {
        console.error('Error uploading profile picture:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get work file
router.get('/works/:id/file', auth, async (req, res) => {
    try {
        const work = await Work.findOne({ _id: req.params.id, user: req.user.id });
        if (!work) {
            return res.status(404).json({ error: 'Work not found' });
        }

        if (work.fileUrl) {
            return res.redirect(work.fileUrl);
        }

        if (!work.fileData) {
            return res.status(404).json({ error: 'Work file not found' });
        }

        res.set('Content-Type', work.mimeType);
        res.send(work.fileData);
    } catch (error) {
        console.error('Error fetching work file:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upload work
router.post('/works', auth, workUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { title, description } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const uploaded = await uploadBuffer(req.file.buffer, {
            folder: 'works',
            resourceType: 'auto'
        });

        const fileType = req.file.mimetype.startsWith('image/') ? 'image' : 'document';

        const work = new Work({
            user: req.user.id,
            title,
            description,
            fileUrl: uploaded.secure_url,
            mimeType: req.file.mimetype,
            fileType
        });

        await work.save();

        const user = await User.findById(req.user.id);
        if (user) {
            user.works.push(work._id);
            await user.save();
        }

        res.json(sanitizeWork(work));
    } catch (error) {
        console.error('Error uploading work:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete work
router.delete('/works/:id', auth, async (req, res) => {
    try {
        const work = await Work.findOne({ _id: req.params.id, user: req.user.id });
        if (!work) {
            return res.status(404).json({ error: 'Work not found' });
        }

        const user = await User.findById(req.user.id);
        if (user) {
            user.works = user.works.filter(w => w.toString() !== req.params.id);
            user.featuredWorks = (user.featuredWorks || []).filter(w => w.toString() !== req.params.id);
            await user.save();
        }

        await Work.deleteOne({ _id: req.params.id });
        res.json({ message: 'Work deleted successfully' });
    } catch (error) {
        console.error('Error deleting work:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router; 
