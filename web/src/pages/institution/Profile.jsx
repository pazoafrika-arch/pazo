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
import { ChangePasswordModal } from '../individual/Profile.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, phone as fmtPhone, ratePct } from '../../lib/format.js';

export default function InstitutionProfile() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/institution/me');
  const [editOpen, setEditOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (loading && !data) return <Loading label="Loading your profile" />;
  if (!data) return null;

  const { user, profile, partner } = data;

  return (
    <div className="stack">
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <Avatar name={profile.organisation_name} color={user.avatar_color} size="lg" square />
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
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">Organisation details</div>
          <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          <DetailList
            items={[
              { label: 'Organisation', value: profile.organisation_name },
              { label: 'Industry', value: profile.industry_type || '—' },
              { label: 'Contact person', value: profile.contact_person_name || '—' },
              { label: 'Contact email', value: user.email },
              { label: 'Contact phone', value: fmtPhone(profile.contact_phone) },
              { label: 'Commission rate', value: ratePct(partner.commission_rate) },
            ]}
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

      <EditOrgModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        data={data}
        onSaved={() => {
          setEditOpen(false);
          reload({ quiet: true });
          toast.success('Details updated');
        }}
      />

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

function EditOrgModal({ open, onClose, data, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && data) {
      setForm({
        organisation_name: data.profile.organisation_name || '',
        contact_person_name: data.profile.contact_person_name || '',
        contact_phone: data.profile.contact_phone || '',
        email: data.user.email || '',
      });
      setError(null);
    }
  }, [open, data]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/institution/me', form);
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
      title="Edit organisation details"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Organisation name">
        <Input
          value={form.organisation_name || ''}
          onChange={(e) => setForm({ ...form, organisation_name: e.target.value })}
        />
      </Field>
      <Field label="Contact person">
        <Input
          value={form.contact_person_name || ''}
          onChange={(e) => setForm({ ...form, contact_person_name: e.target.value })}
        />
      </Field>
      <Field label="Contact email">
        <Input
          type="email"
          value={form.email || ''}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          autoCapitalize="none"
        />
      </Field>
      <Field label="Contact phone">
        <Input
          type="tel"
          value={form.contact_phone || ''}
          onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
        />
      </Field>
    </Modal>
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
