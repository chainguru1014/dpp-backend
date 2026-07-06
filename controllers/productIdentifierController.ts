const ProductIdentifier = require('../models/productIdentifierModel');
const AppError = require('../utils/appError');
const { SOURCE_TYPES } = require('../utils/pmcConstants');
const { parseGs1 } = require('../utils/gs1');

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

        res.status(200).json({ status: 'success', data: doc });
    } catch (error: any) {
        if (error?.code === 11000) {
            return next(new AppError(409, 'fail', 'This identifier is already registered to a product'));
        }
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
        res.status(200).json({ status: 'success', data: docs });
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
