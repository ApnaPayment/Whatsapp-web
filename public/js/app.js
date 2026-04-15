'use strict';

const API = '';           // same origin
const API_KEY = '';       // set if you configured API_KEY in .env

const headers = () => {
  const h = { 'Content-Type': 'application/json' };
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
};

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, { headers: headers(), ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── State ──────────────────────────────────────────────────────
let chats = [];
let contacts = [];
let activeChatId = null;
let isConnected = false;

// ── Socket.io ──────────────────────────────────────────────────
const socket = io();

socket.on('status', (data) => {
  setConnected(data.connected);
  if (data.qr) renderQr(data.qr);
});

socket.on('qr', (qrDataUrl) => {
  setConnected(false);
  renderQr(qrDataUrl);
});

socket.on('message', (msg) => {
  if (msg.chat_id === activeChatId) appendMessage(msg);
  loadChats();
});

// ── Polling ────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const st = await apiFetch('/api/status');
    setConnected(st.connected);
    if (!st.connected && st.hasQr) {
      const { qr } = await apiFetch('/api/qr').catch(() => ({}));
      if (qr) renderQr(qr);
    }
  } catch (_) {}
}
setInterval(pollStatus, 3000);

// ── Connected state ────────────────────────────────────────────
function setConnected(val) {
  isConnected = val;
  const badge = document.getElementById('status-badge');
  if (val) {
    badge.textContent = 'Connected';
    badge.className = 'badge connected';
    showPanel('welcome');
    loadChats();
    loadContacts();
  } else {
    badge.textContent = 'Disconnected';
    badge.className = 'badge disconnected';
  }
}

function showPanel(name) {
  document.getElementById('qr-panel').classList.toggle('hidden', name !== 'qr');
  document.getElementById('chat-panel').classList.toggle('hidden', name !== 'chat');
  document.getElementById('welcome-panel').classList.toggle('hidden', name !== 'welcome');
}

function renderQr(dataUrl) {
  showPanel('qr');
  const c = document.getElementById('qr-container');
  c.innerHTML = `<img src="${dataUrl}" alt="QR code" />`;
  document.getElementById('qr-hint').textContent = 'Scan with WhatsApp';
}

// ── Tabs ───────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-chats').classList.toggle('hidden', tab !== 'chats');
    document.getElementById('tab-contacts').classList.toggle('hidden', tab !== 'contacts');
  });
});

// ── Chats ──────────────────────────────────────────────────────
async function loadChats() {
  try { chats = await apiFetch('/api/chats'); } catch (_) { return; }
  const q = document.getElementById('chat-search').value.toLowerCase();
  const filtered = q ? chats.filter(c => (c.name || c.chat_id).toLowerCase().includes(q)) : chats;
  const ul = document.getElementById('chat-list');
  ul.innerHTML = '';
  filtered.forEach(chat => {
    const li = document.createElement('li');
    if (chat.chat_id === activeChatId) li.classList.add('active');
    const time = chat.last_timestamp ? new Date(chat.last_timestamp * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    li.innerHTML = `
      <div class="list-meta">
        <span class="list-name">${esc(chat.name || chat.chat_id)}</span>
        <span class="list-time">${time}</span>
      </div>
      <div class="list-meta">
        <span class="list-sub">${esc(chat.last_message || '')}</span>
        ${chat.unread_count > 0 ? `<span class="badge-count">${chat.unread_count}</span>` : ''}
      </div>`;
    li.addEventListener('click', () => openChat(chat));
    ul.appendChild(li);
  });
}

document.getElementById('chat-search').addEventListener('input', loadChats);

async function openChat(chat) {
  activeChatId = chat.chat_id;
  document.getElementById('chat-title').textContent = chat.name || chat.chat_id;
  document.getElementById('send-to').value = chat.chat_id.replace(/@.*$/, '');
  showPanel('chat');
  await loadMessages(chat.chat_id);
  loadChats(); // refresh active state
}

async function loadMessages(chatId) {
  const msgs = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`).catch(() => []);
  const container = document.getElementById('messages');
  container.innerHTML = '';
  // messages come newest-first, reverse for display
  [...msgs].reverse().forEach(m => appendMessage(m, false));
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg, scroll = true) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg-bubble ${msg.from_me ? 'out' : 'in'}`;
  const time = msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  div.innerHTML = `<div>${esc(msg.body || '')}</div><div class="msg-time">${time}</div>`;
  container.appendChild(div);
  if (scroll) container.scrollTop = container.scrollHeight;
}

// ── Send ───────────────────────────────────────────────────────
document.getElementById('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const to   = document.getElementById('send-to').value.trim();
  const body = document.getElementById('send-body').value.trim();
  if (!to || !body) return;
  try {
    await apiFetch('/api/messages/send', { method: 'POST', body: JSON.stringify({ to, body }) });
    document.getElementById('send-body').value = '';
    if (activeChatId) loadMessages(activeChatId);
  } catch (err) { alert('Error: ' + err.message); }
});

