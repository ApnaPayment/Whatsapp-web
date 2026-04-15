'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// GET /api/agents
router.get('/', (req, res) => {
  res.json(db.getAllAgents());
});

// POST /api/agents  (admin only — enforced in server.js via requireRole)
router.post('/', async (req, res) => {
  const { username, password, name, email, role } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'username, password and name are required' });
  }
  const validRoles = ['admin', 'manager', 'agent'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'role must be admin | manager | agent' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const agent = db.createAgent({ username, password_hash, name, email, role });
    const { password_hash: _, ...safe } = agent;
    res.status(201).json(safe);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const agent = db.getAgentById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  const { password_hash, ...safe } = agent;
  res.json(safe);
});

// PUT /api/agents/:id
router.put('/:id', async (req, res) => {
  const agent = db.getAgentById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });

  const fields = {};
  const allowed = ['name', 'email', 'role', 'is_active'];
  for (const k of allowed) {
    if (k in req.body) fields[k] = req.body[k];
  }
  if (req.body.password) {
    fields.password_hash = await bcrypt.hash(req.body.password, 10);
  }

  const updated = db.updateAgent(req.params.id, fields);
  const { password_hash, ...safe } = updated;
  res.json(safe);
});

// DELETE /api/agents/:id  (soft-delete)
router.delete('/:id', (req, res) => {
  const agent = db.getAgentById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  // Prevent deleting own account
  if (req.agent && req.agent.id === Number(req.params.id)) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }
  db.deleteAgent(req.params.id);
  res.json({ success: true });
});

module.exports = router;
