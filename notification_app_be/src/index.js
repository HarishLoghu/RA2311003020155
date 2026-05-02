'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const express = require('express');
const { configure, Log } = require('../../logging_middleware/index');
const notificationRoutes = require('./routes/notifications');

const TOKEN = process.env.AUTH_TOKEN;
configure(TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Request logging middleware
app.use(async (req, _res, next) => {
  try {
    await Log('backend', 'info', 'middleware', `${req.method} ${req.originalUrl}`.slice(0,48));
  } catch (_) { /* non-blocking */ }
  next();
});

// Routes
app.use('/api/v1/notifications', notificationRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'notification-app-be' });
});

// 404 handler
app.use(async (req, res) => {
  try {
    await Log('backend', 'warn', 'route', `404: ${req.originalUrl}`.slice(0,48));
  } catch (_) { /* non-blocking */ }
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Global error handler
app.use(async (err, _req, res, _next) => {
  try {
    await Log('backend', 'error', 'handler', `Unhandled error: ${err.message}`);
  } catch (_) { /* non-blocking */ }
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, async () => {
  await Log('backend', 'info', 'service', `Notification service on port ${PORT}`);
  process.stdout.write(`Notification service running at http://localhost:${PORT}\n`);
});
