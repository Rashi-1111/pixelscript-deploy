const express = require('express');
const multer = require('multer');
const Workspace = require('../models/Workspace');
const Collaboration = require('../models/Collaboration');
const auth = require('../middleware/auth');
const { uploadBuffer } = require('../services/cloudinary');

const router = express.Router();

const workspaceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

async function findOrCreateWorkspace(room) {
    let workspace = await Workspace.findOne({ room });
    if (!workspace) {
        workspace = await Workspace.create({ room });
    }

    return workspace;
}

async function canAccessRoom(user, room) {
    if (!user || !room) {
        return false;
    }

    if (user.role === 'admin') {
        return true;
    }

    const collaboration = await Collaboration.findOne({ room })
        .select('artist writer')
        .lean();

    if (!collaboration) {
        return false;
    }

    const userId = String(user._id || user.id || user.userId || '');
    return String(collaboration.artist) === userId || String(collaboration.writer) === userId;
}

router.get('/:room', auth, async (req, res) => {
    try {
        if (!(await canAccessRoom(req.user, req.params.room))) {
            return res.status(403).json({ error: 'Not authorized for this workspace' });
        }

        const workspace = await Workspace.findOne({ room: req.params.room }).lean();

        res.json(workspace || {
            room: req.params.room,
            canvasState: '',
            chat: [],
            assets: []
        });
    } catch (error) {
        console.error('Error fetching workspace:', error);
        res.status(500).json({ error: 'Failed to load workspace' });
    }
});

router.put('/:room', auth, async (req, res) => {
    try {
        if (!(await canAccessRoom(req.user, req.params.room))) {
            return res.status(403).json({ error: 'Not authorized for this workspace' });
        }

        const workspace = await findOrCreateWorkspace(req.params.room);

        if (typeof req.body.canvasState === 'string') {
            workspace.canvasState = req.body.canvasState;
        }

        if (Array.isArray(req.body.chat)) {
            workspace.chat = req.body.chat
                .filter(item => item && (item.message || item.attachment?.url))
                .slice(-100)
                .map(item => ({
                    sender: item.sender || 'Collaborator',
                    message: String(item.message || '').trim(),
                    attachment: item.attachment?.url
                        ? {
                            name: String(item.attachment.name || '').trim(),
                            url: String(item.attachment.url || '').trim(),
                            type: String(item.attachment.type || 'application/octet-stream').trim(),
                            size: Number(item.attachment.size) || 0
                        }
                        : undefined,
                    sentAt: item.sentAt ? new Date(item.sentAt) : new Date()
                }));
        }

        await workspace.save();
        res.json(workspace);
    } catch (error) {
        console.error('Error saving workspace:', error);
        res.status(500).json({ error: 'Failed to save workspace' });
    }
});

router.post('/:room/assets', auth, workspaceUpload.single('file'), async (req, res) => {
    try {
        if (!(await canAccessRoom(req.user, req.params.room))) {
            return res.status(403).json({ error: 'Not authorized for this workspace' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const uploaded = await uploadBuffer(req.file.buffer, {
            folder: 'workspace-assets',
            resourceType: 'auto'
        });

        const workspace = await findOrCreateWorkspace(req.params.room);
        const asset = {
            name: req.file.originalname,
            url: uploaded.secure_url,
            type: uploaded.resource_type || req.file.mimetype,
            uploadedBy: req.body.uploadedBy || 'Collaborator'
        };

        workspace.assets.push(asset);
        await workspace.save();

        res.status(201).json(asset);
    } catch (error) {
        console.error('Error uploading workspace asset:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

module.exports = router;
