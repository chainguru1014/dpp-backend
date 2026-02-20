const AppError = require('../utils/appError');
const Product = require('../models/productModel');
const QRcode = require('../models/qrcodeModel');
const userModel = require('../models/userModel')
const companyModel = require('../models/companyModel')
const {v4:uuidv4} = require('uuid')
const serialModal = require('../models/serialModal')
const base = require('./baseController');
const APIFeatures = require('../utils/apiFeatures');

const divcount = 20000;
const mintcount = 15000;
const numThreads = 4;

const delay = (ms : any) => new Promise(resolve => setTimeout(resolve, ms))

exports.getAllProducts = async(req: any, res: any, next: any) => {
    try {
        const mongoose = require('mongoose');
        const filter: any = { is_deleted: false };
        
        // Handle company_id filter - convert string to ObjectId if needed
        if (req.body.company_id) {
            try {
                // Try to convert to ObjectId if it's a string
                const companyIdStr = String(req.body.company_id);
                if (mongoose.Types.ObjectId.isValid(companyIdStr)) {
                    filter.company_id = mongoose.Types.ObjectId(companyIdStr);
                } else {
                    filter.company_id = req.body.company_id;
                }
            } catch (e) {
                console.error('Error converting company_id to ObjectId:', e);
                filter.company_id = req.body.company_id;
            }
        }
        
        // Add any other filters from req.body
        Object.keys(req.body).forEach(key => {
            if (key !== 'company_id') {
                filter[key] = req.body[key];
            }
        });
        
        console.log('getAllProducts filter:', JSON.stringify(filter, null, 2));
        const doc = await Product.find(filter).populate('company_id');
        console.log('getAllProducts found:', doc.length, 'products');
        if (doc.length > 0) {
            console.log('Sample product company_id:', doc[0].company_id);
        }
        
        res.status(200).json({
            status: 'success',
            results: doc.length,
            data: {
                data: doc
            }
        });
        
    } catch (error) {
        console.error('getAllProducts error:', error);
        next(error);
    }

};

/**
 * Returns products filtered by optional user/company id.
 * If no userId is supplied, all non-deleted products are returned.
 */
exports.getProductsByUser = async (req: any, res: any, next: any) => {
    try {
        const userId = req.query.userId;
        const filter: any = { is_deleted: false };

        if (userId) {
            filter.company_id = userId;
        }

        const doc = await Product.find(filter).populate('company_id');

        res.status(200).json({
            status: 'success',
            results: doc.length,
            data: {
                data: doc
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getProduct = base.getOne(Product);

// Don't update password on this 
exports.updateProduct = async(req: any, res: any, next: any) => {
    try {
        const product = await Product.findOne({ name: req.body.name });

        if (product.total_minted_amount > 0) {
            return next(new AppError(404, 'fail', "Can't update this product. You already minted."), req, res, next);
        }
        if (product.is_deleted) {
            return next(new AppError(404, 'fail', "Product does not exists."), req, res, next);
        }
        
        const doc = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};

exports.deleteProduct = async(req: any, res: any, next: any) => {
    try {
        const product = await Product.findOne({ _id: req.params._id });

        if (product.total_minted_amount > 0) {
            return next(new AppError(404, 'fail', "Can't remove this product. You already minted."), req, res, next);
        }
        
        const doc = await Product.findByIdAndUpdate(req.params.id, { is_deleted: true }, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};

exports.addProduct = async(req: any, res: any, next: any) => {
    try {

        let product = req.body;
        product.total_minted_amount = 0;

        console.log(product);
        const data = await Product.findOne({ name: product.name, detail: product.detail });
        console.log(data);
        if(data) {
            return next(new AppError(404, 'fail', 'product already exists'), req, res, next);
        }

        const doc = await Product.create(product);

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};


async function mintChildProduct(product_id:string,qrcode_id:number) {
    try {
        const products = await Product.find({parent:product_id})

        for(const product of products) {
            let start = new Date();
            for(let j = 1;j<=product.parentCount;j++) {
                await QRcode.create({
                    product_id: product._id,
                    company_id: product.company_id._id,
                    qrcode_id: product.total_minted_amount + j,
                    parent_qrcode_id:qrcode_id
                })
    
                for(const serial of product.serials) {
                    await serialModal.create({
                        type:serial.type,
                        serial:uuidv4(),
                        qrcode_id:product.total_minted_amount + j,
                        product_id:product._id,
                        company_id: product.company_id._id,
                        parent_qrcode_id:qrcode_id
                    })
                }

                const productInfos = await Product.find({parent:product._id})

                if(productInfos.length) {
                    mintChildProduct(product._id,product.total_minted_amount + j)
                }
            }

            // Previously, blockchain minting happened here. Now we only create QR codes and serials in the database.
            
        }


    }
    catch(error) {

    }
}

exports.mint = async(req: any, res: any, next: any) => {
    try {
        const product = await Product.findById(req.params.id).populate('company_id');

        console.log(product);
        let start = new Date();

        const mintAmount = req.body.amount;

        for (let j = 1; j <= mintAmount; j ++ ) {
            await QRcode.create({
                product_id: product._id,
                company_id: product.company_id._id,
                qrcode_id: product.total_minted_amount + j
            })

            for(const serial of product.serials) {
                await serialModal.create({
                    type:serial.type,
                    serial:uuidv4(),
                    qrcode_id:product.total_minted_amount + j,
                    product_id:product._id,
                    company_id: product.company_id._id,
                })
            }

            const products = await Product.find({parent:product._id})

            if(products.length > 0) {
                mintChildProduct(product._id,product.total_minted_amount + j)
            }

            
        }
        let end = new Date();
        console.log(end.getTime() - start.getTime())

        // Update total minted amount purely in the database (no blockchain interaction).
        product.total_minted_amount += mintAmount;
        await product.save();

        // @ts-ignore
        global.io.emit('Refresh product data');

        res.status(200).json({
            status: 'success',
            offset: product.total_minted_amount,
        });
    } catch (error) {
        next(error);
    }
};

exports.transfer = async(req: any, res: any, next: any) => {
    try {
        const { product_id, from_id, to_id, token_id } = req.body;

        const qr = await QRcode.findOne({
            product_id: product_id,
            company_id: from_id,
            qrcode_id: token_id
        });
        console.log(qr);

        qr.company_id = to_id;

        qr.save();
        
        // @ts-ignore
        global.io.emit('Refresh user data');

        res.status(200).json({
            status: true,
        });
    } catch (error) {
        next(error);
    }
}

exports.printQRCodes = async (req: any, res: any, next: any) => {
    try {
        const product = await Product.findById(req.params.id).populate('company_id');
        if (product.total_minted_amount >= product.printed_amount + req.body.count) {
            product.printed_amount += req.body.count;
        } else {
            product.printed_amount = product.total_minted_amount;
        }
        product.save();

        res.status(200).json({
            status: 'success',
            data: product
        });
    } catch (error) {
        next(error);
    }
}

exports.getTransaction = async(req:any,res:any,next:any) => {
    // Blockchain transaction lookup removed; endpoint kept for compatibility.
    res.status(200).json({
        status: 'success',
        data: [],
    });
}
