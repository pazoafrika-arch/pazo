import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  DetailList,
  Field,
  Input,
  Loading,
  Modal,
  Select,
} from '../../components/UI.jsx';
import { AvatarUpload } from '../../components/AvatarUpload.jsx';
import { EditableRow } from '../../components/EditableRow.jsx';
import { ChangePasswordModal } from '../individual/Profile.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { date, phone as fmtPhone, ratePct } from '../../lib/format.js';

export default function InstitutionProfile() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/institution/me');
  const { user: authUser, patchUser } = useAuth();

  /** Save one field from an inline row. */
  const save = async (patch) => {
    await api.put('/institution/me', patch);
    if (patch.organisation_name) patchUser({ name: patch.organisation_name });
    reload({ quiet: true });
    toast.success('Saved');
  };
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (loading && !data) return <Loading label="Loading your profile" />;
  if (!data) return null;

  const { user, profile, partner } = data;

  return (
    <div className="stack">
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-5)', flexWrap: 'wrap' }}>
          <AvatarUpload
            user={{ ...user, name: profile.organisation_name, has_avatar: authUser?.has_avatar }}
            size={88}
            label="Organisation logo"
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
              {profile.organisation_name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
              <Badge tone="teal">{partner.referral_code}</Badge>
              {profile.industry_type && <Badge tone="gray">{profile.industry_type}</Badge>}
              <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                Partner since {date(user.member_since)}
              </span>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Tap the logo to upload your own
            </div>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Organisation details</div>
            <div className="card-subtitle">Tap any row to change it</div>
          </div>
        </div>
        <div style={{ padding: '0 var(--s-5)' }}>
          <EditableRow
            label="Organisation"
            value={profile.organisation_name}
            onSave={(v) => save({ organisation_name: v })}
            validate={(v) => (v.trim().length < 2 ? 'Enter your organisation name' : null)}
          />
          <EditableRow
            label="Contact person"
            value={profile.contact_person_name}
            onSave={(v) => save({ contact_person_name: v })}
            validate={(v) => (v.trim().length < 2 ? 'Enter a contact person' : null)}
          />
          <EditableRow
            label="Contact email"
            value={user.email}
            type="email"
            onSave={(v) => save({ email: v })}
            validate={(v) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : 'Enter a valid email address'
            }
          />
          <EditableRow
            label="Contact phone"
            value={fmtPhone(profile.contact_phone)}
            editValue={profile.contact_phone}
            type="tel"
            onSave={(v) => save({ contact_phone: v })}
            validate={(v) =>
              /^(255|0)?[67]\d{8}$/.test(v.replace(/\D/g, '')) ? null : 'Enter a valid Tanzanian number'
            }
          />
          <EditableRow label="Industry" value={profile.industry_type} readOnly />
          <EditableRow
            label="Commission rate"
            value={ratePct(partner.commission_rate)}
            readOnly
            hint="Set by the business running the programme"
          />
        </div>
      </Card>

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Payout account</div>
            <div className="card-subtitle">Where your monthly payout is sent</div>
          </div>
          <Button variant="ghost" size="sm" icon="edit" onClick={() => setPayoutOpen(true)}>
            Change
          </Button>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="row-icon teal">
              <Icon name={profile.payout_method === 'bank' ? 'building' : 'smartphone'} size={17} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                {profile.payout_account_masked || 'Not set'}
              </div>
              <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                {profile.payout_method === 'bank'
                  ? `${profile.payout_bank_name || 'Bank'} · Paid on the 1st`
                  : 'Mobile money · Paid on the 1st'}
              </div>
            </div>
            {profile.payout_account_verified ? (
              <Badge tone="green" dot>
                Verified
              </Badge>
            ) : (
              <Badge tone="amber">Pending verification</Badge>
            )}
          </div>

          {!profile.payout_account_verified && (
            <div style={{ marginTop: 'var(--s-4)' }}>
              <Banner tone="warn">
                Pazo is verifying this account. Your next payout goes out once verification is
                complete.
              </Banner>
            </div>
          )}
        </div>
      </Card>

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
              Permanent. Every referral your organisation has made stays linked to this code.
            </div>
          </div>
        </div>
      </Card>

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


      <PayoutModal
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        profile={profile}
        onSaved={() => {
          setPayoutOpen(false);
          reload({ quiet: true });
          toast.success('Payout account submitted for verification');
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
    </div>
  );
}

function PayoutModal({ open, onClose, profile, onSaved }) {
  const [form, setForm] = useState({ payout_method: 'bank', payout_account: '', payout_bank_name: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        payout_method: profile.payout_method || 'bank',
        payout_account: '',
        payout_bank_name: profile.payout_bank_name || '',
      });
      setError(null);
    }
  }, [open, profile]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/institution/me/payout-request', form);
      onSaved();
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
      title="Change payout account"
      subtitle="Pazo verifies the new account before your next payout"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Submit for verification
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Payout method">
        <Select
          value={form.payout_method}
          onChange={(e) => setForm({ ...form, payout_method: e.target.value })}
        >
          <option value="bank">Bank transfer</option>
          <option value="mobile_money">Mobile money</option>
        </Select>
      </Field>
      {form.payout_method === 'bank' && (
        <Field label="Bank name">
          <Input
            value={form.payout_bank_name}
            onChange={(e) => setForm({ ...form, payout_bank_name: e.target.value })}
            placeholder="CRDB Bank"
          />
        </Field>
      )}
      <Field
        label={form.payout_method === 'bank' ? 'Account number' : 'Mobile money number'}
        hint="Enter the full account details"
      >
        <Input
          value={form.payout_account}
          onChange={(e) => setForm({ ...form, payout_account: e.target.value })}
          placeholder={form.payout_method === 'bank' ? '0152847391200' : '0754 000 000'}
          autoFocus
        />
      </Field>
      <Banner tone="info">
        Your current account stays active until Pazo confirms the new one.
      </Banner>
    </Modal>
  );
}
