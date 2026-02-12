// Script to ensure uploads directory exists
// Run this before starting the server on VPS

const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✓ Created uploads directory:', uploadsDir);
} else {
    console.log('✓ Uploads directory already exists:', uploadsDir);
}

// Check write permissions
try {
    const testFile = path.join(uploadsDir, '.test-write');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('✓ Uploads directory has write permissions');
} catch (error) {
    console.error('✗ Uploads directory does not have write permissions:', error.message);
    console.error('  Please check directory permissions on the VPS');
    process.exit(1);
}

console.log('✓ Uploads directory setup complete');
