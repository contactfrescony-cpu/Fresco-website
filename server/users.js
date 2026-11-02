'use strict';

// Administrators only: list staff accounts and assign roles.
//
//   GET   /api/admin/users       -> { users: [...] }  (awaiting-role accounts first)
//   PATCH /api/admin/users/:id   { role?: 'admin'|'approver'|'contributor'|'viewer', active?: boolean }
//
// An administrator cannot remove their own admin role or disable themselves, so the
// back office always keeps at least one working administrator.

const express = require('express');
const { getPool } = require('./db.js');
const { requireRole, jsonOnly, ROLES } = require('./auth.js');

function createUsersRouter() {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/', async (req, res, next) => {
    try {
      const [rows] = await getPool().query(
        `SELECT u.id, u.username, u.name, u.date_of_birth AS dob, u.gender,
                r.name AS role, u.is_active, u.last_login_at, u.created_at
           FROM users u LEFT JOIN roles r ON r.id = u.role_id
          ORDER BY (u.role_id IS NULL) DESC, u.created_at DESC`
      );
      return res.json({
        users: rows.map((row) => ({ ...row, is_active: Boolean(row.is_active), is_self: row.id === req.user.id }))
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', jsonOnly, express.json({ limit: '1kb' }), async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'not_found' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const hasRole = body.role !== undefined;
    const hasActive = body.active !== undefined;
    if (!hasRole && !hasActive) return res.status(400).json({ error: 'nothing_to_change' });
    if (hasRole && !ROLES.includes(body.role)) return res.status(400).json({ error: 'invalid', field: 'role' });
    if (hasActive && typeof body.active !== 'boolean') return res.status(400).json({ error: 'invalid', field: 'active' });
    if (id === req.user.id && ((hasRole && body.role !== 'admin') || (hasActive && !body.active))) {
      return res.status(400).json({ error: 'cannot_change_self' });
    }

    const pool = getPool();
    try {
      const sets = [];
      const values = [];
      if (hasRole) { sets.push('role_id = (SELECT id FROM roles WHERE name = ?)'); values.push(body.role); }
      if (hasActive) { sets.push('is_active = ?'); values.push(body.active ? 1 : 0); }
      const [result] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'not_found' });
      // A disabled account is signed out everywhere straight away.
      if (hasActive && !body.active) await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createUsersRouter };
