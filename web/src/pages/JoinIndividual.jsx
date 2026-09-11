import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import { Banner, Button, CopyField, Field, Input, PasswordInput } from '../components/UI.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../app/AuthContext.jsx';
import { useDebounced } from '../hooks/useApi.js';
import '../styles/public.css';

/**
 * Three steps, per PRD 2.2:
 *   1. Personal details
 *   2. Choose a permanent referral code (checked live)
 *   3. Verify the phone by OTP, which creates the account
 *
 * Each step validates before it lets the user move on, so nobody reaches the
 * end and discovers a problem with something they typed three screens ago.
 */
export default function JoinIndividual() {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    whatsapp_number: '',
    password: '',
    referral_code: '',
  });
  const [sameWhatsapp, setSameWhatsapp] = useState(true);

  const [codeState, setCodeState] = useState({ checking: false, available: null, reason: null, link: null });
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpMeta, setOtpMeta] = useState(null);
  const [resendIn, setResendIn] = useState(0);
  const [result, setResult] = useState(null);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((fe) => ({ ...fe, [key]: null }));
    setError(null);
  };

  /* ---------- step 1 ---------- */
  const validateStep1 = () => {
    const errs = {};
    if (form.first_name.trim().length < 2) errs.first_name = 'Enter your first name';
    if (form.last_name.trim().length < 2) errs.last_name = 'Enter your last name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()))
      errs.email = 'Enter a valid email address';

    const digits = form.phone.replace(/\D/g, '');
    if (!/^(255|0)?[67]\d{8}$/.test(digits))
      errs.phone = 'Enter a Tanzanian mobile number, e.g. 0754 000 000';

    if (!sameWhatsapp) {
      const wd = form.whatsapp_number.replace(/\D/g, '');
      if (!/^(255|0)?[67]\d{8}$/.test(wd)) errs.whatsapp_number = 'Enter a valid WhatsApp number';
    }

    if (form.password.length < 8) errs.password = 'At least 8 characters';
    else if (!/[0-9]/.test(form.password)) errs.password = 'Include at least one number';
    else if (!/[A-Z]/.test(form.password)) errs.password = 'Include at least one capital letter';

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /* ---------- step 2: live code availability ---------- */
  const debouncedCode = useDebounced(form.referral_code, 420);

  useEffect(() => {
    const code = debouncedCode.trim().toUpperCase();
    if (step !== 2 || code.length < 4) {
      setCodeState({ checking: false, available: null, reason: null, link: null });
      return undefined;
    }
    let cancelled = false;
    setCodeState((s) => ({ ...s, checking: true }));
    api
      .get(`/auth/check-code/${encodeURIComponent(code)}`)
      .then((d) => {
        if (cancelled) return;
        setCodeState({
          checking: false,
          available: d.available,
          reason: d.reason,
          link: d.preview_link,
        });
      })
      .catch(() => {
        if (!cancelled) setCodeState({ checking: false, available: null, reason: null, link: null });
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedCode, step]);

  /* ---------- step 3: OTP ---------- */
  const otpRefs = useRef([]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendOtp = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/request-otp', {
        phone: form.phone.trim(),
        purpose: 'signup',
      });
      setOtpMeta(res);
      setResendIn(res.resend_after_seconds || 60);
      setStep(3);
      // In development the API echoes the code so the flow works without SMS.
      if (res.dev_code) setOtp(String(res.dev_code).split(''));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [form.phone]);

  const onOtpChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    setError(null);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const onOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const onOtpPaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (text.length) {
      e.preventDefault();
      setOtp(text.padEnd(6, '').split('').slice(0, 6));
      otpRefs.current[Math.min(text.length, 5)]?.focus();
    }
  };

  const completeSignup = async () => {
    const code = otp.join('');
    if (code.length !== 6) return setError('Enter the 6-digit code');

    setBusy(true);
    setError(null);
    try {
      const verified = await api.post('/auth/verify-otp', {
        phone: form.phone.trim(),
        code,
        purpose: 'signup',
      });
      const session = await api.post('/auth/register/individual', {
        ...form,
        whatsapp_number: sameWhatsapp ? form.phone : form.whatsapp_number,
        referral_code: form.referral_code.trim().toUpperCase(),
        temp_token: verified.temp_token,
      });
      setResult(session);
      adoptSession(session);
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return null;
  };

  const strength = passwordStrength(form.password);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <Link to="/" style={{ display: 'inline-block' }}>
            <Logo height={26} />
          </Link>
          <h1 className="auth-title">
            {step === 4 ? 'You are all set' : 'Create your account'}
          </h1>
          <p className="auth-sub">
            {step === 1 && 'A few details to get started'}
            {step === 2 && 'Choose the code you will share'}
            {step === 3 && `Enter the code we sent to ${form.phone}`}
            {step === 4 && 'Your referral code is live'}
          </p>
        </div>

        <div className="auth-body">
          {step < 4 && (
            <div className="step-dots">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`step-dot ${step === s ? 'on' : step > s ? 'done' : ''}`}
                />
              ))}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 'var(--s-4)' }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          {/* ---------- STEP 1 ---------- */}
          {step === 1 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (validateStep1()) setStep(2);
              }}
              noValidate
            >
              <div className="field-row">
                <Field label="First name" error={fieldErrors.first_name} htmlFor="fn">
                  <Input
                    id="fn"
                    value={form.first_name}
                    onChange={set('first_name')}
                    placeholder="Amina"
                    error={fieldErrors.first_name}
                    autoComplete="given-name"
                    autoFocus
                  />
                </Field>
                <Field label="Last name" error={fieldErrors.last_name} htmlFor="ln">
                  <Input
                    id="ln"
                    value={form.last_name}
                    onChange={set('last_name')}
                    placeholder="Hassan"
                    error={fieldErrors.last_name}
                    autoComplete="family-name"
                  />
                </Field>
              </div>

              <Field
                label="Email address"
                error={fieldErrors.email}
                hint="We send receipts and account notices here"
                htmlFor="em"
              >
                <Input
                  id="em"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="amina@example.com"
                  error={fieldErrors.email}
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </Field>

              <Field
                label="Phone number"
                error={fieldErrors.phone}
                hint="You will log in with this number and receive commissions on it"
                htmlFor="ph"
              >
                <Input
                  id="ph"
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="0754 000 000"
                  error={fieldErrors.phone}
                  autoComplete="tel"
                  inputMode="tel"
                />
              </Field>

              <label className="checkbox-row" style={{ marginBottom: 'var(--s-4)' }}>
                <input
                  type="checkbox"
                  checked={sameWhatsapp}
                  onChange={(e) => setSameWhatsapp(e.target.checked)}
                />
                <span className="checkbox-label">
                  This is also my WhatsApp number for commission alerts
                </span>
              </label>

              {!sameWhatsapp && (
                <Field label="WhatsApp number" error={fieldErrors.whatsapp_number} htmlFor="wa">
                  <Input
                    id="wa"
                    type="tel"
                    value={form.whatsapp_number}
                    onChange={set('whatsapp_number')}
                    placeholder="0754 000 000"
                    error={fieldErrors.whatsapp_number}
                    inputMode="tel"
                  />
                </Field>
              )}

              <Field label="Password" error={fieldErrors.password} htmlFor="pw">
                <PasswordInput
                  id="pw"
                  value={form.password}
                  onChange={set('password')}
                  placeholder="At least 8 characters"
                  error={fieldErrors.password}
                  autoComplete="new-password"
                />
                {form.password && (
                  <>
                    <div className="strength">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className={`strength-bar ${i < strength.score ? `on-${strength.tone}` : ''}`}
                        />
                      ))}
                    </div>
                    <div className="field-hint">{strength.label}</div>
                  </>
                )}
              </Field>

              <Button type="submit" variant="primary" block iconRight="arrow-right">
                Continue
              </Button>

              <div className="auth-foot">
                Already have an account? <Link to="/login">Log in</Link>
              </div>
            </form>
          )}

          {/* ---------- STEP 2 ---------- */}
          {step === 2 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (codeState.available) sendOtp();
              }}
              noValidate
            >
              <Field
                label="Your referral code"
                hint="4 to 10 letters or numbers. This is permanent and cannot be changed later."
                htmlFor="code"
              >
                <div className="input-group">
                  <Input
                    id="code"
                    value={form.referral_code}
                    onChange={(e) =>
                      set('referral_code')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
                    }
                    placeholder="AMINA07"
                    style={{ letterSpacing: '0.14em', fontWeight: 700, paddingRight: 44 }}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck="false"
                    autoFocus
                  />
                  <div className="input-suffix">
                    {codeState.checking && <span className="btn-spinner" style={{ color: 'var(--gray-400)' }} />}
                    {!codeState.checking && codeState.available === true && (
                      <Icon name="check-circle" size={18} style={{ color: 'var(--green)' }} />
                    )}
                    {!codeState.checking && codeState.available === false && (
                      <Icon name="alert-circle" size={18} style={{ color: 'var(--red)' }} />
                    )}
                  </div>
                </div>
              </Field>

              {codeState.available === false && codeState.reason && (
                <div style={{ marginTop: -8, marginBottom: 'var(--s-4)' }}>
                  <div className="field-error">
                    <Icon name="alert-circle" size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>{codeState.reason}</span>
                  </div>
                </div>
              )}

              {codeState.available && codeState.link && (
                <div style={{ marginBottom: 'var(--s-5)' }}>
                  <div className="label">Your referral link will be</div>
                  <CopyField value={codeState.link} label="Link" />
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={!codeState.available}
                iconRight="arrow-right"
              >
                Continue
              </Button>

              <Button
                type="button"
                variant="ghost"
                block
                onClick={() => setStep(1)}
                style={{ marginTop: 8 }}
              >
                Back
              </Button>
            </form>
          )}

          {/* ---------- STEP 3 ---------- */}
          {step === 3 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                completeSignup();
              }}
              noValidate
            >
              <div style={{ marginBottom: 'var(--s-5)' }}>
                <Banner tone="info">
                  We sent a 6-digit code to <strong>{form.phone}</strong>. It expires in 5 minutes.
                </Banner>
              </div>

              <div className="otp-row" onPaste={onOtpPaste} style={{ marginBottom: 'var(--s-3)' }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    className="otp-box"
                    value={digit}
                    onChange={(e) => onOtpChange(i, e.target.value)}
                    onKeyDown={(e) => onOtpKeyDown(i, e)}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    aria-label={`Digit ${i + 1}`}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              <div style={{ textAlign: 'center', marginBottom: 'var(--s-5)', fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                {resendIn > 0 ? (
                  `Resend available in ${resendIn}s`
                ) : (
                  <button type="button" onClick={sendOtp} style={{ color: 'var(--teal)', fontWeight: 600 }}>
                    Resend code
                  </button>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={otp.join('').length !== 6}
              >
                Verify and create my account
              </Button>

              <Button
                type="button"
                variant="ghost"
                block
                onClick={() => setStep(2)}
                style={{ marginTop: 8 }}
              >
                Change details
              </Button>
            </form>
          )}

          {/* ---------- STEP 4 ---------- */}
          {step === 4 && result && (
            <div className="success-block">
              <div className="success-ring">
                <Icon name="check" size={30} strokeWidth={2.6} />
              </div>
              <div className="success-title">Welcome, {form.first_name}!</div>
              <div className="success-text">
                Your code is live. Share it anywhere and start earning on every purchase.
              </div>

              <div className="code-reveal">
                <div className="code-reveal-label">Your referral code</div>
                <div className="code-reveal-value">{result.referral_code}</div>
              </div>

              <div style={{ textAlign: 'left', marginBottom: 'var(--s-5)' }}>
                <div className="label">Your referral link</div>
                <CopyField value={result.referral_link} label="Link" />
              </div>

              <Button
                variant="primary"
                block
                iconRight="arrow-right"
                onClick={() => navigate('/app', { replace: true })}
              >
                Go to my dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function passwordStrength(password) {
  if (!password) return { score: 0, tone: 'weak', label: '' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[0-9]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (password.length >= 12 && /[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return { score: 1, tone: 'weak', label: 'Needs a number and a capital letter' };
  if (score === 2) return { score: 2, tone: 'ok', label: 'Good — a longer password is stronger' };
  return { score: 3, tone: 'good', label: 'Strong password' };
}
