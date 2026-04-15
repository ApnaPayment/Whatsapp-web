'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  res.json(db.getAllChats());
});

router.get('/:chatId/messages', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json(db.getMessagesByChat(req.params.chatId, limit));
});

module.exports = router;
