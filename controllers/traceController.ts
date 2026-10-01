const mongoose = require('mongoose');
const Product = require('../models/productModel');
const QRcode = require('../models/qrcodeModel');
const Serials = require('../models/serialModal');
const PMC = require('../models/pmcModel');
const PmcIdentifier = require('../models/pmcIdentifierModel');
const ProductIdentifier = require('../models/productIdentifierModel');
const ScanRecord = require('../models/scanRecordModel');
const CaptureRecord = require('../models/captureRecordModel');
const OwnershipTransfer = require('../models/ownershipTransferModel');
const AppError = require('../utils/appError');
const { extractProductFromQrUrl } = require('../utils/publicUrl');
const { parseGs1 } = require('../utils/gs1');
const { resolveCompanyScope } = require('../utils/companyScope');

// "Find an item": one search box that accepts whatever is printed on or
// stored in a product — its passport ID (PMC), the QR code's link, a serial,
// an RFID/NFC tag ID, a barcode/GTIN, a GS1 Digital Link — or just part of a
// product's name or style number. An exact code opens that item's "digital
// twin": every scan, staff capture and ownership transfer in time order, with
// the places they happened.

const EVENT_LIMIT = 300;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const productSummary = (product: any) => ({
    _id: product._id,
    name: product.name || '',
    model: product.model || '',
    skuStyleNumber: product.skuStyleNumber || '',
    image: Array.isArray(product.images) && product.images.length ? product.images[0] : '',
    brandName: product.brandInfo?.name || '',
    color: product.color || '',
    size: product.size || '',
    totalCodes: product.total_minted_amount || 0
});

const placeOf = (loc: any) => ({
    country: loc?.country || '',
    region: loc?.region || '',
    city: loc?.city || '',
    address: loc?.address || '',
    latitude: typeof loc?.latitude === 'number' ? loc.latitude : null,
    longitude: typeof loc?.longitude === 'number' ? loc.longitude : null
});

