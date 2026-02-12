// Node.js script to import JSON data into MongoDB
// This script handles MongoDB ObjectId conversion properly
// Run from backend directory: node import-mongodb-data.js

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB connection string - adjust if needed
// Use 127.0.0.1 instead of localhost to force IPv4
const MONGODB_URI = process.env.DATABASE || 'mongodb://127.0.0.1:27017/4dveritasG';

// Collection mappings - adjust paths as needed
const collections = [
  { file: path.join(__dirname, '..', '4dveritasG.qrcodes.json'), name: 'qrcodes' },
  { file: path.join(__dirname, '..', '4dveritasG.serials.json'), name: 'serials' },
  { file: path.join(__dirname, '..', '4dveritasG.users.json'), name: 'users' },
  { file: path.join(__dirname, '..', '4dveritasG.companies.json'), name: 'companies' },
  { file: path.join(__dirname, '..', '4dveritasG.products.json'), name: 'products' }
];

// Function to convert MongoDB export format to proper format
function convertMongoDBFormat(data) {
  if (Array.isArray(data)) {
    return data.map(item => convertMongoDBFormat(item));
  } else if (data && typeof data === 'object') {
    const converted = {};
    for (const key in data) {
      if (key === '_id' && data[key] && data[key].$oid) {
        converted[key] = new mongoose.Types.ObjectId(data[key].$oid);
      } else if (key === 'product_id' && data[key] && data[key].$oid) {
        converted[key] = new mongoose.Types.ObjectId(data[key].$oid);
      } else if (key === 'company_id' && data[key] && data[key].$oid) {
        converted[key] = new mongoose.Types.ObjectId(data[key].$oid);
      } else if (key === 'parent' && data[key] && data[key].$oid) {
        converted[key] = new mongoose.Types.ObjectId(data[key].$oid);
      } else {
        converted[key] = convertMongoDBFormat(data[key]);
      }
    }
    return converted;
  }
  return data;
}

async function importData() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB!');

    const db = mongoose.connection.db;

    for (const collection of collections) {
      try {
        console.log(`\nProcessing ${collection.name}...`);
        
        // Try multiple possible paths
        let filePath = collection.file;
        if (!fs.existsSync(filePath)) {
          // Try alternative path
          filePath = path.join('d:', '4D', `4dveritasG.${collection.name}.json`);
        }
        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${collection.file} or ${filePath}`);
          continue;
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        let data = JSON.parse(fileContent);

        // Drop existing collection
        try {
          await db.collection(collection.name).drop();
          console.log(`Dropped existing ${collection.name} collection`);
        } catch (err) {
          // Collection might not exist, that's okay
          console.log(`Collection ${collection.name} doesn't exist yet`);
        }

        // Convert MongoDB export format
        data = convertMongoDBFormat(data);

        // Insert data
        if (data.length > 0) {
          await db.collection(collection.name).insertMany(data);
          console.log(`✓ Imported ${data.length} documents into ${collection.name}`);
        } else {
          console.log(`⚠ No data to import for ${collection.name}`);
        }
      } catch (err) {
        console.error(`Error importing ${collection.name}:`, err.message);
      }
    }

    console.log('\n✓ Import complete!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

importData();
