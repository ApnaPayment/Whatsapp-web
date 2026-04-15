'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { saveMessage, upsertChat, getContactByPhone, createContact } = require('./database');

let client;
let currentQr = null;
let isReady = false;

function initWhatsApp(io) {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  client.on('qr', async (qr) => {
    console.log('QR received');
    currentQr = await qrcode.toDataURL(qr);
    isReady = false;
    io.emit('qr', currentQr);
    io.emit('status', { connected: false, qr: currentQr });
  });

  client.on('ready', () => {
    console.log('WhatsApp client ready');
    currentQr = null;
    isReady = true;
    io.emit('status', { connected: true });
  });

  client.on('authenticated', () => {
    console.log('Authenticated');
    currentQr = null;
  });

  client.on('auth_failure', (msg) => {
    console.error('Auth failure:', msg);
    isReady = false;
    io.emit('status', { connected: false, error: msg });
  });

  client.on('disconnected', (reason) => {
    console.log('Disconnected:', reason);
    isReady = false;
    io.emit('status', { connected: false });
  });

  client.on('message', async (msg) => {
    try {
      const chat = await msg.getChat();
      const contact = await msg.getContact();
      const phone = contact.number || msg.from.replace(/@.*$/, '');

      // Upsert CRM contact
      let dbContact = getContactByPhone(phone);
      if (!dbContact) {
        dbContact = createContact({
          phone,
          name: contact.pushname || contact.name || phone,
        });
      }

      // Save message
      saveMessage({
        chat_id: msg.from,
        message_id: msg.id._serialized,
        from_me: msg.fromMe,
        body: msg.body,
        timestamp: msg.timestamp,
        contact_id: dbContact ? dbContact.id : null,
      });

      // Update chat record
      upsertChat({
        chat_id: msg.from,
        name: chat.name || phone,
        last_message: msg.body,
        last_timestamp: msg.timestamp,
        unread_count: chat.unreadCount || 0,
      });

      io.emit('message', {
        chat_id: msg.from,
        message_id: msg.id._serialized,
        from_me: false,
        body: msg.body,
        timestamp: msg.timestamp,
        contact: dbContact,
      });
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  client.initialize().catch((err) => console.error('WhatsApp init error:', err));
}

async function sendMessage(to, body) {
  if (!client || !isReady) throw new Error('WhatsApp client not ready');
  const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
  const msg = await client.sendMessage(chatId, body);
  return msg;
}

function getStatus() {
  return { connected: isReady, hasQr: !!currentQr };
}

function getCurrentQr() {
  return currentQr;
}

module.exports = { initWhatsApp, sendMessage, getStatus, getCurrentQr };
