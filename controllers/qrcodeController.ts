const QRcode = require('../models/qrcodeModel');
const Serials = require('../models/serialModal')
const Product = require('../models/productModel');
const Company = require('../models/companyModel');
const base = require('./baseController');
const APIFeatures = require('../utils/apiFeatures');
const { encrypt, decrypt } = require('../utils/helper');
const qrcode = require('qrcode');

const divcount = 20000;

const toStringArray = (value: any): string[] => {
    if (value == null) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item: any) => toStringArray(item));
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    if (typeof value === 'object') {
        return Object.values(value).flatMap((item: any) => toStringArray(item));
    }

    return [];
};

const toArray = (value: any): any[] => {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'object') {
        return Object.values(value);
    }
    return [value];
};

const normalizeProductMedia = (productDoc: any) => {
    if (!productDoc || typeof productDoc !== 'object') {
        return productDoc;
    }

    const normalized = { ...productDoc };
    normalized.images = toStringArray(productDoc.images);
    normalized.files = toStringArray(productDoc.files);
    normalized.videos = toArray(productDoc.videos);

    if (productDoc.warrantyAndGuarantee && typeof productDoc.warrantyAndGuarantee === 'object') {
        normalized.warrantyAndGuarantee = {
            ...productDoc.warrantyAndGuarantee,
            images: toStringArray(productDoc.warrantyAndGuarantee.images),
            files: toStringArray(productDoc.warrantyAndGuarantee.files),
            videos: toArray(productDoc.warrantyAndGuarantee.videos)
        };
    }

    if (productDoc.manualsAndCerts && typeof productDoc.manualsAndCerts === 'object') {
        normalized.manualsAndCerts = {
            ...productDoc.manualsAndCerts,
            images: toStringArray(productDoc.manualsAndCerts.images),
            files: toStringArray(productDoc.manualsAndCerts.files),
            videos: toArray(productDoc.manualsAndCerts.videos)
        };
    }

    return normalized;
};

exports.getAllQRcodes = base.getAll(QRcode);
exports.getQRcode = base.getOne(QRcode);

// Don't update password on this 
exports.updateQRcode = base.updateOne(QRcode);
exports.deleteQRcode = base.deleteOne(QRcode);
exports.addQRcode = base.createOne(QRcode);

exports.getQRcodesWithProductId = async(req: any, res: any, next: any) => {
    try {
        // const doc = await QRcode.find({ product_id: req.body.product_id }).skip(req.body.offset).limit(req.body.amount);
        const product = await Product.findById(req.body.product_id);

        let data = [];
        let count = 100;
        
        if (req.body.page == 0) {
            
            for (let i = req.body.from; i <= req.body.to; i ++) {
                if (i > 0 && i <= product.total_minted_amount) {
                    const stringdata = JSON.stringify({
                        product_id: product._id,
                        token_id: i
                    });
                    const encryptData = encrypt(stringdata);
                    data.push(encryptData);
                }
            }
        } else if (req.body.page > 0) {
            if (req.body.page == Math.ceil(product.total_minted_amount / 100) && product.total_minted_amount % 100) {
                count = product.total_minted_amount % 100;
            } 
            else if (req.body.page > Math.ceil(product.total_minted_amount / 100)) {
                count = 0;
            }
            
            for (let i = 1; i <= count; i ++) {
                const stringdata = JSON.stringify({
                    product_id: product._id,
                    token_id: (req.body.page - 1) * 100 + i
                });
                const encryptData = encrypt(stringdata);
                data.push(encryptData);
            }
        }

        res.status(200).json({
            status: 'success',
            data
        });
        
    } catch (error) {
        next(error);
    }

};

exports.decrypt = async (req: any, res: any, next: any) => { 
    try {
        console.log(req.body.encryptData);
        const data = JSON.parse(decrypt(req.body.encryptData));
        console.log(data);

        if(data.product_id) {
            const qrcodeData = await QRcode.findOne({product_id: data.product_id, qrcode_id: data.token_id}).populate('company_id');
            console.log(qrcodeData);

            const product = await Product.findById(data.product_id);
            const serials = await Serials.find({product_id:data.product_id,qrcode_id:data.token_id});
            const normalizedProduct = normalizeProductMedia(product?._doc || {});

            const qrcodeImage = await qrcode.toDataURL(req.body.encryptData);

            const resData = {
                token_id: data.token_id,
                location: qrcodeData.company_id.location,
                ...normalizedProduct,
                qrcode_img: qrcodeImage,
                serialInfos:serials
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'Product'
            });
        } else if (data.user_id) {
            const company = await Company.findById(data.user_id);
            company.privateKey = undefined;
            company.password = undefined;
            console.log(company);
            const qrcodeImage = await qrcode.toDataURL('https://4dveritaspublic.com?qrcode=' + req.body.encryptData);
            
            const resData = {
                token_id: data.token_id,
                ...company._doc,
                qrcode_img: qrcodeImage
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'User'
            });
        }
    } catch (error) {
        next(error);
    }
};

