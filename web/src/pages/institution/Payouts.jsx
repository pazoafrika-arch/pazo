import { Icon } from '../../components/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Loading } from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { date, monthLabel, num, tzs } from '../../lib/format.js';

/**
 * The monthly payout record (PRD 3.3). The current month appears first as an
 * "Upcoming" row so the answer to "when do I next get paid?" is always visible.
 */
export default function InstitutionPayouts() {
  const { data, loading, error, reload } = useApi('/institution/me/payouts');

  if (loading && !data) return <Loading label="Loading payouts" />;
  if (error)
    return (
      <Banner
        tone="error"
        title="Could not load payouts"
        action={
          <Button size="sm" variant="secondary" onClick={() => reload()}>
            Retry
          </Button>
        }
      >
        {error}
      </Banner>
    );

  const items = data?.items || [];
  const paid = items.filter((i) => i.status === 'completed');
  const totalPaid = paid.reduce((s, i) => s + i.commission_tzs, 0);

  /**
   * Statements are an authenticated endpoint, so they cannot be a plain link.
   * The document is fetched and opened in a new tab, where the browser's own
   * print dialog produces the PDF.
   */
  const openStatement = async (month) => {
    const key = new Date(month).toISOString().slice(0, 7);
    const res = await api.raw(`/institution/me/statements/${key}`);
    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="stack">
      <div className="grid-2">
        <Card>
          <div className="stat-label">Next payout</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {date(data?.next_payout_date)}
          </div>
          <div className="stat-foot">Automatic, on the 1st of each month</div>
        </Card>
        <Card>
          <div className="stat-label">Paid to date</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(totalPaid, { compact: true })}
          </div>
          <div className="stat-foot">
            Across {paid.length} payout{paid.length === 1 ? '' : 's'}
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Monthly payouts</div>
            <div className="card-subtitle">Every month, with a downloadable statement</div>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No payouts yet"
            text="Your first payout is sent on the 1st of the month after you start earning."
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Referrals</th>
                  <th className="num">Sales</th>
                  <th className="num">Commission</th>
                  <th>Status</th>
                  <th>Statement</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-primary" data-label="Month">
                      {monthLabel(p.month)}
                    </td>
                    <td className="num" data-label="Referrals">
                      {num(p.referrals)}
                    </td>
                    <td className="num" data-label="Sales">
                      {tzs(p.sales_tzs)}
                    </td>
                    <td className="num strong" data-label="Commission">
                      {tzs(p.commission_tzs)}
                    </td>
                    <td data-label="Status">
                      {p.upcoming ? (
                        <Badge tone="teal">Upcoming {date(p.expected_at)}</Badge>
                      ) : (
                        <Badge status={p.status}>
                          {p.status === 'completed' ? `Paid ${date(p.paid_at)}` : undefined}
                        </Badge>
                      )}
                    </td>
                    <td data-label="Statement">
                      {p.upcoming ? (
                        <span style={{ color: 'var(--text-3)', fontSize: 'var(--t-sm)' }}>
                          Available after payout
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="file-text"
                          onClick={() => openStatement(p.month)}
                        >
                          Statement
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span className="row-icon teal">
            <Icon name="info" size={17} />
          </span>
          <div style={{ fontSize: 'var(--t-base)', color: 'var(--text-2)', lineHeight: 1.65 }}>
            Commissions accumulate through the month and are paid to your registered account on the
            1st. Statements list every transaction in the period without any traveller personal
            data.
          </div>
        </div>
      </Card>
    </div>
  );
}
