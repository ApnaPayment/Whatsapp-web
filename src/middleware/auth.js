'use strict';

const jwt = require('jsonwebtoken');
const { getAgentById } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'wa-crm-default-secret-change-in-production';
const JWT_EXPIRES = '7d';

function signToken(agentId) {
  return jwt.sign({ id: agentId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function requireAuth(req, res, next) {
  // Fallback: legacy X-API-Key for external integrations
  const apiKey = req.headers['x-api-key'];
  if (process.env.API_KEY && apiKey === process.env.API_KEY) {
    req.agent = { id: 0, role: 'admin', name: 'API', username: 'api' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const agent = getAgentById(payload.id);
    if (!agent || !agent.is_active) return res.status(401).json({ error: 'Unauthorized' });
    req.agent = agent;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.agent) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.agent.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { requireAuth, requireRole, signToken };
