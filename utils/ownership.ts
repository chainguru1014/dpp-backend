const mongoose = require('mongoose');
const Company = require('../models/companyModel');
const User = require('../models/userModel');
const Product = require('../models/productModel');
const ProductHolding = require('../models/productHoldingModel');

const normalizeEmail = (email: any) => String(email || '').trim().toLowerCase();

/**
 * Load a Company/User owner document and return a lightweight identity
 * { kind, id, email, name } suitable for snapshotting onto a transfer record.
 */
const resolveOwnerIdentity = async (kind: string, id: any, email?: string) => {
    const base = { kind, id: id || null, email: normalizeEmail(email), name: '' };
    try {
        if (kind === 'User' && id) {
            const u = await User.findById(id).lean();
            if (u) {
                const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
                return { kind, id, email: u.email || base.email, name: fullName || u.name || '' };
            }
        } else if (kind === 'Company' && id) {
            const c = await Company.findById(id).lean();
            if (c) {
                return { kind: 'Company', id, email: c.email || base.email, name: c.name || '' };
            }
        }
    } catch (e) {
        // Fall through to the bare identity if lookup fails.
    }
    return base;
};

const buildOwnerQuery = (productId: any, owner: any) => {
    const q: any = { product_id: productId, 'owner.kind': owner.kind };
    if (owner.kind === 'Email') {
        q['owner.email'] = normalizeEmail(owner.email);
    } else {
        q['owner.id'] = owner.id;
    }
    return q;
};

/**
 * Lazily materialize the initial holding: every product starts fully owned by
 * the Company/brand that created it (quantity = total_minted_amount).
 */
const ensureSeedHolding = async (product: any) => {
    const count = await ProductHolding.countDocuments({ product_id: product._id });
    if (count > 0) return;
    await ProductHolding.create({
        product_id: product._id,
        owner: { kind: 'Company', id: product.company_id, email: '', name: '' },
        quantity: product.total_minted_amount || 0
    });
};

/** How many units the given owner currently holds for a product. */
const ownerHolds = async (productId: any, owner: any) => {
    const doc = await ProductHolding.findOne(buildOwnerQuery(productId, owner));
    return doc ? doc.quantity : 0;
};

/**
 * Move `quantity` units of a product from one owner to another, creating the
 * receiver's holding row if needed. Throws if the sender lacks enough units.
 */
const moveHolding = async (product: any, fromOwner: any, toOwner: any, quantity: number) => {
    await ensureSeedHolding(product);

    const fromDoc = await ProductHolding.findOne(buildOwnerQuery(product._id, fromOwner));
    if (!fromDoc || fromDoc.quantity < quantity) {
        const have = fromDoc ? fromDoc.quantity : 0;
        const err: any = new Error(`Insufficient units to transfer (holding ${have}, requested ${quantity})`);
        err.statusCode = 409;
        throw err;
    }
    fromDoc.quantity -= quantity;
    await fromDoc.save();

    let toDoc = await ProductHolding.findOne(buildOwnerQuery(product._id, toOwner));
    if (toDoc) {
        toDoc.quantity += quantity;
        if (toOwner.name) toDoc.owner.name = toOwner.name;
        if (toOwner.email) toDoc.owner.email = normalizeEmail(toOwner.email);
        await toDoc.save();
    } else {
        toDoc = await ProductHolding.create({
            product_id: product._id,
            owner: {
                kind: toOwner.kind,
                id: toOwner.id || null,
                email: normalizeEmail(toOwner.email),
                name: toOwner.name || ''
            },
            quantity
        });
    }
    return toDoc;
};

/**
 * The product's primary (largest) holder, used as the "current owner" for
 * display and as the counterparty for a consumer buy. Falls back to the
 * Company/brand for products with no holdings yet.
 */
const getPrimaryOwner = async (product: any) => {
    const holdings = await ProductHolding.find({ product_id: product._id, quantity: { $gt: 0 } })
        .sort({ quantity: -1 })
        .lean();
    if (holdings.length) {
        const o = holdings[0].owner;
        return { kind: o.kind, id: o.id, email: o.email || '', name: o.name || '' };
    }
    return { kind: 'Company', id: product.company_id, email: '', name: '' };
};

/**
 * Convert any Email-kind holdings matching this user's email into User-kind
 * holdings owned by them. Called when a user logs in / opens "My products" so
 * invites sent before they registered are claimed.
 */
const claimEmailHoldings = async (user: any) => {
    const email = normalizeEmail(user?.email);
    if (!email || !user?._id) return;
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.name || '';
    await ProductHolding.updateMany(
        { 'owner.kind': 'Email', 'owner.email': email },
        { $set: { 'owner.kind': 'User', 'owner.id': user._id, 'owner.name': fullName } }
    );
};

/**
 * The largest current holder of a product EXCLUDING a given party (the buyer).
 * Used by the consumer "Buy" flow: a user who already owns some units can buy
 * more, as long as another owner (brand/company or a different holder) still has
 * units to sell. Returns null only when the excluded party is the sole holder.
 */
const getPrimaryOwnerExcluding = async (product: any, exclude: any) => {
    const holdings = await ProductHolding.find({ product_id: product._id, quantity: { $gt: 0 } })
        .sort({ quantity: -1 })
        .lean();
    for (const h of holdings) {
        const o = h.owner;
        const isExcluded = exclude && o.kind === exclude.kind && String(o.id) === String(exclude.id);
        if (!isExcluded) {
            return { kind: o.kind, id: o.id, email: o.email || '', name: o.name || '' };
        }
    }
    return null;
};

/**
 * The set of product ids an owner (User or Company) is associated with: every
 * product they currently hold units of, plus — for a brand company — products
 * they created. Used to scope analytics / ESG / LCA feeds to an owner.
 */
const getOwnedProductIds = async (ownerKind: string, ownerId: any) => {
    const idSet = new Set<string>();
    const holdings = await ProductHolding.find({
        'owner.kind': ownerKind,
        'owner.id': ownerId,
        quantity: { $gt: 0 }
    }).select('product_id').lean();
    holdings.forEach((h: any) => idSet.add(String(h.product_id)));

    if (ownerKind === 'Company') {
        const created = await Product.find({ company_id: ownerId, is_deleted: { $ne: true } })
            .select('_id').lean();
        created.forEach((p: any) => idSet.add(String(p._id)));
    }

    return [...idSet].map((id) => new mongoose.Types.ObjectId(id));
};

module.exports = {
    normalizeEmail,
    resolveOwnerIdentity,
    ensureSeedHolding,
    ownerHolds,
    moveHolding,
    getPrimaryOwner,
    getPrimaryOwnerExcluding,
    claimEmailHoldings,
    getOwnedProductIds,
};
