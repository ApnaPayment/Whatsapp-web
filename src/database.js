'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'crm.db');
let db;

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      company TEXT,
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL UNIQUE,
      name TEXT,
      last_message TEXT,
      last_timestamp INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      message_id TEXT UNIQUE,
      from_me INTEGER DEFAULT 0,
      body TEXT,
      timestamp INTEGER,
      contact_id INTEGER REFERENCES contacts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_body ON messages(body);
  `);

  console.log('Database initialised at', DB_PATH);
}

function getDb() {
  if (!db) throw new Error('Database not initialised');
  return db;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

function getAllContacts() {
  return getDb().prepare('SELECT * FROM contacts ORDER BY name ASC').all();
}

function getContactById(id) {
  return getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
}

function getContactByPhone(phone) {
  return getDb().prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
}

function createContact({ phone, name, email, company, tags, notes }) {
  const stmt = getDb().prepare(`
    INSERT INTO contacts (phone, name, email, company, tags, notes)
    VALUES (@phone, @name, @email, @company, @tags, @notes)
  `);
  const result = stmt.run({
    phone,
    name: name || '',
    email: email || '',
    company: company || '',
    tags: JSON.stringify(tags || []),
    notes: notes || '',
  });
  return getContactById(result.lastInsertRowid);
}

function updateContact(id, fields) {
  const allowed = ['name', 'email', 'company', 'tags', 'notes'];
  const sets = [];
  const params = {};
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = @${key}`);
      params[key] = key === 'tags' ? JSON.stringify(fields[key]) : fields[key];
    }
  }
  if (sets.length === 0) return getContactById(id);
  sets.push("updated_at = datetime('now')");
  params.id = id;
  getDb().prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getContactById(id);
}

function deleteContact(id) {
  return getDb().prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

// ── Chats ─────────────────────────────────────────────────────────────────────

function upsertChat({ chat_id, name, last_message, last_timestamp, unread_count }) {
  getDb().prepare(`
    INSERT INTO chats (chat_id, name, last_message, last_timestamp, unread_count)
    VALUES (@chat_id, @name, @last_message, @last_timestamp, @unread_count)
    ON CONFLICT(chat_id) DO UPDATE SET
      name = excluded.name,
      last_message = excluded.last_message,
      last_timestamp = excluded.last_timestamp,
      unread_count = excluded.unread_count
  `).run({ chat_id, name, last_message, last_timestamp, unread_count });
}

function getAllChats() {
  return getDb().prepare('SELECT * FROM chats ORDER BY last_timestamp DESC').all();
}

// ── Messages ──────────────────────────────────────────────────────────────────

function saveMessage({ chat_id, message_id, from_me, body, timestamp, contact_id }) {
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO messages (chat_id, message_id, from_me, body, timestamp, contact_id)
      VALUES (@chat_id, @message_id, @from_me, @body, @timestamp, @contact_id)
    `).run({ chat_id, message_id, from_me: from_me ? 1 : 0, body, timestamp, contact_id: contact_id || null });
  } catch (_) { /* duplicate */ }
}

function getMessagesByChat(chatId, limit = 50) {
  return getDb().prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(chatId, limit);
}

function searchMessages(query) {
  return getDb().prepare(
    "SELECT * FROM messages WHERE body LIKE ? ORDER BY timestamp DESC LIMIT 100"
  ).all(`%${query}%`);
}

module.exports = {
  initDb,
  getAllContacts,
  getContactById,
  getContactByPhone,
  createContact,
  updateContact,
  deleteContact,
  upsertChat,
  getAllChats,
  saveMessage,
  getMessagesByChat,
  searchMessages,
};
