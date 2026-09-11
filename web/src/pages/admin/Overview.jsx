import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  SkeletonCards,
  Stat,
} from '../../components/UI.jsx';
import { DualLineChart, DonutChart, ChartLegend } from '../../components/Charts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { num, relative, tzs } from '../../lib/format.js';

/** The Pazo internal control plane (PRD 5.2). */
export default function AdminOverview() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi('/admin/overview');

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
        title="Could not load the overview"
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

  const { totals, today, this_month: month, attention, chart } = data;

  // Merge the three daily series into one dataset for the comparison chart.
  const combined = chart.sales.map((point, i) => ({
    date: point.date,
    commission: chart.commissions[i]?.value || 0,
    fees: chart.fees[i]?.value || 0,
  }));

  const partnerMix = [
    { name: 'Individuals', value: totals.individual_partners },
    { name: 'Organisations', value: totals.institution_partners },
  ];

  return (
    <div className="stack">
      {/* Things needing a decision */}
      {(attention.pending_approvals > 0 ||
        attention.pending_commissions_tzs > 0 ||
        attention.low_wallet_businesses.length > 0) && (
        <div className="stack-sm">
          {attention.pending_approvals > 0 && (
            <Banner
              tone="warn"
              title={`${attention.pending_approvals} organisation${attention.pending_approvals === 1 ? '' : 's'} awaiting review`}
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate('/admin/approvals')}>
                  Review
                </Button>
              }
            >
              Applications are reviewed within 24 hours of submission.
            </Banner>
          )}

          {attention.pending_commissions_tzs > 0 && (
            <Banner
              tone="error"
              title={`${tzs(attention.pending_commissions_tzs)} in unpaid commissions`}
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate('/admin/transactions?status=pending')}>
                  Open monitor
                </Button>
              }
            >
              {attention.pending_commission_count} commission
              {attention.pending_commission_count === 1 ? '' : 's'} could not be paid because a
              business wallet was short.
            </Banner>
          )}

          {attention.low_wallet_businesses.map((b) => (
            <Banner
              key={b.id}
              tone="warn"
              title={`${b.name} wallet is low`}
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/businesses?open=${b.id}`)}>
                  Top up
                </Button>
              }
            >
              Balance {tzs(b.balance_tzs)} is below their {tzs(b.threshold_tzs)} alert threshold.
            </Banner>
          ))}
        </div>
      )}

      {/* Today */}
      <div>
        <div className="section-head">
          <div>
            <div className="section-title">Today</div>
            <div className="section-sub">Platform activity since midnight UTC</div>
          </div>
        </div>
        <div className="stat-grid stagger">
          <Stat label="Transactions" value={num(today.transactions)} icon="activity" />
          <Stat
            label="Commissions paid"
            value={tzs(today.commissions_paid_tzs, { compact: true })}
            icon="banknote"
            tone="teal"
          />
          <Stat
            label="Platform fees earned"
            value={tzs(today.platform_fees_tzs, { compact: true })}
            icon="percent"
          />
          <Stat
            label="Pending commissions"
            value={tzs(attention.pending_commissions_tzs, { compact: true })}
            icon="clock"
            hint={`${attention.pending_commission_count} waiting`}
            onClick={() => navigate('/admin/transactions?status=pending')}
          />
        </div>
      </div>

      {/* Platform totals */}
      <div>
        <div className="section-head">
          <div>
            <div className="section-title">Platform</div>
            <div className="section-sub">All businesses, all partners, all time</div>
          </div>
        </div>
        <div className="stat-grid stagger">
          <Stat
            label="Businesses"
            value={num(totals.businesses)}
            icon="briefcase"
            hint={`${totals.businesses_active} active`}
            onClick={() => navigate('/admin/businesses')}
          />
          <Stat
            label="Individual partners"
            value={num(totals.individual_partners)}
            icon="user"
            onClick={() => navigate('/admin/partners?type=individual')}
          />
          <Stat
            label="Organisation partners"
            value={num(totals.institution_partners)}
            icon="building"
            onClick={() => navigate('/admin/partners?type=institution')}
          />
          <Stat
            label="Gross sales value"
            value={tzs(totals.gmv_tzs, { compact: true })}
            icon="trend-up"
            hint={`${num(totals.referrals)} referrals`}
          />
        </div>
      </div>

      <div className="grid-main-side">
        <Card pad={false}>
          <div className="card-head">
            <div>
              <div className="card-title">Commissions and platform fees</div>
              <div className="card-subtitle">Daily, last 30 days</div>
            </div>
            <Badge tone="teal">{tzs(month.platform_fees_tzs)} fees this month</Badge>
          </div>
          <div style={{ padding: 'var(--s-5) var(--s-4) var(--s-4)' }}>
            <DualLineChart
              data={combined}
              height={280}
              seriesA={{ key: 'commission', label: 'Commissions' }}
              seriesB={{ key: 'fees', label: 'Platform fees' }}
            />
            <ChartLegend
              items={[
                { name: 'Commissions to partners' },
                { name: 'Platform fees to Pazo', color: '#0f3460' },
              ]}
            />
          </div>
        </Card>

        <div className="stack">
          <Card pad={false}>
            <div className="card-head">
              <div className="card-title">Partner mix</div>
            </div>
            <div style={{ padding: 'var(--s-4)' }}>
              <DonutChart data={partnerMix} height={180} />
              <ChartLegend
                items={partnerMix.map((p) => ({ name: p.name, value: num(p.value) }))}
              />
            </div>
          </Card>

          <Card pad={false}>
            <div className="card-head">
              <div className="card-title">Business wallets</div>
            </div>
            <div style={{ padding: '0 var(--s-5)' }}>
              {data.businesses.map((b) => (
                <div
                  className="row-item"
                  key={b.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/admin/businesses?open=${b.id}`)}
                >
                  <div className="row-body">
                    <div className="row-title">{b.name}</div>
                    <div className="row-sub">{num(b.partners)} partners</div>
                  </div>
                  <div className="row-amount">{tzs(b.wallet_balance_tzs, { compact: true })}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad={false}>
            <div className="card-head">
              <div className="card-title">Recent admin activity</div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin/audit')}>
                Full log
              </Button>
            </div>
            <div style={{ padding: '0 var(--s-5)' }}>
              {data.recent_activity.length === 0 ? (
                <EmptyState icon="list-checks" title="No activity yet" />
              ) : (
                data.recent_activity.map((a, i) => (
                  <div className="row-item" key={i}>
                    <span className="row-icon gray">
                      <Icon name="shield" size={15} />
                    </span>
                    <div className="row-body">
                      <div className="row-title" style={{ fontSize: 'var(--t-sm)' }}>
                        {humanAction(a.action)}
                      </div>
                      <div className="row-sub">
                        {a.actor_name} · {relative(a.created_at)}
                      </div>
                    </div>
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

/** Turn `admin.wallet_topup` into "Wallet topup". */
export function humanAction(action) {
  const text = String(action).split('.').slice(1).join(' ').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
