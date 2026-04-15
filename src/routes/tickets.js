'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/tickets?status=&priority=&assigned_to=&q=&page=&limit=
router.get('/', (req, res) => {
  const { status, priority, assigned_to, q, page, limit } = req.query;
  const tickets = db.getAllTickets({
    status,
    priority,
    assigned_to,
    q,
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 50,
  });
  // Attach labels for each ticket
  const result = tickets.map(t => ({
    ...t,
    labels: db.getTicketLabels(t.id),
  }));
  res.json(result);
});

// POST /api/tickets
router.post('/', (req, res) => {
  const { chat_id, contact_id, subject, priority, assigned_to } = req.body;
  if (!chat_id) return res.status(400).json({ error: 'chat_id is required' });

  const ticket = db.createTicket({ chat_id, contact_id, subject, priority, assigned_to });

  db.addTicketActivity({
    ticket_id: ticket.id,
    agent_id: req.agent ? req.agent.id : null,
    action_type: 'created',
    payload: { by: req.agent ? req.agent.name : 'system' },
  });

  res.status(201).json({ ...ticket, labels: [] });
});

// GET /api/tickets/:id
router.get('/:id', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const labels = db.getTicketLabels(ticket.id);
  const notes = db.getTicketNotes(ticket.id);
  const activities = db.getTicketActivities(ticket.id);
  res.json({ ...ticket, labels, notes, activities });
});

// PUT /api/tickets/:id
router.put('/:id', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const allowed = ['status', 'priority', 'subject', 'assigned_to'];
  const fields = {};
  for (const k of allowed) {
    if (k in req.body) fields[k] = req.body[k] === '' ? null : req.body[k];
  }

  // Record activity for significant changes
  if (fields.status && fields.status !== ticket.status) {
    db.addTicketActivity({
      ticket_id: ticket.id,
      agent_id: req.agent ? req.agent.id : null,
      action_type: 'status_changed',
      payload: { from: ticket.status, to: fields.status },
    });
  }
  if ('assigned_to' in fields && fields.assigned_to !== ticket.assigned_to) {
    const assignee = fields.assigned_to ? db.getAgentById(fields.assigned_to) : null;
    db.addTicketActivity({
      ticket_id: ticket.id,
      agent_id: req.agent ? req.agent.id : null,
      action_type: 'assigned',
      payload: { to: assignee ? assignee.name : 'Unassigned' },
    });
  }
  if (fields.priority && fields.priority !== ticket.priority) {
    db.addTicketActivity({
      ticket_id: ticket.id,
      agent_id: req.agent ? req.agent.id : null,
      action_type: 'priority_changed',
      payload: { from: ticket.priority, to: fields.priority },
    });
  }

  const updated = db.updateTicket(req.params.id, fields);
  res.json({ ...updated, labels: db.getTicketLabels(updated.id) });
});

// GET /api/tickets/:id/notes
router.get('/:id/notes', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json(db.getTicketNotes(req.params.id));
});

// POST /api/tickets/:id/notes
router.post('/:id/notes', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const { body, is_internal } = req.body;
  if (!body) return res.status(400).json({ error: 'body is required' });

  const note = db.addTicketNote({
    ticket_id: Number(req.params.id),
    agent_id: req.agent ? req.agent.id : null,
    body,
    is_internal: is_internal !== false,
  });

  db.addTicketActivity({
    ticket_id: Number(req.params.id),
    agent_id: req.agent ? req.agent.id : null,
    action_type: 'note_added',
    payload: { is_internal: is_internal !== false },
  });

  res.status(201).json(note);
});

// GET /api/tickets/:id/activities
router.get('/:id/activities', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json(db.getTicketActivities(req.params.id));
});

// POST /api/tickets/:id/labels
router.post('/:id/labels', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const { label_id } = req.body;
  if (!label_id) return res.status(400).json({ error: 'label_id is required' });
  if (!db.getLabelById(label_id)) return res.status(404).json({ error: 'Label not found' });

  db.addLabelToTicket(Number(req.params.id), Number(label_id));
  db.addTicketActivity({
    ticket_id: Number(req.params.id),
    agent_id: req.agent ? req.agent.id : null,
    action_type: 'label_added',
    payload: { label_id },
  });
  res.json(db.getTicketLabels(req.params.id));
});

// DELETE /api/tickets/:id/labels/:labelId
router.delete('/:id/labels/:labelId', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  db.removeLabelFromTicket(Number(req.params.id), Number(req.params.labelId));
  res.json(db.getTicketLabels(req.params.id));
});

module.exports = router;
