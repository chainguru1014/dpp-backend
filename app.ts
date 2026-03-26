const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const fs = require('fs');
const fetch = require('node-fetch');
const router = express.Router();

const companyRoutes = require('./routes/companyRoutes');
const qrcodeRoutes = require('./routes/qrcodeRoutes');
const productRoutes = require('./routes/productRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const userRoutes = require('./routes/userRoutes');
const globalErrHandler = require('./controllers/errorController');
const AppError = require('./utils/appError');

const app = express();

// CORS configuration - must be before other middleware
app.use(cors({
    origin: '*', // Allow all origins for development/production
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Set security HTTP headers (configured to work with CORS)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false
}));

// Limit request from the same API 
const limiter = rateLimit({
    max: 1000,
    windowMs: 60 * 60 * 1000,
    message: 'Too Many Request from this IP, please try again in an hour'
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
app.use(express.json({
    limit: '100mb'
}));
app.use(express.urlencoded({limit: '100mb'}));

// Data sanitization against Nosql query injection
app.use(mongoSanitize());

// Data sanitization against XSS(clean user input from malicious HTML code)
app.use(xss());

// Prevent parameter pollution
app.use(hpp());

// Routes
app.use('/company', companyRoutes);
app.use('/upload', uploadRoutes);
app.use('/qrcode', qrcodeRoutes);
app.use('/user', userRoutes);

// Serve product web page for URL-format QR codes:
//  - /product/:productId/:qrcodeId
// This must be after /qrcode routes but before the catch-all route
app.get('/product/:productId/:qrcodeId', (req: any, res: any) => {
    const { productId, qrcodeId } = req.params;
    const path = require('path');
    const htmlPath = path.join(__dirname, '../app/public/product.html');
    const fs = require('fs');
    
    if (fs.existsSync(htmlPath)) {
        // Read and serve the HTML file
        let html = fs.readFileSync(htmlPath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } else {
        // Fallback: return a simple HTML response
        res.setHeader('Content-Type', 'text/html');
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Details</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    .error { color: red; }
                </style>
            </head>
            <body>
                <h1>Product Details</h1>
                <p>Loading product information for key: ${productId}/${qrcodeId}</p>
                <div id="content"></div>
                <script>
                    const productId = '${productId}';
                    const qrcodeId = '${qrcodeId}';
                    // Use same-origin in hosted environments to avoid cross-origin/CORS issues.
                    const API_BASE_URL = '/';
                    const endpoint = 'qrcode/public/' + encodeURIComponent(productId) + '/' + encodeURIComponent(qrcodeId);
                    fetch(API_BASE_URL + endpoint)
                        .then(res => res.json())
                        .then(data => {
                            if (data.status === 'success') {
                                document.getElementById('content').innerHTML = 
                                    '<h2>' + (data.data.name || 'Product') + '</h2>' +
                                    '<p><strong>Model:</strong> ' + (data.data.model || 'N/A') + '</p>' +
                                    '<p>' + (data.data.detail || 'No description available') + '</p>';
                            } else {
                                document.getElementById('content').innerHTML = 
                                    '<p class="error">Error: ' + (data.message || 'Product not found') + '</p>';
                            }
                        })
                        .catch(err => {
                            document.getElementById('content').innerHTML = 
                                '<p class="error">Error loading product: ' + err.message + '</p>';
                        });
                </script>
            </body>
            </html>
        `);
    }
});

// Product management routes (must be after web product route to avoid route conflicts)
app.use('/product', productRoutes);

// Serve uploaded files - use absolute path
const path = require('path');
const uploadsPath = path.join(__dirname, 'uploads');
const remoteFilesBaseUrl = process.env.REMOTE_FILES_BASE_URL || 'http://82.165.217.122:5052/files';

// File fallback: if local upload is missing, proxy it from the VPS file host.
app.get('/files/:filename', async (req: any, res: any, next: any) => {
    try {
        const safeFilename = path.basename(req.params.filename || '');
        const localFilePath = path.join(uploadsPath, safeFilename);

        if (fs.existsSync(localFilePath)) {
            return res.sendFile(localFilePath);
        }

        const remoteUrl = `${remoteFilesBaseUrl}/${encodeURIComponent(safeFilename)}`;
        const remoteResponse = await fetch(remoteUrl);

        if (!remoteResponse.ok) {
            return res.status(404).json({
                status: 'fail',
                message: 'File not found'
            });
        }

        const contentType = remoteResponse.headers.get('content-type') || 'application/octet-stream';
        const fileBuffer = await remoteResponse.buffer();
        res.setHeader('Content-Type', contentType);
        return res.send(fileBuffer);
    } catch (error) {
        return next(error);
    }
});

app.use('/files', express.static(uploadsPath));

//handle undefined Routes
app.use('*', (req: any, res: any, next: any) => {
    console.log(req.params);
    const err = new AppError(404, 'fail', 'undefined route');
    next(err, req, res, next);
});

app.use(globalErrHandler);

module.exports = app;