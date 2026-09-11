import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { downloadFile, qs } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { dateTime, num, statusLabel, tzs } from '../../lib/format.js';

/** Every commission event (PRD 4.5), with the filter set the ops team needs. */
export default function BusinessCommissions() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(search, 350);

  const filters = { page, limit: 25, q, status, type, from, to };
  const list = useApi(`/business/me/commissions${qs(filters)}`, {
    deps: [page, q, status, type, from, to],
  });

  useEffect(() => {
    setPage(1);
  }, [q, status, type, from, to]);

  const exportCsv = async () => {
    try {
      await downloadFile(
        `/business/me/commissions${qs({ ...filters, page: undefined, format: 'csv', limit: 100 })}`,
        'pazo-commissions.csv',
      );
      toast.success('Commission history exported');
    } catch {
      toast.error('Could not export');
    }
  };

  const totals = list.data?.totals;

  return (
    <div className="stack">
      {totals && (
        <div className="stat-grid">
          <Card>
            <div className="stat-label">Sales in view</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {tzs(totals.sales_tzs, { compact: true })}
            </div>
          </Card>
          <Card>
            <div className="stat-label">Commission paid</div>
            <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {tzs(totals.commission_tzs, { compact: true })}
            </div>
          </Card>
          <Card>
            <div className="stat-label">Pazo platform fee</div>
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
            <div className="card-title">Commission history</div>
            <div className="card-subtitle">Every commission event, newest first</div>
          </div>
          <Button variant="secondary" size="sm" icon="download" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <div className="filter-bar">
            <SearchInput value={search} onChange={setSearch} placeholder="Partner, code or reference" />
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
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
            {(from || to || status !== 'all' || type !== 'all' || search) && (
              <Button
                variant="ghost"
                size="sm"
                icon="x"
                onClick={() => {
                  setFrom('');
                  setTo('');
                  setStatus('all');
                  setType('all');
                  setSearch('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={8} />
        ) : !list.data?.items?.length ? (
          <EmptyState
            icon="receipt"
            title="No commissions match"
            text="Adjust the filters or widen the date range."
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Partner</th>
                  <th>Bundle</th>
                  <th>Type</th>
                  <th className="num">Purchase</th>
                  <th className="num">Commission</th>
                  <th className="num">Platform fee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-primary" data-label="Date">
                      {dateTime(t.created_at)}
                    </td>
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
                          {t.referral_code}
                        </span>
                      )}
                    </td>
                    <td data-label="Bundle">{t.bundle_type || '—'}</td>
                    <td data-label="Type">
                      <Badge tone={t.transaction_type === 'topup' ? 'blue' : 'teal'}>
                        {statusLabel(t.transaction_type)}
                      </Badge>
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
    </div>
  );
}
