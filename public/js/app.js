'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'wa_crm_token';
const AGENT_KEY = 'wa_crm_agent';

// ── State ──────────────────────────────────────────────────────────────────────
let token = localStorage.getItem(TOKEN_KEY) || '';
let currentAgent = null;
try { currentAgent = JSON.parse(localStorage.getItem(AGENT_KEY) || 'null'); } catch (_) {}
let chats = [];
let contacts = [];
let templates = [];
let labels = [];
let agents = [];
let tickets = [];
let activeChatId = null;
let activeChatTicket = null;
let crmPanelOpen = false;
let currentView = '';

// ── API helpers ────────────────────────────────────────────────────────────────
function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

async function apiFetch(path, opts) {
  const res = await fetch(path, Object.assign({ headers: apiHeaders() }, opts || {}));
  if (res.status === 401) { doLogout(); throw new Error('Session expired'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'HTTP ' + res.status);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkAuth() {
  if (!token) { showLogin(); return; }
  try {
    const agent = await apiFetch('/api/auth/me');
    currentAgent = agent;
    localStorage.setItem(AGENT_KEY, JSON.stringify(agent));
    showApp();
  } catch (_) { showLogin(); }
}

async function doLogin(username, password) {
  const data = await apiFetch('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  token = data.token;
  currentAgent = data.agent;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(AGENT_KEY, JSON.stringify(data.agent));
  showApp();
}

function doLogout() {
  token = '';
  currentAgent = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AGENT_KEY);
  showLogin();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  initApp();
}

// ── App init ──────────────────────────────────────────────────────────────────
function initApp() {
  if (currentAgent) {
    document.getElementById('agent-display').textContent = currentAgent.name;
    document.querySelectorAll('.admin-only').forEach(function (el) {
      el.classList.toggle('hidden', currentAgent.role !== 'admin');
    });
  }
  pollWAStatus();
  setInterval(pollWAStatus, 5000);
  loadChats();
  loadContacts();
  loadTemplates();
  loadLabels();
  loadAgents();
  showView('welcome');
}

// ── WA status ─────────────────────────────────────────────────────────────────
async function pollWAStatus() {
  try {
    const st = await apiFetch('/api/status');
    setWAConnected(st.connected);
    if (!st.connected && st.hasQr) {
      const res = await apiFetch('/api/qr').catch(function () { return {}; });
      if (res.qr) renderQR(res.qr);
    }
  } catch (_) {}
}

function setWAConnected(val) {
  const badge = document.getElementById('wa-badge');
  badge.className = 'wa-badge ' + (val ? 'connected' : 'disconnected');
  badge.title = val ? 'WhatsApp: Connected' : 'WhatsApp: Disconnected';
  if (val && currentView === 'welcome') {
    document.getElementById('qr-container').innerHTML = '<span style="font-size:4rem">✅</span>';
    document.getElementById('qr-title').textContent = '✅ WhatsApp Connected';
    document.getElementById('qr-hint').textContent = 'Select a chat from the sidebar to start messaging.';
  }
}

function renderQR(dataUrl) {
  showView('welcome');
  document.getElementById('qr-container').innerHTML = '<img src="' + dataUrl + '" alt="QR Code" />';
  document.getElementById('qr-title').textContent = 'Scan to connect WhatsApp';
  document.getElementById('qr-hint').textContent = 'Open WhatsApp → Linked Devices → Link a Device';
}

// ── Socket.io ──────────────────────────────────────────────────────────────────
var socket = io();

socket.on('status', function (data) {
  setWAConnected(data.connected);
  if (data.qr) renderQR(data.qr);
});

socket.on('qr', function (dataUrl) { setWAConnected(false); renderQR(dataUrl); });

socket.on('message', function (msg) {
  if (msg.chat_id === activeChatId) appendMessage(msg);
  loadChats();
  updateUnreadBadge();
  if (msg.ticket && activeChatTicket && activeChatTicket.id === msg.ticket.id) {
    loadCRMPanel(activeChatId);
  }
});

socket.on('ticket_created', function () { loadTickets(); });
socket.on('ticket_updated', function (t) {
  loadTickets();
  if (activeChatTicket && activeChatTicket.id === t.id) loadCRMPanel(activeChatId);
});

socket.on('sla_breach', function (list) {
  updateOpenBadge();
  if (list.length > 0) console.warn('SLA breach:', list.length, 'ticket(s)');
});

// ── Views ──────────────────────────────────────────────────────────────────────
function showView(viewId) {
  currentView = viewId;
  document.querySelectorAll('.view').forEach(function (v) {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  var el = document.getElementById('view-' + viewId);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
  document.querySelectorAll('.tbar-btn[data-view]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === viewId);
  });
  var titles = { welcome: 'WhatsApp CRM', chat: '', analytics: 'Analytics', templates: 'Templates', agents: 'Agent Management' };
  if (titles[viewId] !== undefined) document.getElementById('toolbar-title').textContent = titles[viewId];
}

// ── Sidebar sections ───────────────────────────────────────────────────────────
function showSidebarSection(section) {
  document.querySelectorAll('.sidebar-section').forEach(function (s) { s.classList.add('hidden'); });
  document.querySelectorAll('.snav-btn').forEach(function (b) { b.classList.remove('active'); });
  var sEl = document.getElementById('section-' + section);
  if (sEl) sEl.classList.remove('hidden');
  var btn = document.querySelector('.snav-btn[data-section="' + section + '"]');
  if (btn) btn.classList.add('active');
  if (section === 'tickets') loadTickets();
  if (section === 'contacts') renderContacts();
}

// ── Chats ──────────────────────────────────────────────────────────────────────
async function loadChats() {
  try { chats = await apiFetch('/api/chats'); } catch (_) { return; }
  renderChats();
  updateUnreadBadge();
}

function renderChats() {
  var q = document.getElementById('chat-search').value.toLowerCase();
  var filtered = q ? chats.filter(function (c) { return (c.name || c.chat_id || '').toLowerCase().includes(q); }) : chats;
  var ul = document.getElementById('chat-list');
  ul.innerHTML = '';
  filtered.forEach(function (chat) {
    var li = document.createElement('li');
    li.className = 'chat-item' + (chat.chat_id === activeChatId ? ' active' : '');
    var time = chat.last_timestamp ? fmtTime(chat.last_timestamp * 1000) : '';
    li.innerHTML =
      '<div class="item-row">' +
        '<span class="item-name">' + esc(chat.name || chat.chat_id) + '</span>' +
        '<span class="item-time">' + time + '</span>' +
      '</div>' +
      '<div class="item-row">' +
        '<span class="item-preview">' + esc(chat.last_message || '') + '</span>' +
        (chat.unread_count > 0 ? '<span class="unread-dot">' + chat.unread_count + '</span>' : '') +
      '</div>';
    li.addEventListener('click', function () { openChat(chat); });
    ul.appendChild(li);
  });
}

function updateUnreadBadge() {
  var total = chats.reduce(function (s, c) { return s + (c.unread_count || 0); }, 0);
  var badge = document.getElementById('snav-unread-badge');
  badge.textContent = total;
  badge.classList.toggle('hidden', total === 0);
}

async function openChat(chat) {
  activeChatId = chat.chat_id;
  showView('chat');
  renderChats();
  var phone = chat.chat_id.replace(/@.*$/, '');
  var name = chat.name || phone;
  document.getElementById('chat-header-name').textContent = name;
  document.getElementById('chat-header-phone').textContent = phone;
  document.getElementById('chat-avatar').textContent = (name[0] || '?').toUpperCase();
  document.getElementById('toolbar-title').textContent = name;
  document.getElementById('template-picker').classList.add('hidden');
  await loadMessages(chat.chat_id);
  if (crmPanelOpen) loadCRMPanel(chat.chat_id);
}

async function loadMessages(chatId) {
  var msgs = await apiFetch('/api/chats/' + encodeURIComponent(chatId) + '/messages?limit=50').catch(function () { return []; });
  var container = document.getElementById('messages');
  container.innerHTML = '';
  msgs.slice().reverse().forEach(function (m) { appendMessage(m, false); });
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg, scroll) {
  if (scroll === undefined) scroll = true;
  var container = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'msg-bubble ' + (msg.from_me ? 'out' : 'in');
  var time = msg.timestamp ? fmtTime(msg.timestamp * 1000) : '';
  var isMedia = msg.msg_type && msg.msg_type !== 'chat';
  div.innerHTML =
    '<div>' + esc(msg.body || '') + '</div>' +
    (isMedia ? '<div class="msg-type-badge">[' + esc(msg.msg_type) + ']</div>' : '') +
    '<div class="msg-time">' + time + '</div>';
  container.appendChild(div);
  if (scroll) container.scrollTop = container.scrollHeight;
}

// ── Tickets (sidebar) ──────────────────────────────────────────────────────────
async function loadTickets() {
  var status = document.getElementById('tf-status').value;
  var priority = document.getElementById('tf-priority').value;
  var assignedVal = document.getElementById('tf-assigned').value;
  var assignedTo = assignedVal === 'me' && currentAgent ? String(currentAgent.id) : assignedVal;
  var q = document.getElementById('ticket-search').value;
  var params = new URLSearchParams();
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (assignedTo) params.set('assigned_to', assignedTo);
  if (q) params.set('q', q);
  try {
    tickets = await apiFetch('/api/tickets?' + params.toString());
  } catch (_) { return; }
  renderTickets();
  updateOpenBadge();
}

function renderTickets() {
  var ul = document.getElementById('ticket-list');
  ul.innerHTML = '';
  tickets.forEach(function (t) {
    var li = document.createElement('li');
    li.className = 'ticket-item';
    var phone = t.contact_phone || t.chat_id.replace(/@.*$/, '');
    li.innerHTML =
      '<div class="item-row">' +
        '<span class="item-name">' + esc(t.contact_name || t.subject || phone) + '</span>' +
        '<span class="badge badge-' + t.status + '">' + t.status + '</span>' +
      '</div>' +
      '<div class="item-row" style="margin-top:4px">' +
        '<span class="item-preview">#' + t.id + ' · ' + esc(t.agent_name || 'Unassigned') + '</span>' +
        '<span class="badge badge-' + t.priority + '">' + t.priority + '</span>' +
      '</div>';
    li.addEventListener('click', function () { openChatFromTicket(t); });
    ul.appendChild(li);
  });
}

function updateOpenBadge() {
  var openCount = tickets.filter(function (t) { return t.status === 'open'; }).length;
  var badge = document.getElementById('snav-open-badge');
  badge.textContent = openCount;
  badge.classList.toggle('hidden', openCount === 0);
}

async function openChatFromTicket(ticket) {
  var existingChat = chats.find(function (c) { return c.chat_id === ticket.chat_id; });
  var chat = existingChat || { chat_id: ticket.chat_id, name: ticket.contact_name || ticket.chat_id.replace(/@.*$/, '') };
  showSidebarSection('chats');
  await openChat(chat);
  setTimeout(function () { openCRMPanel(ticket.chat_id); }, 100);
}

// ── Contacts ───────────────────────────────────────────────────────────────────
async function loadContacts() {
  try { contacts = await apiFetch('/api/contacts'); } catch (_) {}
  renderContacts();
}

function renderContacts() {
  var q = document.getElementById('contact-search').value.toLowerCase();
  var filtered = q ? contacts.filter(function (c) {
    return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
  }) : contacts;
  var ul = document.getElementById('contact-list');
  ul.innerHTML = '';
  filtered.forEach(function (c) {
    var li = document.createElement('li');
    li.className = 'contact-item';
    li.innerHTML =
      '<div class="item-row">' +
        '<span class="item-name">' + esc(c.name || c.phone) + '</span>' +
        '<button class="btn-sm" data-cid="' + c.id + '">Edit</button>' +
      '</div>' +
      '<div class="item-preview">' + esc(c.phone) + (c.company ? ' · ' + esc(c.company) : '') + '</div>';
    li.querySelector('button').addEventListener('click', function (e) {
      e.stopPropagation();
      openContactModal(c);
    });
    li.addEventListener('click', function () {
      var chat = chats.find(function (x) { return x.chat_id === c.phone + '@c.us'; })
        || { chat_id: c.phone + '@c.us', name: c.name || c.phone };
      showSidebarSection('chats');
      openChat(chat);
    });
    ul.appendChild(li);
  });
}

// ── CRM Panel ──────────────────────────────────────────────────────────────────
function openCRMPanel(chatId) {
  crmPanelOpen = true;
  document.getElementById('crm-panel').classList.remove('hidden');
  loadCRMPanel(chatId);
}

function closeCRMPanel() {
  crmPanelOpen = false;
  document.getElementById('crm-panel').classList.add('hidden');
}

async function loadCRMPanel(chatId) {
  if (!chatId) return;

  // Find ticket – check local state first, then fetch
  var ticketSummary = tickets.find(function (t) { return t.chat_id === chatId; });
  var ticket = null;

  if (!ticketSummary) {
    // Fetch fresh list in case sidebar hasn't loaded tickets yet
    try {
      var all = await apiFetch('/api/tickets');
      ticketSummary = all.find(function (t) { return t.chat_id === chatId; });
    } catch (_) {}
  }

  if (ticketSummary) {
    try { ticket = await apiFetch('/api/tickets/' + ticketSummary.id); } catch (_) {}
  }

  activeChatTicket = ticket;

  // Contact info
  var phone = chatId.replace(/@.*$/, '');
  var dbContact = contacts.find(function (c) { return c.phone === phone; });
  var contactName = (ticket && ticket.contact_name) || (dbContact && dbContact.name) || phone;
  var initials = (contactName[0] || '?').toUpperCase();

  document.getElementById('crm-avatar').textContent = initials;
  document.getElementById('crm-contact-name').textContent = contactName;
  document.getElementById('crm-contact-phone').textContent = phone;
  document.getElementById('crm-contact-company').textContent = (dbContact && dbContact.company) || '';

  // Ticket section
  if (ticket) {
    document.getElementById('crm-ticket-id').textContent = 'Ticket #' + ticket.id + ' · ' + fmtDate(ticket.created_at);
    document.getElementById('crm-status').value = ticket.status;
    document.getElementById('crm-priority').value = ticket.priority;
    document.getElementById('crm-assigned').value = ticket.assigned_to || '';
    renderSLA(ticket);
    renderCRMLabels(ticket.labels || []);
    renderCRMNotes(ticket.notes || []);
    renderCRMActivities(ticket.activities || []);
  } else {
    document.getElementById('crm-ticket-id').textContent = 'No ticket yet';
    renderSLA(null);
    renderCRMLabels([]);
    renderCRMNotes([]);
    renderCRMActivities([]);
  }
}

function renderSLA(ticket) {
  var el = document.getElementById('crm-sla');
  if (!ticket || !ticket.sla_due_at) { el.textContent = ''; el.className = 'crm-sla'; return; }
  var due = new Date(ticket.sla_due_at);
  var diffMs = due - Date.now();
  var diffH = diffMs / 3600000;
  if (diffMs < 0) {
    el.textContent = '⚠️ SLA Breached (' + Math.abs(Math.round(diffH)) + 'h ago)';
    el.className = 'crm-sla breach';
  } else if (diffH < 2) {
    el.textContent = '⏰ SLA due in ' + Math.round(diffMs / 60000) + ' min';
    el.className = 'crm-sla warning';
  } else {
    el.textContent = '✅ SLA due ' + due.toLocaleString();
    el.className = 'crm-sla ok';
  }
}

function renderCRMLabels(lbls) {
  var container = document.getElementById('crm-labels-list');
  container.innerHTML = '';
  lbls.forEach(function (label) {
    var chip = document.createElement('span');
    chip.className = 'label-chip';
    chip.style.background = label.color + '33';
    chip.style.color = label.color;
    chip.innerHTML = esc(label.name) + ' <button data-lid="' + label.id + '">✕</button>';
    chip.querySelector('button').addEventListener('click', function () { removeLabelFromTicket(label.id); });
    container.appendChild(chip);
  });
}

function renderCRMNotes(notes) {
  var container = document.getElementById('crm-notes-list');
  container.innerHTML = '';
  notes.forEach(function (note) {
    var div = document.createElement('div');
    div.className = 'note-item ' + (note.is_internal ? 'internal' : 'external');
    div.innerHTML =
      '<div>' + esc(note.body) + '</div>' +
      '<div class="note-meta">' + esc(note.agent_name || 'System') + ' · ' + fmtDate(note.created_at) + (note.is_internal ? ' · Internal' : '') + '</div>';
    container.appendChild(div);
  });
}

function renderCRMActivities(activities) {
  var container = document.getElementById('crm-activity-list');
  container.innerHTML = '';
  activities.slice().reverse().slice(0, 20).forEach(function (act) {
    var div = document.createElement('div');
    div.className = 'activity-item';
    div.innerHTML =
      '<span class="activity-dot ' + act.action_type + '"></span>' +
      '<span class="activity-text">' + activityLabel(act) + '</span>' +
      '<span class="activity-time">' + fmtDate(act.created_at) + '</span>';
    container.appendChild(div);
  });
}

function activityLabel(act) {
  var by = act.agent_name ? ' by ' + esc(act.agent_name) : '';
  try {
    var p = JSON.parse(act.payload || '{}');
    switch (act.action_type) {
      case 'created':          return 'Ticket created' + by;
      case 'status_changed':   return 'Status: ' + p.from + ' → ' + p.to + by;
      case 'assigned':         return 'Assigned to ' + esc(p.to || '?') + by;
      case 'priority_changed': return 'Priority: ' + p.from + ' → ' + p.to + by;
      case 'note_added':       return 'Note added' + by;
      case 'message_in':       return 'Inbound message';
      case 'message_out':      return 'Outbound message' + by;
      case 'label_added':      return 'Label added' + by;
      case 'reopened':         return 'Ticket reopened';
      default:                 return esc(act.action_type);
    }
  } catch (_) { return esc(act.action_type); }
}

async function removeLabelFromTicket(labelId) {
  if (!activeChatTicket) return;
  try {
    await apiFetch('/api/tickets/' + activeChatTicket.id + '/labels/' + labelId, { method: 'DELETE' });
    loadCRMPanel(activeChatId);
  } catch (err) { alert(err.message); }
}

async function saveTicketChanges() {
  if (!activeChatTicket) return;
  var status = document.getElementById('crm-status').value;
  var priority = document.getElementById('crm-priority').value;
  var assigned_to = document.getElementById('crm-assigned').value || null;
  try {
    await apiFetch('/api/tickets/' + activeChatTicket.id, {
      method: 'PUT', body: JSON.stringify({ status: status, priority: priority, assigned_to: assigned_to }),
    });
    loadCRMPanel(activeChatId);
    loadTickets();
  } catch (err) { alert(err.message); }
}

async function addLabelToActiveTicket() {
  if (!activeChatTicket) return;
  var sel = document.getElementById('crm-label-select');
  var labelId = sel.value;
  if (!labelId) return;
  try {
    await apiFetch('/api/tickets/' + activeChatTicket.id + '/labels', {
      method: 'POST', body: JSON.stringify({ label_id: Number(labelId) }),
    });
    sel.value = '';
    loadCRMPanel(activeChatId);
  } catch (err) { alert(err.message); }
}

// ── Templates ──────────────────────────────────────────────────────────────────
async function loadTemplates() {
  try { templates = await apiFetch('/api/templates'); } catch (_) {}
}

function renderTemplatesTable() {
  var tbody = document.querySelector('#templates-table tbody');
  tbody.innerHTML = '';
  templates.forEach(function (t) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + esc(t.name) + '</td>' +
      '<td><span class="badge badge-' + (t.category || 'general') + '">' + esc(t.category) + '</span></td>' +
      '<td class="td-truncate">' + esc(t.body) + '</td>' +
      '<td><div class="table-actions">' +
        '<button class="btn-sm btn-edit-tpl" data-id="' + t.id + '">Edit</button>' +
        '<button class="btn-sm btn-danger btn-del-tpl" data-id="' + t.id + '">Delete</button>' +
      '</div></td>';
    tr.querySelector('.btn-edit-tpl').addEventListener('click', function () { openTemplateModal(t); });
    tr.querySelector('.btn-del-tpl').addEventListener('click', function () { deleteTemplate(t.id); });
    tbody.appendChild(tr);
  });
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  try {
    await apiFetch('/api/templates/' + id, { method: 'DELETE' });
    await loadTemplates();
    renderTemplatesTable();
  } catch (err) { alert(err.message); }
}

// ── Agents ─────────────────────────────────────────────────────────────────────
async function loadAgents() {
  try {
    agents = await apiFetch('/api/agents');
    var sel = document.getElementById('crm-assigned');
    while (sel.options.length > 1) sel.remove(1);
    agents.filter(function (a) { return a.is_active; }).forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

function renderAgentsTable() {
  var tbody = document.querySelector('#agents-table tbody');
  tbody.innerHTML = '';
  agents.forEach(function (a) {
    var tr = document.createElement('tr');
    var isSelf = currentAgent && currentAgent.id === a.id;
    tr.innerHTML =
      '<td>' + esc(a.name) + '</td>' +
      '<td>' + esc(a.username) + '</td>' +
      '<td>' + esc(a.email || '—') + '</td>' +
      '<td><span class="badge badge-' + a.role + '">' + a.role + '</span></td>' +
      '<td><span class="badge badge-' + (a.is_active ? 'active' : 'inactive') + '">' + (a.is_active ? 'Active' : 'Inactive') + '</span></td>' +
      '<td><div class="table-actions">' +
        '<button class="btn-sm btn-edit-agent" data-id="' + a.id + '">Edit</button>' +
        (!isSelf ? '<button class="btn-sm btn-danger btn-toggle-agent" data-id="' + a.id + '">' + (a.is_active ? 'Deactivate' : 'Activate') + '</button>' : '') +
      '</div></td>';
    tr.querySelector('.btn-edit-agent').addEventListener('click', function () { openAgentModal(a); });
    var toggleBtn = tr.querySelector('.btn-toggle-agent');
    if (toggleBtn) toggleBtn.addEventListener('click', function () { toggleAgentActive(a); });
    tbody.appendChild(tr);
  });
}

async function toggleAgentActive(agent) {
  try {
    await apiFetch('/api/agents/' + agent.id, { method: 'PUT', body: JSON.stringify({ is_active: agent.is_active ? 0 : 1 }) });
    await loadAgents();
    renderAgentsTable();
  } catch (err) { alert(err.message); }
}

// ── Labels ─────────────────────────────────────────────────────────────────────
async function loadLabels() {
  try {
    labels = await apiFetch('/api/labels');
    var sel = document.getElementById('crm-label-select');
    while (sel.options.length > 1) sel.remove(1);
    labels.forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l.id; opt.textContent = l.name;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

// ── Analytics ──────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    var results = await Promise.all([
      apiFetch('/api/analytics/overview'),
      apiFetch('/api/analytics/messages-trend?days=14'),
      apiFetch('/api/analytics/agent-workload'),
    ]);
    renderAnalytics(results[0], results[1], results[2]);
  } catch (_) {}
}

function renderAnalytics(overview, trend, workload) {
  var stats = overview.ticketStats;
  var slaBreaching = overview.slaBreaching;

  document.getElementById('stats-cards').innerHTML =
    '<div class="stat-card"><div class="stat-value">' + stats.total + '</div><div class="stat-label">Total Tickets</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#4ade80">' + stats.open + '</div><div class="stat-label">Open</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#fbbf24">' + stats.pending + '</div><div class="stat-label">Pending</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#60a5fa">' + stats.resolved + '</div><div class="stat-label">Resolved</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#f87171">' + slaBreaching + '</div><div class="stat-label">SLA Breaching</div></div>';

  var maxP = Math.max.apply(null, overview.priorityBreakdown.map(function (p) { return p.count; }).concat([1]));
  document.getElementById('priority-chart').innerHTML = overview.priorityBreakdown.map(function (p) {
    return '<div class="priority-bar-row">' +
      '<span class="priority-bar-label">' + p.priority + '</span>' +
      '<div class="priority-bar-track"><div class="priority-bar-fill bar-' + p.priority + '" style="width:' + Math.round(p.count / maxP * 100) + '%"></div></div>' +
      '<span class="priority-bar-count">' + p.count + '</span>' +
      '</div>';
  }).join('') || '<span class="muted">No data</span>';

  var tbody = document.querySelector('#workload-table tbody');
  tbody.innerHTML = workload.map(function (a) {
    return '<tr><td>' + esc(a.name) + '</td><td>' + a.open_tickets + '</td></tr>';
  }).join('') || '<tr><td colspan="2" class="muted">No agents</td></tr>';

  var maxM = Math.max.apply(null, trend.map(function (t) { return t.count; }).concat([1]));
  document.getElementById('messages-trend').innerHTML = trend.map(function (t) {
    return '<div class="trend-bar-wrap">' +
      '<div class="trend-bar" style="height:' + Math.max(4, Math.round(t.count / maxM * 55)) + 'px" title="' + t.day + ': ' + t.count + '"></div>' +
      '<div class="trend-day">' + (t.day ? t.day.slice(5) : '') + '</div>' +
      '</div>';
  }).join('') || '<span class="muted">No data</span>';
}

// ── Template picker ────────────────────────────────────────────────────────────
function renderTemplatePicker() {
  var q = document.getElementById('tpl-search').value.toLowerCase();
  var filtered = q ? templates.filter(function (t) { return t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q); }) : templates;
  var ul = document.getElementById('tpl-list');
  ul.innerHTML = '';
  if (filtered.length === 0) {
    ul.innerHTML = '<li style="padding:12px;color:var(--text-muted);font-size:.82rem">No templates found</li>';
    return;
  }
  filtered.forEach(function (t) {
    var li = document.createElement('li');
    li.innerHTML = '<div class="tpl-item-name">' + esc(t.name) + '</div><div class="tpl-item-body">' + esc(t.body) + '</div>';
    li.addEventListener('click', function () {
      document.getElementById('send-body').value = t.body;
      document.getElementById('template-picker').classList.add('hidden');
      document.getElementById('send-body').focus();
    });
    ul.appendChild(li);
  });
}

// ── Modals ─────────────────────────────────────────────────────────────────────

// Contact modal
function openContactModal(contact) {
  document.getElementById('contact-modal-title').textContent = contact ? 'Edit Contact' : 'Add Contact';
  document.getElementById('cm-id').value = contact ? contact.id : '';
  document.getElementById('cm-phone').value = contact ? contact.phone : '';
  document.getElementById('cm-phone').disabled = !!contact;
  document.getElementById('cm-name').value = contact ? (contact.name || '') : '';
  document.getElementById('cm-email').value = contact ? (contact.email || '') : '';
  document.getElementById('cm-company').value = contact ? (contact.company || '') : '';
  var tags = contact ? JSON.parse(contact.tags || '[]') : [];
  document.getElementById('cm-tags').value = tags.join(', ');
  document.getElementById('cm-notes').value = contact ? (contact.notes || '') : '';
  document.getElementById('contact-modal').classList.remove('hidden');
}

async function saveContact() {
  var id = document.getElementById('cm-id').value;
  var phone = document.getElementById('cm-phone').value.trim();
  var name = document.getElementById('cm-name').value.trim();
  var email = document.getElementById('cm-email').value.trim();
  var company = document.getElementById('cm-company').value.trim();
  var tags = document.getElementById('cm-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  var notes = document.getElementById('cm-notes').value.trim();
  if (!id && !phone) return alert('Phone is required');
  try {
    if (id) {
      await apiFetch('/api/contacts/' + id, { method: 'PUT', body: JSON.stringify({ name: name, email: email, company: company, tags: tags, notes: notes }) });
    } else {
      await apiFetch('/api/contacts', { method: 'POST', body: JSON.stringify({ phone: phone, name: name, email: email, company: company, tags: tags, notes: notes }) });
    }
    document.getElementById('contact-modal').classList.add('hidden');
    await loadContacts();
    renderContacts();
  } catch (err) { alert(err.message); }
}

// Note modal
function openNoteModal() {
  document.getElementById('nm-body').value = '';
  document.getElementById('nm-internal').checked = true;
  document.getElementById('note-modal').classList.remove('hidden');
}

async function saveNote() {
  if (!activeChatTicket) { alert('No active ticket for this chat.'); return; }
  var body = document.getElementById('nm-body').value.trim();
  var is_internal = document.getElementById('nm-internal').checked;
  if (!body) return alert('Note body is required');
  try {
    await apiFetch('/api/tickets/' + activeChatTicket.id + '/notes', {
      method: 'POST', body: JSON.stringify({ body: body, is_internal: is_internal }),
    });
    document.getElementById('note-modal').classList.add('hidden');
    loadCRMPanel(activeChatId);
  } catch (err) { alert(err.message); }
}

// Template modal
function openTemplateModal(tpl) {
  document.getElementById('tpl-modal-title').textContent = tpl ? 'Edit Template' : 'New Template';
  document.getElementById('tpl-id').value = tpl ? tpl.id : '';
  document.getElementById('tpl-name').value = tpl ? tpl.name : '';
  document.getElementById('tpl-category').value = tpl ? tpl.category : 'general';
  document.getElementById('tpl-body').value = tpl ? tpl.body : '';
  document.getElementById('template-modal').classList.remove('hidden');
}

async function saveTemplate() {
  var id = document.getElementById('tpl-id').value;
  var name = document.getElementById('tpl-name').value.trim();
  var category = document.getElementById('tpl-category').value;
  var body = document.getElementById('tpl-body').value.trim();
  if (!name || !body) return alert('Name and body are required');
  try {
    if (id) {
      await apiFetch('/api/templates/' + id, { method: 'PUT', body: JSON.stringify({ name: name, category: category, body: body }) });
    } else {
      await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify({ name: name, category: category, body: body }) });
    }
    document.getElementById('template-modal').classList.add('hidden');
    await loadTemplates();
    renderTemplatesTable();
  } catch (err) { alert(err.message); }
}

