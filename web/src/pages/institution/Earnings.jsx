import { useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  Pagination,
  SkeletonRows,
} from '../../components/UI.jsx';
import { TrendAreaChart } from '../../components/Charts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { date, dateTime, statusLabel, tzs } from '../../lib/format.js';

export default function InstitutionEarnings() {
  const [page, setPage] = useState(1);
  const wallet = useApi('/institution/me/wallet');
  const chart = useApi('/institution/me/earnings-chart?days=30');
  const list = useApi(`/institution/me/transactions?page=${page}&limit=20`, { deps: [page] });

  const w = wallet.data;
  if (wallet.loading && !w) return <Loading label="Loading earnings" />;

  return (
    <div className="stack">
      <div className="grid-3 keep-2">
        <Card>
          <div className="stat-label">Accumulated this month</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(w?.accumulated_balance_tzs, { compact: true })}
          </div>
          <div className="stat-foot">Paid {date(w?.next_payout_date)}</div>
        </Card>
        <Card>
          <div className="stat-label">Earned this month</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(w?.earned_this_month_tzs, { compact: true })}
          </div>
          <div className="stat-foot">{w?.transactions_this_month} transactions</div>
        </Card>
        <Card>
          <div className="stat-label">Lifetime earned</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(w?.lifetime_earned_tzs, { compact: true })}
          </div>
          <div className="stat-foot">Since joining</div>
        </Card>
      </div>

      {chart.data?.series?.some((d) => d.value > 0) && (
        <Card pad={false}>
          <div className="card-head">
            <div>
              <div className="card-title">Commissions, last 30 days</div>
              <div className="card-subtitle">Added to your monthly balance</div>
            </div>
          </div>
          <div style={{ padding: 'var(--s-4) var(--s-4) var(--s-3)' }}>
            <TrendAreaChart data={chart.data.series} height={200} />
          </div>
        </Card>
      )}

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Commission history</div>
            <div className="card-subtitle">
              Traveller details are never shown — only the bundle, date and amount
            </div>
          </div>
        </div>

        <div style={{ padding: '0 var(--s-5)' }}>
          {list.loading && !list.data ? (
            <SkeletonRows count={6} />
          ) : !list.data?.items?.length ? (
            <EmptyState
              icon="banknote"
              title="No commissions yet"
              text="Commissions appear here as travellers referred by your code buy data."
            />
          ) : (
            list.data.items.map((t) => (
              <div className="row-item" key={t.id}>
                <span className={`row-icon ${t.status === 'paid' ? 'green' : 'amber'}`}>
                  <Icon name="banknote" size={17} />
                </span>
                <div className="row-body">
                  <div className="row-title">{t.bundle_type || 'Data bundle'}</div>
                  <div className="row-sub">
                    {statusLabel(t.transaction_type)} · Sale {tzs(t.sale_tzs)} · {dateTime(t.created_at)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`row-amount ${t.status === 'paid' ? 'pos' : ''}`}>
                    {tzs(t.commission_tzs, { sign: t.status === 'paid' })}
                  </div>
                  {t.status !== 'paid' && <Badge status={t.status} />}
                </div>
              </div>
            ))
          )}
        </div>

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
