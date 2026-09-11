import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Loading } from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { copyToClipboard, date, monthLabel, statusLabel, tzs } from '../../lib/format.js';
import { useToast } from '../../app/ToastContext.jsx';

/**
 * Institution home. The key difference from the individual view: the balance
 * is not withdrawable, it accumulates and is paid automatically on the 1st.
 * The hero says exactly that, so nobody goes hunting for a withdraw button.
 */
export default function InstitutionHome() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/institution/me/home');

  if (loading && !data) return <Loading label="Loading your dashboard" />;
  if (error)
    return (
      <Banner
        tone="error"
        title="Could not load your dashboard"
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

  const copyLink = async () => {
    const okay = await copyToClipboard(data.referral_link);
    toast[okay ? 'success' : 'error'](okay ? 'Referral link copied' : 'Could not copy the link');
  };

  const daysToPayout = Math.max(
    0,
    Math.ceil((new Date(data.next_payout_date).getTime() - Date.now()) / 86_400_000),
  );

  return (
    <div className="stack">
      {data.announcement && (
        <Banner
          tone={data.announcement.variant === 'warning' ? 'warn' : 'info'}
          title={data.announcement.title}
        >
          {data.announcement.body}
        </Banner>
      )}

      {/* Accumulated balance */}
      <div className="hero-card anim-rise">
        <div className="hero-inner">
          <div className="hero-label">Accumulated balance this month</div>
          <div className="hero-amount">{tzs(data.accumulated_balance_tzs)}</div>
          <div className="hero-sub">
            Paid automatically on {date(data.next_payout_date)}
            {daysToPayout > 0 ? ` · in ${daysToPayout} day${daysToPayout === 1 ? '' : 's'}` : ''}
          </div>

          <div className="hero-actions">
            <button className="hero-action" onClick={() => navigate('/institution/payouts')}>
              <Icon name="calendar" size={17} />
              <span>Payouts</span>
            </button>
            <button className="hero-action" onClick={() => navigate('/institution/earnings')}>
              <Icon name="receipt" size={17} />
              <span>Earnings</span>
            </button>
            <button className="hero-action" onClick={() => navigate('/institution/code')}>
              <Icon name="qr" size={17} />
              <span>Our code</span>
            </button>
          </div>
        </div>
      </div>

      {/* This month */}
      <div className="grid-2">
        <Card>
          <div className="stat-label">Referrals this month</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {data.referrals_this_month}
          </div>
          <div className="stat-foot">{data.total_referrals} all time</div>
        </Card>
        <Card>
          <div className="stat-label">Sales generated</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(data.sales_this_month_tzs, { compact: true })}
          </div>
          <div className="stat-foot">This month, through your code</div>
        </Card>
      </div>

      {/* Last payout */}
      {data.last_payout && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="row-icon green">
              <Icon name="check-circle" size={17} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                Last payout: {tzs(data.last_payout.amount_tzs)}
              </div>
              <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                {monthLabel(data.last_payout.month)} · sent {date(data.last_payout.completed_at)}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/institution/payouts')}>
              View
            </Button>
          </div>
        </Card>
      )}

      {/* Referral code */}
      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">Our referral code</div>
          <button
            onClick={() => navigate('/institution/code')}
            style={{ fontSize: 'var(--t-sm)', color: 'var(--teal)', fontWeight: 600 }}
          >
            See more →
          </button>
        </div>
        <div style={{ padding: 'var(--s-5)' }}>
          <div
            style={{
              background: 'var(--surface-sunken)',
              border: '1.5px dashed var(--teal-light)',
              borderRadius: 'var(--r-md)',
              padding: 'var(--s-4)',
              textAlign: 'center',
              marginBottom: 'var(--s-3)',
            }}
          >
            <div
              style={{
                fontSize: 'var(--t-2xl)',
                fontWeight: 800,
                color: 'var(--teal)',
                letterSpacing: '0.14em',
                overflowWrap: 'anywhere',
              }}
            >
              {data.referral_code}
            </div>
          </div>
          <Button variant="secondary" block icon="copy" onClick={copyLink}>
            Copy referral link
          </Button>
        </div>
      </Card>

      {/* Recent commissions */}
      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">Recent commissions</div>
          <button
            onClick={() => navigate('/institution/earnings')}
            style={{ fontSize: 'var(--t-sm)', color: 'var(--teal)', fontWeight: 600 }}
          >
            See all
          </button>
        </div>
        <div style={{ padding: '0 var(--s-5)' }}>
          {data.recent_commissions.length === 0 ? (
            <EmptyState
              icon="banknote"
              title="No commissions yet"
              text="Share your code with guests and travellers. Commissions appear here as they buy."
            />
          ) : (
            data.recent_commissions.map((t) => (
              <div className="row-item" key={t.id}>
                <span className={`row-icon ${t.status === 'paid' ? 'green' : 'amber'}`}>
                  <Icon name="banknote" size={17} />
                </span>
                <div className="row-body">
                  <div className="row-title">{t.bundle_type || 'Data bundle'}</div>
                  <div className="row-sub">
                    {statusLabel(t.transaction_type)} · {date(t.created_at)}
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
      </Card>
    </div>
  );
}
