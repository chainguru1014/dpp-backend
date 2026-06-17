const mongoose = require('mongoose');
const Notification = require('../models/notificationModel');

const toObjectIdIfValid = (value: any) => {
    if (!value) return null;
    const str = String(value);
    return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
};

const emitUpdate = () => {
    try {
        // @ts-ignore
        global.io && global.io.emit('notifications:updated');
    } catch (e) { /* socket optional */ }
};

/**
 * Internal helper used by other controllers (e.g. transfers) to raise a
 * targeted notification. Never throws — notification failures must not break
 * the primary action.
 */
const createNotification = async (opts: any) => {
    try {
        const doc = await Notification.create({
            audience: opts.audience || 'user',
            recipient: opts.recipient || {},
            type: opts.type || 'system',
            level: opts.level || 'info',
            title: opts.title || '',
            message: opts.message || '',
            data: opts.data || {},
            createdBy: opts.createdBy || {}
        });
        emitUpdate();
        return doc;
    } catch (err) {
        console.error('createNotification failed:', err);
        return null;
    }
};

/** Build the query selecting the notifications a given reader should see. */
const buildReaderQuery = (recipientKind: string, recipientObjId: any) => {
    const or: any[] = [];
    if (recipientObjId) {
        or.push({ 'recipient.id': recipientObjId });
    }
    // App users (kind User) also receive broadcast system notifications.
    if (recipientKind === 'User') {
        or.push({ audience: 'all_users', is_active: true });
    }
    if (!or.length) return null;
    return { is_deleted: false, $or: or };
};

/**
 * GET /notification?recipient_kind=User|Company&recipient_id=...&limit=
 * Returns the reader's notifications (targeted + broadcasts for app users),
 * each annotated with a `read` flag, plus the unread count.
 */
exports.list = async (req: any, res: any, next: any) => {
    try {
        const recipientKind = req.query?.recipient_kind;
        const recipientObjId = toObjectIdIfValid(req.query?.recipient_id);
        const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit) || 50));

        const query = buildReaderQuery(recipientKind, recipientObjId);
        if (!query) {
            return res.status(200).json({ status: 'success', data: [], unreadCount: 0 });
        }

        const docs = await Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean();
        const data = docs.map((d: any) => ({
            ...d,
            read: Array.isArray(d.readBy) && d.readBy.some((id: any) => String(id) === String(recipientObjId))
        }));
        const unreadCount = data.filter((d: any) => !d.read).length;

        return res.status(200).json({ status: 'success', data, unreadCount });
    } catch (error) {
        next(error);
    }
};

/** GET /notification/unread-count — lightweight count for badge polling. */
exports.unreadCount = async (req: any, res: any, next: any) => {
    try {
        const recipientKind = req.query?.recipient_kind;
        const recipientObjId = toObjectIdIfValid(req.query?.recipient_id);
        const query = buildReaderQuery(recipientKind, recipientObjId);
        if (!query) {
            return res.status(200).json({ status: 'success', count: 0 });
        }
        const docs = await Notification.find(query).select('readBy').lean();
        const count = docs.filter(
            (d: any) => !(Array.isArray(d.readBy) && d.readBy.some((id: any) => String(id) === String(recipientObjId)))
        ).length;
        return res.status(200).json({ status: 'success', count });
    } catch (error) {
        next(error);
    }
};

