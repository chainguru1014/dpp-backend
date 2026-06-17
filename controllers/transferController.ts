const crypto = require('crypto');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const OwnershipTransfer = require('../models/ownershipTransferModel');
const Product = require('../models/productModel');
const ProductHolding = require('../models/productHoldingModel');
const ScanRecord = require('../models/scanRecordModel');
const ProductReaction = require('../models/productReactionModel');
const User = require('../models/userModel');
const Company = require('../models/companyModel');
const Notification = require('../models/notificationModel');
const {
    resolveOwnerIdentity,
    ensureSeedHolding,
    ownerHolds,
    moveHolding,
    getPrimaryOwner,
    getPrimaryOwnerExcluding,
    claimEmailHoldings,
    normalizeEmail,
    getOwnedProductIds,
} = require('../utils/ownership');
const { createNotification } = require('./notificationController');

const toObjectIdIfValid = (value: any) => {
    if (!value) return null;
    const str = String(value);
    return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
};

const webBaseUrl = () => {
    const base = process.env.PUBLIC_WEB_APP_URL || 'https://dpp.innosynch.com';
    return base.replace(/\/+$/, '');
};

const buildProductSnapshot = (product: any) => {
    const images = Array.isArray(product?.images) ? product.images : [];
    return {
        name: product?.name || '',
        model: product?.model || '',
        image: images.length ? String(images[0]) : '',
        brandName: product?.brandInfo?.name || ''
    };
};

const METHODS = [
    'sale', 'sell', 'distribute', 'distribute_to_shop',
    'export_to_country', 'export_to_store', 'export_to_shop',
    'gift', 'lease', 'return'
];

const METHOD_LABELS: any = {
    sale: 'Sale / Purchase',
    sell: 'Sell',
    distribute: 'Distribute',
    distribute_to_shop: 'Distribute to shop',
    export_to_country: 'Export to other country',
    export_to_store: 'Export to store',
    export_to_shop: 'Export to shop',
    gift: 'Gift',
    lease: 'Lease',
    return: 'Return'
};

/**
 * Buyer initiates an ownership-transfer request. Idempotent: repeated taps for
 * the same (product, qrcode, buyer) reuse the existing pending transfer.
 */
exports.initiate = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.body?.product_id);
        const buyerObjId = toObjectIdIfValid(req.body?.buyer_id);
        const qrcodeId = req.body?.qrcode_id != null && req.body?.qrcode_id !== ''
            ? Number(req.body.qrcode_id)
            : null;
        const method = METHODS.includes(req.body?.method) ? req.body.method : 'sale';

        if (!productObjId || !buyerObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id and buyer_id are required' });
        }

        const product = await Product.findById(productObjId);
        if (!product || product.is_deleted) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }

        const buyer = await User.findById(buyerObjId).lean();
        if (!buyer) {
            return res.status(404).json({ status: 'fail', message: 'Buyer not found' });
        }

        await ensureSeedHolding(product);
        // Ownership is per-unit: a buyer who already holds some items can buy more,
        // as long as another owner (brand/company or a different holder) still has
        // units to sell. The seller is the largest holder that isn't the buyer.
        const owner = await getPrimaryOwnerExcluding(product, { kind: 'User', id: buyerObjId });
        if (!owner) {
            return res.status(409).json({ status: 'fail', message: 'No items available to purchase for this product' });
        }

        // Resolve a display-friendly owner identity (name + email) for the buyer,
        // with a brand-company fallback. Computed here so it's returned even when
        // an older pending transfer (with an empty snapshot) is reused below.
        let fromOwner = await resolveOwnerIdentity(owner.kind, owner.id);
        if (!fromOwner.name && !fromOwner.email && product.company_id) {
            const c = await Company.findById(product.company_id).lean();
            if (c) fromOwner = { kind: 'Company', id: c._id, name: c.name || '', email: c.email || '' };
        }
        const ownerInfo = { kind: fromOwner.kind, id: fromOwner.id, name: fromOwner.name, email: fromOwner.email };

        // Reuse an existing pending transfer if one already exists.
        const existing = await OwnershipTransfer.findOne({
            product_id: productObjId,
            qrcode_id: qrcodeId,
            'to_owner.id': buyerObjId,
            status: 'pending'
        });
        if (existing) {
            // Refresh the stored owner snapshot in case it was empty/stale.
            if (!existing.from_owner?.name && !existing.from_owner?.email) {
                existing.from_owner = ownerInfo;
                await existing.save();
            }
            const existingUrl = `${webBaseUrl()}/transfer/${existing.code}`;
            return res.status(200).json({
                status: 'success',
                code: existing.code,
                url: existingUrl,
                qrImage: await qrcode.toDataURL(existingUrl),
                transfer: existing,
                owner: ownerInfo
            });
        }

        const buyerName = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || buyer.name || '';
        const code = crypto.randomBytes(16).toString('base64url');

        const transfer = await OwnershipTransfer.create({
            product_id: productObjId,
            qrcode_id: qrcodeId,
            code,
            method,
            status: 'pending',
            productSnapshot: buildProductSnapshot(product),
            quantity: 1,
            from_owner: ownerInfo,
            to_owner: {
                kind: 'User',
                id: buyerObjId,
                name: buyerName,
                email: buyer.email || '',
                phone: buyer.phoneNumber || '',
                country: buyer.country || buyer.addressCountry || ''
            }
        });

        // Note: the owner is notified when the buyer taps "Send" in the share
        // dialog (POST /transfer/:code/notify-owner), not on initiate.

        const url = `${webBaseUrl()}/transfer/${code}`;
        return res.status(200).json({
            status: 'success',
            code,
            url,
            qrImage: await qrcode.toDataURL(url),
            transfer,
            owner: ownerInfo
        });
    } catch (error) {
        next(error);
    }
};

