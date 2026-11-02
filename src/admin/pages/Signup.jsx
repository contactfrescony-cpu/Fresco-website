import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import logo from '../../assets/fresco-ny-logo.webp';
import { postJson, useAuth } from '../AuthContext.jsx';

// Values must match GENDERS in server/auth.js.
const GENDERS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['other', 'Other'],
  ['undisclosed', 'Prefer not to say']
];

const FIELD_ERRORS = {
  name: 'Please enter your full name.',
  username: 'Login ID must be 3–40 characters: lowercase letters, numbers, dot, dash or underscore.',
  dob: 'Please enter a valid date of birth (you must be at least 18).',
  gender: 'Please select your gender.',
  password: 'Password must be at least 10 characters.'
};

const ERRORS = {
  username_taken: 'That login ID is already taken. Please choose another.',
  rate_limited: 'Too many sign-ups from this connection. Please try again in an hour.',
  db_unavailable: 'Sign-up is temporarily unavailable. Please try again shortly.',
  network: 'Could not reach the server. Check your connection and try again.'
};

/** Latest allowed birth date (18 years ago today) as YYYY-MM-DD, for the date picker. */
function maxBirthDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export default function Signup() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'signed-in') return <Navigate to="/admin" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get('name')).trim(),
      username: String(data.get('username')).trim().toLowerCase(),
      dob: String(data.get('dob')),
      gender: String(data.get('gender')),
      password: String(data.get('password')),
      website: String(data.get('website') || '')
    };
    if (payload.password !== String(data.get('confirm'))) {
      setError('The two passwords do not match.');
      form.elements.confirm.focus();
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const { ok, data: result } = await postJson('/api/auth/signup', payload);
      if (ok) {
        navigate('/admin/login', { replace: true, state: { signedUp: true, username: payload.username } });
        return;
      }
      setError(ERRORS[result.error] || FIELD_ERRORS[result.field] || 'Your account could not be created. Please try again.');
      if (result.field) form.elements[result.field]?.focus();
    } catch {
      setError(ERRORS.network);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login-card admin-signup-card" onSubmit={handleSubmit}>
        <Link to="/" aria-label="Fresco NY website"><img className="admin-login-logo" src={logo} alt="Fresco NY" width="820" height="169" /></Link>
        <div className="eyebrow">STAFF SIGN-UP</div>
        <h1>Create account</h1>
        <p className="admin-login-intro">After you sign up, an administrator will assign your role. You can sign in once that is done.</p>

        <label htmlFor="su-name">Full name</label>
        <input id="su-name" name="name" required maxLength={120} autoComplete="name" autoFocus />

        <label htmlFor="su-username">Login ID</label>
        <input
          id="su-username" name="username" required minLength={3} maxLength={40} autoComplete="username"
          autoCapitalize="none" spellCheck={false} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,39}"
          title="3–40 characters: letters, numbers, dot, dash or underscore"
        />
        <small className="admin-hint">You'll use this to sign in, e.g. <em>priya.s</em></small>

        <div className="admin-field-row">
          <div>
            <label htmlFor="su-dob">Date of birth</label>
            <input id="su-dob" name="dob" type="date" required min="1926-01-01" max={maxBirthDate()} autoComplete="bday" />
          </div>
          <div>
            <label htmlFor="su-gender">Gender</label>
            <select id="su-gender" name="gender" required defaultValue="">
              <option value="" disabled>Select</option>
              {GENDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>

        <label htmlFor="su-password">Password</label>
        <input id="su-password" name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
        <label htmlFor="su-confirm">Confirm password</label>
        <input id="su-confirm" name="confirm" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />

        <div className="hp-field" aria-hidden="true">
          <label htmlFor="su-website">Website</label>
          <input id="su-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        {error && <p className="admin-alert" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
        <p className="admin-login-note">Already have an account? <Link to="/admin/login">Sign in</Link></p>
      </form>
    </div>
  );
}
