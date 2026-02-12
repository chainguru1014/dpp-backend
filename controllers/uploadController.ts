const upload = require("../utils/upload");
const util = require("util");

exports.index = (req: any, res: any) => {
    return res.render('index', { message: req.flash() });
}

exports.uploadSingle = (req: any, res: any, next: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'No file uploaded'
            });
        }
        
        console.log('File uploaded successfully:', req.file.filename);
        res.status(200).json({
            status: 'success',
            url: req.file.filename,
            path: `/files/${req.file.filename}`
        });
    } catch (error) {
        console.error('Upload error:', error);
        next(error);
    }
}

exports.uploadMultiple = (req: any, res: any, next: any) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No files uploaded'
            });
        }
        
        let images = [];
        for(let i = 0; i < req.files.length ; ++ i) {
            // Return just the filename for frontend compatibility
            images.push(req.files[i].filename);
        }
        
        console.log('Multiple files uploaded successfully:', images.length);
        res.status(200).json({
            status: 'success',
            files: images
        });
    } catch (err) {
        console.error('Multiple upload error:', err);
        next(err);
    }
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