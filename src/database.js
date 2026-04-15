'use strict';

const Database = require('better-sqlite3');
const { hashSync } = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'crm.db');
let db;

// ── Priority → SLA hours mapping ──────────────────────────────────────────────
const SLA_HOURS = { urgent: 1, high: 4, medium: 24, low: 72 };

function getSlaHours(priority) {
  return SLA_HOURS[priority] || 24;
}

function computeSLADue(priority) {
  const due = new Date();
  due.setHours(due.getHours() + getSlaHours(priority));
  return due.toISOString();
}

// ── Initialisation ─────────────────────────────────────────────────────────────

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- ── original tables ──────────────────────────────────────────────────────
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
      contact_id INTEGER REFERENCES contacts(id),
      msg_type TEXT DEFAULT 'chat'
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_body ON messages(body);

    -- ── agents ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      role TEXT DEFAULT 'agent',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ── tickets ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      contact_id INTEGER REFERENCES contacts(id),
      assigned_to INTEGER REFERENCES agents(id),
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      subject TEXT DEFAULT '',
      sla_hours INTEGER DEFAULT 24,
      sla_due_at TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_chat ON tickets(chat_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);

    -- ── ticket notes ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ticket_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      agent_id INTEGER REFERENCES agents(id),
      body TEXT NOT NULL,
      is_internal INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── ticket activities ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ticket_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      agent_id INTEGER REFERENCES agents(id),
      action_type TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_activities_ticket ON ticket_activities(ticket_id);

    -- ── labels ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#25d366',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── ticket → label junction ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ticket_labels (
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      label_id INTEGER NOT NULL REFERENCES labels(id),
      PRIMARY KEY (ticket_id, label_id)
    );

    -- ── templates ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default admin (only on first run)
  const existingAdmin = db.prepare("SELECT id FROM agents WHERE username = 'admin'").get();
  if (!existingAdmin) {
    const pwd = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = hashSync(pwd, 10);
    db.prepare(
      "INSERT INTO agents (username, password_hash, name, role) VALUES (?, ?, ?, ?)"
    ).run('admin', hash, 'Administrator', 'admin');
    console.log('Default admin created  →  username: admin  password: [set via ADMIN_PASSWORD env var or check .env.example]');
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('WARNING: Using default admin password "admin123". Set ADMIN_PASSWORD in .env before going to production.');
    }
  }

  // Seed a couple of default labels (ignore if already present)
  const seedLabels = [
    { name: 'New Lead', color: '#25d366' },
    { name: 'VIP', color: '#f59e0b' },
    { name: 'Support', color: '#3b82f6' },
    { name: 'Follow-up', color: '#ef4444' },
  ];
  const insertLabel = db.prepare(
    "INSERT OR IGNORE INTO labels (name, color) VALUES (@name, @color)"
  );
  seedLabels.forEach(l => insertLabel.run(l));

  console.log('Database initialised at', DB_PATH);
}

