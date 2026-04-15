'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  res.json(db.getAllContacts());
});

router.post('/', (req, res) => {
  const { phone, name, email, company, tags, notes } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  try {
    const contact = db.createContact({ phone, name, email, company, tags, notes });
    res.status(201).json(contact);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const contact = db.getContactById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  res.json(contact);
});

router.put('/:id', (req, res) => {
  const contact = db.getContactById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  res.json(db.updateContact(req.params.id, req.body));
});

router.delete('/:id', (req, res) => {
  const contact = db.getContactById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  db.deleteContact(req.params.id);
  res.json({ success: true });
});

module.exports = router;
