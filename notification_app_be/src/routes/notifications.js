'use strict';

const express = require('express');
const { Log } = require('../../../logging_middleware/index');
const { getTopNNotifications } = require('../services/priorityInbox');

const router = express.Router();

/**
 * GET /api/v1/notifications/priority-inbox
 * Returns the top-N priority unread notifications.
 * Query param: ?top=10  (default 10)
 */
router.get('/priority-inbox', async (req, res) => {
  const token = process.env.AUTH_TOKEN;
  const topN = parseInt(req.query.top, 10) || 10;

  await Log('backend', 'info', 'route', `GET /priority-inbox top=${topN}`);

  try {
    const notifications = await getTopNNotifications(token, topN);
    await Log('backend', 'info', 'route', `Priority-inbox ok: ${notifications.length}`);
    return res.status(200).json({
      success: true,
      count: notifications.length,
      topN,
      notifications,
    });
  } catch (err) {
    await Log('backend', 'error', 'route', `Priority-inbox failed: ${err.message}`.slice(0,48));
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/notifications
 * Returns all notifications (unsorted, raw from upstream API).
 */
router.get('/', async (req, res) => {
  const token = process.env.AUTH_TOKEN;
  const axios = require('axios');

  await Log('backend', 'info', 'route', 'GET /notifications called');

  try {
    const apiRes = await axios.get(
      'http://20.207.122.201/evaluation-service/notifications',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const notifications = apiRes.data.notifications ?? [];
    await Log('backend', 'info', 'route', `Notifications ok: ${notifications.length}`);
    return res.status(200).json({ success: true, count: notifications.length, notifications });
  } catch (err) {
    await Log('backend', 'error', 'route', `Notifications failed`.slice(0,48));
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