function getDb() {
  if (!db) throw new Error('Database not initialised');
  return db;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

function getAllContacts({ q = '', page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  if (q) {
    return getDb().prepare(`
      SELECT * FROM contacts
      WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR company LIKE ?
      ORDER BY name ASC LIMIT ? OFFSET ?
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit, offset);
  }
  return getDb().prepare(
    'SELECT * FROM contacts ORDER BY name ASC LIMIT ? OFFSET ?'
  ).all(limit, offset);
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

function getAllChats({ page = 1, limit = 100 } = {}) {
  const offset = (page - 1) * limit;
  return getDb().prepare(
    'SELECT * FROM chats ORDER BY last_timestamp DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

// ── Messages ──────────────────────────────────────────────────────────────────

function saveMessage({ chat_id, message_id, from_me, body, timestamp, contact_id, msg_type = 'chat' }) {
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO messages (chat_id, message_id, from_me, body, timestamp, contact_id, msg_type)
      VALUES (@chat_id, @message_id, @from_me, @body, @timestamp, @contact_id, @msg_type)
    `).run({
      chat_id, message_id, from_me: from_me ? 1 : 0,
      body, timestamp, contact_id: contact_id || null, msg_type,
    });
  } catch (_) { /* duplicate */ }
}

function getMessagesByChat(chatId, limit = 50, page = 1) {
  const offset = (page - 1) * limit;
  return getDb().prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).all(chatId, limit, offset);
}

function searchMessages(query, limit = 100) {
  return getDb().prepare(
    'SELECT * FROM messages WHERE body LIKE ? ORDER BY timestamp DESC LIMIT ?'
  ).all(`%${query}%`, limit);
}

// ── Agents ────────────────────────────────────────────────────────────────────

function getAllAgents() {
  return getDb().prepare(
    'SELECT id, username, name, email, role, is_active, created_at, updated_at FROM agents ORDER BY name ASC'
  ).all();
}

function getAgentById(id) {
  return getDb().prepare(
    'SELECT id, username, password_hash, name, email, role, is_active, created_at, updated_at FROM agents WHERE id = ?'
  ).get(id);
}

function getAgentByUsername(username) {
  return getDb().prepare(
    'SELECT * FROM agents WHERE username = ?'
  ).get(username);
}

function createAgent({ username, password_hash, name, email, role }) {
  const result = getDb().prepare(`
    INSERT INTO agents (username, password_hash, name, email, role)
    VALUES (@username, @password_hash, @name, @email, @role)
  `).run({ username, password_hash, name, email: email || '', role: role || 'agent' });
  return getAgentById(result.lastInsertRowid);
}

function updateAgent(id, fields) {
  const allowed = ['name', 'email', 'role', 'is_active', 'password_hash'];
  const sets = [];
  const params = {};
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }
  if (sets.length === 0) return getAgentById(id);
  sets.push("updated_at = datetime('now')");
  params.id = id;
  getDb().prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getAgentById(id);
}

function deleteAgent(id) {
  return getDb().prepare('UPDATE agents SET is_active = 0 WHERE id = ?').run(id);
}

// ── Tickets ───────────────────────────────────────────────────────────────────

