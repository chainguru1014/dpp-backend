/**
 * One-off data backfill: assign a random itemCategory + skuStyleNumber to
 * every existing product that doesn't already have one (new products get
 * these automatically at creation time — see productController.addProduct).
 *
 * Run from the backend folder (after `npm run build`, so dist/ is current):
 *   node backfill-product-categories.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const Product = require('./dist/models/productModel');

const ITEM_CATEGORY_PREFIXES = {
  denim: 'DNM',
  tops: 'TSH',
  bottoms: 'BOT',
  outerwear: 'OUT',
  others: 'OTH',
};
const ITEM_CATEGORY_KEYS = Object.keys(ITEM_CATEGORY_PREFIXES);

function randomItemCategory() {
  return ITEM_CATEGORY_KEYS[Math.floor(Math.random() * ITEM_CATEGORY_KEYS.length)];
}

function randomSkuStyleNumber(category) {
  const prefix = ITEM_CATEGORY_PREFIXES[category] || 'OTH';
  const yymm = String(Math.floor(2401 + Math.random() * 700));
  const seq = String(Math.floor(1 + Math.random() * 99)).padStart(2, '0');
  return `${prefix}-${yymm}-${seq}`;
}

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected to MongoDB.');

  const products = await Product.find({
    is_deleted: { $ne: true },
    $or: [{ itemCategory: { $exists: false } }, { skuStyleNumber: { $exists: false } }, { skuStyleNumber: '' }],
  }).select('_id name itemCategory skuStyleNumber');

  let updated = 0;
  for (const p of products) {
    const category = p.itemCategory && ITEM_CATEGORY_KEYS.includes(p.itemCategory) ? p.itemCategory : randomItemCategory();
    const sku = p.skuStyleNumber || randomSkuStyleNumber(category);
    await Product.updateOne({ _id: p._id }, { $set: { itemCategory: category, skuStyleNumber: sku } });
    console.log(`  ${p.name || p._id}: ${category} / ${sku}`);
    updated += 1;
  }

  console.log(`Done. ${updated} product(s) backfilled.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
