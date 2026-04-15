'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  const { page, limit } = req.query;
  res.json(db.getAllChats({
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 100,
  }));
});

router.get('/:chatId/messages', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const page  = parseInt(req.query.page, 10)  || 1;
  res.json(db.getMessagesByChat(req.params.chatId, limit, page));
});

module.exports = router;
