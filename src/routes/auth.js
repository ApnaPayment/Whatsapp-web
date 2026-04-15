'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getStatus, getCurrentQr } = require('../whatsapp');
const { getAgentByUsername } = require('../database');
const { signToken, requireAuth } = require('../middleware/auth');

// ── Public WhatsApp status / QR ───────────────────────────────────────────────
router.get('/qr', (req, res) => {
  const qr = getCurrentQr();
  if (!qr) return res.status(404).json({ error: 'No QR available' });
  res.json({ qr });
});

router.get('/status', (req, res) => {
  res.json(getStatus());
});

// ── Agent login ───────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const agent = getAgentByUsername(username);
  if (!agent || !agent.is_active) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, agent.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(agent.id);
  const { password_hash, ...agentData } = agent;
  res.json({ token, agent: agentData });
});

// ── Current agent ─────────────────────────────────────────────────────────────
router.get('/auth/me', requireAuth, (req, res) => {
  const { password_hash, ...agentData } = req.agent;
  res.json(agentData);
});

module.exports = router;
