import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Banner,
  Button,
  Card,
  CopyField,
  DetailList,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  Pagination,
  SkeletonRows,
  Tabs,
} from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { dateTime, num, tzs } from '../../lib/format.js';

/**
 * The pre-loaded wallet commissions are paid from (PRD 4.6).
 *
 * Topping up by mobile money is instant: a prompt is pushed to the payer's
 * phone through ClickPesa and the wallet is credited when the provider
 * confirms. Bank transfer stays available for larger amounts and is credited
 * by the Pazo finance team.
 */
export default function BusinessWallet() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [topupOpen, setTopupOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const [ledgerTab, setLedgerTab] = useState('ledger');
  const { data, loading, reload } = useApi(`/business/me/wallet?page=${page}&limit=25`, {
    deps: [page],
  });
  const topups = useApi('/business/me/wallet/topups?limit=15');

  if (loading && !data) return <Loading label="Loading wallet" />;
  if (!data) return null;

  const settlePending = async () => {
    setSettling(true);
    try {
      const res = await api.post('/business/me/wallet/settle-pending');
      if (res.settled > 0) {
        toast.success(
          `${res.settled} commission${res.settled === 1 ? '' : 's'} paid, ${tzs(res.total_tzs)} in total`,
        );
      } else {
        toast.warn('Not enough balance to settle the pending commissions');
      }
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="stack">
      {data.low_balance && (
        <Banner
          tone="warn"
          title="Wallet balance is low"
          action={
            <Button size="sm" variant="secondary" onClick={() => setTopupOpen(true)}>
              How to top up
            </Button>
          }
        >
          You are below your alert threshold of {tzs(data.alert_threshold_tzs)}. Commissions stop
          paying automatically once the balance runs out.
        </Banner>
      )}

      <div className="grid-main-side">
        <div className="stack">
          <div className="hero-card">
            <div className="hero-inner">
              <div className="hero-label">Wallet balance</div>
              <div className="hero-amount">{tzs(data.balance_tzs)}</div>
              <div className="hero-sub">
                Commissions are paid from this balance as transactions come in
              </div>
              <div className="hero-actions">
                <button className="hero-action" onClick={() => setTopupOpen(true)}>
                  <Icon name="upload" size={17} />
                  <span>Top up</span>
                </button>
              </div>
            </div>
          </div>

          <Card pad={false}>
            <div className="card-head">
              <div>
                <div className="card-title">Wallet history</div>
                <div className="card-subtitle">Every top-up and every commission paid out</div>
              </div>
            </div>

            <div style={{ padding: '0 var(--s-5)' }}>
              <Tabs
                tabs={[
                  { value: 'ledger', label: 'All movements' },
                  { value: 'topups', label: 'Top-ups', count: topups.data?.total },
                ]}
                value={ledgerTab}
                onChange={setLedgerTab}
              />
            </div>

            {ledgerTab === 'topups' ? (
              <TopupHistory data={topups.data} loading={topups.loading} />
            ) : data.ledger.items.length === 0 ? (
              <EmptyState icon="receipt" title="No wallet activity yet" />
            ) : (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th className="num">Amount</th>
                      <th className="num">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.items.map((l) => (
                      <tr key={l.id}>
                        <td className="cell-primary" data-label="Date">
                          {dateTime(l.created_at)}
                        </td>
                        <td data-label="Description">{l.description || '—'}</td>
                        <td data-label="Type">
                          <Badge tone={l.amount_tzs > 0 ? 'green' : 'gray'}>
                            {l.entry_type === 'topup'
                              ? 'Top-up'
                              : l.entry_type === 'commission'
                                ? 'Commission'
                                : l.entry_type}
                          </Badge>
                        </td>
                        <td
                          className="num strong"
                          data-label="Amount"
                          style={{ color: l.amount_tzs > 0 ? 'var(--green)' : 'var(--text-2)' }}
                        >
                          {tzs(l.amount_tzs, { sign: true })}
                        </td>
                        <td className="num" data-label="Balance after">
                          {num(l.balance_after_tzs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {ledgerTab === 'ledger' && data.ledger.total > data.ledger.limit && (
              <Pagination
                page={data.ledger.page}
                pages={data.ledger.pages}
                total={data.ledger.total}
                limit={data.ledger.limit}
                onPage={setPage}
              />
            )}
          </Card>
        </div>

        <div className="stack">
          <Card pad={false}>
            <div className="card-head">
              <div>
                <div className="card-title">Pending commissions</div>
                <div className="card-subtitle">Waiting on wallet funds</div>
              </div>
            </div>
            <div style={{ padding: 'var(--s-5)' }}>
              {data.pending_commissions.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="row-icon green">
                    <Icon name="check-circle" size={17} />
                  </span>
                  <div style={{ fontSize: 'var(--t-base)', color: 'var(--text-2)' }}>
                    Every commission is paid. Nothing is waiting.
                  </div>
                </div>
              ) : (
                <>
                  <div className="stat-value" style={{ color: 'var(--amber)' }}>
                    {tzs(data.pending_total_tzs)}
                  </div>
                  <div className="stat-foot" style={{ marginBottom: 'var(--s-4)' }}>
                    {data.pending_commissions.length} commission
                    {data.pending_commissions.length === 1 ? '' : 's'} across partners
                  </div>

                  {data.shortfall_tzs > 0 ? (
                    <Banner tone="warn">
                      You need a further {tzs(data.shortfall_tzs)} to clear all of these.
                    </Banner>
                  ) : (
                    <Button
                      variant="teal"
                      block
                      icon="refresh"
                      onClick={settlePending}
                      loading={settling}
                    >
                      Pay them now
                    </Button>
                  )}

                  <div style={{ marginTop: 'var(--s-4)' }}>
                    {data.pending_commissions.slice(0, 6).map((p) => (
                      <div className="row-item" key={p.id}>
                        <div className="row-body">
                          <div className="row-title">{p.partner_name}</div>
                          <div className="row-sub">{p.bundle_type || 'Data bundle'}</div>
                        </div>
                        <div className="row-amount">{tzs(p.commission_tzs)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card pad={false}>
            <div className="card-head">
              <div className="card-title">Alert threshold</div>
            </div>
            <div style={{ padding: 'var(--s-5)' }}>
              <div className="stat-value" style={{ fontSize: 'var(--t-xl)' }}>
                {tzs(data.alert_threshold_tzs)}
              </div>
              <div className="stat-foot">
                You are notified when the balance drops below this. Change it in Settings.
              </div>
            </div>
          </Card>
        </div>
      </div>

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        wallet={data}
        onStarted={() => {
          setTopupOpen(false);
          topups.reload({ quiet: true });
          // The wallet is credited on the provider callback, so poll briefly.
          setTimeout(() => {
            reload({ quiet: true });
            topups.reload({ quiet: true });
          }, 6000);
        }}
      />
    </div>
  );
}

/* ---------------- top-up history ---------------- */
function TopupHistory({ data, loading }) {
  if (loading && !data) return <SkeletonRows count={4} />;
  if (!data?.items?.length)
    return (
      <EmptyState
        icon="upload"
        title="No top-ups yet"
        text="Mobile money top-ups and confirmed bank transfers appear here."
      />
    );

  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            <th>Date</th>
            <th>Method</th>
            <th>Reference</th>
            <th className="num">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((t) => (
            <tr key={t.id}>
              <td className="cell-primary" data-label="Date">
                {dateTime(t.created_at)}
              </td>
              <td data-label="Method">
                {t.method === 'mobile_money' ? 'Mobile money' : 'Bank transfer'}
                {t.destination && (
                  <span
                    style={{ display: 'block', fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}
                  >
                    {t.destination}
                  </span>
                )}
              </td>
              <td data-label="Reference">
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                  {t.reference}
                </code>
              </td>
              <td className="num strong" data-label="Amount">
                {tzs(t.amount_tzs)}
              </td>
              <td data-label="Status">
                <Badge status={t.status} />
                {t.failure_reason && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--t-xs)',
                      color: 'var(--text-3)',
                      marginTop: 3,
                    }}
                  >
                    {t.failure_reason}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- top-up ---------------- */
function TopupModal({ open, onClose, wallet, onStarted }) {
  const toast = useToast();
  const [method, setMethod] = useState('mobile_money');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setMethod(wallet?.instant_topup_available ? 'mobile_money' : 'bank');
      setAmount('');
      setPhone('');
      setError(null);
    }
  }, [open, wallet]);

  if (!wallet) return null;
  const value = parseInt(String(amount).replace(/\D/g, ''), 10) || 0;
  const presets = [500000, 1000000, 2500000, 5000000];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/business/me/wallet/topup', {
        amount_tzs: value,
        phone_number: phone,
      });
      toast.success('Check your phone and approve the payment prompt');
      onStarted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Top up your wallet"
      subtitle="Commissions are paid to partners from this balance"
      width="wide"
      footer={
        method === 'mobile_money' ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="teal"
              onClick={submit}
              loading={busy}
              disabled={value <= 0 || phone.replace(/\D/g, '').length < 9}
            >
              Send prompt {value > 0 ? `for ${tzs(value)}` : ''}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {wallet.instant_topup_available && (
        <div className="segmented" style={{ marginBottom: 'var(--s-5)' }}>
          <button
            className={`segment ${method === 'mobile_money' ? 'active' : ''}`}
            onClick={() => setMethod('mobile_money')}
          >
            Mobile money
          </button>
          <button
            className={`segment ${method === 'bank' ? 'active' : ''}`}
            onClick={() => setMethod('bank')}
          >
            Bank transfer
          </button>
        </div>
      )}

      {method === 'mobile_money' ? (
        <>
          <Field label="Amount" hint="Credited to your wallet as soon as you approve the prompt">
            <div className="input-group">
              <span className="input-prefix">TZS</span>
              <Input
                value={value ? value.toLocaleString('en-US') : ''}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                inputMode="numeric"
                style={{ fontSize: 'var(--t-xl)', fontWeight: 700 }}
                autoFocus
              />
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--s-5)' }}>
            {presets.map((p) => (
              <Button key={p} variant="secondary" size="sm" onClick={() => setAmount(String(p))}>
                {tzs(p, { compact: true })}
              </Button>
            ))}
          </div>

          <Field
            label="Mobile money number to charge"
            hint="The prompt is sent to this number for approval"
          >
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0754 000 000"
              inputMode="tel"
            />
          </Field>

          <Banner tone="info">
            Approve the prompt on the handset. Your wallet is credited only once ClickPesa confirms
            the payment, and any commissions waiting on funds are paid immediately after.
          </Banner>
        </>
      ) : (
        <>
          <Banner tone="info">
            Send a bank transfer using the details below and include the reference. The Pazo finance
            team credits your wallet within one business day of the funds clearing.
          </Banner>

          <div style={{ marginTop: 'var(--s-5)' }}>
            <DetailList
              items={[
                { label: 'Bank', value: wallet.topup_instructions.bank_name },
                { label: 'Account name', value: wallet.topup_instructions.account_name },
                { label: 'Account number', value: wallet.topup_instructions.account_number },
                { label: 'SWIFT', value: wallet.topup_instructions.swift },
              ]}
            />
          </div>

          <div style={{ marginTop: 'var(--s-5)' }}>
            <div className="label">Payment reference — include this exactly</div>
            <CopyField value={wallet.topup_instructions.reference} label="Reference" />
          </div>
        </>
      )}
    </Modal>
  );
}
