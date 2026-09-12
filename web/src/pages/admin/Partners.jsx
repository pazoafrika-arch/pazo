import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Banner,
  BrandCell,
  Button,
  Card,
  ConfirmDialog,
  CopyField,
  DetailList,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  PasswordInput,
  SearchInput,
  Select,
  SkeletonRows,
  Textarea,
} from '../../components/UI.jsx';
import { AvatarUpload } from '../../components/AvatarUpload.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { api, downloadFile, qs } from '../../lib/api.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { date, dateTime, num, ratePct, relative, statusLabel, tzs } from '../../lib/format.js';

/** Every partner across every business (PRD 5.4). */
export default function AdminPartners() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState(params.get('type') || 'all');
  const [status, setStatus] = useState('all');
  const [businessId, setBusinessId] = useState('all');
  const [openId, setOpenId] = useState(params.get('open'));
  const [createOpen, setCreateOpen] = useState(false);
  const q = useDebounced(search, 350);

  const businesses = useApi('/admin/businesses?limit=50');
  const list = useApi(
    `/admin/partners${qs({ page, limit: 20, q, type, status, business_id: businessId })}`,
    { deps: [page, q, type, status, businessId] },
  );

  useEffect(() => setPage(1), [q, type, status, businessId]);

  const closeDrawer = () => {
    setOpenId(null);
    if (params.get('open')) {
      params.delete('open');
      setParams(params, { replace: true });
    }
  };

  return (
    <div className="stack">
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Partners</div>
            <div className="card-subtitle">
              {list.data ? `${num(list.data.total)} across all businesses` : 'Individuals and organisations'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              icon="download"
              onClick={() =>
                downloadFile(
                  `/admin/partners${qs({ q, type, status, format: 'csv', limit: 100 })}`,
                  'pazo-partners.csv',
                ).catch(() => toast.error('Could not export'))
              }
            >
              Export
            </Button>
            <Button variant="primary" size="sm" icon="user-plus" onClick={() => setCreateOpen(true)}>
              Add partner
            </Button>
          </div>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <div className="filter-bar">
            <SearchInput value={search} onChange={setSearch} placeholder="Name, email or code" />
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All types</option>
              <option value="individual">Individuals</option>
              <option value="institution">Organisations</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              <option value="all">All businesses</option>
              {(businesses.data?.items || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={8} />
        ) : !list.data?.items?.length ? (
          <EmptyState icon="users" title="No partners match" text="Try a different filter." />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Type</th>
                  <th>Business</th>
                  <th>Code</th>
                  <th className="num">Referrals</th>
                  <th className="num">Earned</th>
                  <th>Last active</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setOpenId(p.id)}>
                    <td className="cell-primary" data-label="Partner">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <Avatar
                          name={p.name}
                          size="sm"
                          square={p.partner_type === 'institution'}
                          color={p.avatar_color || (p.partner_type === 'institution' ? '#0f3460' : '#01989f')}
                          userId={p.user_id}
                          hasImage={p.has_avatar}
                        />
                        <span>
                          {p.name}
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-sm)',
                              color: 'var(--text-3)',
                              fontWeight: 400,
                            }}
                          >
                            {p.email || p.phone}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Type">
                      <Badge tone={p.partner_type === 'institution' ? 'blue' : 'teal'}>
                        {statusLabel(p.partner_type)}
                      </Badge>
                    </td>
                    <td data-label="Business">
                      <BrandCell
                        name={p.business_name}
                        businessId={p.business_id}
                        hasLogo={p.business_has_logo}
                      />
                    </td>
                    <td data-label="Code">
                      <Badge tone="gray">{p.referral_code}</Badge>
                    </td>
                    <td className="num" data-label="Referrals">
                      {num(p.total_referrals)}
                    </td>
                    <td className="num strong" data-label="Earned">
                      {tzs(p.total_earnings_tzs, { compact: true })}
                    </td>
                    <td data-label="Last active">
                      {p.last_active_at ? relative(p.last_active_at) : '—'}
                    </td>
                    <td data-label="Status">
                      <Badge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.data?.total > list.data?.limit && (
          <Pagination
            page={list.data.page}
            pages={list.data.pages}
            total={list.data.total}
            limit={list.data.limit}
            onPage={setPage}
          />
        )}
      </Card>

      <PartnerDrawer
        partnerId={openId}
        onClose={closeDrawer}
        onChanged={() => list.reload({ quiet: true })}
      />

      <CreatePartnerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        businesses={businesses.data?.items || []}
        onCreated={() => {
          setCreateOpen(false);
          list.reload({ quiet: true });
          toast.success('Partner created');
        }}
      />
    </div>
  );
}

