const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');

// System (broadcast) management — super admin. Declared before the dynamic
// ":id/read" routes so the static "system" segment isn't swallowed.
router.get('/system', NotificationController.systemList);
router.post('/system', NotificationController.createSystem);
router.put('/system/:id', NotificationController.updateSystem);
router.delete('/system/:id', NotificationController.removeSystem);

// Reader endpoints (app users + admin companies).
router.get('/', NotificationController.list);
router.get('/unread-count', NotificationController.unreadCount);
router.post('/read-all', NotificationController.markAllRead);
router.post('/:id/read', NotificationController.markRead);

module.exports = router;
