import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Loading } from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { copyToClipboard, date, greeting, relative, tzs } from '../../lib/format.js';
import { useToast } from '../../app/ToastContext.jsx';

/**
 * The individual partner home. Answers three questions in order:
 * how much do I have, what is my code, and what just happened.
 */
export default function IndividualHome() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/individual/me/home');

  if (loading && !data) return <Loading label="Loading your dashboard" />;
  if (error)
    return (
      <Banner tone="error" title="Could not load your dashboard" action={<Button size="sm" variant="secondary" onClick={() => reload()}>Retry</Button>}>
        {error}
      </Banner>
    );
  if (!data) return null;

  const copyLink = async () => {
    const okay = await copyToClipboard(data.referral_link);
    toast[okay ? 'success' : 'error'](okay ? 'Referral link copied' : 'Could not copy the link');
  };

  const share = async () => {
    const text = `Get instant mobile data wherever you travel with The Travela. Sign up with my link: ${data.referral_link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join The Travela', text, url: data.referral_link });
        return;
      } catch {
        // The user dismissed the sheet; fall through to copying.
      }
    }
    const okay = await copyToClipboard(text);
    toast[okay ? 'success' : 'error'](okay ? 'Share message copied' : 'Could not copy');
  };

  return (
    <div className="stack">
      {data.announcement && (
        <Banner tone={data.announcement.variant === 'warning' ? 'warn' : 'info'} title={data.announcement.title}>
          {data.announcement.body}
        </Banner>
      )}

      {/* Balance */}
      <div className="hero-card anim-rise">
        <div className="hero-inner">
          <div className="hero-label">Account balance</div>
          <div className="hero-amount">{tzs(data.wallet_balance_tzs)}</div>
          <div className="hero-sub">
            {data.pending_tzs > 0
              ? `${tzs(data.pending_tzs)} pending · Available to withdraw now`
              : 'Available to withdraw'}
          </div>

          <div className="hero-actions">
            <button className="hero-action" onClick={() => navigate('/app/wallet?withdraw=1')}>
              <Icon name="send" size={17} />
              <span>Withdraw</span>
            </button>
            <button className="hero-action" onClick={() => navigate('/app/wallet')}>
              <Icon name="receipt" size={17} />
              <span>History</span>
            </button>
            <button className="hero-action" onClick={() => navigate('/app/code')}>
              <Icon name="qr" size={17} />
              <span>My code</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick numbers */}
      <div className="grid-3 keep-2 stagger">
        <Card>
          <div className="stat-label">Earned this month</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(data.earned_this_month_tzs, { compact: true })}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Total referrals</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {data.total_referrals}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Link clicks</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {data.total_clicks}
          </div>
        </Card>
      </div>

      {/* Referral code */}
      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">My referral code</div>
          <button
            onClick={() => navigate('/app/code')}
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

          <div
            style={{
              background: 'var(--navy)',
              borderRadius: 'var(--r-sm)',
              padding: '11px 13px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 'var(--s-3)',
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 'var(--t-sm)',
                color: 'rgba(255,255,255,.55)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {data.referral_link.replace(/^https?:\/\//, '')}
            </span>
            <button
              onClick={copyLink}
              style={{ fontSize: 'var(--t-sm)', fontWeight: 700, color: 'var(--teal-light)', flexShrink: 0 }}
            >
              Copy
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" icon="copy" onClick={copyLink} style={{ flex: 1 }}>
              Copy link
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="qr"
              onClick={() => navigate('/app/code')}
              style={{ flex: 1 }}
            >
              View QR
            </Button>
            <Button variant="secondary" size="sm" icon="share" onClick={share} style={{ flex: 1 }}>
              Share
            </Button>
          </div>
        </div>
      </Card>

      {/* Activity */}
      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">Recent activity</div>
          <button
            onClick={() => navigate('/app/wallet')}
            style={{ fontSize: 'var(--t-sm)', color: 'var(--teal)', fontWeight: 600 }}
          >
            See all
          </button>
        </div>

        <div style={{ padding: '0 var(--s-5)' }}>
          {data.activity.length === 0 ? (
            <EmptyState
              icon="activity"
              title="No activity yet"
              text="Share your code to get your first referral. Commissions show up here the moment a traveller buys."
              action={
                <Button variant="teal" icon="share" onClick={share}>
                  Share my link
                </Button>
              }
            />
          ) : (
            data.activity.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} />)
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * One activity row. Traveller identity is never shown here — only the event
 * type, the bundle and the date, per the platform privacy rule.
 */
function ActivityRow({ item }) {
  if (item.kind === 'commission') {
    return (
      <div className="row-item">
        <span className={`row-icon ${item.status === 'paid' ? 'green' : 'amber'}`}>
          <Icon name="banknote" size={17} />
        </span>
        <div className="row-body">
          <div className="row-title">
            {item.status === 'paid' ? 'Commission earned' : 'Commission pending'}
          </div>
          <div className="row-sub">
            {item.label || 'Data bundle'} · {date(item.created_at)}
          </div>
        </div>
        <div className={`row-amount ${item.status === 'paid' ? 'pos' : ''}`}>
          {tzs(item.amount_tzs, { sign: item.status === 'paid' })}
        </div>
      </div>
    );
  }

  if (item.kind === 'referral') {
    return (
      <div className="row-item">
        <span className="row-icon teal">
          <Icon name="user-plus" size={17} />
        </span>
        <div className="row-body">
          <div className="row-title">New referral</div>
          <div className="row-sub">Someone signed up with your code · {date(item.created_at)}</div>
        </div>
        <Badge tone="teal">+1</Badge>
      </div>
    );
  }

  return (
    <div className="row-item">
      <span className="row-icon amber">
        <Icon name="arrow-up-right" size={17} />
      </span>
      <div className="row-body">
        <div className="row-title">Withdrawal</div>
        <div className="row-sub">
          To {item.label} · {relative(item.created_at)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="row-amount neg">-{tzs(item.amount_tzs).replace('TZS ', 'TZS ')}</div>
        <Badge status={item.status} />
      </div>
    </div>
  );
}
