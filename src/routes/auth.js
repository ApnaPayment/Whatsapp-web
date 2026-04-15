'use strict';

const express = require('express');
const router = express.Router();
const { getStatus, getCurrentQr } = require('../whatsapp');

// Public — no API key required
router.get('/qr', (req, res) => {
  const qr = getCurrentQr();
  if (!qr) return res.status(404).json({ error: 'No QR available' });
  res.json({ qr });
});

router.get('/status', (req, res) => {
  res.json(getStatus());
});

module.exports = router;
