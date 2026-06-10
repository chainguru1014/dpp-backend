const mongoose = require('mongoose');

const followedBrandSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        brandWebsiteUrl: {
            type: String,
            required: true,
            trim: true
        },
        brandName: {
            type: String,
            default: '',
            trim: true
        },
        brandDetail: {
            type: String,
            default: '',
            trim: true
        },
        brandLogoUrl: {
            type: String,
            default: '',
            trim: true
        }
    },
    { timestamps: true }
);

followedBrandSchema.index({ user_id: 1, brandWebsiteUrl: 1 }, { unique: true });

module.exports = mongoose.model('FollowedBrand', followedBrandSchema);
