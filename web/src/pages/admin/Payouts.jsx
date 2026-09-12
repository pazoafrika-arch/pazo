import { useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Loading,
  Pagination,
  SkeletonRows,
  Tabs,
} from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api, downloadFile } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, monthLabel, num, relative, tzs } from '../../lib/format.js';

/**
 * Monthly institution payouts (PRD 5.7) plus the agent withdrawal queue, which
 * is disbursed automatically through ClickPesa.
 */
export default function AdminPayouts() {
  const [tab, setTab] = useState('due');
  return (
    <div className="stack">
      <Card pad={false}>
        <div style={{ padding: '0 var(--s-5)' }}>
          <Tabs
            tabs={[
              { value: 'due', label: 'Due this month' },
              { value: 'history', label: 'Payout history' },
              { value: 'withdrawals', label: 'Agent withdrawals' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </Card>

      {tab === 'due' && <PayoutsDue />}
      {tab === 'history' && <PayoutHistory />}
      {tab === 'withdrawals' && <Withdrawals />}
    </div>
  );
}

/* ---------------- due this month ---------------- */
function PayoutsDue() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/admin/payouts/monthly/pending');
  const [batchOpen, setBatchOpen] = useState(false);
  const [single, setSingle] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading label="Loading payouts due" />;
  if (!data) return null;

  const processBatch = async () => {
    setBusy(true);
    try {
      const res = await api.post('/admin/payouts/monthly/process', { month: data.month });
      toast.success(
        `${res.processed.length} payout${res.processed.length === 1 ? '' : 's'} processed, ${tzs(res.total_tzs)} in total`,
      );
      if (res.failed.length) toast.warn(`${res.failed.length} could not be processed`);
      setBatchOpen(false);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const processOne = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/admin/payouts/monthly/${single.partner_id}/process`, {
        month: data.month,
      });
      toast.success(`${tzs(res.amount_tzs)} sent to ${res.organisation_name}`);
      setSingle(null);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const queued = data.items.filter((i) => i.status === 'queued');

  return (
    <div className="stack">
      <div className="grid-2">
        <Card>
          <div className="stat-label">Institutions due</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-2xl)', marginTop: 4 }}>
            {num(data.summary.institutions)}
          </div>
          <div className="stat-foot">For {monthLabel(data.month)}</div>
        </Card>
        <Card>
          <div className="stat-label">Total to pay out</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-2xl)', marginTop: 4 }}>
            {tzs(data.summary.total_tzs)}
          </div>
          <div className="stat-foot">Accumulated balances</div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Payouts due</div>
            <div className="card-subtitle">
              Processing zeroes the accumulated balance and notifies the organisation
            </div>
          </div>
          {queued.length > 0 && (
            <Button variant="teal" icon="send" onClick={() => setBatchOpen(true)}>
              Process all ({queued.length})
            </Button>
          )}
        </div>

        {data.items.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title="Nothing due"
            text="No organisation has an accumulated balance this cycle."
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Payout account</th>
                  <th className="num">Referrals</th>
                  <th className="num">Sales</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.partner_id}>
                    <td className="cell-primary" data-label="Organisation">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <Avatar
                          name={i.organisation_name}
                          size="sm"
                          square
                          color="#0f3460"
                          userId={i.user_id}
                        />
                        <span>
                          {i.organisation_name}
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-sm)',
                              color: 'var(--text-3)',
                              fontWeight: 400,
                            }}
                          >
                            {i.referral_code}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Payout account">
                      {i.payout_account_masked}
                      {!i.payout_account_verified && (
                        <Badge tone="amber" className="badge">
                          Unverified
                        </Badge>
                      )}
                    </td>
                    <td className="num" data-label="Referrals">
                      {num(i.referral_count)}
                    </td>
                    <td className="num" data-label="Sales">
                      {tzs(i.sales_tzs, { compact: true })}
                    </td>
                    <td className="num strong" data-label="Amount">
                      {tzs(i.accumulated_balance_tzs)}
                    </td>
                    <td data-label="Status">
                      <Badge status={i.status} />
                    </td>
                    <td data-label="Action">
                      {i.status === 'queued' && (
                        <Button variant="ghost" size="sm" onClick={() => setSingle(i)}>
                          Pay now
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

      <ConfirmDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onConfirm={processBatch}
        loading={busy}
        title={`Process ${queued.length} payout${queued.length === 1 ? '' : 's'}?`}
        message={`${tzs(data.summary.total_tzs)} will be marked as paid for ${monthLabel(data.month)}. Each organisation is notified and their accumulated balance resets to zero. Confirm the bank transfers have been made before continuing.`}
        confirmLabel="Process all payouts"
        tone="teal"
      />

      <ConfirmDialog
        open={!!single}
        onClose={() => setSingle(null)}
        onConfirm={processOne}
        loading={busy}
        title={`Pay ${single?.organisation_name}?`}
        message={
          single
            ? `${tzs(single.accumulated_balance_tzs)} will be marked as paid to ${single.payout_account_masked} and their balance reset to zero.`
            : ''
        }
        confirmLabel="Mark as paid"
        tone="teal"
      />
    </div>
  );
}

/* ---------------- history ---------------- */
function PayoutHistory() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, loading } = useApi(`/admin/payouts/monthly/history?page=${page}&limit=25`, {
    deps: [page],
  });

  return (
    <Card pad={false}>
      <div className="card-head">
        <div>
          <div className="card-title">Payout history</div>
          <div className="card-subtitle">Every monthly payout processed</div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          onClick={() =>
            downloadFile('/admin/payouts/monthly/history?format=csv&limit=100', 'pazo-payouts.csv').catch(
              () => toast.error('Could not export'),
            )
          }
        >
          Export
        </Button>
      </div>

      {loading && !data ? (
        <SkeletonRows count={6} />
      ) : !data?.items?.length ? (
        <EmptyState icon="calendar" title="No payouts yet" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Organisation</th>
                  <th className="num">Transactions</th>
                  <th className="num">Sales</th>
                  <th className="num">Amount</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-primary" data-label="Month">
                      {monthLabel(p.month)}
                    </td>
                    <td data-label="Organisation">
                      {p.organisation_name}
                      <span
                        style={{ display: 'block', fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}
                      >
                        {p.referral_code}
                      </span>
                    </td>
                    <td className="num" data-label="Transactions">
                      {num(p.transaction_count)}
                    </td>
                    <td className="num" data-label="Sales">
                      {tzs(p.sales_total_tzs, { compact: true })}
                    </td>
                    <td className="num strong" data-label="Amount">
                      {tzs(p.amount_tzs)}
                    </td>
                    <td data-label="Reference">
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                        {p.reference || '—'}
                      </code>
                    </td>
                    <td data-label="Status">
                      <Badge status={p.status} />
                      {p.completed_at && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 'var(--t-xs)',
                            color: 'var(--text-3)',
                            marginTop: 3,
                          }}
                        >
                          {date(p.completed_at)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.limit && (
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={data.limit}
              onPage={setPage}
            />
          )}
        </>
      )}
    </Card>
  );
}

/* ---------------- agent withdrawals ---------------- */
function Withdrawals() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('queued');
  const [failTarget, setFailTarget] = useState(null);
  const [retryTarget, setRetryTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const gateway = useApi('/admin/gateway/status');
  const { data, loading, reload } = useApi(
    `/admin/withdrawals?page=${page}&limit=25&status=${status}`,
    { deps: [page, status] },
  );

  const act = async (fn, successMessage) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(typeof successMessage === 'function' ? successMessage(res) : successMessage);
      setFailTarget(null);
      setRetryTarget(null);
      reload({ quiet: true });
      gateway.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const g = gateway.data;

  return (
    <div className="stack">
      {g && !g.configured && (
        <Banner tone="warn" title="Payment gateway not configured">
          Withdrawals are accepted and queued, but nothing is sent until ClickPesa credentials are
          set. Partners keep their debited balance safely in the queue.
        </Banner>
      )}

      {g && g.configured && !g.checksum_enabled && (
        <Banner tone="warn" title="Webhook checksums are not enabled">
          Callbacks cannot be verified by signature, so every one is confirmed against the gateway
          before money moves. Set a checksum key in the ClickPesa portal to remove that round trip.
        </Banner>
      )}

      {g && (
        <div className="stat-grid">
          <Card>
            <div className="stat-label">In the queue</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {num(g.queue.queued)}
            </div>
            <div className="stat-foot">{tzs(g.queue.queued_tzs, { compact: true })} waiting</div>
          </Card>
          <Card>
            <div className="stat-label">Sending now</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {num(g.queue.processing)}
            </div>
            <div className="stat-foot">At the gateway</div>
          </Card>
          <Card>
            <div className="stat-label">Sent today</div>
            <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {tzs(g.queue.sent_today_tzs, { compact: true })}
            </div>
            <div className="stat-foot">Rolling 24 hours</div>
          </Card>
          <Card>
            <div className="stat-label">Gateway float</div>
            <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
              {g.balance?.[0]?.availableBalance !== undefined
                ? tzs(g.balance[0].availableBalance, { compact: true })
                : '—'}
            </div>
            <div className="stat-foot">
              {g.balance_error ? (
                <span style={{ color: 'var(--amber)' }}>{g.balance_error}</span>
              ) : (
                'Available at ClickPesa'
              )}
            </div>
          </Card>
        </div>
      )}

      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Agent withdrawals</div>
            <div className="card-subtitle">
              Paid automatically to mobile money, one every minute
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="sm"
              icon="send"
              loading={busy}
              onClick={() => act(() => api.post('/admin/gateway/drain-queue'), (r) =>
                r.sent ? 'Next payout sent' : `Nothing sent (${r.skipped || 'queue empty'})`,
              )}
            >
              Send next
            </Button>
            <div className="segmented">
              {['queued', 'processing', 'completed', 'failed'].map((st) => (
                <button
                  key={st}
                  className={`segment ${status === st ? 'active' : ''}`}
                  onClick={() => {
                    setStatus(st);
                    setPage(1);
                  }}
                >
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && !data ? (
          <SkeletonRows count={5} />
        ) : !data?.items?.length ? (
          <EmptyState
            icon={status === 'failed' ? 'check-circle' : 'inbox'}
            title={status === 'failed' ? 'No failed payouts' : `No ${status} withdrawals`}
            text={
              status === 'queued'
                ? 'Withdrawals appear here the moment a partner requests one.'
                : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th>Destination</th>
                    <th className="num">Amount</th>
                    <th>Requested</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((w) => (
                    <tr key={w.id}>
                      <td className="cell-primary" data-label="Partner">
                        {w.partner_name}
                        <span
                          style={{
                            display: 'block',
                            fontSize: 'var(--t-sm)',
                            color: 'var(--text-3)',
                            fontWeight: 400,
                          }}
                        >
                          {w.referral_code}
                        </span>
                      </td>
                      <td data-label="Destination">
                        {w.destination}
                        {w.beneficiary_name && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-sm)',
                              color: 'var(--text-3)',
                            }}
                          >
                            {w.beneficiary_name}
                            {w.channel_provider ? ` · ${w.channel_provider}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="num strong" data-label="Amount">
                        {tzs(w.amount_tzs)}
                        {w.fee_tzs > 0 && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-xs)',
                              color: 'var(--text-3)',
                              fontWeight: 400,
                            }}
                          >
                            fee {tzs(w.fee_tzs)}
                          </span>
                        )}
                      </td>
                      <td data-label="Requested">{relative(w.requested_at)}</td>
                      <td data-label="Status">
                        <Badge status={w.status} />
                        {w.failure_reason && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-xs)',
                              color: 'var(--text-3)',
                              marginTop: 3,
                            }}
                          >
                            {w.failure_reason}
                          </span>
                        )}
                        {w.attempts > 1 && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--t-xs)',
                              color: 'var(--text-3)',
                            }}
                          >
                            {w.attempts} attempts
                          </span>
                        )}
                      </td>
                      <td data-label="Action">
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {['failed', 'reversed', 'queued'].includes(w.status) && (
                            <Button
                              variant="teal"
                              size="sm"
                              icon="refresh"
                              onClick={() => setRetryTarget(w)}
                            >
                              Retry
                            </Button>
                          )}
                          {w.status === 'processing' && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon="refresh"
                                onClick={() =>
                                  act(
                                    () => api.post(`/admin/withdrawals/${w.id}/reconcile`),
                                    'Checked against the gateway',
                                  )
                                }
                              >
                                Check
                              </Button>
                              <Button
                                variant="danger-ghost"
                                size="sm"
                                onClick={() => setFailTarget(w)}
                              >
                                Fail
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.total > data.limit && (
              <Pagination
                page={data.page}
                pages={data.pages}
                total={data.total}
                limit={data.limit}
                onPage={setPage}
              />
            )}
          </>
        )}
      </Card>

      {g?.recent_events?.length > 0 && (
        <Card pad={false}>
          <div className="card-head">
            <div>
              <div className="card-title">Recent gateway callbacks</div>
              <div className="card-subtitle">Every webhook ClickPesa has sent</div>
            </div>
          </div>
          <div style={{ padding: '0 var(--s-5)' }}>
            {g.recent_events.map((e, i) => (
              <div className="row-item" key={i}>
                <span className={`row-icon ${e.signature_valid ? 'green' : 'amber'}`}>
                  <Icon name={e.signature_valid ? 'shield' : 'alert-triangle'} size={15} />
                </span>
                <div className="row-body">
                  <div className="row-title" style={{ fontSize: 'var(--t-sm)' }}>
                    {e.event_type}
                  </div>
                  <div className="row-sub">
                    {e.order_reference || 'no reference'} · {e.process_result || 'pending'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Badge tone={e.signature_valid ? 'green' : 'amber'}>
                    {e.signature_valid ? 'Verified' : 'Unsigned'}
                  </Badge>
                  <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)', marginTop: 3 }}>
                    {relative(e.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!retryTarget}
        onClose={() => setRetryTarget(null)}
        onConfirm={() =>
          act(
            () => api.post(`/admin/withdrawals/${retryTarget.id}/retry`),
            'Payout re-queued',
          )
        }
        loading={busy}
        title={`Retry this payout?`}
        message={
          retryTarget
            ? `${tzs(retryTarget.amount_tzs)} to ${retryTarget.partner_name}. A failed payout was already refunded, so retrying takes the amount back out of their wallet and sends it again with a fresh reference.`
            : ''
        }
        confirmLabel="Retry payout"
        tone="teal"
      />

      <ConfirmDialog
        open={!!failTarget}
        onClose={() => setFailTarget(null)}
        onConfirm={() =>
          act(
            () =>
              api.post(`/admin/withdrawals/${failTarget.id}/fail`, {
                reason: 'Marked failed by Pazo admin',
              }),
            (r) => `${tzs(r.refunded_tzs)} returned to the partner`,
          )
        }
        loading={busy}
        title="Mark this payout failed?"
        message={
          failTarget
            ? `${tzs(failTarget.amount_tzs)} is returned to ${failTarget.partner_name}'s wallet. Only do this when the gateway has confirmed the money did not leave.`
            : ''
        }
        confirmLabel="Fail and refund"
        tone="danger"
      />
    </div>
  );
}
