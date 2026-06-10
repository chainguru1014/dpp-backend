const Company = require('../models/companyModel');
const User = require('../models/userModel');
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

module.exports = {
    normalizeEmail,
    resolveOwnerIdentity,
    ensureSeedHolding,
    ownerHolds,
    moveHolding,
    getPrimaryOwner,
    claimEmailHoldings,
};
