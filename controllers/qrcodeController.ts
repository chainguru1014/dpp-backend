const QRcode = require('../models/qrcodeModel');
const SecurityQRCode = require('../models/securityQRCodeModel');
const Serials = require('../models/serialModal')
const Product = require('../models/productModel');
const Company = require('../models/companyModel');
const ScanRecord = require('../models/scanRecordModel');
const User = require('../models/userModel');
const ProductReaction = require('../models/productReactionModel');
const base = require('./baseController');
const APIFeatures = require('../utils/apiFeatures');
const { encrypt, decrypt } = require('../utils/helper');
const { getOwnedProductIds } = require('../utils/ownership');
const qrcode = require('qrcode');
const mongoose = require('mongoose');

// Resolve an optional owner scope (owner_kind + owner_id) from a request into a
// product_id $in filter. Returns null when no owner scope is requested.
const resolveOwnerProductMatch = async (req: any) => {
    const ownerKind = req.query?.owner_kind === 'User' ? 'User' : req.query?.owner_kind === 'Company' ? 'Company' : null;
    const ownerId = req.query?.owner_id;
    if (!ownerKind || !ownerId || !mongoose.Types.ObjectId.isValid(String(ownerId))) return null;
    const ids = await getOwnedProductIds(ownerKind, new mongoose.Types.ObjectId(String(ownerId)));
    return { ids, filter: { product_id: { $in: ids } } };
};

const divcount = 20000;
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://dpp.innosynch.com').replace(/\/+$/, '');

const buildPublicProductUrl = (productId: any, qrCodeId: any) => {
    return `${PUBLIC_APP_URL}/product/${encodeURIComponent(String(productId))}/${encodeURIComponent(String(qrCodeId))}`;
};

const extractProductFromQrUrl = (qrUrl: string) => {
    if (!qrUrl || typeof qrUrl !== 'string') {
        return null;
    }

    let normalizedUrl = String(qrUrl).trim();

    // Support wrapped format:
    //   http://localhost:3000?qrcode=https%3A%2F%2Fhost%2Fproduct%2F:id%2F:qrcodeId
    const qrcodeParamIndex = normalizedUrl.indexOf('qrcode=');
    if (qrcodeParamIndex >= 0) {
        const encodedValue = normalizedUrl.substring(qrcodeParamIndex + 'qrcode='.length).split('&')[0];
        try {
            normalizedUrl = decodeURIComponent(encodedValue);
        } catch (error) {
            normalizedUrl = encodedValue;
        }
    }

    const match = normalizedUrl.match(/\/product\/([^/?#]+)\/([^/?#]+)/i);
    if (!match) {
        return null;
    }

    const productId = decodeURIComponent(match[1]);
    const qrcodeId = Number(decodeURIComponent(match[2]));
    if (!productId || !Number.isFinite(qrcodeId)) {
        return null;
    }

    return { productId, qrcodeId };
};

const getPublicProductPayload = async (productId: any, qrcodeId: any) => {
    const numericQrId = Number(qrcodeId);
    if (!Number.isFinite(numericQrId)) {
        return null;
    }

    const qrcodeData = await QRcode.findOne({ product_id: productId, qrcode_id: numericQrId }).populate('company_id');
    if (!qrcodeData) {
        return null;
    }

    const product = await Product.findById(productId);
    if (!product) {
        return null;
    }

    const serials = await Serials.find({ product_id: productId, qrcode_id: numericQrId });
    const normalizedProduct = normalizeProductMedia(product?._doc || {});
    const scannedQRCode = buildPublicProductUrl(productId, numericQrId);
    const qrcodeImage = await qrcode.toDataURL(scannedQRCode);

    return {
        token_id: numericQrId,
        location: qrcodeData.company_id?.location || '',
        ...normalizedProduct,
        ownerInfo: qrcodeData.company_id ? {
            name: qrcodeData.company_id?.name || '',
            email: qrcodeData.company_id?.email || '',
            phoneNumber: qrcodeData.company_id?.phoneNumber || '',
            address: qrcodeData.company_id?.location || ''
        } : null,
        qrcode_img: qrcodeImage,
        serialInfos: serials,
        scannedQRCode
    };
};

const toStringArray = (value: any): string[] => {
    if (value == null) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item: any) => toStringArray(item));
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    if (typeof value === 'object') {
        return Object.values(value).flatMap((item: any) => toStringArray(item));
    }

    return [];
};

const toArray = (value: any): any[] => {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'object') {
        return Object.values(value);
    }
    return [value];
};

