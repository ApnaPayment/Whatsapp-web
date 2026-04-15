'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/templates?q=
router.get('/', (req, res) => {
  res.json(db.getAllTemplates({ q: req.query.q || '' }));
});

// POST /api/templates
router.post('/', (req, res) => {
  const { name, category, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
  res.status(201).json(db.createTemplate({ name, category, body }));
});

// PUT /api/templates/:id
router.put('/:id', (req, res) => {
  if (!db.getTemplateById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json(db.updateTemplate(req.params.id, req.body));
});

// DELETE /api/templates/:id
router.delete('/:id', (req, res) => {
  if (!db.getTemplateById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.deleteTemplate(req.params.id);
  res.json({ success: true });
});

module.exports = router;
