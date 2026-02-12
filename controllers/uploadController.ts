const upload = require("../utils/upload");
const util = require("util");

exports.index = (req: any, res: any) => {
    return res.render('index', { message: req.flash() });
}

exports.uploadSingle = (req: any, res: any, next: any) => {
    try {
        if (req.file) {
            console.log(req.file)
            res.status(200).json({
                status: 'success',
                url: req.file.filename
            });
        }
    } catch (error) {
        next(error);
    }
}

exports.uploadMultiple = (req: any, res: any, next: any) => {
    try {
        if (req.files.length) {
            let images = [];
            for(let i = 0; i < req.files.length ; ++ i) {
                images.push(req.files[i].filename);
            }
            res.status(200).json({
                status: 'success',
                files: images
            });
        }
    } catch (err) {
        next(err);
    }
    // return res.redirect('/');
}

exports.uploadSingleV2 = async (req: any, res: any) => {
    const uploadFile = util.promisify(upload.single('file'));
    try {
        await uploadFile(req, res);
        console.log(req.file)
        
        req.flash('success', 'File Uploaded.');
    } catch (error) {
        console.log(error)
    }
    return res.redirect('/');
}