const normalizeProductMedia = (productDoc: any) => {
    if (!productDoc || typeof productDoc !== 'object') {
        return productDoc;
    }

    const normalized = { ...productDoc };
    normalized.images = toStringArray(productDoc.images);
    normalized.files = toStringArray(productDoc.files);
    normalized.videos = toArray(productDoc.videos);

    if (productDoc.warrantyAndGuarantee && typeof productDoc.warrantyAndGuarantee === 'object') {
        normalized.warrantyAndGuarantee = {
            ...productDoc.warrantyAndGuarantee,
            images: toStringArray(productDoc.warrantyAndGuarantee.images),
            files: toStringArray(productDoc.warrantyAndGuarantee.files),
            videos: toArray(productDoc.warrantyAndGuarantee.videos)
        };
    }

    if (productDoc.manualsAndCerts && typeof productDoc.manualsAndCerts === 'object') {
        normalized.manualsAndCerts = {
            ...productDoc.manualsAndCerts,
            images: toStringArray(productDoc.manualsAndCerts.images),
            files: toStringArray(productDoc.manualsAndCerts.files),
            videos: toArray(productDoc.manualsAndCerts.videos)
        };
    }

    return normalized;
};

exports.getAllQRcodes = base.getAll(QRcode);
exports.getQRcode = base.getOne(QRcode);

// Don't update password on this 
exports.updateQRcode = base.updateOne(QRcode);
exports.deleteQRcode = base.deleteOne(QRcode);
exports.addQRcode = base.createOne(QRcode);

exports.getQRcodesWithProductId = async(req: any, res: any, next: any) => {
    try {
        // const doc = await QRcode.find({ product_id: req.body.product_id }).skip(req.body.offset).limit(req.body.amount);
        const product = await Product.findById(req.body.product_id);

        let data = [];
        let count = 100;
        
        if (req.body.page == 0) {
            
            for (let i = req.body.from; i <= req.body.to; i ++) {
                if (i > 0 && i <= product.total_minted_amount) {
                    data.push(buildPublicProductUrl(product._id, i));
                }
            }
        } else if (req.body.page > 0) {
            if (req.body.page == Math.ceil(product.total_minted_amount / 100) && product.total_minted_amount % 100) {
                count = product.total_minted_amount % 100;
            } 
            else if (req.body.page > Math.ceil(product.total_minted_amount / 100)) {
                count = 0;
            }
            
            for (let i = 1; i <= count; i ++) {
                data.push(buildPublicProductUrl(product._id, (req.body.page - 1) * 100 + i));
            }
        }

        res.status(200).json({
            status: 'success',
            data
        });
        
    } catch (error) {
        next(error);
    }

};

exports.decrypt = async (req: any, res: any, next: any) => { 
    try {
        if (!req.body || !req.body.encryptData) {
            return res.status(400).json({
                status: 'fail',
                message: 'encryptData is required'
            });
        }

        console.log(req.body.encryptData);
        const rawValue = String(req.body.encryptData || '').trim();

        // Backward-compatible support:
        // If URL-format QR value is sent to /decrypt, resolve it as product QR URL.
        const parsedFromUrl = extractProductFromQrUrl(rawValue);
        if (parsedFromUrl) {
            const payload = await getPublicProductPayload(parsedFromUrl.productId, parsedFromUrl.qrcodeId);
            if (!payload) {
                return res.status(404).json({
                    status: 'fail',
                    message: 'Product not found'
                });
            }

            return res.status(200).json({
                status: 'success',
                data: payload,
                type: 'Product'
            });
        }

        const data = JSON.parse(decrypt(rawValue));
        console.log(data);

        if(data.product_id) {
            const qrcodeData = await QRcode.findOne({product_id: data.product_id, qrcode_id: data.token_id}).populate('company_id');
            console.log(qrcodeData);

            if (!qrcodeData) {
                return res.status(404).json({
                    status: 'fail',
                    message: 'QR code data not found'
                });
            }

            const product = await Product.findById(data.product_id);
            if (!product) {
                return res.status(404).json({
                    status: 'fail',
                    message: 'Product not found'
                });
            }
            const serials = await Serials.find({product_id:data.product_id,qrcode_id:data.token_id});
            const normalizedProduct = normalizeProductMedia(product?._doc || {});

            const qrcodeImage = await qrcode.toDataURL(buildPublicProductUrl(data.product_id, data.token_id));

            const resData = {
                token_id: data.token_id,
                location: qrcodeData.company_id?.location || '',
                ...normalizedProduct,
                qrcode_img: qrcodeImage,
                serialInfos:serials
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'Product'
            });
        } else if (data.user_id) {
            const company = await Company.findById(data.user_id);
            if (!company) {
                return res.status(404).json({
                    status: 'fail',
                    message: 'Company not found'
                });
            }
            company.privateKey = undefined;
            company.password = undefined;
            console.log(company);
            const qrcodeImage = await qrcode.toDataURL('https://4dveritaspublic.com?qrcode=' + req.body.encryptData);
            
            const resData = {
                token_id: data.token_id,
                ...company._doc,
                qrcode_img: qrcodeImage
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'User'
            });
        } else {
            return res.status(400).json({
                status: 'fail',
                message: 'Invalid decrypted payload'
            });
        }
    } catch (error: any) {
        const rawMessage = String(error?.message || '');
        if (/pool destroyed|pool is closed|connection.+closed|topology.+closed/i.test(rawMessage)) {
            return res.status(503).json({
                status: 'error',
                message: 'Database connection is temporarily unavailable. Please try again.'
            });
        }
        next(error);
    }
};