// ── Contacts ───────────────────────────────────────────────────
async function loadContacts() {
  try { contacts = await apiFetch('/api/contacts'); } catch (_) { return; }
  renderContacts();
}

function renderContacts() {
  const q = document.getElementById('contact-search').value.toLowerCase();
  const filtered = q
    ? contacts.filter(c => (c.name || c.phone || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
    : contacts;
  const ul = document.getElementById('contact-list');
  ul.innerHTML = '';
  filtered.forEach(contact => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="list-meta">
        <span class="list-name">${esc(contact.name || contact.phone)}</span>
        <button class="btn-edit" data-id="${contact.id}" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.8rem;">Edit</button>
      </div>
      <div class="list-sub">${esc(contact.phone)}${contact.company ? ' · ' + esc(contact.company) : ''}</div>`;
    li.querySelector('.btn-edit').addEventListener('click', (e) => { e.stopPropagation(); openModal(contact); });
    li.addEventListener('click', () => {
      // open chat with this contact
      const chatId = `${contact.phone}@c.us`;
      const chat = chats.find(c => c.chat_id === chatId) || { chat_id: chatId, name: contact.name || contact.phone };
      openChat(chat);
    });
    ul.appendChild(li);
  });
}

document.getElementById('contact-search').addEventListener('input', renderContacts);

// ── Contact Modal ──────────────────────────────────────────────
function openModal(contact = null) {
  document.getElementById('modal-title').textContent = contact ? 'Edit Contact' : 'Add Contact';
  document.getElementById('modal-id').value    = contact ? contact.id : '';
  document.getElementById('modal-phone').value   = contact ? contact.phone : '';
  document.getElementById('modal-name').value    = contact ? contact.name : '';
  document.getElementById('modal-email').value   = contact ? contact.email : '';
  document.getElementById('modal-company').value = contact ? contact.company : '';
  const tags = contact ? JSON.parse(contact.tags || '[]') : [];
  document.getElementById('modal-tags').value  = tags.join(', ');
  document.getElementById('modal-notes').value = contact ? contact.notes : '';
  document.getElementById('modal-phone').disabled = !!contact;
  document.getElementById('contact-modal').classList.remove('hidden');
}

document.getElementById('btn-add-contact').addEventListener('click', () => openModal());
document.getElementById('modal-cancel').addEventListener('click', () => document.getElementById('contact-modal').classList.add('hidden'));
document.getElementById('contact-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('modal-save').addEventListener('click', async () => {
  const id    = document.getElementById('modal-id').value;
  const phone = document.getElementById('modal-phone').value.trim();
  const name  = document.getElementById('modal-name').value.trim();
  const email = document.getElementById('modal-email').value.trim();
  const company = document.getElementById('modal-company').value.trim();
  const tags  = document.getElementById('modal-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const notes = document.getElementById('modal-notes').value.trim();
  if (!id && !phone) return alert('Phone is required');
  try {
    if (id) {
      await apiFetch(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify({ name, email, company, tags, notes }) });
    } else {
      await apiFetch('/api/contacts', { method: 'POST', body: JSON.stringify({ phone, name, email, company, tags, notes }) });
    }
    document.getElementById('contact-modal').classList.add('hidden');
    loadContacts();
  } catch (err) { alert('Error: ' + err.message); }
});

// ── Helpers ────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ───────────────────────────────────────────────────────
pollStatus();
