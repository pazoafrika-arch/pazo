import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  DetailList,
  Field,
  Input,
  Loading,
  Modal,
  PasswordInput,
} from '../../components/UI.jsx';
import { AvatarUpload } from '../../components/AvatarUpload.jsx';
import { EditableRow } from '../../components/EditableRow.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { date, phone as fmtPhone } from '../../lib/format.js';

export default function IndividualProfile() {
  const toast = useToast();
  const navigate = useNavigate();
  const { signOut, patchUser, user: authUser } = useAuth();
  const { data, loading, reload } = useApi('/individual/me');

  /**
   * Save one field. Used by every inline row, so a single failure path and a
   * single success toast cover the whole screen.
   */
  const save = async (patch) => {
    const res = await api.put('/individual/me', patch);
    if (res?.name) patchUser({ name: res.name });
    reload({ quiet: true });
    toast.success('Saved');
  };

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  if (loading && !data) return <Loading label="Loading your profile" />;
  if (!data) return null;

  const { user, profile, partner } = data;

  const closeAccount = async () => {
    setClosing(true);
    try {
      await api.del('/individual/me');
      toast.success('Your account has been closed');
      await signOut({ notifyServer: false });
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setClosing(false);
    }
  };

  return (
    <div className="stack">
      {/* Identity */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-5)', flexWrap: 'wrap' }}>
          <AvatarUpload
            user={{ ...user, has_avatar: authUser?.has_avatar }}
            size={88}
            onChanged={(patch) => {
              patchUser(patch);
              reload({ quiet: true });
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 'var(--t-xl)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--navy)',
              }}
            >
              {user.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Badge tone="teal">{partner.referral_code}</Badge>
              <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                Partner since {date(user.member_since)}
              </span>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Tap your picture to change it
            </div>
          </div>
        </div>
      </Card>

      {/* Personal details — each row edits in place */}
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Personal information</div>
            <div className="card-subtitle">Tap any row to change it</div>
          </div>
        </div>
        <div style={{ padding: '0 var(--s-5)' }}>
          <EditableRow
            label="First name"
            value={profile.first_name}
            onSave={(v) => save({ first_name: v })}
            validate={(v) => (v.trim().length < 2 ? 'Enter your first name' : null)}
          />
          <EditableRow
            label="Last name"
            value={profile.last_name}
            onSave={(v) => save({ last_name: v })}
            validate={(v) => (v.trim().length < 2 ? 'Enter your last name' : null)}
          />
          <EditableRow
            label="Email address"
            value={user.email}
            type="email"
            onSave={(v) => save({ email: v })}
            validate={(v) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : 'Enter a valid email address'
            }
          />
          <EditableRow
            label="WhatsApp number"
            value={fmtPhone(profile.whatsapp_number)}
            editValue={profile.whatsapp_number}
            type="tel"
            hint="Where commission alerts are sent"
            onSave={(v) => save({ whatsapp_number: v })}
            validate={(v) =>
              /^(255|0)?[67]\d{8}$/.test(v.replace(/\D/g, '')) ? null : 'Enter a valid Tanzanian number'
            }
          />
          <EditableRow
            label="Login phone"
            value={fmtPhone(user.phone)}
            readOnly
            action={{ label: 'Change', onClick: () => setPhoneOpen(true) }}
            hint="Changing this needs a code sent to the new number"
          />
        </div>
      </Card>

      {/* Payout account */}
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Withdrawal account</div>
            <div className="card-subtitle">Where your commissions are sent</div>
          </div>
          <Button variant="ghost" size="sm" icon="edit" onClick={() => setPayoutOpen(true)}>
            Change
          </Button>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          {profile.mobile_money_number ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="row-icon teal">
                <Icon name="smartphone" size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                  {profile.mobile_money_masked}
                </div>
                <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                  Mobile money · Instant payouts
                </div>
              </div>
              {profile.mobile_money_verified ? (
                <Badge tone="green" dot>
                  Verified
                </Badge>
              ) : (
                <Badge tone="amber">Unverified</Badge>
              )}
            </div>
          ) : (
            <Banner tone="warn" title="No payout account">
              Add a mobile money number to withdraw your earnings.
            </Banner>
          )}
        </div>
      </Card>

      {/* Referral code — permanent */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="row-icon gray">
            <Icon name="lock" size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              Referral code: {partner.referral_code}
            </div>
            <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', lineHeight: 1.5 }}>
              This code is permanent and cannot be changed. It keeps every referral you have ever
              made linked to you.
            </div>
          </div>
        </div>
      </Card>

      {/* Security */}
      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">Security</div>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          <Button variant="secondary" icon="key" onClick={() => setPasswordOpen(true)}>
            Change password
          </Button>
        </div>
      </Card>

      {/* Danger zone */}
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Close account</div>
            <div className="card-subtitle">
              Your personal details are removed within 30 days. Transaction records are kept for
              audit.
            </div>
          </div>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          <Button variant="danger-ghost" icon="trash" onClick={() => setCloseOpen(true)}>
            Close my account
          </Button>
        </div>
      </Card>

      <OtpChangeModal
        open={phoneOpen}
        onClose={() => setPhoneOpen(false)}
        title="Change your login phone"
        subtitle="We will send a code to the new number to confirm it is yours"
        label="New phone number"
        requestPath="/individual/me/phone/request-otp"
        confirmPath="/individual/me/phone/confirm"
        payloadKey="phone"
        onDone={() => {
          setPhoneOpen(false);
          reload({ quiet: true });
          toast.success('Phone number updated');
        }}
      />

      <OtpChangeModal
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        title="Change your withdrawal account"
        subtitle="We will send a code to the new number to confirm it is yours"
        label="Mobile money number"
        requestPath="/individual/me/payout/request-otp"
        confirmPath="/individual/me/payout/confirm"
        payloadKey="mobile_money_number"
        onDone={() => {
          setPayoutOpen(false);
          reload({ quiet: true });
          toast.success('Withdrawal account updated');
        }}
      />

      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => {
          setPasswordOpen(false);
          toast.success('Password changed');
        }}
      />

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={closeAccount}
        loading={closing}
        title="Close your Pazo account?"
        message="You will be signed out and will no longer earn commissions. Withdraw any remaining balance first. This cannot be undone."
        confirmLabel="Close my account"
        tone="danger"
      />
    </div>
  );
}