exports.recordScan = async (req: any, res: any, next: any) => {
    try {
        const { product_id, token_id, encryptData, user_id, source, location, security_verified, security_qrcode_id } = req.body || {};
        const sourceNorm = String(source || 'scan').toLowerCase() === 'visit' ? 'visit' : 'scan';

        if (!product_id || token_id == null || !encryptData) {
            return res.status(400).json({
                status: 'fail',
                message: 'product_id, token_id and encryptData are required'
            });
        }

        // Capture requester IP (respect proxy headers).
        const ip = String(
            (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
            req.socket?.remoteAddress ||
            req.ip ||
            ''
        );

        const loc = location && typeof location === 'object' ? {
            country: location.country || '',
            region: location.region || '',
            city: location.city || '',
            latitude: location.latitude != null ? Number(location.latitude) : null,
            longitude: location.longitude != null ? Number(location.longitude) : null,
            source: location.source || (location.latitude != null ? 'gps' : '')
        } : undefined;

        await ScanRecord.create({
            product_id,
            qrcode_id: Number(token_id),
            encrypt_data: String(encryptData),
            user_id: user_id || undefined,
            scanned_at: new Date(),
            source: sourceNorm,
            ip,
            location: loc,
            security_verified: typeof security_verified === 'boolean' ? security_verified : null,
            security_qrcode_id: security_qrcode_id != null ? Number(security_qrcode_id) : null
        });

        return res.status(201).json({
            status: 'success'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Admin scan-history feed. Joins each scan with the (optional) logged-in user,
 * the product, and that user's reactions (like/dislike/buy) for the product.
 * Supports filtering (date range, product, user, source, security, reaction,
 * logged-in) + free-text search, with pagination.
 */
exports.getScanHistory = async (req: any, res: any, next: any) => {
    try {
        const {
            page = 1, limit = 25, from, to, product_id, user_id,
            source, security, reaction, loggedIn, q
        } = req.query || {};

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 25));

        const match: any = {};
        if (product_id && mongoose.Types.ObjectId.isValid(String(product_id))) {
            match.product_id = new mongoose.Types.ObjectId(String(product_id));
        }
        if (user_id && mongoose.Types.ObjectId.isValid(String(user_id))) {
            match.user_id = new mongoose.Types.ObjectId(String(user_id));
        }
        if (source === 'scan' || source === 'visit') match.source = source;
        if (from || to) {
            match.scanned_at = {};
            if (from) match.scanned_at.$gte = new Date(String(from));
            if (to) { const d = new Date(String(to)); d.setHours(23, 59, 59, 999); match.scanned_at.$lte = d; }
        }
        if (security === 'verified') match.security_verified = true;
        else if (security === 'failed') match.security_verified = false;
        else if (security === 'na') match.security_verified = { $in: [null, undefined] };

        // Owner scope (company/user): restrict to the products they own.
        const ownerScope = await resolveOwnerProductMatch(req);
        if (ownerScope) match.product_id = { $in: ownerScope.ids };

        const pipeline: any[] = [
            { $match: match },
            { $sort: { scanned_at: -1 } },
            { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'productreactions',
                    let: { uid: '$user_id', pid: '$product_id' },
                    pipeline: [
                        { $match: { $expr: { $and: [{ $eq: ['$user_id', '$$uid'] }, { $eq: ['$product_id', '$$pid'] }] } } },
                        { $project: { reaction: 1 } }
                    ],
                    as: 'reactionsArr'
                }
            },
            { $addFields: { reactionValues: '$reactionsArr.reaction' } },
            {
                $addFields: {
                    like: { $in: ['like', '$reactionValues'] },
                    dislike: { $in: ['dislike', '$reactionValues'] },
                    buy: { $in: ['buy', '$reactionValues'] }
                }
            }
        ];

        if (reaction === 'like' || reaction === 'dislike' || reaction === 'buy') {
            pipeline.push({ $match: { reactionValues: reaction } });
        }
        if (loggedIn === 'true') pipeline.push({ $match: { user_id: { $ne: null } } });
        else if (loggedIn === 'false') pipeline.push({ $match: { user_id: { $in: [null, undefined] } } });

        if (q && String(q).trim()) {
            const safe = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(safe, 'i');
            pipeline.push({
                $match: {
                    $or: [
                        { 'user.name': rx }, { 'user.email': rx },
                        { 'product.name': rx }, { 'product.model': rx },
                        { ip: rx }, { 'location.city': rx }, { 'location.country': rx }
                    ]
                }
            });
        }

        pipeline.push({
            $facet: {
                data: [
                    { $skip: (pageNum - 1) * limitNum },
                    { $limit: limitNum },
                    {
                        $project: {
                            _id: 1, scanned_at: 1, source: 1, ip: 1, location: 1,
                            security_verified: 1, security_qrcode_id: 1, qrcode_id: 1,
                            like: 1, dislike: 1, buy: 1,
                            user: {
                                _id: '$user._id', name: '$user.name', email: '$user.email',
                                userType: '$user.userType', country: '$user.country'
                            },
                            product: { _id: '$product._id', name: '$product.name', model: '$product.model' }
                        }
                    }
                ],
                total: [{ $count: 'count' }]
            }
        });

        const result = await ScanRecord.aggregate(pipeline);
        const data = result[0]?.data || [];
        const total = result[0]?.total?.[0]?.count || 0;

        return res.status(200).json({ status: 'success', total, page: pageNum, limit: limitNum, data });
    } catch (error) {
        next(error);
    }
};

/**
 * Dashboard analytics: totals, scans-per-day series, source / security /
 * reaction / audience breakdowns, and top products / brands by scans.
 */
exports.getAnalytics = async (req: any, res: any, next: any) => {
    try {
        const DAYS = 14;
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - (DAYS - 1));

        // Optional owner scope: when present, every metric is restricted to the
        // owner's products (used by company/user dashboards).
        const ownerScope = await resolveOwnerProductMatch(req);
        const pFilter = ownerScope ? ownerScope.filter : {};
        const scanScopeStage = ownerScope ? [{ $match: pFilter }] : [];

        const [
            totalScans, totalUsers, totalCompanies, totalProducts,
            uniqueScannerIds, byDayAgg, sourceAgg, securityAgg, reactionsAgg,
            loggedInScans, topProductsAgg, topBrandsAgg
        ] = await Promise.all([
            ScanRecord.countDocuments({ ...pFilter }),
            User.countDocuments({ role: 'User' }),
            Company.countDocuments({}),
            ownerScope ? Promise.resolve(ownerScope.ids.length) : Product.countDocuments({ is_deleted: { $ne: true } }),
            ScanRecord.distinct('user_id', { user_id: { $ne: null }, ...pFilter }),
            ScanRecord.aggregate([
                { $match: { scanned_at: { $gte: since }, ...pFilter } },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$scanned_at' } }, count: { $sum: 1 } } }
            ]),
            ScanRecord.aggregate([...scanScopeStage, { $group: { _id: '$source', count: { $sum: 1 } } }]),
            ScanRecord.aggregate([...scanScopeStage, { $group: { _id: '$security_verified', count: { $sum: 1 } } }]),
            ProductReaction.aggregate([...scanScopeStage, { $group: { _id: '$reaction', count: { $sum: 1 } } }]),
            ScanRecord.countDocuments({ user_id: { $ne: null }, ...pFilter }),
            ScanRecord.aggregate([
                ...scanScopeStage,
                { $group: { _id: '$product_id', count: { $sum: 1 } } },
                { $sort: { count: -1 } }, { $limit: 6 },
                { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
                { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
                { $project: { name: { $ifNull: ['$p.name', 'Unknown'] }, count: 1 } }
            ]),
            ScanRecord.aggregate([
                ...scanScopeStage,
                { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'p' } },
                { $unwind: '$p' },
                { $group: { _id: '$p.company_id', count: { $sum: 1 } } },
                { $sort: { count: -1 } }, { $limit: 6 },
                { $lookup: { from: 'companies', localField: '_id', foreignField: '_id', as: 'c' } },
                { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
                { $project: { name: { $ifNull: ['$c.name', 'Unknown'] }, count: 1 } }
            ])
        ]);

        const dayMap: any = {};
        byDayAgg.forEach((d: any) => { dayMap[d._id] = d.count; });
        const scansByDay: any[] = [];
        for (let i = 0; i < DAYS; i++) {
            const dt = new Date(since);
            dt.setDate(since.getDate() + i);
            const key = dt.toISOString().slice(0, 10);
            scansByDay.push({ date: key, count: dayMap[key] || 0 });
        }

        const source = { scan: 0, visit: 0 };
        sourceAgg.forEach((s: any) => { if (s._id === 'visit') source.visit = s.count; else source.scan += s.count; });

        const security = { verified: 0, failed: 0, na: 0 };
        securityAgg.forEach((s: any) => {
            if (s._id === true) security.verified = s.count;
            else if (s._id === false) security.failed = s.count;
            else security.na += s.count;
        });

        const reactions: any = { like: 0, dislike: 0, buy: 0 };
        reactionsAgg.forEach((r: any) => { if (reactions[r._id] !== undefined) reactions[r._id] = r.count; });

        return res.status(200).json({
            status: 'success',
            data: {
                totals: {
                    scans: totalScans,
                    users: totalUsers,
                    companies: totalCompanies,
                    products: totalProducts,
                    uniqueScanners: (uniqueScannerIds || []).filter(Boolean).length
                },
                scansByDay,
                source,
                security,
                reactions,
                audience: { loggedIn: loggedInScans, guest: Math.max(0, totalScans - loggedInScans) },
                topProducts: topProductsAgg,
                topBrands: topBrandsAgg
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getScannedProducts = async (req: any, res: any, next: any) => {
    try {
        const { user_id } = req.query || {};
        const matchStage: any = {};

        if (user_id && mongoose.Types.ObjectId.isValid(String(user_id))) {
            matchStage.user_id = new mongoose.Types.ObjectId(String(user_id));
        }

        const pipeline: any[] = [];
        if (Object.keys(matchStage).length > 0) {
            pipeline.push({ $match: matchStage });
        }

        pipeline.push(
            { $sort: { scanned_at: -1 } },
            {
                $group: {
                    _id: '$encrypt_data',
                    latest: { $first: '$$ROOT' }
                }
            },
            {
                $lookup: {
                    from: 'products',
                    localField: 'latest.product_id',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: '$product' },
            { $sort: { 'latest.scanned_at': -1 } }
        );

        const records = await ScanRecord.aggregate(pipeline);
        const data = records.map((record: any) => {
            const normalizedProduct = normalizeProductMedia(record.product || {});
            return {
                ...normalizedProduct,
                token_id: record.latest?.qrcode_id,
                scannedAt: new Date(record.latest?.scanned_at || Date.now()).getTime(),
                scannedQRCode: record.latest?.encrypt_data || '',
                visitSource: record.latest?.source === 'visit' ? 'visit' : 'scan'
            };
        });

        return res.status(200).json({
            status: 'success',
            data
        });
    } catch (error) {
        next(error);
    }
};

exports.getProductInfoWithQRCodeID = async (req: any, res: any, next: any) => { 
    try {
        const data = await QRcode.findById(req.params.id).populate('company_id');
        console.log(data);

        if(data.product_id) {
            const product = await Product.findById(data.product_id);
            const serials = await Serials.find({product_id:data.product_id,qrcode_id:data.qrcode_id});
            const normalizedProduct = normalizeProductMedia(product?._doc || {});

            const qrcodeImage = await qrcode.toDataURL(buildPublicProductUrl(product._id, data.qrcode_id));

            const resData = {
                token_id: data.qrcode_id,
                location: data.company_id.location,
                ...normalizedProduct,
                serialInfos:serials,
                qrcode_img: qrcodeImage,
                company:data.company_id
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'Product'
            });
        }
    } catch (error) {
        next(error);
    }
};


exports.getProductInfoWithSerial = async(req:any, res:any, next:any) => {
    try {
        const serialData = req.body.data
        const serialInfo = await Serials.findOne({type:serialData.type,serial:serialData.serial}).populate('company_id')
        if(serialInfo) {
            const product = await Product.findById(serialInfo.product_id);
            console.log(product);
            const serials = await Serials.find({product_id:serialInfo.product_id,qrcode_id:serialInfo.qrcode_id});
            const normalizedProduct = normalizeProductMedia(product?._doc || {});
            const qrcodeImage = await qrcode.toDataURL(buildPublicProductUrl(product._id, serialInfo.qrcode_id));

            const resData = {
                token_id: serialInfo.qrcode_id,
                location: serialInfo.company_id.location,
                ...normalizedProduct,
                serialInfos:serials,
                qrcode_img: qrcodeImage,
                company:serialInfo.company_id
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'Product'
            });
        }

    }
    catch(error) {

    }
}

exports.getSerials = async(req:any, res:any, next:any) => {
    try {
        try {
            // const doc = await QRcode.find({ product_id: req.body.product_id }).skip(req.body.offset).limit(req.body.amount);
            const product = await Product.findById(req.body.product_id)
            const serials = await Serials.find({product_id:req.body.product_id})
    
            let data = [];
            let count = 100;
            
            if (req.body.page == 0) {
                
                for (let i = req.body.from; i <= req.body.to; i ++) {
                    if (i > 0 && i <= product.total_minted_amount) {
                        let serial = serials.filter((item:any)=>item.qrcode_id === i)
                        data.push(serial);
                    }
                }
            } else if (req.body.page > 0) {
                if (req.body.page == Math.ceil(product.total_minted_amount / 100) && product.total_minted_amount % 100) {
                    count = product.total_minted_amount % 100;
                } 
                else if (req.body.page > Math.ceil(product.total_minted_amount / 100)) {
                    count = 0;
                }
                
                for (let i = 1; i <= count; i ++) {
                    const stringdata = JSON.stringify({
                        product_id: product._id,
                        token_id: (req.body.page - 1) * 100 + i
                    });

                    let serial = serials.filter((item:any)=>item.qrcode_id === ((req.body.page - 1) * 100 + i))
                    data.push(serial);
                }
            }
    
            res.status(200).json({
                status: 'success',
                data
            });
            
        } catch (error) {
            next(error);
        }
    }
    catch(err) {

    }

}

// Generate Security QR Codes (independent from regular QR codes)
exports.generateSecurityQRCodes = async (req: any, res: any, next: any) => {
    try {
        const { product_id, amount, company_id } = req.body;
        
        if (!product_id || !amount || !company_id) {
            return res.status(400).json({
                status: 'fail',
                message: 'product_id, amount, and company_id are required'
            });
        }

        const product = await Product.findById(product_id);
        if (!product) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        // Get current max security_qrcode_id for this product
        const maxSecurityQR = await SecurityQRCode.findOne({ product_id })
            .sort({ security_qrcode_id: -1 })
            .limit(1);
        
        let startId = maxSecurityQR ? maxSecurityQR.security_qrcode_id + 1 : 1;
        const encryptedKeys = [];

        // Generate security QR codes
        for (let i = 0; i < amount; i++) {
            const security_qrcode_id = startId + i;
            const stringdata = JSON.stringify({
                product_id: product._id,
                security_token_id: security_qrcode_id
            });
            const encryptData = encrypt(stringdata);

            // Save to database
            await SecurityQRCode.create({
                product_id: product._id,
                company_id: company_id,
                security_qrcode_id: security_qrcode_id,
                encrypted_key: encryptData
            });

            encryptedKeys.push(encryptData);
        }

        // @ts-ignore
        global.io.emit('Refresh product data');

        res.status(200).json({
            status: 'success',
            data: encryptedKeys
        });
    } catch (error) {
        next(error);
    }
};

// Get Security QR Codes for a product
exports.getSecurityQRCodes = async (req: any, res: any, next: any) => {
    try {
        const { product_id, page = 1 } = req.body;
        
        if (!product_id) {
            return res.status(400).json({
                status: 'fail',
                message: 'product_id is required'
            });
        }

        const securityQRCodes = await SecurityQRCode.find({ product_id })
            .sort({ security_qrcode_id: 1 })
            .skip((page - 1) * 100)
            .limit(100);

        const encryptedKeys = securityQRCodes.map((sqrc: any) => sqrc.encrypted_key);
        const totalCount = await SecurityQRCode.countDocuments({ product_id });

        res.status(200).json({
            status: 'success',
            data: encryptedKeys,
            total: totalCount,
            page: page
        });
    } catch (error) {
        next(error);
    }
};

// Get product info by encrypted key for web page (public endpoint)
exports.getProductByKey = async (req: any, res: any, next: any) => {
    try {
        const { key } = req.params;
        
        if (!key) {
            return res.status(400).json({
                status: 'fail',
                message: 'Product key is required'
            });
        }

        // Decrypt the key to get product_id and token_id
        const data = JSON.parse(decrypt(key));
        
        if (!data.product_id) {
            return res.status(404).json({
                status: 'fail',
                message: 'Invalid product key'
            });
        }

        const product = await Product.findById(data.product_id).populate('company_id');
        if (!product) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        const normalizedProduct = normalizeProductMedia(product._doc || {});
        
        // Return only the data needed for the public web page
        const webProductData = {
            name: normalizedProduct.name || '',
            model: normalizedProduct.model || '',
            detail: normalizedProduct.detail || '',
            images: normalizedProduct.images || [],
            company: product.company_id ? {
                name: product.company_id.name || '',
                _id: product.company_id._id
            } : null,
            company_id: product.company_id ? {
                name: product.company_id.name || '',
                _id: product.company_id._id
            } : null
        };

        res.status(200).json({
            status: 'success',
            data: webProductData
        });
    } catch (error) {
        console.error('Error in getProductByKey:', error);
        res.status(400).json({
            status: 'fail',
            message: 'Invalid product key or error processing request'
        });
    }
};

// Public product endpoint for URL-format QR codes: /product/:productId/:qrcodeId
exports.getPublicProductByIds = async (req: any, res: any, next: any) => {
    try {
        const { productId, qrcodeId } = req.params;
        if (!productId || qrcodeId == null) {
            return res.status(400).json({
                status: 'fail',
                message: 'productId and qrcodeId are required'
            });
        }

        const payload = await getPublicProductPayload(productId, qrcodeId);
        if (!payload) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: payload,
            type: 'Product'
        });
    } catch (error) {
        next(error);
    }
};

// Resolve QR URL to product payload and optionally verify it matches expected URL.
exports.resolveProductByQrUrl = async (req: any, res: any, next: any) => {
    try {
        const qrUrl = String(req.body?.qrUrl || '').trim();
        const expectedQrUrl = String(req.body?.expectedQrUrl || '').trim();

        if (!qrUrl) {
            return res.status(400).json({
                status: 'fail',
                message: 'qrUrl is required'
            });
        }

        const parsed = extractProductFromQrUrl(qrUrl);
        if (!parsed) {
            return res.status(400).json({
                status: 'fail',
                message: 'Invalid product QR URL'
            });
        }

        const payload = await getPublicProductPayload(parsed.productId, parsed.qrcodeId);
        if (!payload) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        const scannedNormalizedUrl = buildPublicProductUrl(parsed.productId, parsed.qrcodeId);
        let isSecurityCheckPassed = true;
        if (expectedQrUrl) {
            const expectedParsed = extractProductFromQrUrl(expectedQrUrl);
            isSecurityCheckPassed = !!expectedParsed
                && String(expectedParsed.productId) === String(parsed.productId)
                && Number(expectedParsed.qrcodeId) === Number(parsed.qrcodeId);
        }

        return res.status(200).json({
            status: 'success',
            data: payload,
            securityCheck: {
                isPassed: isSecurityCheckPassed,
                expectedQrUrl: expectedQrUrl || undefined,
                scannedQrUrl: scannedNormalizedUrl
            },
            type: 'Product'
        });
    } catch (error) {
        next(error);
    }
};