import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS } from '../sections.js';

const GENDER_LABELS = { male: 'Male', female: 'Female', other: 'Other', undisclosed: 'Prefer not to say' };
const ROLE_OPTIONS = ['admin', 'approver', 'contributor', 'viewer'];
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "YYYY-MM-DD" (date of birth) -> "05 Mar 1994", without time-zone shifts. */
const formatDob = (value) => (value ? dateFormat.format(new Date(`${value}T12:00:00`)) : '—');

const ERRORS = {
  cannot_change_self: 'You cannot remove your own admin role or disable your own account.',
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'Only administrators can change users.'
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(ERRORS[data.error] || 'Something went wrong. Please try again.');
  return data;
}

export default function UsersPage() {
  const [users, setUsers] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setUsers((await api('/api/admin/users')).users);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async (user, change, message) => {
    setBusyId(user.id);
    setError('');
    setNotice('');
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(change) });
      setNotice(message);
      await load();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyId(null);
    }
  };

  const assignRole = (user, role) => {
    if (!role || role === user.role) return;
    update(user, { role }, `${user.name} is now ${ROLE_LABELS[role]}.`);
  };

  const toggleActive = (user) => {
    const active = !user.is_active;
    if (!active && !window.confirm(`Disable ${user.name}? They will be signed out and cannot sign in until re-enabled.`)) return;
    update(user, { active }, `${user.name} has been ${active ? 'enabled' : 'disabled'}.`);
  };

  const pendingCount = users ? users.filter((user) => !user.role).length : 0;
  const shown = users ? users.filter((user) => filter === 'all' || !user.role) : [];

  return (
    <>
      <header className="admin-page-head">
        <div className="eyebrow">USERS & ROLES</div>
        <h1>Users & Roles</h1>
        <p className="muted">People who sign up appear here. Assign a role to let them sign in.</p>
      </header>

      <div className="admin-toolbar">
        <div className="admin-tabs" role="group" aria-label="Filter users">
          <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All {users && <span>{users.length}</span>}
          </button>
          <button type="button" className={filter === 'pending' ? 'is-active' : ''} aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>
            Awaiting role {pendingCount > 0 && <span className="is-alert">{pendingCount}</span>}
          </button>
        </div>
      </div>

      {notice && <p className="admin-success" role="status">{notice}</p>}
      {error && <p className="admin-alert" role="alert">{error}</p>}

      {!users && !error && <div className="admin-panel">Loading users…</div>}
      {users && shown.length === 0 && (
        <div className="admin-panel admin-placeholder">{filter === 'pending' ? 'Nobody is waiting for a role.' : 'No users yet.'}</div>
      )}

      {shown.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Login ID</th>
                <th scope="col">Date of birth</th>
                <th scope="col">Gender</th>
                <th scope="col">Signed up</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((user) => (
                <tr key={user.id} className={!user.role ? 'is-pending' : undefined}>
                  <td data-label="Name">
                    <strong>{user.name}</strong>{user.is_self && <span className="admin-you">You</span>}
                  </td>
                  <td data-label="Login ID">
                    {user.username && <div>{user.username}</div>}
                  </td>
                  <td data-label="Date of birth">{formatDob(user.dob)}</td>
                  <td data-label="Gender">{GENDER_LABELS[user.gender] || '—'}</td>
                  <td data-label="Signed up">{dateTimeFormat.format(new Date(user.created_at))}</td>
                  <td data-label="Role">
                    <select
                      aria-label={`Role for ${user.name}`}
                      value={user.role || ''}
                      disabled={busyId === user.id || user.is_self}
                      onChange={(event) => assignRole(user, event.target.value)}
                    >
                      {!user.role && <option value="">— Assign role —</option>}
                      {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                    </select>
                  </td>
                  <td data-label="Status">
                    {!user.role ? (
                      <span className="admin-status is-pending">Awaiting role</span>
                    ) : (
                      <span className={user.is_active ? 'admin-status is-active' : 'admin-status is-disabled'}>
                        {user.is_active ? 'Active' : 'Disabled'}
                      </span>
                    )}
                    {!user.is_self && (
                      <button type="button" className="admin-link-button" disabled={busyId === user.id} onClick={() => toggleActive(user)}>
                        {user.is_active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
