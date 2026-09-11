import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  SkeletonCards,
  Stat,
} from '../../components/UI.jsx';
import { DailyBarChart } from '../../components/Charts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { num, ratePct, tzs } from '../../lib/format.js';

/** The Travela's control centre (PRD 4.2). */
export default function BusinessOverview() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi('/business/me/overview');

  if (loading && !data)
    return (
      <div className="stack">
        <SkeletonCards count={4} />
        <div className="skeleton" style={{ height: 300, borderRadius: 'var(--r-lg)' }} />
      </div>
    );
  if (error)
    return (
      <Banner
        tone="error"
        title="Could not load the dashboard"
        action={
          <Button size="sm" variant="secondary" onClick={() => reload()}>
            Retry
          </Button>
        }
      >
        {error}
      </Banner>
    );
  if (!data) return null;

  const { cards, wallet } = data;

  return (
    <div className="stack">
      {wallet.low_balance && (
        <Banner
          tone="warn"
          title="Wallet balance is low"
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/business/wallet')}>
              View wallet
            </Button>
          }
        >
          Your balance of {tzs(wallet.balance_tzs)} is below your alert threshold of{' '}
          {tzs(wallet.alert_threshold_tzs)}. Top up to keep commissions paying automatically.
        </Banner>
      )}

      {wallet.pending_commissions_tzs > 0 && (
        <Banner
          tone="error"
          title="Commissions are waiting on funds"
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/business/wallet')}>
              Resolve
            </Button>
          }
        >
          {tzs(wallet.pending_commissions_tzs)} could not be paid to partners because the wallet was
          short. They pay automatically once you top up.
        </Banner>
      )}

      <div className="stat-grid stagger">
        <Stat
          label="Active partners"
          value={num(cards.active_partners.value)}
          icon="users"
          delta={cards.active_partners.change_pct}
          hint="vs last 30 days"
          onClick={() => navigate('/business/partners')}
        />
        <Stat
          label="Referrals this month"
          value={num(cards.referrals_this_month.value)}
          icon="user-plus"
          delta={cards.referrals_this_month.change_pct}
          hint="vs last month"
          onClick={() => navigate('/business/referrals')}
        />
        <Stat
          label="Sales through referrals"
          value={tzs(cards.sales_this_month_tzs.value, { compact: true })}
          icon="trend-up"
          delta={cards.sales_this_month_tzs.change_pct}
          hint="this month"
        />
        <Stat
          label="Commissions paid"
          value={tzs(cards.commissions_this_month_tzs.value, { compact: true })}
          icon="banknote"
          delta={cards.commissions_this_month_tzs.change_pct}
          hint="this month"
          tone="teal"
          onClick={() => navigate('/business/commissions')}
        />
      </div>

      <div className="grid-main-side">
        <Card pad={false}>
          <div className="card-head">
            <div>
              <div className="card-title">Referral-driven sales</div>
              <div className="card-subtitle">Daily purchase value, last 30 days</div>
            </div>
            <Badge tone="teal">{num(data.transactions_this_month)} transactions this month</Badge>
          </div>
          <div style={{ padding: 'var(--s-5) var(--s-4) var(--s-4)' }}>
            <DailyBarChart data={data.daily_sales} height={280} />
          </div>
        </Card>

        <div className="stack">
          <Card pad={false}>
            <div className="card-head">
              <div className="card-title">Wallet</div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/business/wallet')}>
                Manage
              </Button>
            </div>
            <div style={{ padding: 'var(--s-5)' }}>
              <div
                className="stat-value"
                style={{ color: wallet.low_balance ? 'var(--amber)' : 'var(--navy)' }}
              >
                {tzs(wallet.balance_tzs)}
              </div>
              <div className="stat-foot" style={{ marginTop: 6 }}>
                {wallet.low_balance ? (
                  <Badge tone="amber" dot>
                    Below threshold
                  </Badge>
                ) : (
                  <Badge tone="green" dot>
                    Healthy
                  </Badge>
                )}
                <span>Alert at {tzs(wallet.alert_threshold_tzs, { compact: true })}</span>
              </div>

              <div className="divider" style={{ margin: 'var(--s-4) 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--t-sm)' }}>
                <span style={{ color: 'var(--text-3)' }}>Commission rate</span>
                <strong>{ratePct(data.business.commission_rate)}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--t-sm)',
                  marginTop: 7,
                }}
              >
                <span style={{ color: 'var(--text-3)' }}>Pazo platform fee</span>
                <strong>{ratePct(data.business.platform_fee_rate)}</strong>
              </div>
            </div>
          </Card>

          <Card pad={false}>
            <div className="card-head">
              <div className="card-title">Top partners this month</div>
            </div>
            <div style={{ padding: '0 var(--s-5)' }}>
              {data.top_partners.length === 0 ? (
                <EmptyState icon="users" title="No partner activity yet" />
              ) : (
                data.top_partners.map((p, i) => (
                  <div
                    className="row-item"
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/business/partners?open=${p.id}`)}
                  >
                    <span
                      className="row-icon"
                      style={{
                        background: i === 0 ? 'var(--teal-xlight)' : 'var(--gray-100)',
                        color: i === 0 ? 'var(--teal)' : 'var(--gray-500)',
                        fontWeight: 800,
                        fontSize: 'var(--t-sm)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="row-body">
                      <div className="row-title">{p.name}</div>
                      <div className="row-sub">
                        {p.referral_code} · {p.transactions} transaction
                        {p.transactions === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="row-amount">{tzs(p.commission_tzs, { compact: true })}</div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
