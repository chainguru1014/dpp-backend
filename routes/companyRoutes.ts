const express = require('express');
const router = express.Router();
const CompanyController = require('../controllers/companyController');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { requireSuperAdmin, requireSuperOrSelf } = require('../middleware/superAdmin');

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
router.get('/brand', protect, restrictTo('Company', 'Employee'), CompanyController.getBrand);
router.put('/brand', protect, restrictTo('Company', 'Employee'), CompanyController.updateBrand);
router.get('/dpp-theme', protect, restrictTo('Company', 'Employee'), CompanyController.getDppTheme);
router.put('/dpp-theme', protect, restrictTo('Company', 'Employee'), CompanyController.updateDppTheme);
router.get('/:id/dpp-theme', CompanyController.getPublicDppTheme);
router.get('/:id', CompanyController.getCompany);
// Adding or removing a brand company: the Yometel admin only (a brand it
// adds is accepted at once). Changing one: the admin, or the company itself.
router.post('/', protect, requireSuperAdmin, CompanyController.addCompany);
router.put('/:id', protect, requireSuperOrSelf, CompanyController.updateCompany);
router.delete('/:id', protect, requireSuperAdmin, CompanyController.deleteCompany);
router.get('/verify/:id', CompanyController.verify);



module.exports = router;