function getAllTickets({ status, priority, assigned_to, q, page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const wheres = [];
  const params = [];

  if (status) { wheres.push('t.status = ?'); params.push(status); }
  if (priority) { wheres.push('t.priority = ?'); params.push(priority); }
  if (assigned_to === 'none') {
    wheres.push('t.assigned_to IS NULL');
  } else if (assigned_to) {
    wheres.push('t.assigned_to = ?');
    params.push(assigned_to);
  }
  if (q) {
    wheres.push('(t.subject LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  params.push(limit, offset);

  return getDb().prepare(`
    SELECT t.*, c.name as contact_name, c.phone as contact_phone,
           a.name as agent_name
    FROM tickets t
    LEFT JOIN contacts c ON t.contact_id = c.id
    LEFT JOIN agents a ON t.assigned_to = a.id
    ${where}
    ORDER BY t.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);
}

function getTicketById(id) {
  return getDb().prepare(`
    SELECT t.*, c.name as contact_name, c.phone as contact_phone,
           a.name as agent_name
    FROM tickets t
    LEFT JOIN contacts c ON t.contact_id = c.id
    LEFT JOIN agents a ON t.assigned_to = a.id
    WHERE t.id = ?
  `).get(id);
}

function getTicketByChatId(chatId) {
  return getDb().prepare(
    'SELECT * FROM tickets WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(chatId);
}

function createTicket({ chat_id, contact_id, subject, priority = 'medium', assigned_to }) {
  const sla_hours = getSlaHours(priority);
  const sla_due_at = computeSLADue(priority);
  const result = getDb().prepare(`
    INSERT INTO tickets (chat_id, contact_id, subject, priority, assigned_to, sla_hours, sla_due_at)
    VALUES (@chat_id, @contact_id, @subject, @priority, @assigned_to, @sla_hours, @sla_due_at)
  `).run({
    chat_id,
    contact_id: contact_id || null,
    subject: subject || '',
    priority,
    assigned_to: assigned_to || null,
    sla_hours,
    sla_due_at,
  });
  return getTicketById(result.lastInsertRowid);
}

function updateTicket(id, fields) {
  const allowed = ['status', 'priority', 'subject', 'assigned_to', 'resolved_at', 'sla_due_at', 'sla_hours'];
  const sets = [];
  const params = {};

  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }
  if (sets.length === 0) return getTicketById(id);

  // Recompute SLA if priority changed
  if (fields.priority && !fields.sla_due_at) {
    const ticket = getTicketById(id);
    if (ticket && fields.priority !== ticket.priority) {
      const sla_hours = getSlaHours(fields.priority);
      sets.push('sla_hours = @sla_hours');
      sets.push('sla_due_at = @sla_due_at');
      params.sla_hours = sla_hours;
      params.sla_due_at = computeSLADue(fields.priority);
    }
  }

  // Auto-set resolved_at
  if (fields.status === 'resolved' && !fields.resolved_at) {
    sets.push("resolved_at = datetime('now')");
  } else if (['open', 'pending'].includes(fields.status)) {
    sets.push('resolved_at = NULL');
  }

  sets.push("updated_at = datetime('now')");
  params.id = id;
  getDb().prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getTicketById(id);
}

// ── Ticket Notes ──────────────────────────────────────────────────────────────

function getTicketNotes(ticketId) {
  return getDb().prepare(`
    SELECT tn.*, a.name as agent_name
    FROM ticket_notes tn
    LEFT JOIN agents a ON tn.agent_id = a.id
    WHERE tn.ticket_id = ?
    ORDER BY tn.created_at ASC
  `).all(ticketId);
}

function addTicketNote({ ticket_id, agent_id, body, is_internal = 1 }) {
  const result = getDb().prepare(`
    INSERT INTO ticket_notes (ticket_id, agent_id, body, is_internal)
    VALUES (@ticket_id, @agent_id, @body, @is_internal)
  `).run({ ticket_id, agent_id: agent_id || null, body, is_internal: is_internal ? 1 : 0 });
  return getDb().prepare(
    'SELECT tn.*, a.name as agent_name FROM ticket_notes tn LEFT JOIN agents a ON tn.agent_id = a.id WHERE tn.id = ?'
  ).get(result.lastInsertRowid);
}

// ── Ticket Activities ─────────────────────────────────────────────────────────

function getTicketActivities(ticketId) {
  return getDb().prepare(`
    SELECT ta.*, a.name as agent_name
    FROM ticket_activities ta
    LEFT JOIN agents a ON ta.agent_id = a.id
    WHERE ta.ticket_id = ?
    ORDER BY ta.created_at ASC
  `).all(ticketId);
}

function addTicketActivity({ ticket_id, agent_id, action_type, payload = {} }) {
  const result = getDb().prepare(`
    INSERT INTO ticket_activities (ticket_id, agent_id, action_type, payload)
    VALUES (@ticket_id, @agent_id, @action_type, @payload)
  `).run({
    ticket_id,
    agent_id: agent_id || null,
    action_type,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  return getDb().prepare('SELECT * FROM ticket_activities WHERE id = ?').get(result.lastInsertRowid);
}

// ── Labels ────────────────────────────────────────────────────────────────────

function getAllLabels() {
  return getDb().prepare('SELECT * FROM labels ORDER BY name ASC').all();
}

function getLabelById(id) {
  return getDb().prepare('SELECT * FROM labels WHERE id = ?').get(id);
}

function createLabel({ name, color }) {
  const result = getDb().prepare(
    'INSERT INTO labels (name, color) VALUES (@name, @color)'
  ).run({ name, color: color || '#25d366' });
  return getLabelById(result.lastInsertRowid);
}

function updateLabel(id, { name, color }) {
  const sets = [];
  const params = { id };
  if (name !== undefined) { sets.push('name = @name'); params.name = name; }
  if (color !== undefined) { sets.push('color = @color'); params.color = color; }
  if (sets.length === 0) return getLabelById(id);
  getDb().prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getLabelById(id);
}

function deleteLabel(id) {
  getDb().prepare('DELETE FROM ticket_labels WHERE label_id = ?').run(id);
  return getDb().prepare('DELETE FROM labels WHERE id = ?').run(id);
}

function getTicketLabels(ticketId) {
  return getDb().prepare(`
    SELECT l.* FROM labels l
    JOIN ticket_labels tl ON tl.label_id = l.id
    WHERE tl.ticket_id = ?
  `).all(ticketId);
}

function addLabelToTicket(ticketId, labelId) {
  try {
    getDb().prepare(
      'INSERT OR IGNORE INTO ticket_labels (ticket_id, label_id) VALUES (?, ?)'
    ).run(ticketId, labelId);
  } catch (_) { /* already exists */ }
}

function removeLabelFromTicket(ticketId, labelId) {
  getDb().prepare(
    'DELETE FROM ticket_labels WHERE ticket_id = ? AND label_id = ?'
  ).run(ticketId, labelId);
}

// ── Templates ─────────────────────────────────────────────────────────────────

function getAllTemplates({ q = '' } = {}) {
  if (q) {
    return getDb().prepare(
      'SELECT * FROM templates WHERE name LIKE ? OR body LIKE ? ORDER BY name ASC'
    ).all(`%${q}%`, `%${q}%`);
  }
  return getDb().prepare('SELECT * FROM templates ORDER BY name ASC').all();
}

function getTemplateById(id) {
  return getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id);
}

function createTemplate({ name, category, body }) {
  const result = getDb().prepare(
    'INSERT INTO templates (name, category, body) VALUES (@name, @category, @body)'
  ).run({ name, category: category || 'general', body });
  return getTemplateById(result.lastInsertRowid);
}

function updateTemplate(id, fields) {
  const allowed = ['name', 'category', 'body'];
  const sets = [];
  const params = { id };
  for (const key of allowed) {
    if (key in fields) { sets.push(`${key} = @${key}`); params[key] = fields[key]; }
  }
  if (sets.length === 0) return getTemplateById(id);
  sets.push("updated_at = datetime('now')");
  getDb().prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getTemplateById(id);
}

function deleteTemplate(id) {
  return getDb().prepare('DELETE FROM templates WHERE id = ?').run(id);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function getTicketStats() {
  const rows = getDb().prepare(
    'SELECT status, COUNT(*) as count FROM tickets GROUP BY status'
  ).all();
  const stats = { open: 0, pending: 0, resolved: 0, closed: 0, total: 0 };
  rows.forEach(r => { stats[r.status] = r.count; stats.total += r.count; });
  return stats;
}

function getTicketsByPriority() {
  return getDb().prepare(
    'SELECT priority, COUNT(*) as count FROM tickets WHERE status NOT IN (\'closed\') GROUP BY priority'
  ).all();
}

function getMessagesPerDay(days = 14) {
  return getDb().prepare(`
    SELECT date(timestamp, 'unixepoch') as day, COUNT(*) as count
    FROM messages
    WHERE timestamp >= strftime('%s', datetime('now', ?))
    GROUP BY day
    ORDER BY day ASC
  `).all(`-${days} days`);
}

function getAgentWorkload() {
  return getDb().prepare(`
    SELECT a.id, a.name, COUNT(t.id) as open_tickets
    FROM agents a
    LEFT JOIN tickets t ON t.assigned_to = a.id AND t.status IN ('open','pending')
    WHERE a.is_active = 1
    GROUP BY a.id
    ORDER BY open_tickets DESC
  `).all();
}

function getSLABreachingTickets() {
  return getDb().prepare(`
    SELECT t.*, c.name as contact_name, c.phone as contact_phone, a.name as agent_name
    FROM tickets t
    LEFT JOIN contacts c ON t.contact_id = c.id
    LEFT JOIN agents a ON t.assigned_to = a.id
    WHERE t.status IN ('open','pending')
      AND t.sla_due_at IS NOT NULL
      AND t.sla_due_at < datetime('now')
  `).all();
}

module.exports = {
  initDb,
  // contacts
  getAllContacts, getContactById, getContactByPhone,
  createContact, updateContact, deleteContact,
  // chats
  upsertChat, getAllChats,
  // messages
  saveMessage, getMessagesByChat, searchMessages,
  // agents
  getAllAgents, getAgentById, getAgentByUsername,
  createAgent, updateAgent, deleteAgent,
  // tickets
  getAllTickets, getTicketById, getTicketByChatId,
  createTicket, updateTicket,
  // ticket notes
  getTicketNotes, addTicketNote,
  // ticket activities
  getTicketActivities, addTicketActivity,
  // labels
  getAllLabels, getLabelById, createLabel, updateLabel, deleteLabel,
  getTicketLabels, addLabelToTicket, removeLabelFromTicket,
  // templates
  getAllTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate,
  // analytics
  getTicketStats, getTicketsByPriority, getMessagesPerDay,
  getAgentWorkload, getSLABreachingTickets,
  // helpers
  getSlaHours, computeSLADue,
};
