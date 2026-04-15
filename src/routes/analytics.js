'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/analytics/overview
router.get('/overview', (req, res) => {
  const ticketStats = db.getTicketStats();
  const priorityBreakdown = db.getTicketsByPriority();
  const slaBreaching = db.getSLABreachingTickets().length;
  res.json({ ticketStats, priorityBreakdown, slaBreaching });
});

// GET /api/analytics/messages-trend?days=14
router.get('/messages-trend', (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
  res.json(db.getMessagesPerDay(days));
});

// GET /api/analytics/agent-workload
router.get('/agent-workload', (req, res) => {
  res.json(db.getAgentWorkload());
});

module.exports = router;