/**
 * Two-step change for anything that moves money or grants access:
 * enter the new value, then confirm with a code sent to it.
 */
function OtpChangeModal({
  open,
  onClose,
  title,
  subtitle,
  label,
  requestPath,
  confirmPath,
  payloadKey,
  onDone,
}) {
  const [step, setStep] = useState(1);
  const [value, setValue] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const refs = useRef([]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setValue('');
      setOtp(['', '', '', '', '', '']);
      setError(null);
    }
  }, [open]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(requestPath, { [payloadKey]: value });
      if (res.dev_code) setOtp(String(res.dev_code).split(''));
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(confirmPath, { [payloadKey]: value, code: otp.join('') });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={step === 1 ? subtitle : `Enter the code we sent to ${value}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {step === 1 ? (
            <Button variant="primary" onClick={requestCode} loading={busy} disabled={value.length < 9}>
              Send code
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={confirm}
              loading={busy}
              disabled={otp.join('').length !== 6}
            >
              Confirm
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {step === 1 ? (
        <Field label={label}>
          <Input
            type="tel"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="0754 000 000"
            inputMode="tel"
            autoFocus
          />
        </Field>
      ) : (
        <div
          className="otp-row"
          onPaste={(e) => {
            const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
            if (text.length) {
              e.preventDefault();
              setOtp(text.padEnd(6, '').split('').slice(0, 6));
            }
          }}
        >
          {otp.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="otp-box"
              value={d}
              onChange={(e) => {
                const digit = e.target.value.replace(/\D/g, '').slice(-1);
                const next = [...otp];
                next[i] = digit;
                setOtp(next);
                setError(null);
                if (digit && i < 5) refs.current[i + 1]?.focus();
              }}
              onKeyDown={(e) =>
                e.key === 'Backspace' && !otp[i] && i > 0 && refs.current[i - 1]?.focus()
              }
              inputMode="numeric"
              maxLength={1}
              aria-label={`Digit ${i + 1}`}
              autoFocus={i === 0}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- change password ---------------- */
export function ChangePasswordModal({ open, onClose, onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Change password
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Current password">
        <PasswordInput
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
      </Field>
      <Field label="New password" hint="At least 8 characters, with a number and a capital letter">
        <PasswordInput
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
    </Modal>
  );
}
