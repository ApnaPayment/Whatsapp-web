'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/labels
router.get('/', (req, res) => {
  res.json(db.getAllLabels());
});

// POST /api/labels
router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    res.status(201).json(db.createLabel({ name, color }));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// PUT /api/labels/:id
router.put('/:id', (req, res) => {
  if (!db.getLabelById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json(db.updateLabel(req.params.id, req.body));
});

// DELETE /api/labels/:id
router.delete('/:id', (req, res) => {
  if (!db.getLabelById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.deleteLabel(req.params.id);
  res.json({ success: true });
});

module.exports = router;
