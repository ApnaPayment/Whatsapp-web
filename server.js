'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const { initDb, getSLABreachingTickets } = require('./src/database');
const { initWhatsApp } = require('./src/whatsapp');
const { requireAuth, requireRole } = require('./src/middleware/auth');

const authRoutes     = require('./src/routes/auth');
const agentRoutes    = require('./src/routes/agents');
const contactRoutes  = require('./src/routes/contacts');
const chatRoutes     = require('./src/routes/chats');
const messageRoutes  = require('./src/routes/messages');
const ticketRoutes   = require('./src/routes/tickets');
const labelRoutes    = require('./src/routes/labels');
const templateRoutes = require('./src/routes/templates');
const analyticsRoutes = require('./src/routes/analytics');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Public routes (no auth required) ─────────────────────────────────────────
app.use('/api', authRoutes);  // /api/qr, /api/status, /api/auth/login, /api/auth/me

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api/contacts',  requireAuth, contactRoutes);
app.use('/api/chats',     requireAuth, chatRoutes);
app.use('/api/messages',  requireAuth, messageRoutes);
app.use('/api/tickets',   requireAuth, ticketRoutes);
app.use('/api/labels',    requireAuth, labelRoutes);
app.use('/api/templates', requireAuth, templateRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);

// Admin-only: agent management
app.use('/api/agents', requireAuth, requireRole('admin'), agentRoutes);

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ── SLA background check ──────────────────────────────────────────────────────
function runSLACheck() {
  try {
    const breaching = getSLABreachingTickets();
    if (breaching.length > 0) {
      console.log(`SLA check: ${breaching.length} ticket(s) breaching SLA`);
      io.emit('sla_breach', breaching);
    }
  } catch (err) {
    console.error('SLA check error:', err);
  }
}

// ── Init DB and WhatsApp, then start server ───────────────────────────────────
(async () => {
  initDb();
  initWhatsApp(io);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`WhatsApp CRM running on http://localhost:${PORT}`));

  // Start SLA check loop after server is up
  const slaInterval = parseInt(process.env.SLA_CHECK_INTERVAL_MS, 10) || 300_000;
  setInterval(runSLACheck, slaInterval);
})();
