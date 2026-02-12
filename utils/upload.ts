const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uniqid = require('uniqid'); 

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
}

const storage = multer.diskStorage({
    destination: function (req: any, file: any, cb: any) {
        // Use absolute path to ensure it works on VPS
        cb(null, uploadsDir);
    },
    filename: function (req: any, file: any, cb: any) {
        // Generate unique filename
        const uniqueFilename = Date.now() + uniqid() + path.extname(file.originalname);
        cb(null, uniqueFilename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req: any, file: any, cb: any) => {
        // Accept images only
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images are allowed.'), false);
        }
    }
});

module.exports = upload;