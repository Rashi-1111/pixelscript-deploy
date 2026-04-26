const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
    room: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    canvasState: {
        type: String,
        default: ''
    },
    chat: [{
        sender: {
            type: String,
            trim: true,
            default: 'Collaborator'
        },
        message: {
            type: String,
            default: '',
            trim: true
        },
        attachment: {
            name: {
                type: String,
                trim: true,
                default: ''
            },
            url: {
                type: String,
                default: ''
            },
            type: {
                type: String,
                default: 'application/octet-stream'
            },
            size: {
                type: Number,
                default: 0
            }
        },
        sentAt: {
            type: Date,
            default: Date.now
        }
    }],
    assets: [{
        name: {
            type: String,
            required: true,
            trim: true
        },
        url: {
            type: String,
            required: true
        },
        type: {
            type: String,
            default: 'application/octet-stream'
        },
        uploadedBy: {
            type: String,
            trim: true,
            default: 'Collaborator'
        },
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Workspace', workspaceSchema);
