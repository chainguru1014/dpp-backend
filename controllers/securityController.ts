const mongoose = require('mongoose');
const Product = require('../models/productModel');
const QRcode = require('../models/qrcodeModel');
const ScanRecord = require('../models/scanRecordModel');
const AppError = require('../utils/appError');
const { resolveCompanyScope } = require('../utils/companyScope');
const { assessItemScans } = require('../utils/scanRisk');

// Security insights: how often each label is scanned, where, and which
// labels behave like copies (see utils/scanRisk.ts). A brand can then block
// a label, which warns every shopper who scans it from then on.

// The most-scanned items are assessed; beyond this the tail is all
// single-scan items that cannot be suspicious anyway.
const MAX_ITEMS = 5000;
const MAX_SUSPECTS = 100;
const REPEAT_BUCKETS = [
    { label: '1', min: 1, max: 1 },
    { label: '2', min: 2, max: 2 },
    { label: '3-5', min: 3, max: 5 },
    { label: '6-10', min: 6, max: 10 },
    { label: '11-20', min: 11, max: 20 },
    { label: '21+', min: 21, max: Infinity }
];

const itemKey = (productId: any, qrcodeId: any) => `${String(productId)}:${qrcodeId}`;

// GET /security/insights?days=
exports.getInsights = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view security insights'), req, res, next);
        }
        const days = Math.max(7, Math.min(365, parseInt(req.query?.days) || 90));
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);

        const productFilter: any = { is_deleted: { $ne: true } };
        if (scope.companyId) productFilter.company_id = scope.companyId;
        const productIds = await Product.find(productFilter).distinct('_id');

        const match: any = { scanned_at: { $gte: since }, product_id: { $in: productIds } };
        const [items, securityAgg, countryAgg, blockedDocs] = await Promise.all([
            ScanRecord.aggregate([
                { $match: { ...match, qrcode_id: { $ne: null } } },
                { $sort: { scanned_at: 1 } },
                {
                    $group: {
                        _id: { p: '$product_id', q: '$qrcode_id' },
                        scans: { $sum: 1 },
                        lastScan: { $max: '$scanned_at' },
                        pmcCode: { $last: '$pmc_code' },
                        events: { $push: { at: '$scanned_at', ip: '$ip', location: '$location', security_verified: '$security_verified' } }
                    }
                },
                { $sort: { scans: -1 } },
                { $limit: MAX_ITEMS }
            ]).allowDiskUse(true),
            ScanRecord.aggregate([{ $match: match }, { $group: { _id: '$security_verified', count: { $sum: 1 } } }]),
            ScanRecord.aggregate([
                { $match: { ...match, 'location.country': { $nin: [null, ''] } } },
                { $group: { _id: '$location.country', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 15 }
            ]),
            QRcode.find({ product_id: { $in: productIds }, blocked: true }).select('product_id qrcode_id blockedNote blockedAt').lean()
        ]);

        const blocked = new Map<string, any>();
        blockedDocs.forEach((d: any) => blocked.set(itemKey(d.product_id, d.qrcode_id), d));

        const repeatHistogram = REPEAT_BUCKETS.map((b) => ({ label: b.label, items: 0 }));
        const rows: any[] = [];
        const seen = new Set<string>();
        items.forEach((item: any) => {
            const bucket = REPEAT_BUCKETS.findIndex((b) => item.scans >= b.min && item.scans <= b.max);
            if (bucket >= 0) repeatHistogram[bucket].items += 1;

            const key = itemKey(item._id.p, item._id.q);
            const risk = assessItemScans(item.events);
            const isBlocked = blocked.has(key);
            if (risk.level === 'none' && !isBlocked) return;
            seen.add(key);
            rows.push({
                productId: item._id.p,
                qrcodeId: item._id.q,
                pmcCode: item.pmcCode || '',
                scans: item.scans,
                lastScan: item.lastScan,
                countries: Array.from(new Set(item.events.map((e: any) => e.location?.country).filter(Boolean))),
                level: risk.level,
                reasons: risk.reasons.map((r: any) => r.text),
                blocked: isBlocked,
                blockedNote: blocked.get(key)?.blockedNote || ''
            });
        });
        // Blocked items with no scans in this period still belong on the list.
        blockedDocs.forEach((d: any) => {
            const key = itemKey(d.product_id, d.qrcode_id);
            if (seen.has(key)) return;
            rows.push({
                productId: d.product_id, qrcodeId: d.qrcode_id, pmcCode: '', scans: 0, lastScan: null, countries: [],
                level: 'none', reasons: [], blocked: true, blockedNote: d.blockedNote || ''
            });
        });

        const rank: any = { high: 0, medium: 1, none: 2 };
        rows.sort((a, b) => (rank[a.level] - rank[b.level]) || (b.scans - a.scans));
        const suspects = rows.slice(0, MAX_SUSPECTS);

        const names = await Product.find({ _id: { $in: suspects.map((s) => s.productId) } }).select('name model images skuStyleNumber').lean();
        const byId = new Map<string, any>();
        names.forEach((p: any) => byId.set(String(p._id), p));
        suspects.forEach((s) => {
            const p = byId.get(String(s.productId));
            s.productName = p?.name || 'Unknown product';
            s.productModel = p?.model || '';
            s.productImage = Array.isArray(p?.images) && p.images.length ? p.images[0] : '';
        });

        const security = { verified: 0, failed: 0 };
        let totalScans = 0;
        securityAgg.forEach((s: any) => {
            totalScans += s.count;
            if (s._id === true) security.verified = s.count;
            else if (s._id === false) security.failed = s.count;
        });

        res.status(200).json({
            status: 'success',
            data: {
                days,
                totals: {
                    scans: totalScans,
                    itemsScanned: items.length,
                    repeatItems: items.filter((i: any) => i.scans > 1).length,
                    highRisk: rows.filter((r) => r.level === 'high').length,
                    mediumRisk: rows.filter((r) => r.level === 'medium').length,
                    blocked: blockedDocs.length,
                    securityVerified: security.verified,
                    securityFailed: security.failed
                },
                repeatHistogram,
                countries: countryAgg.map((c: any) => ({ country: c._id, count: c.count })),
                suspects
            }
        });
    } catch (error) {
        next(error);
    }
};

// POST /security/item-status { product_id, qrcode_id, blocked, note }
// Blocking a label does not stop it opening the product page — it makes that
// page warn the shopper that the label may be a copy.
exports.setItemStatus = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed || !scope.canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may block or unblock a label'), req, res, next);
        }
        const { product_id, qrcode_id, blocked, note } = req.body || {};
        const numericQrId = Number(qrcode_id);
        if (!mongoose.Types.ObjectId.isValid(String(product_id)) || !Number.isFinite(numericQrId) || typeof blocked !== 'boolean') {
            return next(new AppError(400, 'fail', 'product_id, qrcode_id and blocked are required'), req, res, next);
        }
        const product = await Product.findOne({ _id: product_id, is_deleted: { $ne: true } }).select('company_id');
        if (!product || (scope.companyId && String(product.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Item not found'), req, res, next);
        }
        const result = await QRcode.updateOne(
            { product_id, qrcode_id: numericQrId },
            { $set: { blocked, blockedNote: blocked ? String(note || '').trim().slice(0, 300) : '', blockedAt: blocked ? new Date() : null } }
        );
        if (!result.matchedCount && !result.n) {
            return next(new AppError(404, 'fail', 'Item not found'), req, res, next);
        }
        res.status(200).json({ status: 'success', data: { blocked } });
    } catch (error) {
        next(error);
    }
};
