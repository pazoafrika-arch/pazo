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
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { api, downloadFile, qs } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, dateTime, num, pct, ratePct, relative, statusLabel, tzs } from '../../lib/format.js';

/** All partners for this business (PRD 4.3), with a detail side panel. */
export default function BusinessPartners() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('commission_tzs');
  const [openId, setOpenId] = useState(params.get('open'));

  const q = useDebounced(search, 350);
  const list = useApi(
    `/business/me/partners${qs({ page, limit: 20, q, type, status, sort, dir: 'desc' })}`,
    { deps: [page, q, type, status, sort] },
  );

  useEffect(() => {
    setPage(1);
  }, [q, type, status]);

  const closeDrawer = () => {
    setOpenId(null);
    if (params.get('open')) {
      params.delete('open');
      setParams(params, { replace: true });
    }
  };

  const exportCsv = async () => {
    try {
      await downloadFile(
        `/business/me/partners${qs({ q, type, status, sort, format: 'csv', limit: 100 })}`,
        'pazo-partners.csv',
      );
      toast.success('Partner list exported');
    } catch {
      toast.error('Could not export the list');
    }
  };

  return (
    <div className="stack">
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Partners</div>
            <div className="card-subtitle">
              {list.data ? `${num(list.data.total)} total` : 'Everyone referring to your business'}
            </div>
          </div>
          <Button variant="secondary" size="sm" icon="download" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <div className="filter-bar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name or code" />
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
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="commission_tzs">Top commission</option>
              <option value="sales_tzs">Top sales</option>
              <option value="referrals_month">Most referrals this month</option>
              <option value="total_referrals">Most referrals all time</option>
              <option value="created_at">Newest</option>
            </Select>
          </div>
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={6} />
        ) : !list.data?.items?.length ? (
          <EmptyState
            icon="users"
            title="No partners match"
            text="Try a different search or clear the filters."
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Code</th>
                  <th className="num">Referrals (mo)</th>
                  <th className="num">Sales (mo)</th>
                  <th className="num">Commission (mo)</th>
                  <th>Payout</th>
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
                          color={p.partner_type === 'institution' ? '#0f3460' : '#007b84'}
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
                            {statusLabel(p.partner_type)}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Code">
                      <Badge tone="gray">{p.referral_code}</Badge>
                    </td>
                    <td className="num" data-label="Referrals this month">
                      {num(p.referrals_this_month)}
                    </td>
                    <td className="num" data-label="Sales this month">
                      {tzs(p.sales_tzs, { compact: true })}
                    </td>
                    <td className="num strong" data-label="Commission this month">
                      {tzs(p.commission_tzs, { compact: true })}
                    </td>
                    <td data-label="Payout">
                      <Badge tone={p.payout_method === 'Instant' ? 'teal' : 'blue'}>
                        {p.payout_method}
                      </Badge>
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
    </div>
  );
}

