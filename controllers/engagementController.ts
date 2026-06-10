const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const FollowedBrand = require('../models/followedBrandModel');
const AlbumItem = require('../models/albumItemModel');
const PurchaseHistory = require('../models/purchaseHistoryModel');
const ProductReaction = require('../models/productReactionModel');

const normalizeWebsite = (url: string) => {
    const raw = String(url || '').trim();
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return withProtocol.toLowerCase();
};

const toObjectIdIfValid = (mongoose: any, value: any) => {
    if (!value) return null;
    const str = String(value);
    return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
};

const isPoolDestroyedError = (error: any) => /pool destroyed|pool is closed|connection.+closed|topology.+closed/i.test(String(error?.message || ''));

const ensureDbConnection = async () => {
    if (mongoose.connection.readyState === 1) return;
    if (!process.env.DATABASE) {
        throw new Error('Database connection string is missing');
    }
    await mongoose.connect(process.env.DATABASE);
};

const runWithDbRetry = async (runner: () => Promise<any>) => {
    try {
        await ensureDbConnection();
        return await runner();
    } catch (error: any) {
        if (!isPoolDestroyedError(error)) {
            throw error;
        }
        await ensureDbConnection();
        return await runner();
    }
};

exports.getFollowStatus = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        const website = normalizeWebsite(req.query?.brandWebsiteUrl);
        if (!userId || !website) {
            return res.status(400).json({ status: 'fail', message: 'user_id and brandWebsiteUrl are required' });
        }
        const doc = await FollowedBrand.findOne({ user_id: userId, brandWebsiteUrl: website });
        return res.status(200).json({ status: 'success', following: !!doc });
    } catch (error) {
        next(error);
    }
};

exports.followBrand = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.body?.user_id);
        const website = normalizeWebsite(req.body?.brandWebsiteUrl);
        if (!userId || !website) {
            return res.status(400).json({ status: 'fail', message: 'user_id and brandWebsiteUrl are required' });
        }

        const payload = {
            user_id: userId,
            brandWebsiteUrl: website,
            brandName: String(req.body?.brandName || '').trim(),
            brandDetail: String(req.body?.brandDetail || '').trim(),
            brandLogoUrl: String(req.body?.brandLogoUrl || '').trim(),
        };

        await FollowedBrand.findOneAndUpdate(
            { user_id: userId, brandWebsiteUrl: website },
            payload,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return res.status(200).json({ status: 'success', following: true });
    } catch (error) {
        next(error);
    }
};

exports.unfollowBrand = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.body?.user_id);
        const website = normalizeWebsite(req.body?.brandWebsiteUrl);
        if (!userId || !website) {
            return res.status(400).json({ status: 'fail', message: 'user_id and brandWebsiteUrl are required' });
        }
        await FollowedBrand.findOneAndDelete({ user_id: userId, brandWebsiteUrl: website });
        return res.status(200).json({ status: 'success', following: false });
    } catch (error) {
        next(error);
    }
};

exports.listFollowedBrands = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        if (!userId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        const docs = await runWithDbRetry(() =>
            FollowedBrand.find({ user_id: userId }).sort({ updatedAt: -1 }).lean()
        );
        return res.status(200).json({ status: 'success', data: docs });
    } catch (error) {
        if (isPoolDestroyedError(error)) {
            return res.status(503).json({ status: 'error', message: 'Database connection is temporarily unavailable. Please try again.' });
        }
        next(error);
    }
};

exports.getAlbumStatus = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        const productId = toObjectIdIfValid(mongoose, req.query?.product_id);
        const tokenId = req.query?.token_id != null ? Number(req.query.token_id) : null;
        if (!userId || !productId) {
            return res.status(400).json({ status: 'fail', message: 'user_id and product_id are required' });
        }
        const doc = await AlbumItem.findOne({ user_id: userId, product_id: productId, token_id: tokenId });
        return res.status(200).json({ status: 'success', added: !!doc });
    } catch (error) {
        next(error);
    }
};

