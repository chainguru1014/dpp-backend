/* Demo data for presentations (Yometel luxury demo):
 *  1. Work records' photos: the seeded records showed the product's studio
 *     photo; they now show capture photos (the item with its QR hang tag,
 *     seed-cap-ymt-<sku>-<1|2>.jpg, copied into dist/uploads first).
 *  2. Service requests (repair / resale / rental / recycling) from demo
 *     shoppers, in every status, with the brand's replies and history.
 *
 *   node scripts/seed-demo-captures-requests.js            # dry run
 *   node scripts/seed-demo-captures-requests.js --apply    # back up, then write
 *
 * Backup: ~/backup-<date>-demo-captures-requests.json (old imagePaths and the
 * ids of the requests added, so both can be undone).
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

const COMPANY = '6ad4efeb11da8caa0dd79b1f';
const UPLOADS = path.join(__dirname, '..', 'dist', 'uploads');
const DAY = 24 * 3600 * 1000;

const REQUESTS = [
  { sku: 'YMT-CH42-SS', kind: 'repair', status: 'in_progress', days: 12, item: 7, msg: 'The chronograph pusher at 2 o’clock sticks and the seconds hand does not reset to zero.', reply: 'Thank you. Your watch arrived at our Geneva workshop. We are replacing the pusher gasket and will service the movement. Expected return: 10 days.', steps: [['accepted', 'We can repair this under warranty. Please use the prepaid shipping label we emailed you.'], ['in_progress', 'Your watch is in the workshop.']] },
  { sku: 'YMT-EP21-WG', kind: 'repair', status: 'completed', days: 19, item: 3, msg: 'The clasp of the chain opens by itself. Could you check it?', reply: 'The clasp was replaced and the chain cleaned. It is on its way back to you.', steps: [['accepted', 'Please bring the pendant to the Milan boutique or send it insured.'], ['in_progress', 'Clasp replacement in progress.'], ['completed', 'Repaired and sent back.']] },
  { sku: 'YMT-RH09-RG', kind: 'resell', status: 'new', days: 1, item: 12, msg: 'I would like to sell this ring back. Worn twice, no scratches, original box and certificate included.', reply: '', steps: [] },
  { sku: 'YMT-MB40-AU', kind: 'resell', status: 'accepted', days: 5, item: 4, msg: 'Watch is 6 months old, bracelet has light marks. Full set with papers.', reply: 'We can offer a store credit of €2,250 after inspection. Please book a visit in any boutique.', steps: [['accepted', 'Offer sent: €2,250 store credit after inspection.']] },
  { sku: 'YMT-DS12-PT', kind: 'rent', status: 'declined', days: 9, item: 9, msg: 'Could I rent these earrings for a wedding on 14 December?', reply: 'We are sorry, these earrings are not available for rental in December. Our Diamond Solitaire can be rented for that date instead.', steps: [['declined', 'Not available on that date.']] },
  { sku: 'YMT-GH22-YG', kind: 'recycle', status: 'completed', days: 15, item: 2, msg: 'One hoop is bent beyond repair. I would like to return the gold for recycling.', reply: 'We received the earrings. The gold was sent to our certified refiner and a €60 voucher was added to your account.', steps: [['accepted', 'Please send the earrings with the prepaid envelope.'], ['completed', 'Recycled. Voucher added.']] },
  { sku: 'YMT-SO10-PT', kind: 'rent', status: 'in_progress', days: 3, item: 5, msg: 'I would like to rent the solitaire for one week from 20 December.', reply: 'Your rental is confirmed for 20–27 December. The deposit will be held on your card.', steps: [['accepted', 'Dates confirmed.'], ['in_progress', 'Preparing your rental.']] },
  { sku: 'YMT-CB3-AG', kind: 'repair', status: 'new', days: 0, item: 6, msg: 'One of the charms came off the middle bangle.', reply: '', steps: [] },
  { sku: 'YMT-VH10-RG', kind: 'resell', status: 'cancelled', days: 21, item: 11, msg: 'Thinking about selling this ring. What would you offer?', reply: '', steps: [['cancelled', 'Cancelled by the shopper.']] },
  { sku: 'YMT-WS-RG', kind: 'repair', status: 'accepted', days: 2, item: 8, msg: 'The band needs resizing from EU 52 to EU 54.', reply: 'Resizing is free within the first year. Please drop the band at any boutique.', steps: [['accepted', 'Free resizing confirmed.']] },
];

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.DATABASE);
  const db = mongoose.connection.db;

  // 1. Work record photos.
  const caps = await db.collection('capturerecords').find({ imagePath: /^\/files\/seed-ymt-/ }).project({ imagePath: 1 }).toArray();
  const missing = new Set();
  const capPlan = caps.map((c, i) => {
    const sku = c.imagePath.replace(/^\/files\/seed-ymt-/, '').replace(/-\d\.jpg$/, '');
    const file = `seed-cap-ymt-${sku}-${(i % 2) + 1}.jpg`;
    if (!fs.existsSync(path.join(UPLOADS, file))) missing.add(file);
    return { _id: c._id, old: c.imagePath, next: `/files/${file}` };
  });
  console.log('work records to update:', capPlan.length, 'missing files:', [...missing]);

  // 2. Service requests.
  const products = await db.collection('products').find({ skuStyleNumber: { $in: REQUESTS.map((r) => r.sku) } }).project({ name: 1, skuStyleNumber: 1 }).toArray();
  const bySku = Object.fromEntries(products.map((p) => [p.skuStyleNumber, p]));
  const emails = ['chrisgroenev@gmail.com', 'test@gmail.com', 'claude-test@example.com', 'test@test.test'];
  const users = (await db.collection('users').find({ email: { $in: emails } }).project({ email: 1, nickname: 1, firstName: 1 }).toArray());
  console.log('products found:', products.length, 'shoppers:', users.map((u) => u.email));
  const existing = await db.collection('circularrequests').countDocuments({ company_id: new mongoose.Types.ObjectId(COMPANY) });
  console.log('existing requests for the company:', existing);
  if (!apply) { console.log('Dry run. Add --apply.'); await mongoose.disconnect(); return; }
  if (missing.size) throw new Error('Copy the capture photos into dist/uploads first.');

  const backup = { captures: capPlan.map(({ _id, old }) => ({ _id, imagePath: old })), requestIds: [] };
  const file = path.join(os.homedir(), `backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-demo-captures-requests.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  console.log('backup', file);

  for (const c of capPlan) await db.collection('capturerecords').updateOne({ _id: c._id }, { $set: { imagePath: c.next } });

  const now = Date.now();
  const names = ['Chris G.', 'Mia Tanaka', 'Lucas Martin', 'Sofia Rossi'];
  const docs = REQUESTS.filter((r) => bySku[r.sku]).map((r, i) => {
    const u = users[i % Math.max(1, users.length)];
    const created = new Date(now - r.days * DAY - (i * 37 + 5) * 60000);
    const history = [{ status: 'new', note: '', by: 'shopper', at: created }];
    r.steps.forEach(([status, note], k) => history.push({ status, note, by: status === 'cancelled' ? 'shopper' : 'Yometel', at: new Date(created.getTime() + (k + 1) * Math.max(1, r.days) * DAY / (r.steps.length + 1)) }));
    return {
      ref: `SR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      kind: r.kind,
      product_id: bySku[r.sku]._id,
      company_id: new mongoose.Types.ObjectId(COMPANY),
      qrcode_id: r.item,
      productName: bySku[r.sku].name,
      user_id: u ? u._id : new mongoose.Types.ObjectId(),
      contact: { name: names[i % names.length], email: u ? u.email : 'shopper@example.com', phone: i % 3 === 0 ? '+81 90 1234 56' + String(10 + i) : '' },
      message: r.msg,
      status: r.status,
      reply: r.reply,
      history,
      createdAt: created,
      updatedAt: history[history.length - 1].at,
      __v: 0,
    };
  });
  const res = await db.collection('circularrequests').insertMany(docs);
  backup.requestIds = Object.values(res.insertedIds);
  fs.writeFileSync(file, JSON.stringify(backup));
  console.log('work records updated', capPlan.length, 'requests added', docs.length);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
