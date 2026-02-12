const express = require('express');
const router = express.Router();
const CompanyController = require('../controllers/companyController');

// Protect all routes after this middleware
// router.use(authController.protect);

router.get('/', CompanyController.getAllCompanys);
router.post('/auth', CompanyController.login);
router.get('/products',CompanyController.getProductsByCompanyId);
// router.get('/info/:wallet', CompanyController.getCompanyByWallet);
router.get('/:id', CompanyController.getCompany);
router.post('/', CompanyController.addCompany);
router.put('/:id', CompanyController.updateCompany);
router.delete('/:id', CompanyController.deleteCompany);
router.get('/verify/:id', CompanyController.verify);



module.exports = router;