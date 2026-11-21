/* Remove products by exact name, with every record that points at them.
 *
 *   node scripts/remove-products.js "Shirt Jacket" "Blue Denim Pants"          # dry run: counts only
 *   node scripts/remove-products.js --apply "Shirt Jacket" "Blue Denim Pants"  # back up, then delete
 *
 * Looks in every collection for product_id / productId / data.productId
 * (ObjectId or string), plus PMC identifiers of the removed PMCs and gate
 * inspections of the removed shipment manifests. With --apply, all matched
 * documents are first written to ~/backup-<date>-remove-products.json.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const names = args.filter((a) => a !== '--apply');
  if (!names.length) throw new Error('Give product names');
  await mongoose.connect(process.env.DATABASE);
  const db = mongoose.connection.db;

  const products = await db.collection('products').find({ name: { $in: names } }).toArray();
  console.log('Products:');
  for (const p of products) console.log(' ', String(p._id), JSON.stringify(p.name), 'company', String(p.company_id || p.companyId || ''), 'brand', String(p.brand_id || p.brandId || ''));
  if (!products.length) { await mongoose.disconnect(); return; }
  const oids = products.map((p) => p._id);
  const strs = oids.map(String);
  const any = [...oids, ...strs];
  const match = { $or: [{ product_id: { $in: any } }, { productId: { $in: any } }, { 'data.productId': { $in: any } }] };

  const backup = { products };
  const plan = [];
  const cols = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => n !== 'products' && !n.startsWith('system.'));
  for (const name of cols) {
    const docs = await db.collection(name).find(match).toArray();
    if (docs.length) { backup[name] = docs; plan.push([name, { _id: { $in: docs.map((d) => d._id) } }]); }
  }
  // Linked one step further.
  const pmcIds = (backup.pmcs || []).map((d) => d._id);
  if (pmcIds.length && cols.includes('pmcidentifiers')) {
    const docs = await db.collection('pmcidentifiers').find({ pmc_id: { $in: pmcIds } }).toArray();
    if (docs.length) { backup.pmcidentifiers = docs; plan.push(['pmcidentifiers', { _id: { $in: docs.map((d) => d._id) } }]); }
  }
  const manifestIds = (backup.shipmentmanifests || []).map((d) => d._id);
  if (manifestIds.length && cols.includes('inspectionrecords')) {
    const docs = await db.collection('inspectionrecords').find({ manifest_id: { $in: manifestIds } }).toArray();
    if (docs.length) { backup.inspectionrecords = docs; plan.push(['inspectionrecords', { _id: { $in: docs.map((d) => d._id) } }]); }
  }
  plan.push(['products', { _id: { $in: oids } }]);

  console.log('Records:');
  for (const [k, v] of Object.entries(backup)) console.log(' ', k, v.length);
  if (!apply) { console.log('Dry run. Add --apply to back up and delete.'); await mongoose.disconnect(); return; }

  const file = path.join(os.homedir(), `backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-remove-products.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  console.log('Backup:', file);
  for (const [name, q] of plan) {
    const r = await db.collection(name).deleteMany(q);
    console.log('  deleted', name, r.deletedCount);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
