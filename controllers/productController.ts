const AppError = require('../utils/appError');
const Product = require('../models/productModel');
const QRcode = require('../models/qrcodeModel');
const userModel = require('../models/userModel')
const companyModel = require('../models/companyModel')
const {v4:uuidv4} = require('uuid')
const serialModal = require('../models/serialModal')
const base = require('./baseController');
const APIFeatures = require('../utils/apiFeatures');
const { buildPublicProductUrl } = require('../utils/publicUrl');
const { resolvePmc } = require('../services/pmcService');
const ScanRecord = require('../models/scanRecordModel');
const ProductHolding = require('../models/productHoldingModel');
const { createNotification } = require('./notificationController');
const { resolveCompanyScope } = require('../utils/companyScope');

/**
 * Fire-and-forget "Lifecycle updated" notification to every app user who has
 * scanned or currently holds this product. Best-effort — never blocks the
 * update response, never throws.
 */
const notifyLifecycleUpdated = async (product: any) => {
    try {
        const productId = product?._id;
        if (!productId) return;
        const productName = product?.name || 'a product you follow';
        const [scanUserIds, holdingOwnerIds] = await Promise.all([
            ScanRecord.distinct('user_id', { product_id: productId }),
            ProductHolding.distinct('owner.id', { product_id: productId, 'owner.kind': 'User', quantity: { $gt: 0 } })
        ]);
        const seen = new Set<string>();
        const ids: any[] = [];
        [...scanUserIds, ...holdingOwnerIds].forEach((id: any) => {
            if (!id) return;
            const key = String(id);
            if (seen.has(key)) return;
            seen.add(key);
            ids.push(id);
        });
        for (const id of ids.slice(0, 200)) {
            await createNotification({
                audience: 'user',
                recipient: { kind: 'User', id },
                type: 'lifecycle_updated',
                level: 'info',
                title: 'Lifecycle Update',
                message: `The product passport for "${productName}" has been updated.`,
                data: { productId: String(productId), productName }
            });
        }
    } catch (err) {
        console.error('notifyLifecycleUpdated failed:', err);
    }
};

const divcount = 20000;
const mintcount = 15000;
const numThreads = 4;

const delay = (ms : any) => new Promise(resolve => setTimeout(resolve, ms))

// Item categories are managed by the super admin (utils/itemCategories.ts);
// each carries the SKU/style-number prefix, e.g. "DNM-2501-01".
const { getItemCategories, FALLBACK_CATEGORY_KEY } = require('../utils/itemCategories');

function randomSkuStyleNumber(prefix: string) {
    const yymm = String(Math.floor(2401 + Math.random() * 700)); // e.g. 2501-2601-ish spread
    const seq = String(Math.floor(1 + Math.random() * 99)).padStart(2, '0');
    return `${prefix || 'OTH'}-${yymm}-${seq}`;
}

// Validates body.itemCategory against the managed list (defaulting a missing
// one to "Others" on create) and fills an empty skuStyleNumber from the
// category's prefix. Returns an error message, or '' when OK.
const applyItemCategory = async (body: any, { isCreate, currentCategory }: { isCreate: boolean; currentCategory?: string }) => {
    const categories = await getItemCategories();
    if (body.itemCategory === '' || body.itemCategory == null) {
        if (isCreate) body.itemCategory = FALLBACK_CATEGORY_KEY;
        else delete body.itemCategory;
    }
    if (body.itemCategory !== undefined && !categories.some((c: any) => c.key === body.itemCategory)) {
        return `Unknown item category "${body.itemCategory}"`;
    }
    if (isCreate ? !body.skuStyleNumber : body.skuStyleNumber === '') {
        const key = body.itemCategory || currentCategory || FALLBACK_CATEGORY_KEY;
        const prefix = categories.find((c: any) => c.key === key)?.skuPrefix;
        body.skuStyleNumber = randomSkuStyleNumber(prefix);
    }
    return '';
};

