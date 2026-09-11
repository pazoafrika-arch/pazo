import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { api, downloadFile, qs } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { dateTime, num, statusLabel, tzs } from '../../lib/format.js';

/** Transaction monitor (PRD 5.6) with resolve actions for disputes. */
export default function AdminTransactions() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [type, setType] = useState('all');
  const [businessId, setBusinessId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [resolveTarget, setResolveTarget] = useState(null);
  const [settleTarget, setSettleTarget] = useState(null);
  const q = useDebounced(search, 350);

  const businesses = useApi('/admin/businesses?limit=50');
  const filters = { page, limit: 25, q, status, type, business_id: businessId, from, to };
  const list = useApi(`/admin/transactions${qs(filters)}`, {
    deps: [page, q, status, type, businessId, from, to],
  });

  useEffect(() => setPage(1), [q, status, type, businessId, from, to]);

  const resolve = async () => {
    try {
      await api.post(`/admin/transactions/${resolveTarget.id}/resolve`, {
        note: 'Resolved by Pazo admin',
      });
      toast.success('Transaction marked resolved');
      setResolveTarget(null);
      list.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const settle = async () => {
    try {
      const res = await api.post('/admin/transactions/settle-pending', {
        business_id: settleTarget,
      });
      toast[res.settled > 0 ? 'success' : 'warn'](
        res.settled > 0
          ? `${res.settled} commission${res.settled === 1 ? '' : 's'} paid, ${tzs(res.total_tzs)} in total`
          : 'Wallet balance is not enough to settle anything',
      );
      setSettleTarget(null);
      list.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const totals = list.data?.totals;
  const hasPending = status === 'pending' && list.data?.items?.length > 0;

  return (
    <div className="stack">
      {hasPending && (
        <Banner
          tone="warn"
          title="Pending commissions"
          action={
            <Select
              value=""
              onChange={(e) => e.target.value && setSettleTarget(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="">Settle for…</option>
              {(businesses.data?.items || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          }
        >
          These commissions could not be paid when the webhook arrived. Once the business wallet is
          funded they can be settled in one action.
        </Banner>
      )}

      {totals && (
        <div className="stat-grid">
          <Card>
            <div className="stat-label">Sales in view</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {tzs(totals.sales_tzs, { compact: true })}
            </div>
          </Card>
          <Card>
            <div className="stat-label">Commission</div>
            <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {tzs(totals.commission_tzs, { compact: true })}
            </div>
          </Card>
          <Card>
            <div className="stat-label">Platform fees</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {tzs(totals.platform_fee_tzs, { compact: true })}
            </div>
          </Card>
          <Card>
            <div className="stat-label">Transactions</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {num(list.data.total)}
            </div>
          </Card>
        </div>
      )}

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Transactions</div>
            <div className="card-subtitle">Every commission event across the platform</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            onClick={() =>
              downloadFile(
                `/admin/transactions${qs({ ...filters, page: undefined, format: 'csv', limit: 100 })}`,
                'pazo-transactions.csv',
              ).catch(() => toast.error('Could not export'))
            }
          >
            Export
          </Button>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <div className="filter-bar">
            <SearchInput value={search} onChange={setSearch} placeholder="Partner, code or reference" />
            <Select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              <option value="all">All businesses</option>
              {(businesses.data?.items || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="resolved">Resolved</option>
            </Select>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All types</option>
              <option value="first_purchase">First purchase</option>
              <option value="topup">Top-up</option>
            </Select>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ width: 'auto' }}
              aria-label="From date"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ width: 'auto' }}
              aria-label="To date"
            />
          </div>
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={8} />
        ) : !list.data?.items?.length ? (
          <EmptyState icon="receipt" title="No transactions match" text="Try widening the filters." />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Business</th>
                  <th>Partner</th>
                  <th>Customer</th>
                  <th className="num">Purchase</th>
                  <th className="num">Commission</th>
                  <th className="num">Fee</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-primary" data-label="Date">
                      {dateTime(t.created_at)}
                    </td>
                    <td data-label="Business">{t.business_name}</td>
                    <td data-label="Partner">
                      {t.partner_name}
                      {t.referral_code && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 'var(--t-sm)',
                            color: 'var(--text-3)',
                          }}
                        >
                          {t.referral_code} · {t.bundle_type || '—'}
                        </span>
                      )}
                    </td>
                    <td data-label="Customer">
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                        {t.customer_id || '—'}
                      </code>
                    </td>
                    <td className="num" data-label="Purchase">
                      {tzs(t.amount_tzs)}
                    </td>
                    <td className="num strong" data-label="Commission">
                      {tzs(t.commission_tzs)}
                    </td>
                    <td className="num" data-label="Platform fee">
                      {tzs(t.platform_fee_tzs)}
                    </td>
                    <td data-label="Status">
                      <Badge status={t.status} />
                      {t.failure_reason && t.status !== 'paid' && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 'var(--t-xs)',
                            color: 'var(--text-3)',
                            marginTop: 3,
                          }}
                        >
                          {t.failure_reason.replace(/_/g, ' ')}
                        </span>
                      )}
                    </td>
                    <td data-label="Action">
                      {(t.status === 'pending' || t.status === 'failed') && (
                        <Button variant="ghost" size="sm" onClick={() => setResolveTarget(t)}>
                          Resolve
                        </Button>
                      )}
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

      <ConfirmDialog
        open={!!resolveTarget}
        onClose={() => setResolveTarget(null)}
        onConfirm={resolve}
        title="Mark this commission resolved?"
        message={
          resolveTarget
            ? `${tzs(resolveTarget.commission_tzs)} for ${resolveTarget.partner_name} will be closed without payment. Use this only when the matter has been settled another way.`
            : ''
        }
        confirmLabel="Mark resolved"
        tone="danger"
      />

      <ConfirmDialog
        open={!!settleTarget}
        onClose={() => setSettleTarget(null)}
        onConfirm={settle}
        title="Settle pending commissions?"
        message="Pending commissions are paid in the order they were recorded, until the wallet balance runs out. Partners are notified and credited immediately."
        confirmLabel="Settle now"
        tone="teal"
      />
    </div>
  );
}
