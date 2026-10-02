const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../models/productModel');
const User = require('../models/userModel');
const CircularRequest = require('../models/circularRequestModel');
const AppError = require('../utils/appError');
const { resolveCompanyScope } = require('../utils/companyScope');
const { SERVICE_KINDS, normalizeCircularity } = require('../utils/circularity');
const { createNotification } = require('./notificationController');

const KIND_LABEL: any = { repair: 'Repair', resell: 'Resale', rent: 'Rental', recycle: 'Recycling' };
const STATUS_LABEL: any = {
    new: 'received', accepted: 'accepted', in_progress: 'in progress',
    completed: 'completed', declined: 'declined', cancelled: 'cancelled'
};
// What the brand may move a request to from each status. A finished request
// stays finished.
const NEXT_STATUS: any = {
    new: ['accepted', 'in_progress', 'completed', 'declined'],
    accepted: ['in_progress', 'completed', 'declined'],
    in_progress: ['completed', 'declined'],
    completed: [],
    declined: [],
    cancelled: []
};
// One shopper cannot flood a brand: this many open requests per product.
const MAX_OPEN_PER_PRODUCT = 5;

const text = (value: any, max: number) => String(value == null ? '' : value).trim().slice(0, max);
const isId = (value: any) => mongoose.Types.ObjectId.isValid(String(value || ''));

// Letters and digits that cannot be confused when read out (no 0/O, 1/I).
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'SR-' + Array.from(crypto.randomBytes(6)).map((b: any) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');

/**
 * POST /circular/requests — a signed-in shopper asks for one of a product's
 * services. Body: { product_id, kind, message, qrcode_id?, contact?: { name, email, phone } }
 */
exports.create = async (req: any, res: any, next: any) => {
    try {
        const kind = text(req.body?.kind, 20);
        if (!SERVICE_KINDS.includes(kind)) {
            return next(new AppError(400, 'fail', 'Choose repair, resell, rent or recycle.'));
        }
        if (!isId(req.body?.product_id)) {
            return next(new AppError(400, 'fail', 'The product is missing.'));
        }
        const product = await Product.findById(req.body.product_id).select('name company_id disposal circularity is_deleted').lean();
        if (!product || product.is_deleted) {
            return next(new AppError(404, 'fail', 'This product no longer exists.'));
        }
        const service = normalizeCircularity(product.circularity, product.disposal)[kind];
        if (!service.enabled || !service.acceptRequests) {
            return next(new AppError(400, 'fail', 'The brand does not take requests for this service.'));
        }
        const message = text(req.body?.message, 1500);
        if (message.length < 5) {
            return next(new AppError(400, 'fail', 'Please describe what you need in a few words.'));
        }

        const open = await CircularRequest.countDocuments({
            user_id: req.user.id, product_id: product._id, status: { $in: ['new', 'accepted', 'in_progress'] }
        });
        if (open >= MAX_OPEN_PER_PRODUCT) {
            return next(new AppError(429, 'fail', 'You already have several open requests for this product. Please wait for the brand to answer.'));
        }

        const user = await User.findById(req.user.id).select('name firstName lastName email phoneNumber').lean();
        const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.name || '';
        const contact = {
            name: text(req.body?.contact?.name, 120) || fullName,
            email: text(req.body?.contact?.email, 200) || user?.email || '',
            phone: text(req.body?.contact?.phone, 60) || user?.phoneNumber || ''
        };
        const qrcodeId = Number(req.body?.qrcode_id);

        const doc = await CircularRequest.create({
            ref: newRef(),
            kind,
            product_id: product._id,
            company_id: product.company_id,
            qrcode_id: Number.isFinite(qrcodeId) && qrcodeId > 0 ? qrcodeId : null,
            productName: product.name || '',
            user_id: req.user.id,
            contact,
            message,
            status: 'new',
            history: [{ status: 'new', note: '', by: contact.name || 'Shopper' }]
        });

        createNotification({
            audience: 'company',
            recipient: { kind: 'Company', id: product.company_id },
            type: 'system',
            title: `${KIND_LABEL[kind]} request for ${product.name || 'a product'}`,
            message: `${contact.name || 'A shopper'} sent a ${KIND_LABEL[kind].toLowerCase()} request (${doc.ref}). Open Service Requests to answer it.`,
            data: { serviceRequestId: doc._id, ref: doc.ref, kind, productId: product._id }
        });

        res.status(201).json({ status: 'success', data: doc });
    } catch (error) {
        next(error);
    }
};

/** GET /circular/requests/mine?product_id= — the shopper's own requests, newest first. */
exports.listMine = async (req: any, res: any, next: any) => {
    try {
        const query: any = { user_id: req.user.id };
        if (isId(req.query?.product_id)) query.product_id = req.query.product_id;
        const docs = await CircularRequest.find(query).sort({ createdAt: -1 }).limit(100).lean();
        res.status(200).json({ status: 'success', data: docs });
    } catch (error) {
        next(error);
    }
};

/** PUT /circular/requests/:id/cancel — the shopper withdraws a request the brand has not started. */
exports.cancelMine = async (req: any, res: any, next: any) => {
    try {
        if (!isId(req.params.id)) return next(new AppError(404, 'fail', 'Request not found.'));
        const doc = await CircularRequest.findOne({ _id: req.params.id, user_id: req.user.id });
        if (!doc) return next(new AppError(404, 'fail', 'Request not found.'));
        if (!['new', 'accepted'].includes(doc.status)) {
            return next(new AppError(400, 'fail', 'This request can no longer be cancelled.'));
        }
        doc.status = 'cancelled';
        doc.history.push({ status: 'cancelled', note: '', by: doc.contact?.name || 'Shopper' });
        await doc.save();
        createNotification({
            audience: 'company',
            recipient: { kind: 'Company', id: doc.company_id },
            type: 'system',
            title: `Request ${doc.ref} was cancelled`,
            message: `${doc.contact?.name || 'The shopper'} cancelled the ${KIND_LABEL[doc.kind].toLowerCase()} request for ${doc.productName || 'a product'}.`,
            data: { serviceRequestId: doc._id, ref: doc.ref, kind: doc.kind }
        });
        res.status(200).json({ status: 'success', data: doc });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /circular/requests?status=&kind=&product_id= — a brand's requests
 * (every company for the platform admin), newest first, with a count per
 * status for the page's tabs.
 */
exports.list = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) return next(new AppError(403, 'fail', 'You do not have permission to see service requests.'));
        const base: any = {};
        if (scope.companyId) base.company_id = scope.companyId;
        const query: any = { ...base };
        if (req.query?.status === 'open') query.status = { $in: ['new', 'accepted', 'in_progress'] };
        else if (STATUS_LABEL[String(req.query?.status || '')]) query.status = req.query.status;
        if (SERVICE_KINDS.includes(String(req.query?.kind || ''))) query.kind = req.query.kind;
        if (isId(req.query?.product_id)) query.product_id = req.query.product_id;

        const [docs, grouped] = await Promise.all([
            CircularRequest.find(query).sort({ createdAt: -1 }).limit(300)
                .populate({ path: 'product_id', select: 'name images model' })
                .populate({ path: 'company_id', select: 'name' })
                .lean(),
            CircularRequest.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }])
        ]);
        const counts: any = {};
        grouped.forEach((g: any) => { counts[g._id] = g.n; });
        res.status(200).json({ status: 'success', data: docs, counts, canWrite: scope.canWrite });
    } catch (error) {
        next(error);
    }
};

