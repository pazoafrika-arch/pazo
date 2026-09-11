import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CopyField,
  DetailList,
  EmptyState,
  Field,
  Input,
  Modal,
  SkeletonRows,
  Tabs,
  Textarea,
} from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, relative } from '../../lib/format.js';

/**
 * The institution approval queue (PRD 5.5). Approving creates the account,
 * the referral code and the welcome email in one action.
 */
export default function AdminApprovals() {
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [approveTarget, setApproveTarget] = useState(null);
  const [declineTarget, setDeclineTarget] = useState(null);
  const [created, setCreated] = useState(null);

  const list = useApi(`/admin/institutions/applications?status=${tab}&limit=50`, { deps: [tab] });
  const pendingCount = useApi('/admin/institutions/applications?status=pending&limit=1');

  return (
    <div className="stack">
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Organisation applications</div>
            <div className="card-subtitle">Reviewed within 24 hours of submission</div>
          </div>
        </div>

        <div style={{ padding: '0 var(--s-5)' }}>
          <Tabs
            tabs={[
              { value: 'pending', label: 'Pending', count: pendingCount.data?.total || 0 },
              { value: 'approved', label: 'Approved' },
              { value: 'declined', label: 'Declined' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5) var(--s-5)' }}>
          {list.loading && !list.data ? (
            <SkeletonRows count={3} />
          ) : !list.data?.items?.length ? (
            <EmptyState
              icon={tab === 'pending' ? 'check-circle' : 'inbox'}
              title={tab === 'pending' ? 'Nothing waiting' : `No ${tab} applications`}
              text={
                tab === 'pending'
                  ? 'Every organisation application has been reviewed.'
                  : undefined
              }
            />
          ) : (
            <div className="stack-sm">
              {list.data.items.map((a) => (
                <Card key={a.id} hoverable>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--s-4)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Avatar name={a.organisation_name} size="md" square color="#0f3460" />

                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div
                        style={{
                          fontSize: 'var(--t-md)',
                          fontWeight: 700,
                          color: 'var(--navy)',
                        }}
                      >
                        {a.organisation_name}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                        {a.industry_type && <Badge tone="gray">{a.industry_type}</Badge>}
                        <Badge status={a.status} />
                        <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                          Applied {relative(a.created_at)}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: 'var(--s-4)',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: 'var(--s-3)',
                          fontSize: 'var(--t-sm)',
                        }}
                      >
                        <div>
                          <div style={{ color: 'var(--text-3)' }}>Contact</div>
                          <div style={{ fontWeight: 600 }}>{a.contact_person_name}</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-3)' }}>Email</div>
                          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {a.contact_email}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-3)' }}>Phone</div>
                          <div style={{ fontWeight: 600 }}>{a.contact_phone || '—'}</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-3)' }}>Payout</div>
                          <div style={{ fontWeight: 600 }}>
                            {a.payout_bank_name ? `${a.payout_bank_name} ` : ''}
                            {a.payout_account || '—'}
                          </div>
                        </div>
                      </div>

                      {a.notes && (
                        <div
                          style={{
                            marginTop: 'var(--s-4)',
                            padding: 'var(--s-3)',
                            background: 'var(--surface-sunken)',
                            borderRadius: 'var(--r-sm)',
                            fontSize: 'var(--t-sm)',
                            color: 'var(--text-2)',
                            lineHeight: 1.6,
                          }}
                        >
                          {a.notes}
                        </div>
                      )}

                      {a.status === 'declined' && a.decline_reason && (
                        <div style={{ marginTop: 'var(--s-4)' }}>
                          <Banner tone="error" title="Declined">
                            {a.decline_reason}
                          </Banner>
                        </div>
                      )}
                    </div>

                    {a.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                          variant="teal"
                          size="sm"
                          icon="check"
                          onClick={() => setApproveTarget(a)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          icon="x"
                          onClick={() => setDeclineTarget(a)}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

      <ApproveModal
        application={approveTarget}
        onClose={() => setApproveTarget(null)}
        onApproved={(result) => {
          setApproveTarget(null);
          setCreated(result);
          list.reload({ quiet: true });
          pendingCount.reload({ quiet: true });
        }}
      />

      <DeclineModal
        application={declineTarget}
        onClose={() => setDeclineTarget(null)}
        onDeclined={() => {
          setDeclineTarget(null);
          list.reload({ quiet: true });
          pendingCount.reload({ quiet: true });
          toast.success('Application declined and the contact notified');
        }}
      />

      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Account created"
        subtitle="Share these credentials with the organisation"
        width="wide"
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        <Banner tone="success" title="Welcome email sent">
          The contact has been emailed their login details, referral code and link.
        </Banner>

        <div style={{ marginTop: 'var(--s-5)' }} className="stack-sm">
          <div>
            <div className="label">Login email</div>
            <CopyField value={created?.login_email || ''} label="Email" />
          </div>
          <div>
            <div className="label">Temporary password</div>
            <CopyField value={created?.temporary_password || ''} label="Password" />
          </div>
          <div>
            <div className="label">Referral code</div>
            <CopyField value={created?.referral_code || ''} label="Code" />
          </div>
          <div>
            <div className="label">Referral link</div>
            <CopyField value={created?.referral_link || ''} label="Link" mono={false} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ApproveModal({ application, onClose, onApproved }) {
  const [form, setForm] = useState({ referral_code: '', commission_rate_override: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [codeState, setCodeState] = useState(null);

  useEffect(() => {
    if (application) {
      // Suggest a code from the organisation name so admins rarely type one.
      const suggested = application.organisation_name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);
      setForm({ referral_code: suggested, commission_rate_override: '' });
      setError(null);
      setCodeState(null);
    }
  }, [application]);

  // Check availability whenever the code settles.
  useEffect(() => {
    const code = form.referral_code;
    if (!application || code.length < 4) {
      setCodeState(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .get(`/auth/check-code/${encodeURIComponent(code)}`)
        .then((d) => !cancelled && setCodeState(d))
        .catch(() => !cancelled && setCodeState(null));
    }, 380);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.referral_code, application]);

  if (!application) return null;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/admin/institutions/applications/${application.id}/approve`, {
        referral_code: form.referral_code,
        commission_rate_override: form.commission_rate_override
          ? Number(form.commission_rate_override) / 100
          : null,
      });
      onApproved(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!application}
      onClose={onClose}
      title="Approve and create the account"
      subtitle={application.organisation_name}
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="teal"
            onClick={approve}
            loading={busy}
            disabled={!codeState?.available}
          >
            Approve and create
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <DetailList
        items={[
          { label: 'Organisation', value: application.organisation_name },
          { label: 'Contact', value: application.contact_person_name },
          { label: 'Login email', value: application.contact_email },
          {
            label: 'Payout account',
            value: `${application.payout_bank_name || ''} ${application.payout_account || '—'}`.trim(),
          },
        ]}
      />

      <div style={{ marginTop: 'var(--s-5)' }}>
        <Field
          label="Referral code"
          hint="Permanent once created. 4 to 10 letters or numbers."
          error={codeState && !codeState.available ? codeState.reason : null}
        >
          <div className="input-group">
            <Input
              value={form.referral_code}
              onChange={(e) =>
                setForm({
                  ...form,
                  referral_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
                })
              }
              style={{ letterSpacing: '0.1em', fontWeight: 700, paddingRight: 44 }}
              error={codeState && !codeState.available}
              autoFocus
            />
            <div className="input-suffix">
              {codeState?.available === true && (
                <Icon name="check-circle" size={18} style={{ color: 'var(--green)' }} />
              )}
              {codeState?.available === false && (
                <Icon name="alert-circle" size={18} style={{ color: 'var(--red)' }} />
              )}
            </div>
          </div>
        </Field>

        <Field
          label="Custom commission rate"
          optional
          hint="Leave blank to inherit the business default"
        >
          <div className="input-group">
            <Input
              value={form.commission_rate_override}
              onChange={(e) =>
                setForm({
                  ...form,
                  commission_rate_override: e.target.value.replace(/[^0-9.]/g, ''),
                })
              }
              placeholder="8"
              inputMode="decimal"
              style={{ paddingLeft: 14, paddingRight: 40 }}
            />
            <div className="input-suffix">
              <span style={{ color: 'var(--text-3)', fontWeight: 600, paddingRight: 4 }}>%</span>
            </div>
          </div>
        </Field>
      </div>

      <Banner tone="info">
        Approving creates the login, generates the referral link and QR code, and emails the
        contact their credentials.
      </Banner>
    </Modal>
  );
}

function DeclineModal({ application, onClose, onDeclined }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (application) {
      setReason('');
      setError(null);
    }
  }, [application]);

  if (!application) return null;

  const decline = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/institutions/applications/${application.id}/decline`, { reason });
      onDeclined();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!application}
      onClose={onClose}
      title="Decline this application"
      subtitle={application.organisation_name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={decline} loading={busy}>
            Decline and notify
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field
        label="Reason"
        optional
        hint="Included in the email to the contact. Keep it brief and factual."
      >
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="We are not onboarding new partners in this category at the moment."
          autoFocus
        />
      </Field>
    </Modal>
  );
}
