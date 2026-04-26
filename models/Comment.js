const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    story: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story',
        required: true,
        index: true
    },
    chapter: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    }
}, {
    timestamps: true
});

// Compound index: fetch all comments for a specific chapter, newest first
commentSchema.index({ story: 1, chapter: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
