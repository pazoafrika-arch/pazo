import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import { Banner, Button, Field, Input, PasswordInput } from '../components/UI.jsx';
import { useAuth, HOME_FOR_ROLE } from '../app/AuthContext.jsx';
import { useApi, useSubmit } from '../hooks/useApi.js';
import '../styles/public.css';

/**
 * One login screen for every role. The server decides which dashboard the
 * account belongs to, so the user never has to pick the right door.
 */
export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: publicData } = useApi('/public/content');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const { submit, busy, error, setError } = useSubmit(
    async () => {
      const data = await signIn(identifier.trim(), password);
      const target = location.state?.from || HOME_FOR_ROLE[data.user.role] || '/';
      navigate(target, { replace: true });
      return data;
    },
  );

  if (user) return <Navigate to={HOME_FOR_ROLE[user.role] || '/'} replace />;

  const onSubmit = (e) => {
    e.preventDefault();
    if (!identifier.trim()) return setError('Enter your email or phone number');
    if (!password) return setError('Enter your password');
    return submit();
  };

  const maintenance = publicData?.config?.maintenance_mode;

  const fillDemo = (id, pw) => {
    setIdentifier(id);
    setPassword(pw);
    setError(null);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <Link to="/" style={{ display: 'inline-block' }}>
            <Logo height={28} />
          </Link>
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-sub">Sign in to your partner dashboard</p>
        </div>

        <div className="auth-body">
          {maintenance && (
            <div style={{ marginBottom: 'var(--s-4)' }}>
              <Banner tone="warn" title="Maintenance in progress">
                Pazo is briefly down for maintenance. Sign-in may be unavailable.
              </Banner>
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 'var(--s-4)' }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <Field label="Email or phone number" htmlFor="identifier">
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com or 0754 000 000"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                autoFocus
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
              />
            </Field>

            <div style={{ textAlign: 'right', marginBottom: 'var(--s-4)', marginTop: -6 }}>
              <Link to="/forgot-password" style={{ fontSize: 'var(--t-sm)', fontWeight: 600 }}>
                Forgot password?
              </Link>
            </div>

            <Button type="submit" variant="primary" block loading={busy} iconRight="arrow-right">
              Log in
            </Button>
          </form>

          {publicData?.config?.self_signup_open !== false && (
            <div className="auth-foot">
              New to Pazo? <Link to="/join">Join the programme</Link>
            </div>
          )}

          {import.meta.env.DEV && (
            <div className="demo-box">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 'var(--t-sm)',
                  fontWeight: 700,
                  color: 'var(--text-2)',
                  marginBottom: 6,
                }}
              >
                <Icon name="sparkles" size={14} />
                Demo accounts — tap to fill
              </div>
              {[
                ['Individual', 'amina@demo.pazo.co.tz', 'Demo2026!'],
                ['Organisation', 'serena@demo.pazo.co.tz', 'Demo2026!'],
                ['Business', 'demo@thetravela.com', 'Demo2026!'],
                ['Pazo admin', 'admin@pazo.co.tz', 'Admin2026!'],
              ].map(([role, id, pw]) => (
                <button
                  key={id}
                  type="button"
                  className="demo-row"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => fillDemo(id, pw)}
                >
                  <span className="demo-role">{role}</span>
                  <span className="demo-cred">{id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
