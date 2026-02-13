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
app.use('/product', productRoutes);
app.use('/upload', uploadRoutes);
app.use('/qrcode', qrcodeRoutes);
app.use('/user', userRoutes);

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