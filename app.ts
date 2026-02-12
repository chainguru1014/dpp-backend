const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const router = express.Router();

const companyRoutes = require('./routes/companyRoutes');
const qrcodeRoutes = require('./routes/qrcodeRoutes');
const productRoutes = require('./routes/productRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const userRoutes = require('./routes/userRoutes');
const globalErrHandler = require('./controllers/errorController');
const AppError = require('./utils/appError');

const app = express();

// Allow Cross-Origin requests
// app.use(cors({
//     origin: ['*'],
//     methods: ['GET','POST','DELETE','UPDATE','PUT','PATCH']
// }));
app.use(cors());
//app.use(cors({
//    origin: ['https://', 'https://www.', 'http://', 'http://'],
//    methods: ['GET','POST','DELETE','UPDATE','PUT','PATCH']
//}));

// Set security HTTP headers
app.use(helmet());

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

app.use('/files', express.static('uploads'));

//handle undefined Routes
app.use('*', (req: any, res: any, next: any) => {
    console.log(req.params);
    const err = new AppError(404, 'fail', 'undefined route');
    next(err, req, res, next);
});

app.use(globalErrHandler);

module.exports = app;