exports.addAlbumItem = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.body?.user_id);
        const productId = toObjectIdIfValid(mongoose, req.body?.product_id);
        const tokenId = req.body?.token_id != null ? Number(req.body.token_id) : null;
        if (!userId || !productId) {
            return res.status(400).json({ status: 'fail', message: 'user_id and product_id are required' });
        }
        const snapshot = req.body?.productSnapshot || {};
        await AlbumItem.findOneAndUpdate(
            { user_id: userId, product_id: productId, token_id: tokenId },
            {
                user_id: userId,
                product_id: productId,
                token_id: tokenId,
                productSnapshot: {
                    name: snapshot.name || '',
                    model: snapshot.model || '',
                    detail: snapshot.detail || '',
                    images: Array.isArray(snapshot.images) ? snapshot.images : [],
                    brandInfo: {
                        name: snapshot.brandInfo?.name || '',
                        detail: snapshot.brandInfo?.detail || '',
                        websiteUrl: snapshot.brandInfo?.websiteUrl || '',
                        logoUrl: snapshot.brandInfo?.logoUrl || ''
                    }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return res.status(200).json({ status: 'success', added: true });
    } catch (error) {
        next(error);
    }
};

exports.removeAlbumItem = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.body?.user_id);
        const productId = toObjectIdIfValid(mongoose, req.body?.product_id);
        const tokenId = req.body?.token_id != null ? Number(req.body.token_id) : null;
        if (!userId || !productId) {
            return res.status(400).json({ status: 'fail', message: 'user_id and product_id are required' });
        }
        await AlbumItem.findOneAndDelete({ user_id: userId, product_id: productId, token_id: tokenId });
        return res.status(200).json({ status: 'success', added: false });
    } catch (error) {
        next(error);
    }
};

exports.listAlbumItems = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        if (!userId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        const docs = await runWithDbRetry(() => AlbumItem.find({ user_id: userId }).sort({ updatedAt: -1 }));
        return res.status(200).json({ status: 'success', data: docs });
    } catch (error) {
        if (isPoolDestroyedError(error)) {
            return res.status(503).json({ status: 'error', message: 'Database connection is temporarily unavailable. Please try again.' });
        }
        next(error);
    }
};

exports.addPurchaseHistory = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.body?.user_id);
        const productId = toObjectIdIfValid(mongoose, req.body?.product_id);
        const tokenId = req.body?.token_id != null ? Number(req.body.token_id) : null;
        if (!userId || !productId) {
            return res.status(400).json({ status: 'fail', message: 'user_id and product_id are required' });
        }
        const snapshot = req.body?.productSnapshot || {};
        await PurchaseHistory.findOneAndUpdate(
            { user_id: userId, product_id: productId, token_id: tokenId },
            {
                user_id: userId,
                product_id: productId,
                token_id: tokenId,
                productSnapshot: {
                    name: snapshot.name || '',
                    model: snapshot.model || '',
                    detail: snapshot.detail || '',
                    images: Array.isArray(snapshot.images) ? snapshot.images : [],
                    brandInfo: {
                        name: snapshot.brandInfo?.name || '',
                        detail: snapshot.brandInfo?.detail || '',
                        websiteUrl: snapshot.brandInfo?.websiteUrl || '',
                        logoUrl: snapshot.brandInfo?.logoUrl || ''
                    }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};

exports.listPurchaseHistory = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        if (!userId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        const docs = await runWithDbRetry(() => PurchaseHistory.find({ user_id: userId }).sort({ updatedAt: -1 }));
        return res.status(200).json({ status: 'success', data: docs });
    } catch (error) {
        if (isPoolDestroyedError(error)) {
            return res.status(503).json({ status: 'error', message: 'Database connection is temporarily unavailable. Please try again.' });
        }
        next(error);
    }
};

exports.setProductReaction = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.body?.user_id);
        const productId = toObjectIdIfValid(mongoose, req.body?.product_id);
        const tokenId = req.body?.token_id != null && req.body?.token_id !== '' ? Number(req.body.token_id) : null;
        if (!userId || !productId) {
            return res.status(400).json({ status: 'fail', message: 'user_id and product_id are required' });
        }
        if (tokenId == null || !Number.isFinite(tokenId)) {
            return res.status(400).json({ status: 'fail', message: 'token_id is required' });
        }
        const reaction = req.body?.reaction;
        if (reaction == null || reaction === '') {
            await ProductReaction.deleteOne({ user_id: userId, product_id: productId, token_id: tokenId });
            return res.status(200).json({ status: 'success', reaction: null });
        }
        const r = String(reaction).toLowerCase();
        if (!['like', 'dislike', 'buy'].includes(r)) {
            return res.status(400).json({ status: 'fail', message: 'reaction must be like, dislike, buy, or empty to clear' });
        }
        await ProductReaction.findOneAndUpdate(
            { user_id: userId, product_id: productId, token_id: tokenId },
            { user_id: userId, product_id: productId, token_id: tokenId, reaction: r },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return res.status(200).json({ status: 'success', reaction: r });
    } catch (error) {
        next(error);
    }
};

