'use strict';

module.exports = function apiAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!process.env.API_KEY || key === process.env.API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
};
