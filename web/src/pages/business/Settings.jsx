import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  CopyField,
  Field,
  Input,
  Loading,
  Modal,
  PasswordInput,
  Select,
} from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, relative, tzs } from '../../lib/format.js';

/** Business configuration, API key and team access (PRD 4.7). */
export default function BusinessSettings() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/business/me/settings');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  useEffect(() => {
    if (data)
      setForm({
        commission_rate: String(data.business.commission_rate * 100),
        wallet_alert_threshold_tzs: String(data.business.wallet_alert_threshold_tzs),
        notification_email: data.business.notification_email || '',
        website: data.business.website || '',
      });
  }, [data]);

  if (loading && !data) return <Loading label="Loading settings" />;
  if (!data || !form) return null;

  const readOnly = data.my_access === 'read_only';

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/business/me/settings', {
        commission_rate: Number(form.commission_rate) / 100,
        wallet_alert_threshold_tzs: Number(form.wallet_alert_threshold_tzs),
        notification_email: form.notification_email,
        website: form.website,
      });
      toast.success('Settings saved');
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    try {
      const res = await api.post('/business/me/api-key/regenerate');
      setNewKey(res.api_key);
      setRegenOpen(false);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeMember = async () => {
    try {
      await api.del(`/business/me/team/${removeTarget.id}`);
      toast.success('Team member removed');
      setRemoveTarget(null);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeAccess = async (member, access) => {
    try {
      await api.put(`/business/me/team/${member.id}`, { access });
      toast.success('Access updated');
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="stack">
      {readOnly && (
        <Banner tone="info" title="Read-only access">
          You can view these settings but not change them. Ask the account owner for full access.
        </Banner>
      )}

      {/* Programme settings */}
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Programme settings</div>
            <div className="card-subtitle">Applies to every partner referring to your business</div>
          </div>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          <div className="field-row">
            <Field
              label="Commission rate"
              hint="Share of each purchase paid to the referring partner"
            >
              <div className="input-group">
                <Input
                  value={form.commission_rate}
                  onChange={(e) =>
                    setForm({ ...form, commission_rate: e.target.value.replace(/[^0-9.]/g, '') })
                  }
                  inputMode="decimal"
                  disabled={readOnly}
                  style={{ paddingLeft: 14, paddingRight: 40 }}
                />
                <div className="input-suffix">
                  <span style={{ color: 'var(--text-3)', fontWeight: 600, paddingRight: 4 }}>%</span>
                </div>
              </div>
            </Field>

            <Field label="Low balance alert" hint="You are notified below this balance">
              <div className="input-group">
                <span className="input-prefix">TZS</span>
                <Input
                  value={Number(form.wallet_alert_threshold_tzs || 0).toLocaleString('en-US')}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      wallet_alert_threshold_tzs: e.target.value.replace(/\D/g, ''),
                    })
                  }
                  inputMode="numeric"
                  disabled={readOnly}
                />
              </div>
            </Field>
          </div>

          <Field label="Notification email" hint="Receives wallet alerts and programme reports">
            <Input
              type="email"
              value={form.notification_email}
              onChange={(e) => setForm({ ...form, notification_email: e.target.value })}
              disabled={readOnly}
              autoCapitalize="none"
            />
          </Field>

          <Field label="Website">
            <Input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              disabled={readOnly}
              placeholder="thetravela.com"
            />
          </Field>

          {!readOnly && (
            <Button variant="primary" onClick={save} loading={saving}>
              Save settings
            </Button>
          )}
        </div>
      </Card>

      {/* API key */}
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">API key</div>
            <div className="card-subtitle">
              Your website uses this to register referrals and report payments
            </div>
          </div>
          {!readOnly && (
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => setRegenOpen(true)}>
              Regenerate
            </Button>
          )}
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          {data.api_key.masked ? (
            <>
              <div className="copy-field" style={{ marginBottom: 'var(--s-3)' }}>
                <code>{data.api_key.masked}</code>
                <Badge tone="green" dot>
                  Active
                </Badge>
              </div>
              <div className="field-hint">
                Last rotated {data.api_key.rotated_at ? relative(data.api_key.rotated_at) : 'never'}.
                The full key is shown only once, at creation.
              </div>
            </>
          ) : (
            <Banner tone="warn">No API key has been issued. Contact Pazo to set one up.</Banner>
          )}

          <div className="divider" />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span className="row-icon teal">
              <Icon name="code" size={17} />
            </span>
            <div style={{ fontSize: 'var(--t-base)', color: 'var(--text-2)', lineHeight: 1.65 }}>
              Your developer needs two endpoints: one to register a referral at signup, one to report
              a confirmed payment. Both are documented at{' '}
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                /api/v1/integrations/docs
              </code>
              .
            </div>
          </div>
        </div>
      </Card>

      {/* Team */}
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Team members</div>
            <div className="card-subtitle">Who can see this dashboard</div>
          </div>
          {data.team.some((t) => t.is_owner) && !readOnly && (
            <Button variant="secondary" size="sm" icon="user-plus" onClick={() => setAddOpen(true)}>
              Add member
            </Button>
          )}
        </div>
        <div style={{ padding: '0 var(--s-5)' }}>
          {data.team.map((m) => (
            <div className="row-item" key={m.id}>
              <Avatar name={m.name} size="md" userId={m.user_id} />
              <div className="row-body">
                <div className="row-title">{m.name}</div>
                <div className="row-sub">
                  {m.email} · {m.last_login_at ? `Last seen ${relative(m.last_login_at)}` : 'Never signed in'}
                </div>
              </div>
              {m.is_owner ? (
                <Badge tone="teal">Owner</Badge>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Select
                    value={m.access}
                    onChange={(e) => changeAccess(m, e.target.value)}
                    disabled={readOnly}
                    style={{ width: 'auto', fontSize: 'var(--t-sm)', padding: '6px 30px 6px 10px' }}
                  >
                    <option value="full">Full access</option>
                    <option value="read_only">Read only</option>
                  </Select>
                  {!readOnly && (
                    <button
                      className="icon-btn"
                      onClick={() => setRemoveTarget(m)}
                      aria-label={`Remove ${m.name}`}
                      style={{ color: 'var(--red)' }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        onConfirm={regenerate}
        title="Regenerate the API key?"
        message="The current key stops working immediately. Your website will not be able to register referrals or report payments until the new key is deployed."
        confirmLabel="Regenerate key"
        tone="danger"
      />

      <Modal
        open={!!newKey}
        onClose={() => setNewKey(null)}
        title="Your new API key"
        subtitle="Copy it now — it cannot be shown again"
        width="wide"
        footer={
          <Button variant="primary" onClick={() => setNewKey(null)}>
            I have saved it
          </Button>
        }
      >
        <Banner tone="warn" title="Shown once">
          Pazo stores only a hash of this key. If you lose it you will have to regenerate again.
        </Banner>
        <div style={{ marginTop: 'var(--s-5)' }}>
          <CopyField value={newKey || ''} label="API key" />
        </div>
      </Modal>

      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          reload({ quiet: true });
          toast.success('Team member added');
        }}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={removeMember}
        title={`Remove ${removeTarget?.name}?`}
        message="They lose access to this dashboard immediately and are signed out of any active session."
        confirmLabel="Remove member"
        tone="danger"
      />
    </div>
  );
}

function AddMemberModal({ open, onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', access: 'full' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', password: '', access: 'full' });
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/business/me/team', form);
      onAdded();
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
      title="Add a team member"
      subtitle="They sign in with the email and password you set here"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Add member
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Full name">
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Joseph Mtei"
          autoFocus
        />
      </Field>
      <Field label="Email address">
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="joseph@thetravela.com"
          autoCapitalize="none"
        />
      </Field>
      <Field label="Temporary password" hint="At least 8 characters, with a number and a capital letter">
        <PasswordInput
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
      <Field label="Access level">
        <Select value={form.access} onChange={(e) => setForm({ ...form, access: e.target.value })}>
          <option value="full">Full access — can change settings</option>
          <option value="read_only">Read only — can view everything</option>
        </Select>
      </Field>
    </Modal>
  );
}
