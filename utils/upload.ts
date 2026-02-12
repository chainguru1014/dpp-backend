const multer = require('multer');
const path = require('path');
const uniqid = require('uniqid'); 

// var storage = new GridFsStorage({
//     url: process.env.DATABASE,
//     options: { useNewUrlParser: true, useUnifiedTopology: true },
//     file: (req, file) => {
//       const match = ["image/png", "image/jpeg"];
  
//       if (match.indexOf(file.mimetype) === -1) {
//         const filename = `${Date.now()}-bezkoder-${file.originalname}`;
//         return filename;
//       }
  
//       return {
//         bucketName: "photos",
//         filename: `${Date.now()}-bezkoder-${file.originalname}`
//       };
//     }
//   });
const storage = multer.diskStorage({
    destination: function (req: any, file: any, cb: any) {
        cb(null, './uploads/');
      },
    filename: function (req: any, file: any, cb: any) {
        cb(null, Date.now() + uniqid() + path.extname(file.originalname));
    }
});

const upload = multer({storage: storage});

module.exports = upload;