/** Fetch a transfer by its code for the confirmation screen. */
exports.getByCode = async (req: any, res: any, next: any) => {
    try {
        const transfer = await OwnershipTransfer.findOne({ code: req.params.code }).lean();
        if (!transfer) {
            return res.status(404).json({ status: 'fail', message: 'Transfer not found' });
        }
        return res.status(200).json({ status: 'success', data: transfer });
    } catch (error) {
        next(error);
    }
};

/**
 * The current owner confirms the transfer. Verifies the acting party is the
 * product's current owner (not the buyer), then moves ownership to the buyer.
 */
exports.confirm = async (req: any, res: any, next: any) => {
    try {
        const actorKind = req.body?.actor?.kind;
        const actorId = req.body?.actor?.id;
        const method = METHODS.includes(req.body?.method) ? req.body.method : null;

        if (!actorKind || !actorId) {
            return res.status(400).json({ status: 'fail', message: 'actor is required' });
        }

        const transfer = await OwnershipTransfer.findOne({ code: req.params.code });
        if (!transfer) {
            return res.status(404).json({ status: 'fail', message: 'Transfer not found' });
        }
        if (transfer.status !== 'pending') {
            return res.status(409).json({ status: 'fail', message: 'This transfer is no longer pending' });
        }

        const product = await Product.findById(transfer.product_id);
        if (!product) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }

        await ensureSeedHolding(product);
        const owner = await getPrimaryOwner(product);

        // Ownership may have changed since this transfer was initiated.
        if (transfer.from_owner?.id && String(transfer.from_owner.id) !== String(owner.id)) {
            return res.status(409).json({ status: 'fail', message: 'Ownership has changed since this request. Please re-initiate.' });
        }

        // Re-validate the actor exists (blocks confirming with a random/spoofed id).
        const actorObjId = toObjectIdIfValid(actorId);
        if (!actorObjId) {
            return res.status(401).json({ status: 'fail', message: 'Invalid actor' });
        }
        const actorDoc = actorKind === 'User'
            ? await User.findById(actorObjId).lean()
            : await Company.findById(actorObjId).lean();
        if (!actorDoc) {
            return res.status(401).json({ status: 'fail', message: 'Actor not found' });
        }

        // Explicitly block the buyer from confirming their own purchase.
        if (transfer.to_owner?.id && String(actorObjId) === String(transfer.to_owner.id)) {
            return res.status(403).json({ status: 'fail', message: 'The buyer cannot confirm their own transfer' });
        }

        // The actor must be the product's current owner.
        const isOwner = actorKind === owner.kind && String(actorObjId) === String(owner.id);
        if (!isOwner) {
            return res.status(403).json({ status: 'fail', message: 'Only the current owner can confirm this transfer' });
        }

        // Move the bought units from the owner to the buyer in the holdings ledger.
        const qty = transfer.quantity || 1;
        await moveHolding(
            product,
            { kind: owner.kind, id: owner.id, email: owner.email },
            {
                kind: 'User',
                id: transfer.to_owner.id,
                email: transfer.to_owner.email,
                name: transfer.to_owner.name
            },
            qty
        );

        transfer.status = 'confirmed';
        transfer.method = method || transfer.method;
        transfer.confirmed_by = { kind: actorKind, id: actorObjId };
        transfer.confirmed_at = new Date();
        await transfer.save();

        try {
            // @ts-ignore
            global.io && global.io.emit('Refresh user data');
        } catch (e) { /* socket optional */ }

        // Let the buyer know their request was accepted.
        if (transfer.to_owner?.id) {
            await createNotification({
                audience: 'user',
                recipient: { kind: 'User', id: transfer.to_owner.id, name: transfer.to_owner.name, email: transfer.to_owner.email },
                type: 'transfer_confirmed',
                level: 'success',
                title: 'Ownership transfer confirmed',
                message: `You now own "${transfer.productSnapshot?.name || product.name}".`,
                data: { transferCode: transfer.code, productId: String(product._id), productName: transfer.productSnapshot?.name || product.name }
            });
        }

        return res.status(200).json({ status: 'success', data: transfer });
    } catch (error) {
        next(error);
    }
};

