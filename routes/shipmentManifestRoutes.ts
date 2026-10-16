const express = require('express');
const router = express.Router();
const ShipmentManifestController = require('../controllers/shipmentManifestController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Admin-panel side (frontend: super admin + Supervisor, via resolveCompanyScope).
router.post('/', protect, restrictTo('Employee', 'Company'), ShipmentManifestController.create);
router.get('/', protect, restrictTo('Employee', 'Company'), ShipmentManifestController.list);
router.get('/:id', protect, restrictTo('Employee', 'Company'), ShipmentManifestController.getById);
router.get('/:id/history', protect, restrictTo('Employee', 'Company'), ShipmentManifestController.history);
router.delete('/:id', protect, restrictTo('Employee', 'Company'), ShipmentManifestController.remove);

// Staff app side — Employee sessions only (same restriction as creating a
// capture, captureRoutes.ts), so every inspection is attributable to who
// actually ran it.
router.get('/code/:code', protect, restrictTo('Employee'), ShipmentManifestController.lookupByCode);
router.post('/:id/preview-match', protect, restrictTo('Employee'), ShipmentManifestController.previewMatch);
router.post('/:id/inspect', protect, restrictTo('Employee'), ShipmentManifestController.inspect);

module.exports = router;
