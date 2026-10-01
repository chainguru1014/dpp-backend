const ProductIdentifier = require('../models/productIdentifierModel');
const PmcIdentifier = require('../models/pmcIdentifierModel');
const PMC = require('../models/pmcModel');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const { SOURCE_TYPES } = require('../utils/pmcConstants');
const { parseGs1 } = require('../utils/gs1');
const { resolvePmc } = require('../services/pmcService');
const QRcode = require('../models/qrcodeModel');
const { resolveCompanyScope } = require('../utils/companyScope');

// Admin registers a barcode/GTIN (or an NFC/RFID tag ID) against a product
// ahead of time, so a later scan of that identifier — by anyone, not just
// through this platform's own minted QR codes — can resolve to a product.
exports.register = async (req: any, res: any, next: any) => {
    try {
        const { product_id, company_id, source_type, raw_value, note } = req.body || {};

        if (!product_id || !company_id) {
            return next(new AppError(400, 'fail', 'product_id and company_id are required'));
        }
        if (!SOURCE_TYPES.includes(source_type)) {
            return next(new AppError(400, 'fail', `source_type must be one of: ${SOURCE_TYPES.join(', ')}`));
        }
        const normalizedRawValue = String(raw_value || '').trim();
        if (!normalizedRawValue) {
            return next(new AppError(400, 'fail', 'raw_value is required'));
        }

        const gs1 = parseGs1(normalizedRawValue);

        const doc = await ProductIdentifier.create({
            product_id,
            company_id,
            source_type,
            raw_value: normalizedRawValue,
            gtin: gs1?.gtin || '',
            note: note || ''
        });

        // Mint the PMC immediately (rather than waiting for the first scan) so
        // the admin panel can show a PMC code for an identifier right after
        // registering it — resolvePmc() is idempotent, so a later real scan
        // of this same identifier just returns this same PMC.
        let pmc_code = null;
        try {
            const pmc = await resolvePmc({ product_id, company_id, source_type, raw_value: normalizedRawValue, gs1 });
            pmc_code = pmc?.pmc_code || null;
        } catch (pmcError) {
            console.error('PMC resolution failed for identifier registration:', pmcError);
        }

        res.status(200).json({ status: 'success', data: { ...doc.toObject(), pmc_code } });
    } catch (error: any) {
        if (error?.code === 11000) {
            return next(new AppError(409, 'fail', 'This identifier is already registered to a product'));
        }
        next(error);
    }
};

// Bulk-registers many identifiers of one type against a product in one call
// — used by the frontend's CSV import (e.g. RFID tags a hardware vendor
// pre-generates and hands over as a CSV). Loops the same create+resolvePmc
// logic register() uses per row. A duplicate raw_value (already registered,
// to this or another product) is skipped rather than failing the whole
// batch, since a re-imported CSV or one with accidental repeats shouldn't
// block the rows that are new.
exports.bulkRegister = async (req: any, res: any, next: any) => {
    try {
        const { product_id, company_id, source_type, rows } = req.body || {};

        if (!product_id || !company_id) {
            return next(new AppError(400, 'fail', 'product_id and company_id are required'));
        }
        if (!SOURCE_TYPES.includes(source_type)) {
            return next(new AppError(400, 'fail', `source_type must be one of: ${SOURCE_TYPES.join(', ')}`));
        }
        if (!Array.isArray(rows) || rows.length === 0) {
            return next(new AppError(400, 'fail', 'rows must be a non-empty array'));
        }

        let inserted = 0;
        let skipped = 0;
        const errors: any[] = [];

        for (const row of rows) {
            const normalizedRawValue = String(row?.raw_value || '').trim();
            if (!normalizedRawValue) {
                skipped++;
                continue;
            }
            try {
                const gs1 = parseGs1(normalizedRawValue);
                await ProductIdentifier.create({
                    product_id,
                    company_id,
                    source_type,
                    raw_value: normalizedRawValue,
                    gtin: gs1?.gtin || '',
                    note: row?.note || ''
                });
                try {
                    await resolvePmc({ product_id, company_id, source_type, raw_value: normalizedRawValue, gs1 });
                } catch (pmcError) {
                    console.error('PMC resolution failed for bulk identifier registration:', pmcError);
                }
                inserted++;
            } catch (error: any) {
                if (error?.code === 11000) {
                    skipped++;
                } else {
                    errors.push({ raw_value: normalizedRawValue, message: error?.message || 'Unknown error' });
                }
            }
        }

        res.status(200).json({ status: 'success', data: { inserted, skipped, errors } });
    } catch (error) {
        next(error);
    }
};

const PAIR_MAX_ROWS = 2000;

/**
 * POST /product-identifier/pair { product_id, source_type, pairs: [{ qrcode_id, raw_value }] }
 * Ties a physical tag (RFID / NFC / barcode) to one specific item, so the
 * tag and the item's QR code lead to the same passport and history. Each
 * pair succeeds or fails on its own; a tag already tied to a different item
 * is reported, never silently moved.
 */
