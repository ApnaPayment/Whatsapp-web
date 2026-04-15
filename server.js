'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const { initDb } = require('./src/database');
const { initWhatsApp } = require('./src/whatsapp');
const authRoutes = require('./src/routes/auth');
const contactRoutes = require('./src/routes/contacts');
const chatRoutes = require('./src/routes/chats');
const messageRoutes = require('./src/routes/messages');
const apiAuth = require('./src/middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Public routes (no API key required)
app.use('/api', authRoutes);

// Protected routes
app.use('/api/contacts', apiAuth, contactRoutes);
app.use('/api/chats', apiAuth, chatRoutes);
app.use('/api/messages', apiAuth, messageRoutes);

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Init DB and WhatsApp, then start server
(async () => {
  initDb();
  initWhatsApp(io);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`WhatsApp CRM running on http://localhost:${PORT}`));
})();
