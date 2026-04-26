const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        required: true,
        enum: ['artist', 'writer', 'editor', 'admin', 'consumer'],
        default: 'writer',
        lowercase: true
    },
    bio: {
        type: String,
        trim: true,
        maxlength: 500
    },
    about: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    genres: [{
        type: String,
        enum: [
            'fantasy',
            'scifi',
            'mystery',
            'romance',
            'horror',
            'thriller',
            'adventure',
            'drama',
            'historical',
            'action',
            'comedy',
            'crime',
            'dystopian',
            'fairy-tale',
            'fiction',
            'graphic-novel',
            'magic-realism',
            'mythology',
            'post-apocalyptic',
            'psychological',
            'satire',
            'slice-of-life',
            'supernatural',
            'suspense',
            'urban-fantasy',
            'young-adult',
            'other'
        ]
    }],
    country: {
        type: String,
        trim: true,
        maxlength: 80,
        default: ''
    },
    ageGroup: {
        type: String,
        enum: ['18-24', '25-34', '35-44', '45+', ''],
        default: ''
    },
    experience: {
        type: String,
        enum: ['0-1', '1-5', '5-10', '10+', ''],
        default: ''
    },
    skills: [{
        type: String,
        trim: true
    }],
    profilePicture: {
        type: String,
        default: 'images/user-1.png'
    },
    works: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Work'
    }],
    featuredWorks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Work'
    }],
    featuredCollaborations: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Collaboration'
    }],
    collaborations: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Collaboration'
    }],
    matches: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending'
        }
    }],
    lastActive: {
        type: Date,
        default: Date.now
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    settings: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    profileCompletion: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    try {
        // Only hash the password if it has been modified (or is new)
        if (!this.isModified('password')) {
            return next();
        }

        // Generate salt and hash password
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Calculate profile completion percentage
userSchema.pre('save', function(next) {
    const fields = ['name', 'role', 'about', 'bio', 'profilePicture', 'genres', 'country', 'ageGroup', 'experience', 'skills'];
    let completedFields = 0;

    fields.forEach(field => {
        if (field === 'profilePicture') {
            if (this.profilePicture && this.profilePicture !== 'images/user-1.png') {
                completedFields++;
            }
        } else if (Array.isArray(this[field])) {
            if (this[field].length > 0) {
                completedFields++;
            }
        } else if (this[field]) {
            completedFields++;
        }
    });

    this.profileCompletion = Math.round((completedFields / fields.length) * 100);
    next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('Error comparing passwords');
    }
};

// Method to update last active
userSchema.methods.updateLastActive = async function() {
    return User.findByIdAndUpdate(this._id, { lastActive: new Date() });
};

const User = mongoose.model('User', userSchema);
module.exports = User;