/** The current owner rejects, or the buyer cancels, a pending transfer. */
exports.reject = async (req: any, res: any, next: any) => {
    try {
        const actorKind = req.body?.actor?.kind;
        const actorId = toObjectIdIfValid(req.body?.actor?.id);
        if (!actorKind || !actorId) {
            return res.status(400).json({ status: 'fail', message: 'actor is required' });
        }

        const transfer = await OwnershipTransfer.findOne({ code: req.params.code });
        if (!transfer) {
            return res.status(404).json({ status: 'fail', message: 'Transfer not found' });
        }
        if (transfer.status !== 'pending') {
            return res.status(409).json({ status: 'fail', message: 'This transfer is no longer pending' });
        }

        const isBuyer = transfer.to_owner?.id && String(actorId) === String(transfer.to_owner.id);

        if (isBuyer) {
            transfer.status = 'cancelled';
        } else {
            // Owner rejection — verify the actor is the current owner.
            const product = await Product.findById(transfer.product_id);
            const owner = await getPrimaryOwner(product);
            const isOwner = actorKind === owner.kind && String(actorId) === String(owner.id);
            if (!isOwner) {
                return res.status(403).json({ status: 'fail', message: 'Only the owner or buyer can act on this transfer' });
            }
            transfer.status = 'rejected';
        }
        transfer.confirmed_by = { kind: actorKind, id: actorId };
        transfer.confirmed_at = new Date();
        await transfer.save();

        const productName = transfer.productSnapshot?.name || 'a product';
        if (isBuyer) {
            // Buyer cancelled — notify the owner that the request was withdrawn.
            if (transfer.from_owner?.id) {
                await createNotification({
                    audience: transfer.from_owner.kind === 'User' ? 'user' : 'company',
                    recipient: { kind: transfer.from_owner.kind, id: transfer.from_owner.id, name: transfer.from_owner.name, email: transfer.from_owner.email },
                    type: 'transfer_rejected',
                    level: 'warning',
                    title: 'Transfer request cancelled',
                    message: `${transfer.to_owner?.name || 'The requester'} cancelled the transfer request for "${productName}".`,
                    data: { transferCode: transfer.code, productId: String(transfer.product_id), productName }
                });
            }
        } else {
            // Owner rejected — notify the buyer.
            if (transfer.to_owner?.id) {
                await createNotification({
                    audience: 'user',
                    recipient: { kind: 'User', id: transfer.to_owner.id, name: transfer.to_owner.name, email: transfer.to_owner.email },
                    type: 'transfer_rejected',
                    level: 'warning',
                    title: 'Transfer request rejected',
                    message: `Your request to receive "${productName}" was rejected.`,
                    data: { transferCode: transfer.code, productId: String(transfer.product_id), productName }
                });
            }
        }

        return res.status(200).json({ status: 'success', data: transfer });
    } catch (error) {
        next(error);
    }
};

/** All transfers for a single product (admin per-product history dialog). */
exports.listByProduct = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.params.productId);
        if (!productObjId) {
            return res.status(400).json({ status: 'fail', message: 'Invalid product id' });
        }
        const data = await OwnershipTransfer.find({ product_id: productObjId })
            .sort({ createdAt: -1 })
            .lean();
        return res.status(200).json({ status: 'success', total: data.length, data });
    } catch (error) {
        next(error);
    }
};

/** Paginated/filtered feed of all transfers (admin Trace page). */
exports.list = async (req: any, res: any, next: any) => {
    try {
        const { page = 1, limit = 25, from, to, status, method, q } = req.query || {};
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 25));

        const match: any = {};
        if (status && ['pending', 'confirmed', 'rejected', 'cancelled'].includes(String(status))) {
            match.status = String(status);
        }
        if (method && METHODS.includes(String(method))) {
            match.method = String(method);
        }
        if (from || to) {
            match.createdAt = {};
            if (from) match.createdAt.$gte = new Date(String(from));
            if (to) { const d = new Date(String(to)); d.setHours(23, 59, 59, 999); match.createdAt.$lte = d; }
        }

        // Owner scope (company/user): restrict to transfers of the products they own.
        const ownerKind = req.query?.owner_kind === 'User' ? 'User' : req.query?.owner_kind === 'Company' ? 'Company' : null;
        const ownerId = req.query?.owner_id;
        if (ownerKind && ownerId && mongoose.Types.ObjectId.isValid(String(ownerId))) {
            const ids = await getOwnedProductIds(ownerKind, new mongoose.Types.ObjectId(String(ownerId)));
            match.product_id = { $in: ids };
        }

        const pipeline: any[] = [
            { $match: match },
            { $sort: { createdAt: -1 } }
        ];

        if (q && String(q).trim()) {
            const safe = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(safe, 'i');
            pipeline.push({
                $match: {
                    $or: [
                        { 'productSnapshot.name': rx },
                        { 'productSnapshot.brandName': rx },
                        { 'from_owner.name': rx }, { 'from_owner.email': rx },
                        { 'to_owner.name': rx }, { 'to_owner.email': rx }
                    ]
                }
            });
        }

        pipeline.push({
            $facet: {
                data: [
                    { $skip: (pageNum - 1) * limitNum },
                    { $limit: limitNum }
                ],
                total: [{ $count: 'count' }]
            }
        });

        const result = await OwnershipTransfer.aggregate(pipeline);
        const data = result[0]?.data || [];
        const total = result[0]?.total?.[0]?.count || 0;

        return res.status(200).json({ status: 'success', total, page: pageNum, limit: limitNum, data });
    } catch (error) {
        next(error);
    }
};

/** Look up whether a recipient email already belongs to a registered user. */
exports.recipient = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.query?.email);
        if (!email) {
            return res.status(400).json({ status: 'fail', message: 'email is required' });
        }
        const user = await User.findOne({ email }).lean();
        return res.status(200).json({
            status: 'success',
            exists: !!user,
            user: user ? { _id: user._id, name: user.name, email: user.email } : null
        });
    } catch (error) {
        next(error);
    }
};

// Shared SMTP transporter + branded layout so every transfer email looks the same.
const mailTransporter = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
});

const mailFrom = () => {
    const addr = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@yometel.jp';
    return `"Yometel DPP" <${addr}>`;
};

const infoRow = (label: string, value: any) =>
    `<tr><td style="padding:6px 0;color:#7a8aa3;font-size:13px">${label}</td><td style="padding:6px 0;font-weight:600;color:#1f3361;text-align:right">${value || '-'}</td></tr>`;