/** PUT /circular/requests/:id { status?, reply? } — the brand answers a request. */
exports.update = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed || !scope.canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or the company account can answer requests.'));
        }
        if (!isId(req.params.id)) return next(new AppError(404, 'fail', 'Request not found.'));
        const query: any = { _id: req.params.id };
        if (scope.companyId) query.company_id = scope.companyId;
        const doc = await CircularRequest.findOne(query);
        if (!doc) return next(new AppError(404, 'fail', 'Request not found.'));

        const status = text(req.body?.status, 20);
        const reply = req.body?.reply === undefined ? undefined : text(req.body.reply, 1500);
        const statusChanges = !!status && status !== doc.status;
        if (statusChanges && !(NEXT_STATUS[doc.status] || []).includes(status)) {
            return next(new AppError(400, 'fail', `A request that is ${STATUS_LABEL[doc.status]} cannot be changed to that.`));
        }
        if (!statusChanges && (reply === undefined || reply === doc.reply)) {
            return res.status(200).json({ status: 'success', data: doc });
        }
        if (reply !== undefined) doc.reply = reply;
        if (statusChanges) doc.status = status;
        doc.history.push({ status: doc.status, note: reply || '', by: req.user?.name || 'Brand' });
        await doc.save();

        createNotification({
            audience: 'user',
            recipient: { kind: 'User', id: doc.user_id, email: doc.contact?.email || '', name: doc.contact?.name || '' },
            type: 'lifecycle_updated',
            level: doc.status === 'declined' ? 'warning' : doc.status === 'completed' ? 'success' : 'info',
            title: `${KIND_LABEL[doc.kind]} request ${STATUS_LABEL[doc.status]}`,
            message: `Your ${KIND_LABEL[doc.kind].toLowerCase()} request for ${doc.productName || 'your product'} (${doc.ref}) is ${STATUS_LABEL[doc.status]}.${doc.reply ? ` Message from the brand: ${doc.reply}` : ''}`,
            data: { serviceRequestId: doc._id, ref: doc.ref, kind: doc.kind, productId: doc.product_id, status: doc.status }
        });

        res.status(200).json({ status: 'success', data: doc });
    } catch (error) {
        next(error);
    }
};
