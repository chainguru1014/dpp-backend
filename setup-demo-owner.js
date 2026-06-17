/**
 * One-off data setup:
 *  1. Create a demo brand company (if it doesn't exist).
 *  2. Point every product at that company (company_id).
 *  3. Reset the ownership ledger so the company holds ALL minted items of every
 *     product (i.e. the company becomes the current owner of all product items).
 *
 * Run from the backend folder:  node setup-demo-owner.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const Company = require('./dist/models/companyModel');
const Product = require('./dist/models/productModel');
const ProductHolding = require('./dist/models/productHoldingModel');

const DEMO_COMPANY = {
  name: 'democompany',
  email: 'democompany@yometel.com',
  password: 'demo1234',
  detail: 'Demo brand company that owns all sample products.',
  location: 'Berlin, Germany',
  role: 'company',
  isVerified: true,
};

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected to MongoDB.');

  // 1. Create or reuse the demo company.
  let company = await Company.findOne({ name: DEMO_COMPANY.name });
  if (!company) {
    company = await Company.create(DEMO_COMPANY);
    console.log(`Created demo company "${company.name}" (${company._id}).`);
  } else {
    console.log(`Demo company "${company.name}" already exists (${company._id}).`);
  }

  // 2. Point every (non-deleted) product at the demo company.
  const products = await Product.find({ is_deleted: { $ne: true } })
    .select('_id name total_minted_amount')
    .lean();
  await Product.updateMany(
    { is_deleted: { $ne: true } },
    { $set: { company_id: company._id } }
  );

  // 3. Reset holdings so the company owns every minted item of each product.
  let totalItems = 0;
  for (const p of products) {
    const qty = p.total_minted_amount || 0;
    await ProductHolding.deleteMany({ product_id: p._id });
    await ProductHolding.create({
      product_id: p._id,
      owner: { kind: 'Company', id: company._id, email: company.email || '', name: company.name || '' },
      quantity: qty,
    });
    totalItems += qty;
    console.log(`  ${p.name || p._id}: company now owns ${qty} item(s).`);
  }

  console.log(`Done. ${products.length} product(s), ${totalItems} item(s) assigned to "${company.name}".`);
  console.log(`Login (admin panel): username "${DEMO_COMPANY.name}", password "${DEMO_COMPANY.password}".`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