// Every recorded event for one item (qrcodeId set) or, with qrcodeId null,
// the latest events across all of a product's items. Newest first.
const buildTimeline = async (product: any, qrcodeId: number | null, pmc: any) => {
    const productId = product._id;
    const scanFilter: any = { product_id: productId };
    const captureFilter: any = { productId: String(productId) };
    const transferFilter: any = { product_id: productId };
    if (qrcodeId != null) {
        // A barcode/NFC/RFID scan carries no qrcode_id — it is tied to the item
        // through its PMC instead.
        scanFilter.$or = [{ qrcode_id: qrcodeId }, ...(pmc?.pmc_code ? [{ pmc_code: pmc.pmc_code }] : [])];
        captureFilter.qrcodeId = String(qrcodeId);
        transferFilter.qrcode_id = qrcodeId;
    }

    const [scans, captures, transfers] = await Promise.all([
        ScanRecord.find(scanFilter).sort({ scanned_at: -1 }).limit(EVENT_LIMIT).lean(),
        CaptureRecord.find(captureFilter).sort({ createdAt: -1 }).limit(EVENT_LIMIT).populate('employee_id', 'name').lean(),
        OwnershipTransfer.find(transferFilter).sort({ createdAt: -1 }).limit(EVENT_LIMIT).lean()
    ]);

    const events: any[] = [];
    scans.forEach((s: any) => {
        events.push({
            kind: s.security_verified === true ? 'security_pass' : s.security_verified === false ? 'security_fail' : 'scan',
            at: s.scanned_at || s.createdAt,
            itemId: s.qrcode_id,
            identifierType: s.identifier_type || 'qr',
            source: s.source || 'scan',
            // Who scanned is personal data the brand has no need for here.
            byAppUser: !!s.user_id,
            place: placeOf(s.location)
        });
    });
    captures.forEach((c: any) => {
        events.push({
            kind: 'capture',
            at: c.createdAt,
            itemId: c.qrcodeId ? Number(c.qrcodeId) : null,
            identifierType: c.identifierType || 'qr',
            step: c.stepEntity || '',
            stepType: c.stepType || '',
            refNumber: c.refNumber || '',
            worker: c.employee_id?.name || '',
            image: c.imagePath || '',
            place: placeOf(c.location)
        });
    });
    transfers.forEach((tr: any) => {
        events.push({
            kind: 'transfer',
            at: tr.confirmed_at || tr.createdAt,
            itemId: tr.qrcode_id,
            status: tr.status,
            method: tr.method,
            quantity: tr.quantity || 1,
            from: tr.from_owner?.name || tr.from_owner?.email || '',
            to: tr.to_owner?.name || tr.to_owner?.email || '',
            place: placeOf({ country: tr.to_owner?.country })
        });
    });
    if (qrcodeId != null && pmc?.createdAt) {
        events.push({ kind: 'created', at: pmc.createdAt, itemId: qrcodeId, place: placeOf(null) });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return events.slice(0, EVENT_LIMIT);
};

const itemResult = async (product: any, qrcodeId: number, matchedBy: string) => {
    const [pmc, serials, code] = await Promise.all([
        PMC.findOne({ product_id: product._id, qrcode_id: qrcodeId }).lean(),
        Serials.find({ product_id: product._id, qrcode_id: qrcodeId }).select('type serial').lean(),
        QRcode.findOne({ product_id: product._id, qrcode_id: qrcodeId }).select('blocked blockedNote').lean()
    ]);
    const identifiers = pmc
        ? await PmcIdentifier.find({ pmc_id: pmc._id }).sort({ createdAt: 1 }).select('source_type raw_value').lean()
        : [];
    return {
        type: 'item',
        matchedBy,
        product: productSummary(product),
        item: {
            qrcodeId,
            pmcCode: pmc?.pmc_code || '',
            blocked: !!code?.blocked,
            blockedNote: code?.blockedNote || '',
            identifiers: identifiers.map((i: any) => ({ type: i.source_type, value: i.raw_value })),
            serials: serials.map((s: any) => ({ type: s.type, value: s.serial }))
        },
        timeline: await buildTimeline(product, qrcodeId, pmc)
    };
};

const productResult = async (product: any, matchedBy: string) => ({
    type: 'product',
    matchedBy,
    product: productSummary(product),
    timeline: await buildTimeline(product, null, null)
});

// GET /trace/search?q=
exports.search = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to search items'), req, res, next);
        }
        const q = String(req.query?.q || '').trim();
        if (q.length < 2) {
            return next(new AppError(400, 'fail', 'Type at least 2 characters to search'), req, res, next);
        }

        // Loads a product only if it exists and is inside the requester's scope.
        const loadProduct = async (id: any) => {
            if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
            const product = await Product.findOne({ _id: id, is_deleted: { $ne: true } });
            if (!product) return null;
            if (scope.companyId && String(product.company_id) !== String(scope.companyId)) return null;
            return product;
        };
        const send = (data: any) => res.status(200).json({ status: 'success', data });

        // 1. The link a product QR code carries.
        const fromUrl = extractProductFromQrUrl(q);
        if (fromUrl) {
            const product = await loadProduct(fromUrl.productId);
            if (product && await QRcode.exists({ product_id: product._id, qrcode_id: fromUrl.qrcodeId })) {
                return send(await itemResult(product, fromUrl.qrcodeId, 'QR code link'));
            }
        }

        // 2. Passport ID (PMC).
        const pmc = await PMC.findOne({ pmc_code: { $regex: `^${escapeRegex(q)}$`, $options: 'i' } }).lean();
        if (pmc) {
            const product = await loadProduct(pmc.product_id);
            if (product) {
                return pmc.qrcode_id != null
                    ? send(await itemResult(product, pmc.qrcode_id, 'Passport ID'))
                    : send(await productResult(product, 'Passport ID'));
            }
        }

        // 3. Any code that was scanned for an item before (RFID / NFC tag ID,
        //    barcode, GS1 Digital Link, QR link).
        const pmcIdentifier = await PmcIdentifier.findOne({ raw_value: q }).lean();
        if (pmcIdentifier) {
            const linked = await PMC.findById(pmcIdentifier.pmc_id).lean();
            const product = linked ? await loadProduct(linked.product_id) : null;
            if (product) {
                return linked.qrcode_id != null
                    ? send(await itemResult(product, linked.qrcode_id, `${String(pmcIdentifier.source_type).toUpperCase()} code`))
                    : send(await productResult(product, `${String(pmcIdentifier.source_type).toUpperCase()} code`));
            }
        }

        // 4. Serial number.
        const serial = await Serials.findOne({ serial: q }).lean();
        if (serial) {
            const product = await loadProduct(serial.product_id);
            if (product) return send(await itemResult(product, serial.qrcode_id, 'Serial number'));
        }

        // 5. A GS1 Digital Link or GTIN of one of our own products.
        const gs1 = parseGs1(q);
        if (gs1?.gtin) {
            const own = await Product.findOne({ gtin: gs1.gtin, is_deleted: { $ne: true } }).select('_id').lean();
            const product = own ? await loadProduct(own._id) : null;
            if (product) {
                const serial = /^\d+$/.test(String(gs1.serial || '')) ? Number(gs1.serial) : null;
                if (serial != null && await QRcode.exists({ product_id: product._id, qrcode_id: serial })) {
                    return send(await itemResult(product, serial, 'GS1 Digital Link'));
                }
                return send(await productResult(product, 'GTIN'));
            }
        }

        // 6. A code registered to a product (tag ID or barcode), or its GTIN.
        const gtin = gs1?.gtin || '';
        const registered = await ProductIdentifier.findOne({
            $or: [{ raw_value: q }, ...(gtin ? [{ gtin }] : [])]
        }).lean();
        if (registered) {
            const product = await loadProduct(registered.product_id);
            if (product) {
                return send(await productResult(product, registered.raw_value === q ? `${String(registered.source_type).toUpperCase()} code` : 'GTIN'));
            }
        }

        // 7. Part of a product name, model or style number.
        const text = { $regex: escapeRegex(q), $options: 'i' };
        const filter: any = { is_deleted: { $ne: true }, $or: [{ name: text }, { model: text }, { skuStyleNumber: text }] };
        if (scope.companyId) filter.company_id = scope.companyId;
        const products = await Product.find(filter).sort({ _id: -1 }).limit(20);
        if (products.length === 1) return send(await productResult(products[0], 'Product'));
        return send({ type: 'list', products: products.map(productSummary) });
    } catch (error) {
        next(error);
    }
};