/** POST /notification/:id/read { recipient_id } — mark a single notification read. */
exports.markRead = async (req: any, res: any, next: any) => {
    try {
        const notifObjId = toObjectIdIfValid(req.params?.id);
        const recipientObjId = toObjectIdIfValid(req.body?.recipient_id);
        if (!notifObjId || !recipientObjId) {
            return res.status(400).json({ status: 'fail', message: 'id and recipient_id are required' });
        }
        await Notification.updateOne({ _id: notifObjId }, { $addToSet: { readBy: recipientObjId } });
        emitUpdate();
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};

/** POST /notification/read-all { recipient_kind, recipient_id } — mark all read. */
exports.markAllRead = async (req: any, res: any, next: any) => {
    try {
        const recipientKind = req.body?.recipient_kind;
        const recipientObjId = toObjectIdIfValid(req.body?.recipient_id);
        const query = buildReaderQuery(recipientKind, recipientObjId);
        if (!query) {
            return res.status(400).json({ status: 'fail', message: 'recipient_id is required' });
        }
        await Notification.updateMany(query, { $addToSet: { readBy: recipientObjId } });
        emitUpdate();
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};

// ----- System notification management (super admin) -----

/**
 * GET /notification/system — list system (broadcast) notifications for the
 * management page, including inactive ones. Supports basic pagination.
 */
exports.systemList = async (req: any, res: any, next: any) => {
    try {
        const page = Math.max(1, parseInt(req.query?.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit) || 20));
        const filter: any = { audience: 'all_users', is_deleted: false };

        const [docs, total] = await Promise.all([
            Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Notification.countDocuments(filter)
        ]);
        const data = docs.map((d: any) => ({ ...d, readCount: Array.isArray(d.readBy) ? d.readBy.length : 0 }));
        return res.status(200).json({ status: 'success', data, total, page, limit });
    } catch (error) {
        next(error);
    }
};

/** POST /notification/system — create a broadcast notification for app users. */
exports.createSystem = async (req: any, res: any, next: any) => {
    try {
        const title = String(req.body?.title || '').trim();
        const message = String(req.body?.message || '').trim();
        const level = ['info', 'success', 'warning', 'critical'].includes(req.body?.level) ? req.body.level : 'info';
        const isActive = req.body?.is_active !== false;
        if (!title || !message) {
            return res.status(400).json({ status: 'fail', message: 'title and message are required' });
        }
        const createdBy = {
            kind: req.body?.createdBy?.kind || 'Company',
            id: toObjectIdIfValid(req.body?.createdBy?.id),
            name: req.body?.createdBy?.name || ''
        };
        const images = Array.isArray(req.body?.images)
            ? req.body.images.filter((x: any) => typeof x === 'string' && x.trim()).map((x: any) => x.trim())
            : [];
        const doc = await Notification.create({
            audience: 'all_users',
            type: 'system',
            level,
            title,
            message,
            images,
            is_active: isActive,
            createdBy
        });
        emitUpdate();
        return res.status(201).json({ status: 'success', data: doc });
    } catch (error) {
        next(error);
    }
};

/** PUT /notification/system/:id — edit title/message/level/active state. */
exports.updateSystem = async (req: any, res: any, next: any) => {
    try {
        const notifObjId = toObjectIdIfValid(req.params?.id);
        if (!notifObjId) {
            return res.status(400).json({ status: 'fail', message: 'Invalid id' });
        }
        const update: any = {};
        if (typeof req.body?.title === 'string') update.title = req.body.title.trim();
        if (typeof req.body?.message === 'string') update.message = req.body.message.trim();
        if (['info', 'success', 'warning', 'critical'].includes(req.body?.level)) update.level = req.body.level;
        if (typeof req.body?.is_active === 'boolean') update.is_active = req.body.is_active;
        if (Array.isArray(req.body?.images)) {
            update.images = req.body.images.filter((x: any) => typeof x === 'string' && x.trim()).map((x: any) => x.trim());
        }

        const doc = await Notification.findOneAndUpdate(
            { _id: notifObjId, audience: 'all_users', is_deleted: false },
            { $set: update },
            { new: true }
        );
        if (!doc) {
            return res.status(404).json({ status: 'fail', message: 'Notification not found' });
        }
        emitUpdate();
        return res.status(200).json({ status: 'success', data: doc });
    } catch (error) {
        next(error);
    }
};

/** DELETE /notification/system/:id — soft delete. */
exports.removeSystem = async (req: any, res: any, next: any) => {
    try {
        const notifObjId = toObjectIdIfValid(req.params?.id);
        if (!notifObjId) {
            return res.status(400).json({ status: 'fail', message: 'Invalid id' });
        }
        const doc = await Notification.findOneAndUpdate(
            { _id: notifObjId, audience: 'all_users' },
            { $set: { is_deleted: true } },
            { new: true }
        );
        if (!doc) {
            return res.status(404).json({ status: 'fail', message: 'Notification not found' });
        }
        emitUpdate();
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};

exports.createNotification = createNotification;