exports.getProductInfoWithQRCodeID = async (req: any, res: any, next: any) => { 
    try {
        const data = await QRcode.findById(req.params.id).populate('company_id');
        console.log(data);

        if(data.product_id) {
            const product = await Product.findById(data.product_id);
            const serials = await Serials.find({product_id:data.product_id,qrcode_id:data.qrcode_id});
            const normalizedProduct = normalizeProductMedia(product?._doc || {});

            const stringdata = JSON.stringify({
                product_id: product._id,
                token_id: data.qrcode_id
            });
            const encryptData = encrypt(stringdata);
            const qrcodeImage = await qrcode.toDataURL('https://4dveritaspublic.com?qrcode=' + encryptData);

            const resData = {
                token_id: data.qrcode_id,
                location: data.company_id.location,
                ...normalizedProduct,
                serialInfos:serials,
                qrcode_img: qrcodeImage,
                company:data.company_id
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'Product'
            });
        }
    } catch (error) {
        next(error);
    }
};


exports.getProductInfoWithSerial = async(req:any, res:any, next:any) => {
    try {
        const serialData = req.body.data
        const serialInfo = await Serials.findOne({type:serialData.type,serial:serialData.serial}).populate('company_id')
        if(serialInfo) {
            const product = await Product.findById(serialInfo.product_id);
            console.log(product);
            const serials = await Serials.find({product_id:serialInfo.product_id,qrcode_id:serialInfo.qrcode_id});
            const normalizedProduct = normalizeProductMedia(product?._doc || {});
            const stringdata = JSON.stringify({
                product_id: product._id,
                token_id: serialInfo.qrcode_id
            });
            const encryptData = encrypt(stringdata);
            const qrcodeImage = await qrcode.toDataURL('https://4dveritaspublic.com?qrcode=' + encryptData);

            const resData = {
                token_id: serialInfo.qrcode_id,
                location: serialInfo.company_id.location,
                ...normalizedProduct,
                serialInfos:serials,
                qrcode_img: qrcodeImage,
                company:serialInfo.company_id
            };
            
            res.status(200).json({
                status: 'success',
                data: resData,
                type: 'Product'
            });
        }

    }
    catch(error) {

    }
}

exports.getSerials = async(req:any, res:any, next:any) => {
    try {
        try {
            // const doc = await QRcode.find({ product_id: req.body.product_id }).skip(req.body.offset).limit(req.body.amount);
            const product = await Product.findById(req.body.product_id)
            const serials = await Serials.find({product_id:req.body.product_id})
    
            let data = [];
            let count = 100;
            
            if (req.body.page == 0) {
                
                for (let i = req.body.from; i <= req.body.to; i ++) {
                    if (i > 0 && i <= product.total_minted_amount) {
                        let serial = serials.filter((item:any)=>item.qrcode_id === i)
                        data.push(serial);
                    }
                }
            } else if (req.body.page > 0) {
                if (req.body.page == Math.ceil(product.total_minted_amount / 100) && product.total_minted_amount % 100) {
                    count = product.total_minted_amount % 100;
                } 
                else if (req.body.page > Math.ceil(product.total_minted_amount / 100)) {
                    count = 0;
                }
                
                for (let i = 1; i <= count; i ++) {
                    const stringdata = JSON.stringify({
                        product_id: product._id,
                        token_id: (req.body.page - 1) * 100 + i
                    });

                    let serial = serials.filter((item:any)=>item.qrcode_id === ((req.body.page - 1) * 100 + i))
                    data.push(serial);
                }
            }
    
            res.status(200).json({
                status: 'success',
                data
            });
            
        } catch (error) {
            next(error);
        }
    }
    catch(err) {

    }

}