// GET /trace/item/:productId/:qrcodeId — open one item directly (from a
// product's list of codes, or a product result's timeline).
exports.getItem = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view items'), req, res, next);
        }
        const { productId, qrcodeId } = req.params;
        const numericQrId = Number(qrcodeId);
        if (!mongoose.Types.ObjectId.isValid(String(productId)) || !Number.isFinite(numericQrId)) {
            return next(new AppError(400, 'fail', 'Invalid item'), req, res, next);
        }
        const product = await Product.findOne({ _id: productId, is_deleted: { $ne: true } });
        if (!product || (scope.companyId && String(product.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Item not found'), req, res, next);
        }
        if (!(await QRcode.exists({ product_id: product._id, qrcode_id: numericQrId }))) {
            return next(new AppError(404, 'fail', 'Item not found'), req, res, next);
        }
        res.status(200).json({ status: 'success', data: await itemResult(product, numericQrId, 'Item') });
    } catch (error) {
        next(error);
    }
};

// GET /trace/product/:productId — a product's latest events across all its items.
exports.getProduct = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view items'), req, res, next);
        }
        const { productId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(productId))) {
            return next(new AppError(400, 'fail', 'Invalid product'), req, res, next);
        }
        const product = await Product.findOne({ _id: productId, is_deleted: { $ne: true } });
        if (!product || (scope.companyId && String(product.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Product not found'), req, res, next);
        }
        res.status(200).json({ status: 'success', data: await productResult(product, 'Product') });
    } catch (error) {
        next(error);
    }
};
