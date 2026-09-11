import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
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
  SkeletonRows,
  Switch,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { api, downloadFile, qs } from '../../lib/api.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { date, dateTime, num, ratePct, relative, tzs } from '../../lib/format.js';

/** Every business on the platform (PRD 5.3) with full management. */
export default function AdminBusinesses() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(params.get('open'));
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const q = useDebounced(search, 350);

  const list = useApi(`/admin/businesses${qs({ page, limit: 20, q })}`, { deps: [page, q] });

  useEffect(() => setPage(1), [q]);

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
            <div className="card-title">Businesses</div>
            <div className="card-subtitle">
              {list.data ? `${num(list.data.total)} registered` : 'Clients running a partner programme'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              icon="download"
              onClick={() =>
                downloadFile('/admin/businesses?format=csv&limit=100', 'pazo-businesses.csv').catch(
                  () => toast.error('Could not export'),
                )
              }
            >
              Export
            </Button>
            <Button variant="primary" size="sm" icon="plus" onClick={() => setCreateOpen(true)}>
              Add business
            </Button>
          </div>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or website" />
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={4} />
        ) : !list.data?.items?.length ? (
          <EmptyState icon="briefcase" title="No businesses yet" />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>API key</th>
                  <th className="num">Wallet</th>
                  <th className="num">Partners</th>
                  <th className="num">Transactions</th>
                  <th className="num">Rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => setOpenId(b.id)}>
                    <td className="cell-primary" data-label="Business">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={b.name} size="sm" square color="#0f3460" />
                        <span>
                          {b.name}
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-sm)',
                              color: 'var(--text-3)',
                              fontWeight: 400,
                            }}
                          >
                            {b.website || '—'}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td data-label="API key">
                      <Badge tone={b.api_key_status === 'active' ? 'green' : 'gray'}>
                        {b.api_key_status === 'active' ? 'Active' : 'Not issued'}
                      </Badge>
                    </td>
                    <td
                      className="num strong"
                      data-label="Wallet"
                      style={{ color: b.low_balance ? 'var(--amber)' : undefined }}
                    >
                      {tzs(b.wallet_balance_tzs, { compact: true })}
                    </td>
                    <td className="num" data-label="Partners">
                      {num(b.partners)}
                    </td>
                    <td className="num" data-label="Transactions">
                      {num(b.transactions)}
                    </td>
                    <td className="num" data-label="Commission rate">
                      {ratePct(b.commission_rate)}
                    </td>
                    <td data-label="Status">
                      <Badge status={b.status} />
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

      <BusinessDrawer
        businessId={openId}
        onClose={closeDrawer}
        onChanged={() => list.reload({ quiet: true })}
        onNewKey={setNewKey}
      />

      <CreateBusinessModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(key) => {
          setCreateOpen(false);
          setNewKey(key);
          list.reload({ quiet: true });
          toast.success('Business created');
        }}
      />

      <Modal
        open={!!newKey}
        onClose={() => setNewKey(null)}
        title="API key"
        subtitle="Copy it now — it is never shown again"
        width="wide"
        footer={
          <Button variant="primary" onClick={() => setNewKey(null)}>
            I have saved it
          </Button>
        }
      >
        <Banner tone="warn" title="Shown once">
          Pazo stores only a SHA-256 hash of this key. Send it to the business through a secure
          channel.
        </Banner>
        <div style={{ marginTop: 'var(--s-5)' }}>
          <CopyField value={newKey || ''} label="API key" />
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- detail ---------------- */
function BusinessDrawer({ businessId, onClose, onChanged, onNewKey }) {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const { data, loading, reload } = useApi(businessId ? `/admin/businesses/${businessId}` : null, {
    enabled: !!businessId,
  });
  const [topupOpen, setTopupOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  if (!businessId) return null;
  const b = data?.business;

  const regenerate = async () => {
    try {
      const res = await api.post(`/admin/businesses/${businessId}/api-key/regenerate`);
      setRegenOpen(false);
      onNewKey(res.api_key);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleStatus = async () => {
    try {
      await api.put(`/admin/businesses/${businessId}`, {
        status: b.status === 'active' ? 'suspended' : 'active',
      });
      toast.success(b.status === 'active' ? 'Business suspended' : 'Business reactivated');
      reload({ quiet: true });
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <Drawer
        open={!!businessId}
        onClose={onClose}
        title={b?.name || 'Business'}
        subtitle={b?.website}
        footer={
          b && (
            <>
              <Button variant="teal" icon="upload" onClick={() => setTopupOpen(true)}>
                Top up wallet
              </Button>
              <Button variant="secondary" icon="edit" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </>
          )
        }
      >
        {loading && !data ? (
          <SkeletonRows count={5} />
        ) : !data ? null : (
          <div className="stack">
            <div className="grid-2">
              <Card>
                <div className="stat-label">Wallet balance</div>
                <div
                  className="stat-value"
                  style={{
                    fontSize: 'var(--t-xl)',
                    marginTop: 3,
                    color:
                      b.wallet_balance_tzs < b.wallet_alert_threshold_tzs
                        ? 'var(--amber)'
                        : 'var(--navy)',
                  }}
                >
                  {tzs(b.wallet_balance_tzs, { compact: true })}
                </div>
                <div className="stat-foot">
                  Alert at {tzs(b.wallet_alert_threshold_tzs, { compact: true })}
                </div>
              </Card>
              <Card>
                <div className="stat-label">Platform fees earned</div>
                <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 3 }}>
                  {tzs(data.stats.platform_fees_tzs, { compact: true })}
                </div>
                <div className="stat-foot">All time, to Pazo</div>
              </Card>
            </div>

            <DetailList
              items={[
                { label: 'Status', value: <Badge status={b.status} /> },
                { label: 'Commission rate', value: ratePct(b.commission_rate) },
                { label: 'Platform fee rate', value: ratePct(b.platform_fee_rate) },
                { label: 'Partners', value: num(data.stats.partners) },
                { label: 'Referrals', value: num(data.stats.referrals) },
                { label: 'Transactions', value: num(data.stats.transactions) },
                { label: 'Sales value', value: tzs(data.stats.sales_tzs) },
                { label: 'Commissions paid', value: tzs(data.stats.commissions_paid_tzs) },
                data.stats.pending_commissions_tzs > 0 && {
                  label: 'Pending commissions',
                  value: (
                    <span style={{ color: 'var(--amber)' }}>
                      {tzs(data.stats.pending_commissions_tzs)}
                    </span>
                  ),
                },
                { label: 'Notification email', value: b.notification_email || '—' },
                { label: 'Joined', value: date(b.created_at) },
              ]}
            />

            <Card pad={false}>
              <div className="card-head">
                <div className="card-title">API key</div>
                <Button variant="ghost" size="sm" icon="refresh" onClick={() => setRegenOpen(true)}>
                  Regenerate
                </Button>
              </div>
              <div style={{ padding: 'var(--s-4)' }}>
                {b.api_key_masked ? (
                  <>
                    <div className="copy-field">
                      <code>{b.api_key_masked}</code>
                    </div>
                    <div className="field-hint" style={{ marginTop: 8 }}>
                      Rotated {b.api_key_rotated_at ? relative(b.api_key_rotated_at) : 'never'}
                    </div>
                  </>
                ) : (
                  <Banner tone="warn">No key issued yet.</Banner>
                )}
              </div>
            </Card>

            <Card pad={false}>
              <div className="card-head">
                <div className="card-title">Team</div>
              </div>
              <div style={{ padding: '0 var(--s-4)' }}>
                {data.team.map((t) => (
                  <div className="row-item" key={t.id}>
                    <Avatar name={t.name} size="sm" />
                    <div className="row-body">
                      <div className="row-title">{t.name}</div>
                      <div className="row-sub">{t.email}</div>
                    </div>
                    <Badge tone={t.is_owner ? 'teal' : 'gray'}>
                      {t.is_owner ? 'Owner' : t.access === 'read_only' ? 'Read only' : 'Full'}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>

            <Card pad={false}>
              <div className="card-head">
                <div className="card-title">Recent wallet movements</div>
              </div>
              <div style={{ padding: '0 var(--s-4)' }}>
                {data.wallet_ledger.length === 0 ? (
                  <EmptyState icon="receipt" title="No movements yet" />
                ) : (
                  data.wallet_ledger.slice(0, 10).map((l) => (
                    <div className="row-item" key={l.id}>
                      <span className={`row-icon ${l.amount_tzs > 0 ? 'green' : 'gray'}`}>
                        <Icon
                          name={l.amount_tzs > 0 ? 'arrow-down-left' : 'arrow-up-right'}
                          size={15}
                        />
                      </span>
                      <div className="row-body">
                        <div className="row-title" style={{ fontSize: 'var(--t-sm)' }}>
                          {l.description}
                        </div>
                        <div className="row-sub">{dateTime(l.created_at)}</div>
                      </div>
                      <div
                        className="row-amount"
                        style={{ color: l.amount_tzs > 0 ? 'var(--green)' : undefined }}
                      >
                        {tzs(l.amount_tzs, { sign: true })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {isSuperAdmin && (
              <Card>
                <Switch
                  label={b.status === 'active' ? 'Business is active' : 'Business is suspended'}
                  description="Suspending stops all API calls and commission processing immediately."
                  checked={b.status === 'active'}
                  onChange={toggleStatus}
                />
              </Card>
            )}
          </div>
        )}
      </Drawer>

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        business={b}
        onDone={(result) => {
          setTopupOpen(false);
          reload({ quiet: true });
          onChanged();
          toast.success(
            result.settled?.settled > 0
              ? `Wallet topped up. ${result.settled.settled} pending commission${result.settled.settled === 1 ? '' : 's'} paid.`
              : 'Wallet topped up',
          );
        }}
      />

      <EditBusinessModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        business={b}
        onSaved={() => {
          setEditOpen(false);
          reload({ quiet: true });
          onChanged();
          toast.success('Business updated');
        }}
      />

      <ConfirmDialog
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        onConfirm={regenerate}
        title="Regenerate this API key?"
        message="The current key stops working immediately and their integration will fail until the new key is deployed."
        confirmLabel="Regenerate"
        tone="danger"
      />
    </>
  );
}

function TopupModal({ open, onClose, business, onDone }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setAmount('');
      setReference('');
      setError(null);
    }
  }, [open]);

  if (!business) return null;
  const value = parseInt(String(amount).replace(/\D/g, ''), 10) || 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/admin/businesses/${business.id}/wallet/topup`, {
        amount_tzs: value,
        reference,
      });
      onDone(res);
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
      title="Record a wallet top-up"
      subtitle={`${business.name} · current balance ${tzs(business.wallet_balance_tzs)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="teal" onClick={save} loading={busy} disabled={value <= 0}>
            Credit {value > 0 ? tzs(value) : 'wallet'}
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Amount received" hint="Only record funds that have actually cleared">
        <div className="input-group">
          <span className="input-prefix">TZS</span>
          <Input
            value={value ? value.toLocaleString('en-US') : ''}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            style={{ fontSize: 'var(--t-xl)', fontWeight: 700 }}
            autoFocus
          />
        </div>
      </Field>
      <Field label="Bank reference" optional hint="Helps finance reconcile the transfer later">
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="CRDB-800145"
        />
      </Field>
      <Banner tone="info">
        Any commissions that were pending on this wallet are paid automatically once the balance
        covers them.
      </Banner>
    </Modal>
  );
}

function EditBusinessModal({ open, onClose, business, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && business) {
      setForm({
        name: business.name,
        website: business.website || '',
        commission_rate: String(business.commission_rate * 100),
        platform_fee_rate: String(business.platform_fee_rate * 100),
        wallet_alert_threshold_tzs: String(business.wallet_alert_threshold_tzs),
        notification_email: business.notification_email || '',
        signup_url_template: business.signup_url_template || '',
      });
      setError(null);
    }
  }, [open, business]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/admin/businesses/${business.id}`, {
        ...form,
        commission_rate: Number(form.commission_rate) / 100,
        platform_fee_rate: Number(form.platform_fee_rate) / 100,
        wallet_alert_threshold_tzs: Number(form.wallet_alert_threshold_tzs),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!business) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit business"
      width="wide"
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
      <Field label="Business name">
        <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Website">
        <Input
          value={form.website || ''}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
        />
      </Field>
      <div className="field-row">
        <Field label="Commission rate (%)">
          <Input
            value={form.commission_rate || ''}
            onChange={(e) =>
              setForm({ ...form, commission_rate: e.target.value.replace(/[^0-9.]/g, '') })
            }
            inputMode="decimal"
          />
        </Field>
        <Field label="Platform fee (%)">
          <Input
            value={form.platform_fee_rate || ''}
            onChange={(e) =>
              setForm({ ...form, platform_fee_rate: e.target.value.replace(/[^0-9.]/g, '') })
            }
            inputMode="decimal"
          />
        </Field>
      </div>
      <Field label="Low balance alert (TZS)">
        <Input
          value={Number(form.wallet_alert_threshold_tzs || 0).toLocaleString('en-US')}
          onChange={(e) =>
            setForm({ ...form, wallet_alert_threshold_tzs: e.target.value.replace(/\D/g, '') })
          }
          inputMode="numeric"
        />
      </Field>
      <Field label="Notification email">
        <Input
          type="email"
          value={form.notification_email || ''}
          onChange={(e) => setForm({ ...form, notification_email: e.target.value })}
          autoCapitalize="none"
        />
      </Field>
      <Field
        label="Referral link template"
        hint="Use {CODE} where the partner's referral code should appear"
      >
        <Input
          value={form.signup_url_template || ''}
          onChange={(e) => setForm({ ...form, signup_url_template: e.target.value })}
          placeholder="https://thetravela.com/signup?ref={CODE}"
        />
      </Field>
    </Modal>
  );
}

function CreateBusinessModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: '',
        website: '',
        category: '',
        commission_rate: '8',
        platform_fee_rate: '1',
        wallet_alert_threshold_tzs: '500000',
        owner_name: '',
        owner_email: '',
        owner_password: '',
      });
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/admin/businesses', {
        ...form,
        commission_rate: Number(form.commission_rate) / 100,
        platform_fee_rate: Number(form.platform_fee_rate) / 100,
        wallet_alert_threshold_tzs: Number(form.wallet_alert_threshold_tzs),
      });
      onCreated(res.api_key);
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
      title="Add a business"
      subtitle="Creates the business, its owner login and its API key"
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Create business
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <div className="eyebrow" style={{ marginBottom: 'var(--s-3)' }}>
        Business
      </div>
      <Field label="Business name">
        <Input
          value={form.name || ''}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="The Travela"
          autoFocus
        />
      </Field>
      <div className="field-row">
        <Field label="Website">
          <Input
            value={form.website || ''}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            placeholder="thetravela.com"
          />
        </Field>
        <Field label="Category" optional>
          <Input
            value={form.category || ''}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="eSIM & connectivity"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Commission rate (%)">
          <Input
            value={form.commission_rate || ''}
            onChange={(e) =>
              setForm({ ...form, commission_rate: e.target.value.replace(/[^0-9.]/g, '') })
            }
            inputMode="decimal"
          />
        </Field>
        <Field label="Platform fee (%)">
          <Input
            value={form.platform_fee_rate || ''}
            onChange={(e) =>
              setForm({ ...form, platform_fee_rate: e.target.value.replace(/[^0-9.]/g, '') })
            }
            inputMode="decimal"
          />
        </Field>
      </div>

      <div className="divider" />

      <div className="eyebrow" style={{ marginBottom: 'var(--s-3)' }}>
        Owner login
      </div>
      <Field label="Owner name">
        <Input
          value={form.owner_name || ''}
          onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
          placeholder="Operations team"
        />
      </Field>
      <Field label="Owner email">
        <Input
          type="email"
          value={form.owner_email || ''}
          onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
          placeholder="ops@thetravela.com"
          autoCapitalize="none"
        />
      </Field>
      <Field label="Temporary password" hint="At least 8 characters, with a number and a capital letter">
        <PasswordInput
          value={form.owner_password || ''}
          onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
        />
      </Field>
    </Modal>
  );
}