exports.getAllProducts = async(req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const filter: any = { is_deleted: false };
        
        // Handle company_id filter - convert string to ObjectId if needed
        if (req.body.company_id) {
            try {
                // Try to convert to ObjectId if it's a string
                const companyIdStr = String(req.body.company_id);
                if (mongoose.Types.ObjectId.isValid(companyIdStr)) {
                    filter.company_id = mongoose.Types.ObjectId(companyIdStr);
                } else {
                    filter.company_id = req.body.company_id;
                }
            } catch (e) {
                console.error('Error converting company_id to ObjectId:', e);
                filter.company_id = req.body.company_id;
            }
        }
        
        // Add any other filters from req.body
        Object.keys(req.body).forEach(key => {
            if (key !== 'company_id') {
                filter[key] = req.body[key];
            }
        });
        
        console.log('getAllProducts filter:', JSON.stringify(filter, null, 2));
        const doc = await Product.find(filter).populate('company_id');
        console.log('getAllProducts found:', doc.length, 'products');
        if (doc.length > 0) {
            console.log('Sample product company_id:', doc[0].company_id);
        }
        
        res.status(200).json({
            status: 'success',
            results: doc.length,
            data: {
                data: doc
            }
        });
        
    } catch (error) {
        console.error('getAllProducts error:', error);
        next(error);
    }

};

/**
 * Returns products filtered by optional user/company id.
 * If no userId is supplied, all non-deleted products are returned.
 */
