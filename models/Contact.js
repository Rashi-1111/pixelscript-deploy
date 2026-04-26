const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        default: ''
    },
    subject: {
        type: String,
        trim: true,
        default: ''
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    // For platform reviews
    rating: {
        type: Number,
        min: 1,
        max: 5,
        default: null
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    avatar: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['new', 'read', 'responded'],
        default: 'new'
    }
}, {
    timestamps: true
});

contactSchema.index({ subject: 1, createdAt: -1 });

module.exports = mongoose.model('Contact', contactSchema);