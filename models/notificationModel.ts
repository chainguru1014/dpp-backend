const mongoose = require("mongoose");

/**
 * Unified notification record.
 *
 * Two delivery shapes share this collection:
 *  - Targeted    : `audience: 'user' | 'company'` with a concrete `recipient`.
 *                  Used for transfer requests/updates aimed at one owner/buyer.
 *  - Broadcast   : `audience: 'all_users'` (no recipient). System notifications
 *                  authored by a super admin and shown to every app user.
 *
 * Read state is tracked per-reader in `readBy` so the same broadcast row can be
 * marked read independently by each user.
 */
const notificationSchema = new mongoose.Schema({
    audience: {
        type: String,
        enum: ['user', 'company', 'all_users'],
        default: 'user',
        index: true
    },
    // Concrete recipient for targeted notifications (null for broadcasts).
    recipient: {
        kind: { type: String, enum: ['User', 'Company', null], default: null },
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
        email: { type: String, default: '' },
        name: { type: String, default: '' }
    },
    type: {
        type: String,
        enum: ['transfer_request', 'transfer_confirmed', 'transfer_rejected', 'transfer_received', 'system'],
        default: 'system'
    },
    // Visual severity, mainly for system notifications.
    level: {
        type: String,
        enum: ['info', 'success', 'warning', 'critical'],
        default: 'info'
    },
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    // Image filenames (served from /files) attached to system notifications.
    images: [{ type: String }],
    // Free-form payload (e.g. transferCode, productId, productName, quantity).
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Reader ids (User/Company) that have marked this notification read.
    readBy: [{ type: mongoose.Schema.Types.ObjectId }],
    // Who authored a system notification (super admin company).
    createdBy: {
        kind: { type: String, enum: ['User', 'Company', null], default: null },
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
        name: { type: String, default: '' }
    },
    // System notifications can be toggled off without deleting.
    is_active: { type: Boolean, default: true },
    is_deleted: { type: Boolean, default: false }
}, { timestamps: true });

notificationSchema.index({ 'recipient.id': 1, is_deleted: 1, createdAt: -1 });
notificationSchema.index({ audience: 1, is_active: 1, is_deleted: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