exports.pair = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to pair tags'));
        }
        const { product_id, source_type, pairs } = req.body || {};
        if (!['rfid', 'nfc', 'barcode'].includes(source_type)) {
            return next(new AppError(400, 'fail', 'source_type must be rfid, nfc or barcode'));
        }
        if (!Array.isArray(pairs) || pairs.length === 0) {
            return next(new AppError(400, 'fail', 'There are no tags to pair'));
        }
        if (pairs.length > PAIR_MAX_ROWS) {
            return next(new AppError(400, 'fail', `Pair at most ${PAIR_MAX_ROWS} tags at a time`));
        }
        const product = await Product.findOne({ _id: product_id, is_deleted: { $ne: true } }).select('company_id');
        if (!product || (scope.companyId && String(product.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Product not found'));
        }
        const companyId = product.company_id;

        let paired = 0;
        let unchanged = 0;
        const errors: { qrcode_id: any; raw_value: string; message: string }[] = [];

        for (const row of pairs) {
            const rawValue = String(row?.raw_value || '').trim();
            const qrcodeId = Number(row?.qrcode_id);
            const fail = (message: string) => errors.push({ qrcode_id: row?.qrcode_id, raw_value: rawValue, message });
            if (!rawValue || !Number.isInteger(qrcodeId) || qrcodeId < 1) {
                fail('Needs an item number and a tag ID.');
                continue;
            }
            try {
                if (!(await QRcode.exists({ product_id: product._id, qrcode_id: qrcodeId }))) {
                    fail(`Item #${qrcodeId} does not exist. Create the QR codes first.`);
                    continue;
                }
                // Already used somewhere? resolvePmc would quietly return the
                // other item's passport, so check before calling it.
                const existing = await PmcIdentifier.findOne({ raw_value: rawValue });
                if (existing) {
                    const owner = await PMC.findById(existing.pmc_id).select('product_id qrcode_id').lean();
                    if (owner && String(owner.product_id) === String(product._id) && owner.qrcode_id === qrcodeId) {
                        unchanged++;
                    } else {
                        fail(owner && String(owner.product_id) === String(product._id) && owner.qrcode_id != null
                            ? `This tag is already paired with item #${owner.qrcode_id}.`
                            : 'This tag is already registered to a product. Remove it there first.');
                    }
                    continue;
                }
                const mapping = await ProductIdentifier.findOne({ raw_value: rawValue }).select('product_id').lean();
                if (mapping && String(mapping.product_id) !== String(product._id)) {
                    fail('This tag is already registered to another product.');
                    continue;
                }
                if (!mapping) {
                    await ProductIdentifier.create({
                        product_id: product._id,
                        company_id: companyId,
                        source_type,
                        raw_value: rawValue,
                        gtin: parseGs1(rawValue)?.gtin || '',
                        note: `Item #${qrcodeId}`
                    });
                }
                await resolvePmc({ product_id: product._id, company_id: companyId, source_type, raw_value: rawValue, qrcode_id: qrcodeId });
                paired++;
            } catch (error: any) {
                fail(error?.code === 11000 ? 'This tag is already registered.' : (error?.message || 'This tag could not be paired.'));
            }
        }

        res.status(200).json({ status: 'success', data: { paired, unchanged, errors } });
    } catch (error) {
        next(error);
    }
};

exports.listForProduct = async (req: any, res: any, next: any) => {
    try {
        const { product_id } = req.query || {};
        if (!product_id) {
            return next(new AppError(400, 'fail', 'product_id is required'));
        }

        const docs = await ProductIdentifier.find({ product_id }).sort({ createdAt: -1 });

        // Batch-attach each identifier's PMC code (if one has been resolved for
        // it yet — either at registration time above, or by a real scan).
        const pmcIdentifiers = await PmcIdentifier.find({
            raw_value: { $in: docs.map((d: any) => d.raw_value) }
        });
        const pmcIds = [...new Set(pmcIdentifiers.map((pi: any) => String(pi.pmc_id)))];
        const pmcs = await PMC.find({ _id: { $in: pmcIds } });
        const pmcCodeById = new Map(pmcs.map((pmc: any) => [String(pmc._id), pmc.pmc_code]));
        const pmcCodeByIdentifier = new Map(
            pmcIdentifiers.map((pi: any) => [`${pi.source_type}:${pi.raw_value}`, pmcCodeById.get(String(pi.pmc_id)) || null])
        );

        const enriched = docs.map((doc: any) => ({
            ...doc.toObject(),
            pmc_code: pmcCodeByIdentifier.get(`${doc.source_type}:${doc.raw_value}`) || null
        }));

        res.status(200).json({ status: 'success', data: enriched });
    } catch (error) {
        next(error);
    }
};

// Marks the next `count` (unprinted, in registration order) identifiers of
// one type as printed — mirrors productController.printQRCodes/
// qrcodeController.printSecurityQRCodes, but against
// Product.identifier_printed_amounts[source_type] since each of the four
// identifier types (barcode/nfc/rfid/gs1dl) is its own printable list.
exports.printIdentifiers = async (req: any, res: any, next: any) => {
    try {
        const { source_type, count } = req.body || {};
        if (!SOURCE_TYPES.includes(source_type)) {
            return next(new AppError(400, 'fail', `source_type must be one of: ${SOURCE_TYPES.join(', ')}`));
        }
        const product = await Product.findById(req.params.productId);
        if (!product) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }
        const total = await ProductIdentifier.countDocuments({ product_id: product._id, source_type });
        const printed = (product.identifier_printed_amounts && product.identifier_printed_amounts[source_type]) || 0;
        const requested = Number(count) || 0;
        const newPrinted = total >= printed + requested ? printed + requested : total;

        await Product.updateOne(
            { _id: product._id },
            { $set: { [`identifier_printed_amounts.${source_type}`]: newPrinted } }
        );
        const updated = await Product.findById(product._id).lean();

        res.status(200).json({ status: 'success', data: updated });
    } catch (error) {
        next(error);
    }
};

exports.remove = async (req: any, res: any, next: any) => {
    try {
        const doc = await ProductIdentifier.findByIdAndDelete(req.params.id);
        if (!doc) {
            return next(new AppError(404, 'fail', 'No identifier mapping found with that id'));
        }
        res.status(200).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};
