
const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
    consumer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    story: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story'
    },
    storyId: {
        type: String,
        default: undefined // For sample stories that don't have MongoDB ObjectId
    },
    chapter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story.chapters'
    },
    purchaseType: {
        type: String,
        enum: ['chapter', 'full_story', 'sample_story'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    paymentMethod: {
        type: String,
        default: 'razorpay'
    },
    paymentId: {
        type: String,
        required: true
    },
    razorpayOrderId: {
        type: String
    },
    razorpaySignature: {
        type: String
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    purchasedAt: {
        type: Date,
        default: Date.now
    }
});

// Compound index to prevent duplicate purchases
purchaseSchema.index({ consumer: 1, story: 1, chapter: 1 }, { unique: true, sparse: true });
purchaseSchema.index(
    { consumer: 1, storyId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            storyId: { $type: 'string' }
        }
    }
);

module.exports = mongoose.model('Purchase', purchaseSchema);