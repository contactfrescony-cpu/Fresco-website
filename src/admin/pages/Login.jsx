import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import logo from '../../assets/fresco-ny-logo.webp';
import { useAuth } from '../AuthContext.jsx';

const ERRORS = {
  invalid_credentials: 'Incorrect login ID or password.',
  pending_approval: 'Your account is waiting for an administrator to assign your role. Please try again later.',
  account_disabled: 'This account has been disabled. Please contact an administrator.',
  rate_limited: 'Too many attempts. Please wait 15 minutes and try again.',
  db_unavailable: 'The back office is temporarily unavailable. Please try again shortly.',
  network: 'Could not reach the server. Check your connection and try again.'
};

/** Only same-site back-office paths are accepted as the post-login destination. */
function safeNext(value) {
  return value && value.startsWith('/admin') && !/^\/admin\/(login|signup)/.test(value) ? value : '/admin';
}

export default function Login() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const next = safeNext(params.get('next'));

  if (status === 'signed-in') return <Navigate to={next} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    const failure = await login(String(form.get('login')).trim(), String(form.get('password')));
    setSubmitting(false);
    if (failure) setError(ERRORS[failure] || ERRORS.invalid_credentials);
    else navigate(next, { replace: true });
  };

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <Link to="/" aria-label="Fresco NY website"><img className="admin-login-logo" src={logo} alt="Fresco NY" width="820" height="169" /></Link>
        <div className="eyebrow">STAFF LOGIN</div>
        <h1>Sign in</h1>
        {state?.signedUp && (
          <p className="admin-success" role="status">
            Account created. An administrator will assign your role — you can sign in once that is done.
          </p>
        )}
        {status === 'unavailable' && <p className="admin-alert">{ERRORS.db_unavailable}</p>}
        <label htmlFor="admin-login">Login ID</label>
        <input
          id="admin-login" name="login" required autoComplete="username" autoCapitalize="none" spellCheck={false}
          defaultValue={state?.username || ''} autoFocus
        />
        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" name="password" type="password" required autoComplete="current-password" />
        {error && <p className="admin-alert" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        <p className="admin-login-note">New to Fresco? <Link to="/admin/signup">Create an account</Link></p>
      </form>
    </div>
  );
}
