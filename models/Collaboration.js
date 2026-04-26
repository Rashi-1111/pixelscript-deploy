const mongoose = require('mongoose');

const chapterPanelSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true,
        default: ''
    },
    imageUrl: {
        type: String,
        required: true
    },
    order: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { _id: true });

const collaborationSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    artist: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    writer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'rejected', 'cancelled'],
        default: 'pending'
    },
    requester: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    room: {
        type: String,
        index: true
    },
    category: {
        type: String,
        enum: ['comic', 'illustration', 'book', 'other'],
        required: true
    },
    genre: {
        type: String,
        enum: ['fantasy', 'sci-fi', 'romance', 'mystery', 'horror', 'adventure', 'drama', 'comedy'],
        required: true
    },
    deadline: {
        type: Date
    },
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    files: [{
        name: String,
        url: String,
        type: String,
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    chat: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    canvas: {
        type: String
    },
    coverImage: {
        type: String,
        default: ''
    },
    storyTitle: {
        type: String,
        trim: true,
        default: ''
    },
    chapterNumber: {
        type: Number,
        default: 1,
        min: 1
    },
    chapterTitle: {
        type: String,
        trim: true,
        default: ''
    },
    storySynopsis: {
        type: String,
        trim: true,
        default: ''
    },
    storyContent: {
        type: String,
        trim: true,
        default: ''
    },
    chapterPanels: [chapterPanelSchema],
    publishRequest: {
        requestedAt: Date,
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        artistApproved: {
            type: Boolean,
            default: false
        },
        writerApproved: {
            type: Boolean,
            default: false
        },
        publishedAt: Date,
        story: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Story'
        }
    },
    storyActionRequest: {
        type: {
            type: String,
            enum: ['edit', 'delete', ''],
            default: ''
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', ''],
            default: ''
        },
        requestedAt: Date,
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        artistApproved: {
            type: Boolean,
            default: false
        },
        writerApproved: {
            type: Boolean,
            default: false
        },
        resolvedAt: Date,
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    rating: {
        artist: {
            rating: {
                type: Number,
                min: 1,
                max: 5
            },
            comment: String
        },
        writer: {
            rating: {
                type: Number,
                min: 1,
                max: 5
            },
            comment: String
        }
    },
    settings: {
        notifications: {
            type: Boolean,
            default: true
        },
        autoSave: {
            type: Boolean,
            default: true
        },
        saveInterval: {
            type: Number,
            default: 300000 // 5 minutes in milliseconds
        }
    }
}, {
    timestamps: true
});

// Index for searching collaborations
collaborationSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Collaboration', collaborationSchema); 
