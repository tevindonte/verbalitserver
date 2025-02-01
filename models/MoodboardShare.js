// backend/models/MoodboardShare.js

const mongoose = require('mongoose');

const MoodboardShareSchema = new mongoose.Schema({
    moodboardId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Board',
        required: true
    },
    token: {
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        enum: ['viewer', 'editor'],
        default: 'viewer'
    },
    invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users', // Assuming you have a User model
        required: true
    },
    email: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: () => Date.now() + 7 * 24 * 60 * 60 * 1000 // Expires in 7 days
    }
});

// Optional: Add TTL index for automatic deletion after expiration
MoodboardShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const MoodboardShare = mongoose.model('MoodboardShare', MoodboardShareSchema);

module.exports = MoodboardShare;