exports.getProductReaction = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        const productId = toObjectIdIfValid(mongoose, req.query?.product_id);
        const tokenId = req.query?.token_id != null && req.query?.token_id !== '' ? Number(req.query.token_id) : null;
        if (!userId || !productId || tokenId == null || !Number.isFinite(tokenId)) {
            return res.status(400).json({ status: 'fail', message: 'user_id, product_id and token_id are required' });
        }
        const doc = await ProductReaction.findOne({ user_id: userId, product_id: productId, token_id: tokenId }).lean();
        return res.status(200).json({ status: 'success', reaction: doc?.reaction || null });
    } catch (error) {
        next(error);
    }
};

exports.listProductReactions = async (req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const userId = toObjectIdIfValid(mongoose, req.query?.user_id);
        if (!userId) {
            return res.status(400).json({ status: 'fail', message: 'user_id is required' });
        }
        const docs = await runWithDbRetry(() => ProductReaction.find({ user_id: userId }).sort({ updatedAt: -1 }).lean());
        return res.status(200).json({ status: 'success', data: docs });
    } catch (error) {
        if (isPoolDestroyedError(error)) {
            return res.status(503).json({ status: 'error', message: 'Database connection is temporarily unavailable. Please try again.' });
        }
        next(error);
    }
};

exports.sendBrandOrProductEmail = async (req: any, res: any, next: any) => {
    try {
        const toEmail = String(req.body?.toEmail || '').trim();
        const subject = String(req.body?.subject || 'Brand information').trim();
        const content = String(req.body?.content || '').trim();
        const html = req.body?.html ? String(req.body.html) : '';
        const attachmentDataUrl = req.body?.attachmentDataUrl ? String(req.body.attachmentDataUrl) : '';
        if (!toEmail || !content) {
            return res.status(400).json({ status: 'fail', message: 'toEmail and content are required' });
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: Number(process.env.SMTP_PORT || 587),
            secure: false,
            auth: process.env.SMTP_USER && process.env.SMTP_PASS
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined
        });

        const mail: any = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@yometel.jp',
            to: toEmail,
            subject,
            text: content
        };

        // Optional inline QR image (data URL). Embed via CID so it renders in-body.
        const match = attachmentDataUrl.match(/^data:(.+);base64,(.+)$/);
        if (match) {
            const buffer = Buffer.from(match[2], 'base64');
            mail.attachments = [{
                filename: 'transfer-qr.png',
                content: buffer,
                cid: 'transferqr'
            }];
            mail.html = html
                ? `${html}<br/><img src="cid:transferqr" alt="QR code" style="width:240px;height:240px"/>`
                : `<pre style="font-family:inherit">${content}</pre><br/><img src="cid:transferqr" alt="QR code" style="width:240px;height:240px"/>`;
        } else if (html) {
            mail.html = html;
        }

        await transporter.sendMail(mail);

        return res.status(200).json({ status: 'success' });
    } catch (error: any) {
        return res.status(500).json({
            status: 'fail',
            message: error?.message || 'Failed to send email'
        });
    }
};
