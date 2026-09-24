/**
 * One-off data backfill: fill in location (country/region/city) for existing
 * scan records that were saved without one, geolocating their stored IP (new
 * scans get this automatically — see qrcodeController.recordScan).
 *
 * Run from the backend folder (after `npm run build`, so dist/ is current):
 *   node backfill-scan-locations.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const ScanRecord = require('./dist/models/scanRecordModel');
const { geolocateIp } = require('./dist/utils/geoLocate');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  console.log('Connected to MongoDB.');

  const missing = { ip: { $nin: [null, ''] }, $or: [{ 'location.country': { $exists: false } }, { 'location.country': '' }, { 'location.country': null }] };
  const ips = await ScanRecord.distinct('ip', missing);
  console.log(`${ips.length} distinct IP(s) to geolocate.`);

  let updated = 0;
  for (const ip of ips) {
    const loc = await geolocateIp(ip);
    if (loc) {
      const res = await ScanRecord.updateMany({ ...missing, ip }, { $set: { location: loc } });
      updated += res.modifiedCount ?? res.nModified ?? 0;
      console.log(`  ${ip}: ${loc.city}, ${loc.country} (${res.modifiedCount ?? res.nModified} scan(s))`);
    } else {
      console.log(`  ${ip}: not resolvable (private/local IP or lookup failed)`);
    }
    await sleep(1500); // ip-api.com free tier: 45 requests/minute
  }

  console.log(`Done. ${updated} scan record(s) backfilled.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
