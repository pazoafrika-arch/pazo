import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { downloadFile, qs } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, num, tzs } from '../../lib/format.js';

/**
 * Every referral signup (PRD 4.4). Travellers appear only as the opaque
 * external ID The Travela supplied — no names, emails or phone numbers are
 * stored by Pazo at all.
 */
export default function BusinessReferrals() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const q = useDebounced(search, 350);

  const list = useApi(`/business/me/referrals${qs({ page, limit: 25, q, status })}`, {
    deps: [page, q, status],
  });

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  const exportCsv = async () => {
    try {
      await downloadFile(
        `/business/me/referrals${qs({ q, status, format: 'csv', limit: 100 })}`,
        'pazo-referrals.csv',
      );
      toast.success('Referral activity exported');
    } catch {
      toast.error('Could not export');
    }
  };

  return (
    <div className="stack">
      <Banner tone="info" icon="shield">
        Traveller names, emails and phone numbers are never stored by Pazo. Each customer appears
        only as the anonymised ID your system supplied.
      </Banner>

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Referral activity</div>
            <div className="card-subtitle">
              {list.data ? `${num(list.data.total)} signups attributed to partners` : 'One row per signup'}
            </div>
          </div>
          <Button variant="secondary" size="sm" icon="download" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <div className="filter-bar">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search customer ID, partner or code"
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Has purchased</option>
              <option value="referred">No purchase yet</option>
            </Select>
          </div>
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={8} />
        ) : !list.data?.items?.length ? (
          <EmptyState
            icon="user-plus"
            title="No referrals match"
            text="Referrals appear here the moment a traveller signs up with a partner code."
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Customer ID</th>
                  <th>Partner</th>
                  <th>Signed up</th>
                  <th>First purchase</th>
                  <th className="num">Purchases</th>
                  <th className="num">Total value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-primary" data-label="Customer ID">
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                        {r.customer_id}
                      </code>
                    </td>
                    <td data-label="Partner">
                      {r.partner_name}
                      <span
                        style={{
                          display: 'block',
                          fontSize: 'var(--t-sm)',
                          color: 'var(--text-3)',
                        }}
                      >
                        {r.referral_code}
                      </span>
                    </td>
                    <td data-label="Signed up">{date(r.signup_date)}</td>
                    <td data-label="First purchase">
                      {r.first_purchase_date ? (
                        date(r.first_purchase_date)
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td className="num" data-label="Purchases">
                      {num(r.total_purchases)}
                    </td>
                    <td className="num strong" data-label="Total value">
                      {tzs(r.total_value_tzs)}
                    </td>
                    <td data-label="Status">
                      <Badge status={r.status}>
                        {r.status === 'active' ? 'Active' : 'Referred'}
                      </Badge>
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