// Agent modal
function openAgentModal(agent) {
  document.getElementById('agent-modal-title').textContent = agent ? 'Edit Agent' : 'New Agent';
  document.getElementById('am-id').value = agent ? agent.id : '';
  document.getElementById('am-name').value = agent ? agent.name : '';
  document.getElementById('am-username').value = agent ? agent.username : '';
  document.getElementById('am-email').value = agent ? (agent.email || '') : '';
  document.getElementById('am-password').value = '';
  document.getElementById('am-role').value = agent ? agent.role : 'agent';
  document.getElementById('am-username').disabled = !!agent;
  document.getElementById('agent-modal').classList.remove('hidden');
}

async function saveAgent() {
  var id = document.getElementById('am-id').value;
  var name = document.getElementById('am-name').value.trim();
  var username = document.getElementById('am-username').value.trim();
  var email = document.getElementById('am-email').value.trim();
  var password = document.getElementById('am-password').value;
  var role = document.getElementById('am-role').value;
  if (!name || (!id && !username)) return alert('Name and username are required');
  if (!id && !password) return alert('Password is required for new agents');
  try {
    var payload = { name: name, email: email, role: role };
    if (password) payload.password = password;
    if (!id) payload.username = username;
    if (id) {
      await apiFetch('/api/agents/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
    }
    document.getElementById('agent-modal').classList.add('hidden');
    await loadAgents();
    renderAgentsTable();
  } catch (err) { alert(err.message); }
}

// New chat modal
function openNewChatModal() {
  document.getElementById('nc-phone').value = '';
  document.getElementById('nc-body').value = '';
  document.getElementById('new-chat-modal').classList.remove('hidden');
}

async function sendNewChat() {
  var phone = document.getElementById('nc-phone').value.trim();
  var body = document.getElementById('nc-body').value.trim();
  if (!phone || !body) return alert('Phone and message are required');
  try {
    await apiFetch('/api/messages/send', { method: 'POST', body: JSON.stringify({ to: phone, body: body }) });
    document.getElementById('new-chat-modal').classList.add('hidden');
    await loadChats();
    var chat = chats.find(function (c) { return c.chat_id === phone + '@c.us'; })
      || { chat_id: phone + '@c.us', name: phone };
    openChat(chat);
  } catch (err) { alert(err.message); }
}

// ── DOM ready ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {

  // Login
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');
    errEl.classList.add('hidden');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await doLogin(username, password);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });

  document.getElementById('btn-logout').addEventListener('click', function () {
    if (confirm('Sign out?')) doLogout();
  });

  // Sidebar nav
  document.querySelectorAll('.snav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { showSidebarSection(btn.dataset.section); });
  });

  // Toolbar view buttons
  document.querySelectorAll('.tbar-btn[data-view]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var view = btn.dataset.view;
      showView(view);
      if (view === 'analytics') loadAnalytics();
      if (view === 'templates') { await loadTemplates(); renderTemplatesTable(); }
      if (view === 'agents') { await loadAgents(); renderAgentsTable(); }
    });
  });

  // New chat
  document.getElementById('btn-new-chat').addEventListener('click', openNewChatModal);
  document.getElementById('nc-cancel').addEventListener('click', function () { document.getElementById('new-chat-modal').classList.add('hidden'); });
  document.getElementById('nc-send').addEventListener('click', sendNewChat);

  // CRM panel
  document.getElementById('btn-toggle-crm').addEventListener('click', function () {
    if (crmPanelOpen) { closeCRMPanel(); } else if (activeChatId) { openCRMPanel(activeChatId); }
  });
  document.getElementById('btn-close-crm').addEventListener('click', closeCRMPanel);
  document.getElementById('btn-save-ticket').addEventListener('click', saveTicketChanges);
  document.getElementById('btn-add-label-to-ticket').addEventListener('click', addLabelToActiveTicket);

  // Notes
  document.getElementById('btn-add-note').addEventListener('click', openNoteModal);
  document.getElementById('nm-cancel').addEventListener('click', function () { document.getElementById('note-modal').classList.add('hidden'); });
  document.getElementById('nm-save').addEventListener('click', saveNote);

  // Contact from CRM panel
  document.getElementById('btn-crm-edit-contact').addEventListener('click', function () {
    var phone = activeChatId ? activeChatId.replace(/@.*$/, '') : '';
    var c = contacts.find(function (x) { return x.phone === phone; });
    openContactModal(c || null);
  });

  // Contacts
  document.getElementById('btn-add-contact').addEventListener('click', function () { openContactModal(null); });
  document.getElementById('cm-cancel').addEventListener('click', function () { document.getElementById('contact-modal').classList.add('hidden'); });
  document.getElementById('cm-save').addEventListener('click', saveContact);
  document.getElementById('contact-search').addEventListener('input', renderContacts);

  // Templates
  document.getElementById('btn-add-template').addEventListener('click', function () { openTemplateModal(null); });
  document.getElementById('tpl-cancel').addEventListener('click', function () { document.getElementById('template-modal').classList.add('hidden'); });
  document.getElementById('tpl-save').addEventListener('click', saveTemplate);

  // Agents
  document.getElementById('btn-add-agent').addEventListener('click', function () { openAgentModal(null); });
  document.getElementById('am-cancel').addEventListener('click', function () { document.getElementById('agent-modal').classList.add('hidden'); });
  document.getElementById('am-save').addEventListener('click', saveAgent);

  // Ticket filters
  document.querySelectorAll('#tf-status, #tf-priority, #tf-assigned').forEach(function (sel) {
    sel.addEventListener('change', loadTickets);
  });
  document.getElementById('ticket-search').addEventListener('input', debounce(loadTickets, 300));

  // Chat search
  document.getElementById('chat-search').addEventListener('input', renderChats);

  // Message send
  document.getElementById('send-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!activeChatId) return;
    var body = document.getElementById('send-body').value.trim();
    if (!body) return;
    var to = activeChatId.replace(/@.*$/, '');
    try {
      await apiFetch('/api/messages/send', { method: 'POST', body: JSON.stringify({ to: to, body: body }) });
      document.getElementById('send-body').value = '';
      loadMessages(activeChatId);
      loadChats();
    } catch (err) { alert('Error: ' + err.message); }
  });

  // Template picker
  document.getElementById('btn-open-tpl-picker').addEventListener('click', function () {
    var picker = document.getElementById('template-picker');
    var wasHidden = picker.classList.contains('hidden');
    picker.classList.toggle('hidden', !wasHidden);
    if (wasHidden) { document.getElementById('tpl-search').value = ''; renderTemplatePicker(); }
  });
  document.getElementById('btn-close-tpl-picker').addEventListener('click', function () {
    document.getElementById('template-picker').classList.add('hidden');
  });
  document.getElementById('tpl-search').addEventListener('input', renderTemplatePicker);

  // Type "/" to open template picker
  document.getElementById('send-body').addEventListener('keydown', function (e) {
    if (e.key === '/' && this.value === '') {
      e.preventDefault();
      document.getElementById('template-picker').classList.remove('hidden');
      document.getElementById('tpl-search').value = '';
      renderTemplatePicker();
      document.getElementById('tpl-search').focus();
    }
    if (e.key === 'Escape') document.getElementById('template-picker').classList.add('hidden');
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.add('hidden'); });
  });

  checkAuth();
});

// ── Utilities ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(str) {
  if (!str) return '';
  var d = new Date(str);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + fmtTime(d);
}

function debounce(fn, delay) {
  var t;
  return function () {
    var args = arguments;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(null, args); }, delay);
  };
}