exports.getProductsByUser = async (req: any, res: any, next: any) => {
    try {
        const userId = req.query.userId;
        const filter: any = { is_deleted: false };

        if (userId) {
            filter.company_id = userId;
        }

        const doc = await Product.find(filter).populate('company_id');

        res.status(200).json({
            status: 'success',
            results: doc.length,
            data: {
                data: doc
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /product/by-brand?website=&limit=
 * Public list of products belonging to one brand (matched on
 * brandInfo.websiteUrl, case-insensitively). Powers the Brand Detail page's
 * "Featured Products" list + "View all".
 */
exports.getProductsByBrand = async (req: any, res: any, next: any) => {
    try {
        const rawWebsite = String(req.query?.website || '').trim();
        if (!rawWebsite) {
            return res.status(400).json({ status: 'fail', message: 'website is required' });
        }
        const limit = Math.min(100, Math.max(0, parseInt(req.query?.limit) || 0));
        // Normalize to the same shape FollowedBrand stores (lowercase, protocol-prefixed)
        // but match loosely so http/https/trailing-slash differences still hit.
        const host = rawWebsite.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const filter: any = {
            is_deleted: { $ne: true },
            'brandInfo.websiteUrl': { $regex: escaped, $options: 'i' },
        };
        let query = Product.find(filter).sort({ _id: -1 }).lean();
        if (limit) query = query.limit(limit);
        const docs = await query;
        return res.status(200).json({ status: 'success', results: docs.length, data: docs });
    } catch (error) {
        next(error);
    }
};

exports.getProduct = base.getOne(Product);

// Don't update password on this 
exports.updateProduct = async(req: any, res: any, next: any) => {
    try {
        const product = (await Product.findById(req.params.id)) || (await Product.findOne({ name: req.body.name }));

        if (!product) {
            return next(new AppError(404, 'fail', 'No product found with that id'), req, res, next);
        }

        if (product.is_deleted) {
            return next(new AppError(404, 'fail', "Product does not exists."), req, res, next);
        }

        const categoryError = await applyItemCategory(req.body, { isCreate: false, currentCategory: product.itemCategory });
        if (categoryError) {
            return next(new AppError(400, 'fail', categoryError), req, res, next);
        }

        const doc = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
        }

        // Notify users who scanned / hold this product that its passport changed.
        notifyLifecycleUpdated(doc);

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};

exports.deleteProduct = async(req: any, res: any, next: any) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return next(new AppError(404, 'fail', 'No product found with that id'), req, res, next);
        }

        if (product.total_minted_amount > 0) {
            return next(new AppError(404, 'fail', "Can't remove this product. You already minted."), req, res, next);
        }

        const doc = await Product.findByIdAndUpdate(req.params.id, { is_deleted: true }, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};

exports.addProduct = async(req: any, res: any, next: any) => {
    try {

        let product = req.body;
        product.total_minted_amount = 0;
        const categoryError = await applyItemCategory(product, { isCreate: true });
        if (categoryError) {
            return next(new AppError(400, 'fail', categoryError), req, res, next);
        }

        console.log(product);
        const data = await Product.findOne({ name: product.name, detail: product.detail });
        console.log(data);
        if(data) {
            return next(new AppError(404, 'fail', 'product already exists'), req, res, next);
        }

        const doc = await Product.create(product);

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};


const BULK_IMPORT_MAX_ROWS = 500;
// Fields a spreadsheet row may set. Anything else in a row is ignored, so an
// import can never touch codes, counters, ownership or the company.
const BULK_IMPORT_FIELDS = [
    'name', 'model', 'aboutProduct', 'productType', 'color', 'size', 'manufactureDate',
    'itemCategory', 'skuStyleNumber', 'warrantyStatus', 'warrantyValidYears',
    'brandInfo', 'images', 'materialSize', 'certifications', 'disposal', 'traceabilityEsg'
];

/**
 * POST /product/bulk-import { rows: [...] }
 * Creates or updates many products from a spreadsheet (the admin panel
 * parses the CSV and sends one object per row). A row with `_id` updates
 * that product — only the fields the row carries; any other row creates a
 * new product. Each row succeeds or fails on its own, and the response says
 * which rows failed and why.
 */
exports.bulkImport = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed || !scope.canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may import products'), req, res, next);
        }
        // The super admin imports into its own company, like the product form does.
        const companyId = scope.companyId || req.user.id;
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
        if (!rows || rows.length === 0) {
            return next(new AppError(400, 'fail', 'There are no rows to import'), req, res, next);
        }
        if (rows.length > BULK_IMPORT_MAX_ROWS) {
            return next(new AppError(400, 'fail', `Import at most ${BULK_IMPORT_MAX_ROWS} products at a time`), req, res, next);
        }

        // A new product needs brand details; rows that leave them out reuse
        // the ones on this company's most recent product.
        const latest = await Product.findOne({ company_id: companyId, is_deleted: { $ne: true } }).sort({ _id: -1 }).select('brandInfo').lean();
        const defaultBrand = latest?.brandInfo || {};

        let created = 0;
        let updated = 0;
        const errors: { row: number; name: string; message: string }[] = [];

        for (let i = 0; i < rows.length; i++) {
            const raw = rows[i] || {};
            const rowNumber = Number(raw.__row) || i + 1;
            const body: any = {};
            BULK_IMPORT_FIELDS.forEach((key) => {
                if (raw[key] !== undefined && raw[key] !== null) body[key] = raw[key];
            });
            const fail = (message: string) => errors.push({ row: rowNumber, name: String(raw.name || ''), message });

            try {
                const id = String(raw._id || '').trim();
                if (id) {
                    const mongoose = require('mongoose');
                    const existing = mongoose.Types.ObjectId.isValid(id)
                        ? await Product.findOne({ _id: id, company_id: companyId, is_deleted: { $ne: true } })
                        : null;
                    if (!existing) {
                        fail('No product of yours has this id. Clear the id column to add it as a new product.');
                        continue;
                    }
                    if (body.name !== undefined && !String(body.name).trim()) {
                        fail('The product name cannot be empty.');
                        continue;
                    }
                    // Nested groups are merged, so a row that only gives a
                    // brand name does not wipe the logo, and so on.
                    ['brandInfo', 'disposal', 'traceabilityEsg', 'materialSize'].forEach((group) => {
                        if (body[group]) body[group] = { ...(existing.toObject()[group] || {}), ...body[group] };
                    });
                    // Lists are replaced by the row's list, but an entry that
                    // already exists keeps what a spreadsheet cannot carry
                    // (its icon, certificate file, "required" tick...).
                    const keepExtras = (incoming: any[], current: any[], key: string) => incoming.map((item: any) => {
                        const match = (current || []).find((c: any) => c && typeof c === 'object'
                            && String(c[key] || '').trim().toLowerCase() === String(item[key] || '').trim().toLowerCase());
                        return match ? { ...(match.toObject ? match.toObject() : match), ...item } : item;
                    });
                    if (Array.isArray(body.materialSize?.materials)) {
                        body.materialSize.materials = keepExtras(body.materialSize.materials, existing.materialSize?.materials, 'material');
                    }
                    if (Array.isArray(body.certifications)) {
                        body.certifications = keepExtras(body.certifications, existing.certifications, 'title');
                    }
                    const categoryError = await applyItemCategory(body, { isCreate: false, currentCategory: existing.itemCategory });
                    if (categoryError) {
                        fail(categoryError);
                        continue;
                    }
                    const doc = await Product.findByIdAndUpdate(existing._id, { $set: body }, { new: true, runValidators: true });
                    notifyLifecycleUpdated(doc);
                    updated++;
                    continue;
                }

                if (!String(body.name || '').trim()) {
                    fail('The product name is missing.');
                    continue;
                }
                body.brandInfo = { ...defaultBrand, ...(body.brandInfo || {}) };
                const missingBrand = ['name', 'detail', 'websiteUrl', 'logoUrl'].filter((key) => !String(body.brandInfo[key] || '').trim());
                if (missingBrand.length) {
                    fail(`Brand details are missing (${missingBrand.join(', ')}). Fill the brand columns, or add one product by hand first so its brand can be reused.`);
                    continue;
                }
                const categoryError = await applyItemCategory(body, { isCreate: true });
                if (categoryError) {
                    fail(categoryError);
                    continue;
                }
                if (await Product.findOne({ company_id: companyId, name: body.name, model: body.model || '', is_deleted: { $ne: true } }).select('_id').lean()) {
                    fail('A product with this name and model already exists. To change it, export your products and import the row with its id.');
                    continue;
                }
                await Product.create({ ...body, company_id: companyId, total_minted_amount: 0 });
                created++;
            } catch (error: any) {
                fail(error?.message || 'This row could not be saved.');
            }
        }

        res.status(200).json({ status: 'success', data: { created, updated, errors } });
    } catch (error) {
        next(error);
    }
};

async function mintChildProduct(product_id:string,qrcode_id:number) {
    const products = await Product.find({parent:product_id})

    for(const product of products) {
        const companyId = product?.company_id?._id || product?.company_id;
        // Skip orphaned products that are missing a company reference.
        if (!companyId) {
            continue;
        }

        const childAmount = product.parentCount || 0;
        if (childAmount <= 0) {
            continue;
        }

        // Atomically reserve this child product's qrcode_id range the same way
        // the top-level mint() does. Without this, re-minting the parent (or two
        // concurrent mints) would read a stale total_minted_amount for the child
        // every time and hand out qrcode_ids that were already used.
        const reserved = await Product.findOneAndUpdate(
            { _id: product._id },
            { $inc: { total_minted_amount: childAmount } },
            { new: false }
        );
        const startOffset = reserved?.total_minted_amount || 0;

        for(let j = 1;j<=childAmount;j++) {
            await QRcode.create({
                product_id: product._id,
                company_id: companyId,
                qrcode_id: startOffset + j,
                parent_qrcode_id:qrcode_id
            })

            // Give this item a PMC immediately, keyed off the same URL its
            // printed QR code will carry, so a later scan of that QR resolves
            // to the same PMC instead of minting a second one.
            await resolvePmc({
                product_id: product._id,
                company_id: companyId,
                qrcode_id: startOffset + j,
                source_type: 'qr',
                raw_value: buildPublicProductUrl(product._id, startOffset + j)
            })

            for(const serial of product.serials) {
                await serialModal.create({
                    type:serial.type,
                    serial:uuidv4(),
                    qrcode_id: startOffset + j,
                    product_id:product._id,
                    company_id: companyId,
                    parent_qrcode_id:qrcode_id
                })
            }

            const productInfos = await Product.find({parent:product._id})

            if(productInfos.length) {
                await mintChildProduct(product._id, startOffset + j)
            }
        }

        // Previously, blockchain minting happened here. Now we only create QR codes and serials in the database.
    }
}

exports.mint = async(req: any, res: any, next: any) => {
    try {
        const product = await Product.findById(req.params.id);

        console.log(product);
        let start = new Date();

        if (!product) {
            return next(new AppError(404, 'fail', 'Product not found'), req, res, next);
        }

        const companyId = product.company_id?._id || product.company_id;
        if (!companyId) {
            return next(new AppError(400, 'fail', 'Product has no company assigned'), req, res, next);
        }

        const mintAmount = Number(req.body.amount);
        if (!Number.isInteger(mintAmount) || mintAmount <= 0) {
            return next(new AppError(400, 'fail', 'amount must be a positive integer'), req, res, next);
        }

        // Atomically reserve [startOffset+1, startOffset+mintAmount] for this mint
        // call up front (instead of reading total_minted_amount once and using it
        // through the loop) so two concurrent/duplicate mint requests for the same
        // product can never be handed overlapping qrcode_id ranges. A failure
        // partway through the loop below only leaves gaps in the reserved range,
        // never a collision.
        const reserved = await Product.findOneAndUpdate(
            { _id: product._id },
            { $inc: { total_minted_amount: mintAmount } },
            { new: false }
        );
        const startOffset = reserved?.total_minted_amount || 0;

        for (let j = 1; j <= mintAmount; j ++ ) {
            await QRcode.create({
                product_id: product._id,
                company_id: companyId,
                qrcode_id: startOffset + j
            })

            // Give this item a PMC immediately, keyed off the same URL its
            // printed QR code will carry, so a later scan of that QR resolves
            // to the same PMC instead of minting a second one.
            await resolvePmc({
                product_id: product._id,
                company_id: companyId,
                qrcode_id: startOffset + j,
                source_type: 'qr',
                raw_value: buildPublicProductUrl(product._id, startOffset + j)
            })

            for(const serial of product.serials) {
                await serialModal.create({
                    type:serial.type,
                    serial:uuidv4(),
                    qrcode_id: startOffset + j,
                    product_id:product._id,
                    company_id: companyId,
                })
            }

            const products = await Product.find({parent:product._id})

            if(products.length > 0) {
                await mintChildProduct(product._id, startOffset + j)
            }


        }
        let end = new Date();
        console.log(end.getTime() - start.getTime())

        // @ts-ignore
        global.io.emit('Refresh product data');

        res.status(200).json({
            status: 'success',
            offset: startOffset + mintAmount,
        });
    } catch (error) {
        next(error);
    }
};

exports.transfer = async(req: any, res: any, next: any) => {
    try {
        const { product_id, from_id, to_id, token_id } = req.body;

        const qr = await QRcode.findOne({
            product_id: product_id,
            company_id: from_id,
            qrcode_id: token_id
        });
        if (!qr) {
            return res.status(404).json({ status: false, message: 'QR code not found' });
        }

        qr.company_id = to_id;
        await qr.save();

        // @ts-ignore
        global.io.emit('Refresh user data');

        res.status(200).json({
            status: true,
        });
    } catch (error) {
        next(error);
    }
}

exports.printQRCodes = async (req: any, res: any, next: any) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ status: 'fail', message: 'Product not found' });
        }
        const count = Number(req.body.count) || 0;
        const minted = product.total_minted_amount || 0;
        const printed = product.printed_amount || 0;
        const newPrinted = minted >= printed + count ? printed + count : minted;

        // Atomic update instead of product.save() — older products with incomplete
        // brandInfo would otherwise fail required-field validation, and an
        // un-awaited save() crashed the process via an unhandled rejection.
        await Product.updateOne({ _id: product._id }, { $set: { printed_amount: newPrinted } });
        const updated = await Product.findById(product._id).populate('company_id').lean();

        res.status(200).json({
            status: 'success',
            data: updated
        });
    } catch (error) {
        next(error);
    }
}

exports.getTransaction = async(req:any,res:any,next:any) => {
    // Blockchain transaction lookup removed; endpoint kept for compatibility.
    res.status(200).json({
        status: 'success',
        data: [],
    });
}