/* ---------------- detail panel ---------------- */
function PartnerDrawer({ partnerId, onClose, onChanged }) {
  const toast = useToast();
  const { data, loading, reload } = useApi(partnerId ? `/business/me/partners/${partnerId}` : null, {
    enabled: !!partnerId,
  });
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!partnerId) return null;

  const p = data?.partner;

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.put(`/business/me/partners/${partnerId}/status`, { status });
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
        subtitle={p ? `${statusLabel(p.partner_type)} · ${p.referral_code}` : 'Loading'}
        footer={
          p && (
            <>
              <Button variant="secondary" icon="percent" onClick={() => setRateOpen(true)}>
                Commission rate
              </Button>
              {p.status === 'active' ? (
                <Button variant="danger-ghost" icon="user-x" onClick={() => setSuspendOpen(true)}>
                  Suspend
                </Button>
              ) : (
                <Button variant="teal" icon="user-check" onClick={() => setStatus('active')} loading={busy}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Avatar
                name={p.name}
                size="lg"
                square={p.partner_type === 'institution'}
                color={p.partner_type === 'institution' ? '#0f3460' : '#007b84'}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--t-lg)', fontWeight: 800, color: 'var(--navy)' }}>
                  {p.name}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                  <Badge status={p.status} />
                  <Badge tone="gray">{ratePct(p.commission_rate)} commission</Badge>
                  {p.has_custom_rate && <Badge tone="blue">Custom rate</Badge>}
                </div>
              </div>
            </div>

            <div className="grid-2">
              <Card>
                <div className="stat-label">Referrals</div>
                <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 3 }}>
                  {num(data.stats.referrals)}
                </div>
                <div className="stat-foot">{num(data.stats.converted)} have purchased</div>
              </Card>
              <Card>
                <div className="stat-label">Total earned</div>
                <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 3 }}>
                  {tzs(data.stats.earnings_tzs, { compact: true })}
                </div>
                <div className="stat-foot">
                  {tzs(data.stats.sales_tzs, { compact: true })} in sales
                </div>
              </Card>
            </div>

            <div>
              <div className="label">Referral link</div>
              <CopyField value={p.referral_link} label="Link" mono={false} />
            </div>

            <div>
              <div className="label">Details</div>
              <DetailList
                items={[
                  { label: 'Email', value: p.email || '—' },
                  p.phone && { label: 'Phone', value: p.phone },
                  { label: 'Joined', value: date(p.joined_at) },
                  { label: 'Last activity', value: p.last_active_at ? relative(p.last_active_at) : '—' },
                  { label: 'Link clicks', value: num(data.stats.clicks) },
                  { label: 'Conversion', value: pct(data.stats.conversion_rate) },
                  data.stats.pending_tzs > 0 && {
                    label: 'Pending commission',
                    value: tzs(data.stats.pending_tzs),
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
            </div>

            <Card pad={false}>
              <div className="card-head">
                <div className="card-title">Recent commissions</div>
              </div>
              <div style={{ padding: '0 var(--s-4)' }}>
                {data.commissions.length === 0 ? (
                  <EmptyState icon="banknote" title="No commissions yet" />
                ) : (
                  data.commissions.slice(0, 10).map((c) => (
                    <div className="row-item" key={c.id}>
                      <div className="row-body">
                        <div className="row-title">{c.bundle_type || 'Data bundle'}</div>
                        <div className="row-sub">{dateTime(c.created_at)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="row-amount pos">{tzs(c.commission_tzs)}</div>
                        <Badge status={c.status} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {data.payouts.length > 0 && (
              <Card pad={false}>
                <div className="card-head">
                  <div className="card-title">
                    {p.partner_type === 'institution' ? 'Monthly payouts' : 'Withdrawals'}
                  </div>
                </div>
                <div style={{ padding: '0 var(--s-4)' }}>
                  {data.payouts.map((x, i) => (
                    <div className="row-item" key={x.id || i}>
                      <div className="row-body">
                        <div className="row-title">
                          {x.payout_month ? date(x.payout_month) : x.mobile_money_number}
                        </div>
                        <div className="row-sub">
                          {date(x.completed_at || x.requested_at || x.processed_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="row-amount">{tzs(x.amount_tzs)}</div>
                        <Badge status={x.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onConfirm={() => setStatus('suspended')}
        loading={busy}
        title="Suspend this partner?"
        message="Their referral code stops working immediately and no new commissions are earned. Existing balances are unaffected. You can reactivate them at any time."
        confirmLabel="Suspend partner"
        tone="danger"
      />

      <RateModal
        open={rateOpen}
        onClose={() => setRateOpen(false)}
        partner={p}
        onSaved={() => {
          setRateOpen(false);
          reload({ quiet: true });
          onChanged();
          toast.success('Commission rate updated');
        }}
      />
    </>
  );
}

function RateModal({ open, onClose, partner, onSaved }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && partner) {
      setValue(partner.has_custom_rate ? String(partner.commission_rate * 100) : '');
      setError(null);
    }
  }, [open, partner]);

  const save = async (clear = false) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/business/me/partners/${partner.id}/commission-rate`, {
        commission_rate: clear ? null : Number(value) / 100,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!partner) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Commission rate"
      subtitle={partner.name}
      footer={
        <>
          {partner.has_custom_rate && (
            <Button variant="ghost" onClick={() => save(true)} disabled={busy}>
              Use default
            </Button>
          )}
          <Button variant="primary" onClick={() => save(false)} loading={busy} disabled={!value}>
            Save rate
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
        label="Commission rate for this partner"
        hint="Leave blank to use your business default. Applies to future transactions only."
      >
        <div className="input-group">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="8"
            inputMode="decimal"
            style={{ paddingLeft: 14, paddingRight: 44 }}
          />
          <div className="input-suffix">
            <span style={{ color: 'var(--text-3)', fontWeight: 600, paddingRight: 4 }}>%</span>
          </div>
        </div>
      </Field>
      <Banner tone="info">
        Historic transactions keep the rate that applied when they were recorded, so past
        statements never change.
      </Banner>
    </Drawer>
  );
}