// Branded outer shell shared by all transfer emails.
const emailLayout = (title: string, innerHtml: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#f4f7fc;padding:24px;border-radius:16px">
    <div style="background:linear-gradient(135deg,#1f3361,#3d5c93);color:#fff;padding:22px 24px;border-radius:14px;text-align:center">
      <h2 style="margin:0;font-size:20px;letter-spacing:.3px">${title}</h2>
    </div>
    <div style="background:#fff;padding:24px;border-radius:14px;margin-top:12px;color:#33415c;line-height:1.6">
      ${innerHtml}
    </div>
    <p style="text-align:center;color:#7a8aa3;font-size:12px;margin-top:16px">Powered by Yometel DPP</p>
  </div>`;

const ctaButton = (href: string, label: string) =>
    `<p style="text-align:center;margin:24px 0">
       <a href="${href}" style="background:#1976d2;color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:700;display:inline-block">${label}</a>
     </p>`;

// HTML invite email for an unregistered recipient who just received ownership.
const sendOwnershipInviteEmail = async (toEmail: string, opts: any) => {
    const registerUrl = `${webBaseUrl()}/register`;
    const inner = `
        <p>Hello,</p>
        <p><strong>${opts.fromName || 'A product owner'}</strong> has transferred ownership of the following to you:</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          ${infoRow('Product', opts.productName)}
          ${infoRow('Quantity', opts.quantity)}
          ${infoRow('Method', opts.methodLabel)}
        </table>
        <p>To access and manage your product${opts.quantity > 1 ? 's' : ''}, please register using <strong>this email address</strong>:</p>
        ${ctaButton(registerUrl, 'Register to claim')}
        <p style="color:#7a8aa3;font-size:13px">If you did not expect this, you can ignore this email.</p>`;
    const text = `${opts.fromName || 'A product owner'} transferred ownership of "${opts.productName}" (qty ${opts.quantity}) to you. Register at ${registerUrl} using this email to claim it.`;
    await mailTransporter().sendMail({
        from: mailFrom(),
        to: toEmail,
        replyTo: process.env.SMTP_FROM || process.env.SMTP_USER || undefined,
        subject: 'You received product ownership',
        text,
        html: emailLayout('You received product ownership', inner)
    });
};

/**
 * Styled "share this transfer" email sent from the app Buy flow. Looks up the
 * pending transfer by code, embeds its QR inline, and includes a confirmation
 * button — so the recipient (the current owner) can scan or click to confirm.
 */
exports.shareEmail = async (req: any, res: any, next: any) => {
    try {
        const toEmail = String(req.body?.toEmail || '').trim();
        const code = String(req.body?.code || '').trim();
        if (!toEmail || !code) {
            return res.status(400).json({ status: 'fail', message: 'toEmail and code are required' });
        }
        const transfer = await OwnershipTransfer.findOne({ code }).lean();
        if (!transfer) {
            return res.status(404).json({ status: 'fail', message: 'Transfer not found' });
        }

        const url = `${webBaseUrl()}/transfer/${code}`;
        const snap = transfer.productSnapshot || {};
        const buyer = transfer.to_owner || {};

        const qrDataUrl = await qrcode.toDataURL(url);
        const m = qrDataUrl.match(/^data:(.+);base64,(.+)$/);
        const attachments = m
            ? [{ filename: 'transfer-qr.png', content: Buffer.from(m[2], 'base64'), cid: 'transferqr' }]
            : [];

        const inner = `
            <p>Hello,</p>
            <p><strong>${buyer.name || 'A buyer'}</strong> would like to receive ownership of this product. As the current owner, scan the QR code or open the link below to review and confirm the transfer.</p>
            <table style="width:100%;border-collapse:collapse;margin:12px 0">
              ${infoRow('Product', snap.name)}
              ${snap.model ? infoRow('Model', snap.model) : ''}
              ${snap.brandName ? infoRow('Brand', snap.brandName) : ''}
              ${infoRow('Buyer', buyer.name)}
              ${buyer.email ? infoRow('Buyer email', buyer.email) : ''}
            </table>
            ${m ? '<p style="text-align:center;margin:18px 0"><img src="cid:transferqr" alt="Transfer QR code" style="width:200px;height:200px;border:1px solid #e7edf6;border-radius:12px;padding:8px;background:#fff"/></p>' : ''}
            ${ctaButton(url, 'Review &amp; confirm transfer')}
            <p style="color:#7a8aa3;font-size:13px;word-break:break-all">Or open this link: ${url}</p>
            <p style="color:#7a8aa3;font-size:13px">If you did not expect this, you can ignore this email.</p>`;

        const text = `${buyer.name || 'A buyer'} would like to receive ownership of "${snap.name || 'a product'}". Review and confirm the transfer here: ${url}`;

        await mailTransporter().sendMail({
            from: mailFrom(),
            to: toEmail,
            replyTo: process.env.SMTP_FROM || process.env.SMTP_USER || undefined,
            subject: 'Confirm product ownership transfer',
            text,
            html: emailLayout('Ownership transfer request', inner),
            attachments
        });

        return res.status(200).json({ status: 'success' });
    } catch (error: any) {
        return res.status(500).json({ status: 'fail', message: error?.message || 'Failed to send email' });
    }
};

/**
 * Push an in-app purchase-request notification to the product item's current
 * owner (the seller on the transfer). They get an actionable transfer_request
 * notification (Approve/Decline) in the app / admin panel. Idempotent per
 * (transfer, recipient) so re-sending doesn't pile up duplicates.
 */
exports.notifyOwner = async (req: any, res: any, next: any) => {
    try {
        const code = String(req.params?.code || '').trim();
        if (!code) {
            return res.status(400).json({ status: 'fail', message: 'code is required' });
        }

        const transfer = await OwnershipTransfer.findOne({ code }).lean();
        if (!transfer) {
            return res.status(404).json({ status: 'fail', message: 'Transfer not found' });
        }

        // The request goes to the product item's CURRENT owner (the seller),
        // regardless of the email the buyer shared the link with. Re-resolve it
        // live (the from_owner snapshot may be stale or have no id) and fall back
        // to the product's brand company so a real owner account is targeted.
        let owner: any = null;
        const product = await Product.findById(transfer.product_id);
        if (product) {
            owner = await getPrimaryOwnerExcluding(product, { kind: transfer.to_owner?.kind, id: transfer.to_owner?.id });
            if ((!owner || !owner.id) && product.company_id) {
                const c = await Company.findById(product.company_id).lean();
                if (c) owner = { kind: 'Company', id: c._id, email: c.email || '', name: c.name || '' };
            }
        }
        // Last resort: the snapshot stored on the transfer.
        if ((!owner || !owner.id) && transfer.from_owner?.id) {
            owner = transfer.from_owner;
        }

        // Mark the request as actually sent (the buyer pressed Send) regardless of
        // whether a registered owner account exists to receive the in-app notice.
        await OwnershipTransfer.updateOne({ code }, { $set: { requestSent: true } });

        if (!owner || !owner.id) {
            console.warn('notifyOwner: no registered owner to notify for transfer', code);
            return res.status(200).json({ status: 'success', notified: false, reason: 'no_owner' });
        }

        const recipient: any = { kind: owner.kind, id: owner.id, name: owner.name || '', email: owner.email || '' };
        const audience = owner.kind === 'User' ? 'user' : 'company';

        const buyer = transfer.to_owner || {};
        const snap = transfer.productSnapshot || {};

        // Skip if this owner was already notified for this transfer.
        const existing = await Notification.findOne({
            'recipient.id': recipient.id,
            type: 'transfer_request',
            'data.transferCode': transfer.code,
            is_deleted: false
        }).lean();

        if (!existing) {
            await createNotification({
                audience,
                recipient,
                type: 'transfer_request',
                level: 'info',
                title: 'New ownership transfer request',
                message: `${buyer.name || 'A user'} requested to receive "${snap.name || 'a product'}".`,
                data: {
                    transferCode: transfer.code,
                    productId: String(transfer.product_id),
                    productName: snap.name,
                    productImage: snap.image,
                    brandName: snap.brandName,
                    quantity: transfer.quantity || 1,
                    buyerName: buyer.name,
                    buyerEmail: buyer.email,
                    buyerPhone: buyer.phone,
                    buyerCountry: buyer.country
                }
            });
        }

        return res.status(200).json({ status: 'success', notified: true });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /transfer/buyer-status?product_id=&qrcode_id=&buyer_id= — the status of the
 * buyer's latest transfer for a product item. Drives the app Buy button:
 * pending → "Requested", confirmed → "Owned", otherwise → "Buy".
 */
exports.buyerStatus = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.query?.product_id);
        const buyerObjId = toObjectIdIfValid(req.query?.buyer_id);
        const qrcodeIdRaw = req.query?.qrcode_id;
        if (!productObjId || !buyerObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id and buyer_id are required' });
        }
        const q: any = { product_id: productObjId, 'to_owner.id': buyerObjId };
        if (qrcodeIdRaw != null && qrcodeIdRaw !== '') {
            const n = Number(qrcodeIdRaw);
            if (Number.isFinite(n)) q.qrcode_id = n;
        }
        const transfer = await OwnershipTransfer.findOne(q).sort({ createdAt: -1 }).lean();
        return res.status(200).json({
            status: 'success',
            transferStatus: transfer ? transfer.status : null,
            requestSent: transfer ? !!transfer.requestSent : false
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /transfer/product-owner?product_id=&qrcode_id= — the current owner of a
 * specific product ITEM (name + email). Ownership/authentication are keyed by the
 * product id AND the item (qrcode) id together. Shown on the app product page.
 */
const resolveItemOwner = async (product: any, qrcodeIdRaw: any) => {
    // Item-specific: the latest confirmed transfer of THIS item gives its owner.
    const n = Number(qrcodeIdRaw);
    if (qrcodeIdRaw != null && qrcodeIdRaw !== '' && Number.isFinite(n)) {
        const transfer = await OwnershipTransfer.findOne({
            product_id: product._id,
            qrcode_id: n,
            status: 'confirmed'
        }).sort({ confirmed_at: -1, createdAt: -1 }).lean();
        if (transfer?.to_owner?.id) {
            const r = await resolveOwnerIdentity(transfer.to_owner.kind, transfer.to_owner.id);
            if (r.name || r.email) return r;
            return {
                kind: transfer.to_owner.kind,
                id: transfer.to_owner.id,
                name: transfer.to_owner.name || '',
                email: transfer.to_owner.email || ''
            };
        }
    }
    // Untransferred item → the brand/company that created the product.
    if (product.company_id) {
        const c = await Company.findById(product.company_id).lean();
        if (c) return { kind: 'Company', id: c._id, name: c.name || '', email: c.email || '' };
    }
    // Last resort → the product's primary holder.
    const owner = await getPrimaryOwner(product);
    return await resolveOwnerIdentity(owner.kind, owner.id);
};

exports.productOwner = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.query?.product_id);
        if (!productObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id is required' });
        }
        const product = await Product.findById(productObjId);
        if (!product || product.is_deleted) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }
        await ensureSeedHolding(product);
        const resolved = await resolveItemOwner(product, req.query?.qrcode_id);
        return res.status(200).json({
            status: 'success',
            owner: { kind: resolved.kind, name: resolved.name || '', email: resolved.email || '' }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /transfer/owned-item-codes?product_id=&owner_id= — the QR code URLs for the
 * specific product items (qrcode_ids) an owner holds via confirmed transfers.
 * Used to show a normal user only the QR codes of the items they actually own.
 */
exports.ownedItemCodes = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.query?.product_id);
        const ownerObjId = toObjectIdIfValid(req.query?.owner_id);
        if (!productObjId || !ownerObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id and owner_id are required' });
        }

        const product = await Product.findById(productObjId).select('total_minted_amount').lean();
        const totalMinted = product?.total_minted_amount || 0;

        // Authoritative owned count — how many units this owner holds in the ledger.
        const holding = await ProductHolding.findOne({
            product_id: productObjId,
            'owner.id': ownerObjId,
            quantity: { $gt: 0 }
        }).lean();
        const heldQty = holding ? holding.quantity : 0;

        // Prefer the specific items the owner obtained via confirmed transfers
        // (those carry a qrcode_id), then fill up to the held quantity with the
        // remaining product codes — units are fungible in the holdings ledger.
        const transfers = await OwnershipTransfer.find({
            product_id: productObjId,
            'to_owner.id': ownerObjId,
            status: 'confirmed',
            qrcode_id: { $ne: null }
        }).select('qrcode_id').lean();

        const ids: number[] = [];
        const seen = new Set<number>();
        transfers.forEach((t: any) => {
            const n = Number(t.qrcode_id);
            if (Number.isFinite(n) && !seen.has(n)) { seen.add(n); ids.push(n); }
        });
        for (let i = 1; i <= totalMinted && ids.length < heldQty; i++) {
            if (!seen.has(i)) { seen.add(i); ids.push(i); }
        }
        const finalIds = ids.slice(0, heldQty);

        const base = webBaseUrl();
        const data = finalIds.map((id) => `${base}/product/${encodeURIComponent(String(productObjId))}/${encodeURIComponent(String(id))}`);
        return res.status(200).json({ status: 'success', data, qrcodeIds: finalIds, count: finalIds.length });
    } catch (error) {
        next(error);
    }
};

/**
 * Owner-initiated transfer: an owner (or an admin acting for the current owner)
 * transfers `quantity` units of a product to a recipient email. If the recipient
 * is a registered user the holding is assigned to them immediately; otherwise an
 * Email-kind holding is created and an HTML invite email is sent.
 */
exports.ownerInitiate = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.body?.product_id);
        const actorKind = req.body?.actor?.kind;
        const actorObjId = toObjectIdIfValid(req.body?.actor?.id);
        const quantity = Math.max(1, parseInt(req.body?.quantity) || 0);
        const method = METHODS.includes(req.body?.method) ? req.body.method : 'sell';
        const receiverEmail = normalizeEmail(req.body?.receiver_email);

        if (!productObjId || !actorKind || !actorObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id and actor are required' });
        }
        if (!receiverEmail) {
            return res.status(400).json({ status: 'fail', message: 'receiver_email is required' });
        }

        const product = await Product.findById(productObjId);
        if (!product || product.is_deleted) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }

        // Validate the actor exists and detect admin (company named "admin").
        const actorDoc = actorKind === 'User'
            ? await User.findById(actorObjId).lean()
            : await Company.findById(actorObjId).lean();
        if (!actorDoc) {
            return res.status(401).json({ status: 'fail', message: 'Actor not found' });
        }
        const isAdmin = actorKind === 'Company' && actorDoc.name === 'admin';

        await ensureSeedHolding(product);

        // The selling party: admin transfers on behalf of the current primary owner.
        const fromOwner = isAdmin
            ? await getPrimaryOwner(product)
            : { kind: actorKind, id: actorObjId, email: actorDoc.email || '', name: actorDoc.name || '' };

        const available = await ownerHolds(product._id, fromOwner);
        if (available < quantity) {
            return res.status(409).json({ status: 'fail', message: `Not enough units to transfer (available ${available})` });
        }

        // Resolve the recipient — registered user or an email invite.
        const recipientUser = await User.findOne({ email: receiverEmail }).lean();
        const toOwner = recipientUser
            ? {
                kind: 'User',
                id: recipientUser._id,
                email: recipientUser.email,
                name: [recipientUser.firstName, recipientUser.lastName].filter(Boolean).join(' ').trim() || recipientUser.name || ''
            }
            : { kind: 'Email', id: null, email: receiverEmail, name: '' };

        if (fromOwner.kind === toOwner.kind && String(fromOwner.id || fromOwner.email) === String(toOwner.id || toOwner.email)) {
            return res.status(409).json({ status: 'fail', message: 'Cannot transfer to the current owner' });
        }

        await moveHolding(product, fromOwner, toOwner, quantity);

        const fromSnapshot = await resolveOwnerIdentity(fromOwner.kind, fromOwner.id, fromOwner.email);
        const transfer = await OwnershipTransfer.create({
            product_id: product._id,
            qrcode_id: null,
            code: crypto.randomBytes(16).toString('base64url'),
            method,
            quantity,
            status: 'confirmed',
            productSnapshot: buildProductSnapshot(product),
            from_owner: { kind: fromSnapshot.kind, id: fromSnapshot.id, name: fromSnapshot.name, email: fromSnapshot.email },
            to_owner: { kind: toOwner.kind, id: toOwner.id, name: toOwner.name, email: toOwner.email },
            confirmed_by: { kind: actorKind, id: actorObjId },
            confirmed_at: new Date()
        });

        // Notify a registered receiver that a product was transferred to them.
        if (recipientUser && toOwner.id) {
            await createNotification({
                audience: 'user',
                recipient: { kind: 'User', id: toOwner.id, name: toOwner.name, email: toOwner.email },
                type: 'transfer_received',
                level: 'success',
                title: 'You received a product',
                message: `${fromSnapshot.name || 'A sender'} transferred "${product.name}" to you${quantity > 1 ? ` (x${quantity})` : ''}.`,
                data: { transferCode: transfer.code, productId: String(product._id), productName: product.name, quantity }
            });
        }

        let invited = false;
        if (toOwner.kind === 'Email') {
            try {
                await sendOwnershipInviteEmail(receiverEmail, {
                    fromName: fromSnapshot.name,
                    productName: product.name,
                    quantity,
                    methodLabel: METHOD_LABELS[method] || method
                });
                invited = true;
            } catch (mailErr) {
                console.error('Invite email failed:', mailErr);
            }
        }

        try {
            // @ts-ignore
            global.io && global.io.emit('Refresh user data');
        } catch (e) { /* socket optional */ }

        return res.status(200).json({ status: 'success', invited, recipientRegistered: !!recipientUser, transfer });
    } catch (error: any) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ status: 'fail', message: error.message });
        }
        next(error);
    }
};

/** Products the user currently owns (held units), for the app "My products" page. */
exports.myProducts = async (req: any, res: any, next: any) => {
    try {
        const userObjId = toObjectIdIfValid(req.query?.user_id);
        if (!userObjId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        const user = await User.findById(userObjId).lean();
        if (user) {
            await claimEmailHoldings(user);
        }

        const holdings = await ProductHolding.find({
            'owner.kind': 'User',
            'owner.id': userObjId,
            quantity: { $gt: 0 }
        }).lean();

        const qtyMap: any = {};
        holdings.forEach((h: any) => { qtyMap[String(h.product_id)] = h.quantity; });
        const productIds = holdings.map((h: any) => h.product_id);

        const products = await Product.find({ _id: { $in: productIds }, is_deleted: { $ne: true } }).lean();
        const data = products.map((p: any) => ({ ...p, heldQuantity: qtyMap[String(p._id)] || 0 }));

        return res.status(200).json({ status: 'success', data });
    } catch (error) {
        next(error);
    }
};

/**
 * Products owned by an arbitrary owner (User or Company), each annotated with
 * `heldQuantity` (units currently held). Powers the admin "Products" list and
 * its per-product owned-count when a User or brand company is logged in.
 *
 * For a Company owner this also includes products the company created
 * (company_id) whose seed holding hasn't been materialized yet — those count as
 * the full minted amount, matching getPrimaryOwner's fallback.
 */
exports.ownedProducts = async (req: any, res: any, next: any) => {
    try {
        const ownerKind = req.query?.owner_kind === 'Company' ? 'Company' : 'User';
        const ownerObjId = toObjectIdIfValid(req.query?.owner_id);
        if (!ownerObjId) {
            return res.status(400).json({ status: 'fail', message: 'owner_id is required' });
        }

        // Claim any email-invite holdings so a freshly registered user sees them.
        if (ownerKind === 'User') {
            const user = await User.findById(ownerObjId).lean();
            if (user) await claimEmailHoldings(user);
        }

        const holdings = await ProductHolding.find({
            'owner.kind': ownerKind,
            'owner.id': ownerObjId,
            quantity: { $gt: 0 }
        }).lean();

        const qtyMap: any = {};
        const idSet = new Set<string>();
        holdings.forEach((h: any) => {
            qtyMap[String(h.product_id)] = h.quantity;
            idSet.add(String(h.product_id));
        });

        // Brand company: also surface products it created (company_id).
        if (ownerKind === 'Company') {
            const created = await Product.find({ company_id: ownerObjId, is_deleted: { $ne: true } }).select('_id').lean();
            created.forEach((p: any) => idSet.add(String(p._id)));
        }

        const ids = [...idSet].map((id) => new mongoose.Types.ObjectId(id));
        const products = await Product.find({ _id: { $in: ids }, is_deleted: { $ne: true } })
            .populate('company_id', 'name email')
            .lean();

        const data = products.map((p: any) => {
            const pid = String(p._id);
            let qty = qtyMap[pid];
            if (qty == null) {
                // No ledger row yet: a brand company holds the full minted amount.
                const companyIdStr = String(p.company_id?._id || p.company_id || '');
                qty = ownerKind === 'Company' && companyIdStr === String(ownerObjId)
                    ? (p.total_minted_amount || 0)
                    : 0;
            }
            return { ...p, heldQuantity: qty };
        });

        return res.status(200).json({ status: 'success', data });
    } catch (error) {
        next(error);
    }
};

/**
 * How many units the acting party can transfer for a product. For an admin
 * (company named "admin") this is the product's current primary owner's holding;
 * for any other actor it's their own holding. Drives the admin dialog's max.
 */
exports.available = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.query?.product_id);
        const actorKind = req.query?.actor_kind;
        const actorObjId = toObjectIdIfValid(req.query?.actor_id);
        if (!productObjId || !actorKind || !actorObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id and actor are required' });
        }
        const product = await Product.findById(productObjId);
        if (!product) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }
        await ensureSeedHolding(product);

        let fromOwner: any;
        if (actorKind === 'Company') {
            const c = await Company.findById(actorObjId).lean();
            fromOwner = c && c.name === 'admin'
                ? await getPrimaryOwner(product)
                : { kind: 'Company', id: actorObjId };
        } else {
            fromOwner = { kind: actorKind, id: actorObjId };
        }

        const available = await ownerHolds(product._id, fromOwner);
        return res.status(200).json({
            status: 'success',
            available,
            total_minted: product.total_minted_amount || 0,
            owner: { kind: fromOwner.kind, id: fromOwner.id, name: fromOwner.name || '' }
        });
    } catch (error) {
        next(error);
    }
};

/** Products the user previously owned and has since transferred away ("Sell"). */
exports.sold = async (req: any, res: any, next: any) => {
    try {
        const userObjId = toObjectIdIfValid(req.query?.user_id);
        if (!userObjId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        // "Sold" = confirmed transfers where this user was the seller — either the
        // source owner, or the owner who confirmed a buyer's request.
        const transfers = await OwnershipTransfer.find({
            status: 'confirmed',
            $or: [
                { 'from_owner.kind': 'User', 'from_owner.id': userObjId },
                { 'confirmed_by.kind': 'User', 'confirmed_by.id': userObjId }
            ]
        }).sort({ confirmed_at: -1, createdAt: -1 }).lean();

        const data = transfers.map((t: any) => ({
            _id: t.product_id,
            transfer_id: t._id,
            name: t.productSnapshot?.name || '',
            model: t.productSnapshot?.model || '',
            images: t.productSnapshot?.image ? [t.productSnapshot.image] : [],
            brandName: t.productSnapshot?.brandName || '',
            quantity: t.quantity || 1,
            method: t.method,
            to_owner: t.to_owner,
            soldAt: t.confirmed_at || t.createdAt
        }));

        return res.status(200).json({ status: 'success', data });
    } catch (error) {
        next(error);
    }
};

/**
 * Buy-request history for a user: every transfer where they are the recipient
 * (tapped Buy / received an invite), with status pending / approved (confirmed).
 */
exports.purchases = async (req: any, res: any, next: any) => {
    try {
        const userObjId = toObjectIdIfValid(req.query?.user_id);
        if (!userObjId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        const transfers = await OwnershipTransfer.find({ 'to_owner.id': userObjId })
            .sort({ createdAt: -1 })
            .lean();
        const data = transfers.map((t: any) => ({
            _id: t._id,
            product_id: t.product_id,
            token_id: t.qrcode_id,
            name: t.productSnapshot?.name || '',
            model: t.productSnapshot?.model || '',
            image: t.productSnapshot?.image || '',
            brandName: t.productSnapshot?.brandName || '',
            quantity: t.quantity || 1,
            method: t.method,
            status: t.status,            // pending | confirmed(=approved) | rejected | cancelled
            time: t.createdAt,
            confirmed_at: t.confirmed_at
        }));
        return res.status(200).json({ status: 'success', data });
    } catch (error) {
        next(error);
    }
};

/**
 * Unified per-user activity feed: scans/visits, like/dislike/buy reactions, and
 * ownership transfers (given) / receives. Newest first.
 */
exports.activity = async (req: any, res: any, next: any) => {
    try {
        const userObjId = toObjectIdIfValid(req.query?.user_id);
        if (!userObjId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }

        const productLookup = [
            { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } }
        ];

        const scans = await ScanRecord.aggregate([
            { $match: { user_id: userObjId } },
            { $sort: { scanned_at: -1 } },
            { $limit: 200 },
            ...productLookup,
            {
                $project: {
                    type: { $cond: [{ $eq: ['$source', 'visit'] }, 'visit', 'scan'] },
                    product_id: '$product_id',
                    token: '$qrcode_id',
                    productName: '$product.name',
                    productImage: { $arrayElemAt: ['$product.images', 0] },
                    time: '$scanned_at',
                    status: 'done'
                }
            }
        ]);

        const reactions = await ProductReaction.aggregate([
            { $match: { user_id: userObjId } },
            { $sort: { updatedAt: -1 } },
            { $limit: 200 },
            ...productLookup,
            {
                $project: {
                    type: '$reaction', // like | dislike | buy
                    product_id: '$product_id',
                    token: '$token_id',
                    productName: '$product.name',
                    productImage: { $arrayElemAt: ['$product.images', 0] },
                    time: '$updatedAt',
                    status: 'done'
                }
            }
        ]);

        const transfers = await OwnershipTransfer.find({
            $or: [
                { 'to_owner.id': userObjId },
                { 'from_owner.kind': 'User', 'from_owner.id': userObjId },
                { 'confirmed_by.kind': 'User', 'confirmed_by.id': userObjId }
            ]
        }).sort({ createdAt: -1 }).limit(300).lean();

        const transferEvents = transfers.map((t: any) => {
            const isReceiver = String(t.to_owner?.id) === String(userObjId);
            return {
                type: isReceiver ? 'receive' : 'transfer',
                product_id: t.product_id,
                token: t.qrcode_id,
                productName: t.productSnapshot?.name || '',
                productImage: t.productSnapshot?.image || '',
                time: t.confirmed_at || t.createdAt,
                status: t.status,
                method: t.method,
                quantity: t.quantity
            };
        });

        const all = [...scans, ...reactions, ...transferEvents]
            .filter((e: any) => e.time)
            .sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, 300);

        return res.status(200).json({ status: 'success', data: all });
    } catch (error) {
        next(error);
    }
};

/** How many units of a product a given owner holds (app Transfer-button gate). */
exports.holding = async (req: any, res: any, next: any) => {
    try {
        const productObjId = toObjectIdIfValid(req.query?.product_id);
        const ownerKind = req.query?.owner_kind || 'User';
        const ownerObjId = toObjectIdIfValid(req.query?.owner_id);
        if (!productObjId || !ownerObjId) {
            return res.status(400).json({ status: 'fail', message: 'product_id and owner_id are required' });
        }
        const product = await Product.findById(productObjId);
        if (!product) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }
        await ensureSeedHolding(product);
        const quantity = await ownerHolds(product._id, { kind: ownerKind, id: ownerObjId });
        return res.status(200).json({
            status: 'success',
            quantity,
            total_minted: product.total_minted_amount || 0
        });
    } catch (error) {
        next(error);
    }
};
