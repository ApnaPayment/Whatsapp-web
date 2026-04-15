'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { sendMessage, getStatus } = require('../whatsapp');
const { upsertChat, saveMessage } = require('../database');

router.post('/send', async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  try {
    const msg = await sendMessage(to, body);
    const phone = to.replace(/@.*$/, '');
    const chatId = to.includes('@c.us') ? to : `${to}@c.us`;

    let contact = db.getContactByPhone(phone);
    if (!contact) contact = db.createContact({ phone, name: phone });

    saveMessage({
      chat_id: chatId,
      message_id: msg.id._serialized,
      from_me: true,
      body,
      timestamp: Math.floor(Date.now() / 1000),
      contact_id: contact ? contact.id : null,
    });

    upsertChat({
      chat_id: chatId,
      name: contact ? (contact.name || phone) : phone,
      last_message: body,
      last_timestamp: Math.floor(Date.now() / 1000),
      unread_count: 0,
    });

    res.json({ success: true, messageId: msg.id._serialized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(db.searchMessages(q));
});

module.exports = router;