function PartnerDrawer({ partnerId, onClose, onChanged }) {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const { data, loading, reload } = useApi(partnerId ? `/admin/partners/${partnerId}` : null, {
    enabled: !!partnerId,
  });
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!partnerId) return null;
  const p = data?.partner;

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.put(`/admin/partners/${partnerId}`, { status });
      toast.success(status === 'suspended' ? 'Partner suspended' : 'Partner reactivated');
      setSuspendOpen(false);
      reload({ quiet: true });
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Drawer
        open={!!partnerId}
        onClose={onClose}
        title={p?.name || 'Partner'}
        subtitle={p ? `${statusLabel(p.partner_type)} · ${p.business_name}` : 'Loading'}
        footer={
          p && (
            <>
              <Button variant="secondary" icon="message-circle" onClick={() => setNotifyOpen(true)}>
                Send message
              </Button>
              {p.status === 'active' ? (
                <Button variant="danger-ghost" icon="user-x" onClick={() => setSuspendOpen(true)}>
                  Suspend
                </Button>
              ) : (
                <Button variant="teal" icon="user-check" loading={busy} onClick={() => setStatus('active')}>
                  Reactivate
                </Button>
              )}
            </>
          )
        }
      >
        {loading && !data ? (
          <SkeletonRows count={5} />
        ) : !data ? null : (
          <div className="stack">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Pazo staff onboard partners on their behalf, so the picture
                  is editable here without asking the partner to sign in. */}
              <AvatarUpload
                user={{
                  id: p.user_id,
                  name: p.name,
                  avatar_color: p.partner_type === 'institution' ? '#0f3460' : '#01989f',
                  has_avatar: p.has_avatar,
                }}
                size={72}
                square={p.partner_type === 'institution'}
                label={p.partner_type === 'institution' ? 'Organisation logo' : 'Profile picture'}
                endpoints={{
                  get: (u) => `/media/avatar/${u.id}`,
                  put: `/media/admin/avatar/${p.user_id}`,
                  del: `/media/admin/avatar/${p.user_id}`,
                }}
                onChanged={() => {
                  reload({ quiet: true });
                  onChanged();
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--t-lg)', fontWeight: 800, color: 'var(--navy)' }}>
                  {p.name}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                  <Badge status={p.status} />
                  <Badge tone="gray">{p.referral_code}</Badge>
                  {p.has_custom_rate && <Badge tone="blue">Custom rate</Badge>}
                </div>
              </div>
            </div>

            <div className="grid-2">
              <Card>
                <div className="stat-label">Total earned</div>
                <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 3 }}>
                  {tzs(p.total_earnings_tzs, { compact: true })}
                </div>
              </Card>
              <Card>
                <div className="stat-label">Referrals</div>
                <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 3 }}>
                  {num(data.stats.referrals)}
                </div>
              </Card>
            </div>

            <div>
              <div className="label">Referral link</div>
              <CopyField value={p.referral_link} label="Link" mono={false} />
            </div>

            <DetailList
              items={[
                { label: 'Business', value: p.business_name },
                { label: 'Email', value: p.email || '—' },
                p.phone_masked && { label: 'Phone', value: p.phone_masked },
                { label: 'Commission rate', value: ratePct(p.commission_rate) },
                { label: 'Joined', value: date(p.joined_at) },
                { label: 'Last sign-in', value: p.last_login_at ? relative(p.last_login_at) : 'Never' },
                { label: 'Link clicks', value: num(data.stats.clicks) },
                { label: 'Sales generated', value: tzs(data.stats.sales_tzs) },
                data.stats.pending_tzs > 0 && {
                  label: 'Pending commission',
                  value: (
                    <span style={{ color: 'var(--amber)' }}>{tzs(data.stats.pending_tzs)}</span>
                  ),
                },
                p.partner_type === 'institution'
                  ? {
                      label: 'Accumulated balance',
                      value: tzs(data.profile.accumulated_balance_tzs),
                    }
                  : { label: 'Wallet balance', value: tzs(data.profile.wallet_balance_tzs) },
                p.partner_type === 'institution'
                  ? { label: 'Payout account', value: data.profile.payout_account_masked || '—' }
                  : { label: 'Mobile money', value: data.profile.mobile_money_masked || '—' },
              ]}
            />

            <Card pad={false}>
              <div className="card-head">
                <div className="card-title">Recent transactions</div>
              </div>
              <div style={{ padding: '0 var(--s-4)' }}>
                {data.transactions.length === 0 ? (
                  <EmptyState icon="receipt" title="No transactions yet" />
                ) : (
                  data.transactions.slice(0, 12).map((t) => (
                    <div className="row-item" key={t.id}>
                      <div className="row-body">
                        <div className="row-title" style={{ fontSize: 'var(--t-sm)' }}>
                          {t.bundle_type || 'Data bundle'}
                        </div>
                        <div className="row-sub">{dateTime(t.created_at)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="row-amount pos">{tzs(t.commission_tzs)}</div>
                        <Badge status={t.commission_status} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onConfirm={() => setStatus('suspended')}
        loading={busy}
        title="Suspend this partner?"
        message="Their referral code stops working and they are signed out of every session. Existing balances are untouched."
        confirmLabel="Suspend partner"
        tone="danger"
      />

      <NotifyModal
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        partnerId={partnerId}
        onSent={() => {
          setNotifyOpen(false);
          toast.success('Message sent');
        }}
      />
    </>
  );
}

function NotifyModal({ open, onClose, partnerId, onSent }) {
  const [form, setForm] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ title: '', body: '' });
      setError(null);
    }
  }, [open]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/partners/${partnerId}/notify`, form);
      onSent();
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
      title="Send a message"
      subtitle="Appears in their in-app notification feed"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={!form.body.trim()}>
            Send
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Title" optional>
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Message from Pazo"
          autoFocus
        />
      </Field>
      <Field label="Message">
        <Textarea
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder="Write your message"
          rows={4}
        />
      </Field>
    </Modal>
  );
}

function CreatePartnerModal({ open, onClose, businesses, onCreated }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        business_id: businesses[0]?.id || '',
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        referral_code: '',
        password: '',
      });
      setError(null);
    }
  }, [open, businesses]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/partners', form);
      onCreated();
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
      title="Add an individual partner"
      subtitle="For assisted onboarding — organisations go through the approval queue"
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Create partner
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Business">
        <Select
          value={form.business_id || ''}
          onChange={(e) => setForm({ ...form, business_id: e.target.value })}
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="field-row">
        <Field label="First name">
          <Input
            value={form.first_name || ''}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Last name">
          <Input
            value={form.last_name || ''}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Email">
        <Input
          type="email"
          value={form.email || ''}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          autoCapitalize="none"
        />
      </Field>
      <Field label="Phone number" hint="Used for login and mobile money payouts">
        <Input
          type="tel"
          value={form.phone || ''}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="0754 000 000"
        />
      </Field>
      <Field label="Referral code" hint="4 to 10 letters or numbers, permanent">
        <Input
          value={form.referral_code || ''}
          onChange={(e) =>
            setForm({
              ...form,
              referral_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
            })
          }
          placeholder="AMINA07"
          style={{ letterSpacing: '0.1em', fontWeight: 700 }}
        />
      </Field>
      <Field label="Temporary password">
        <PasswordInput
          value={form.password || ''}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
    </Modal>
  );
}
