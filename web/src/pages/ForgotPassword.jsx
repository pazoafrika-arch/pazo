import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import { Banner, Button, Field, Input, PasswordInput } from '../components/UI.jsx';
import { api } from '../lib/api.js';
import '../styles/public.css';

/** Identify the account, verify by one-time code, then set a new password. */
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [tempToken, setTempToken] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resendIn, setResendIn] = useState(0);
  const otpRefs = useRef([]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const requestCode = async () => {
    if (!identifier.trim()) return setError('Enter your email or phone number');
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/forgot-password', { identifier: identifier.trim() });
      setSentTo(res.identifier || identifier.trim());
      setResendIn(res.resend_after_seconds || 60);
      if (res.dev_code) setOtp(String(res.dev_code).split(''));
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return null;
  };

  const verifyCode = async () => {
    const code = otp.join('');
    if (code.length !== 6) return setError('Enter the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      const isEmail = sentTo.includes('@');
      const res = await api.post('/auth/verify-otp', {
        [isEmail ? 'email' : 'phone']: sentTo,
        code,
        purpose: 'reset',
      });
      setTempToken(res.temp_token);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return null;
  };

  const resetPassword = async () => {
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (!/[0-9]/.test(password)) return setError('Password must include at least one number');
    if (!/[A-Z]/.test(password)) return setError('Password must include at least one capital letter');

    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { temp_token: tempToken, password });
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return null;
  };

  const onOtpChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    setError(null);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <Link to="/" style={{ display: 'inline-block' }}>
            <Logo height={30} />
          </Link>
          <h1 className="auth-title">
            {step === 4 ? 'Password updated' : 'Reset your password'}
          </h1>
          <p className="auth-sub">
            {step === 1 && 'We will send a one-time code to confirm it is you'}
            {step === 2 && `Enter the code we sent to ${sentTo}`}
            {step === 3 && 'Choose a new password'}
            {step === 4 && 'You can now sign in with your new password'}
          </p>
        </div>

        <div className="auth-body">
          {error && (
            <div style={{ marginBottom: 'var(--s-4)' }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          {step === 1 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                requestCode();
              }}
              noValidate
            >
              <Field label="Email or phone number" htmlFor="ident">
                <Input
                  id="ident"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setError(null);
                  }}
                  placeholder="you@example.com or 0754 000 000"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                />
              </Field>
              <Button type="submit" variant="primary" block loading={busy}>
                Send code
              </Button>
              <div className="auth-foot">
                Remembered it? <Link to="/login">Back to log in</Link>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verifyCode();
              }}
              noValidate
            >
              <div
                className="otp-row"
                style={{ marginBottom: 'var(--s-4)' }}
                onPaste={(e) => {
                  const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
                  if (text.length) {
                    e.preventDefault();
                    setOtp(text.padEnd(6, '').split('').slice(0, 6));
                  }
                }}
              >
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    className="otp-box"
                    value={digit}
                    onChange={(e) => onOtpChange(i, e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Backspace' && !otp[i] && i > 0 && otpRefs.current[i - 1]?.focus()
                    }
                    inputMode="numeric"
                    maxLength={1}
                    aria-label={`Digit ${i + 1}`}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              <div
                style={{
                  textAlign: 'center',
                  marginBottom: 'var(--s-5)',
                  fontSize: 'var(--t-sm)',
                  color: 'var(--text-3)',
                }}
              >
                {resendIn > 0 ? (
                  `Resend available in ${resendIn}s`
                ) : (
                  <button type="button" onClick={requestCode} style={{ color: 'var(--teal)', fontWeight: 600 }}>
                    Resend code
                  </button>
                )}
              </div>

              <Button type="submit" variant="primary" block loading={busy} disabled={otp.join('').length !== 6}>
                Verify code
              </Button>
            </form>
          )}

          {step === 3 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                resetPassword();
              }}
              noValidate
            >
              <Field
                label="New password"
                hint="At least 8 characters, with a number and a capital letter"
                htmlFor="np"
              >
                <PasswordInput
                  id="np"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="New password"
                  autoComplete="new-password"
                  autoFocus
                />
              </Field>
              <Button type="submit" variant="primary" block loading={busy}>
                Save new password
              </Button>
            </form>
          )}

          {step === 4 && (
            <div className="success-block">
              <div className="success-ring">
                <Icon name="check" size={30} strokeWidth={2.6} />
              </div>
              <div className="success-title">All done</div>
              <div className="success-text">
                Your password has been changed and every other session was signed out.
              </div>
              <Button variant="primary" block onClick={() => navigate('/login')}>
                Go to log in
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
