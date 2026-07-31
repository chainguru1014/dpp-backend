const express = require('express');
const router = express.Router();
const CompanyController = require('../controllers/companyController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Protect all routes after this middleware
// router.use(authController.protect);

router.get('/', CompanyController.getAllCompanys);
router.post('/auth', CompanyController.login);
router.get('/products',CompanyController.getProductsByCompanyId);
// router.get('/info/:wallet', CompanyController.getCompanyByWallet);
// Must stay ahead of the /:id routes below, or Express matches
// "process-steps" as an :id value instead of this literal path.
router.get('/process-steps', protect, restrictTo('Company', 'Employee'), CompanyController.getProcessSteps);
router.put('/process-steps', protect, restrictTo('Company', 'Employee'), CompanyController.updateProcessSteps);
router.get('/:id', CompanyController.getCompany);
router.post('/', CompanyController.addCompany);
router.put('/:id', CompanyController.updateCompany);
router.delete('/:id', CompanyController.deleteCompany);
router.get('/verify/:id', CompanyController.verify);



module.exports = router;