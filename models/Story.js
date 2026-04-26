const mongoose = require('mongoose');

const panelSchema = new mongoose.Schema({
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
    }
}, { _id: true });

const chapterSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String,
        required: true
    },
    isFree: {
        type: Boolean,
        default: false
    },
    order: {
        type: Number,
        required: true
    },
    panels: [panelSchema],
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const storySchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    genre: {
        type: String,
        required: true,
        enum: ['fantasy', 'scifi', 'mystery', 'romance', 'horror', 'thriller', 'other']
    },
    coverImage: {
        type: String,
        default: 'images/work1.jpeg'
    },
    sourceCollaboration: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Collaboration'
    },
    projectBoard: {
        synopsis: {
            type: String,
            default: ''
        },
        finalNotes: {
            type: String,
            default: ''
        },
        canvasPreview: {
            type: String,
            default: ''
        },
        panels: [panelSchema],
        artwork: [{
            name: String,
            url: String,
            type: String
        }]
    },
    chapters: [chapterSchema],
    isPublished: {
        type: Boolean,
        default: false
    },
    price: {
        type: Number,
        default: 0,
        min: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Indexes for high-traffic listing queries.
storySchema.index({ isPublished: 1, createdAt: -1 });
storySchema.index({ author: 1, updatedAt: -1 });
storySchema.index({ isPublished: 1, genre: 1, createdAt: -1 });

// Update the updatedAt field on save
storySchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Story', storySchema);
