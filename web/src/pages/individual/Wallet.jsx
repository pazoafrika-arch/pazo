import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  Pagination,
  SkeletonRows,
  Tabs,
} from '../../components/UI.jsx';
import { TrendAreaChart } from '../../components/Charts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { date, dateTime, num, statusLabel, tzs } from '../../lib/format.js';

export default function IndividualWallet() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('earnings');
  const [page, setPage] = useState(1);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const wallet = useApi('/individual/me/wallet');
  const chart = useApi('/individual/me/earnings-chart?days=30');
  const list = useApi(
    tab === 'earnings'
      ? `/individual/me/transactions?page=${page}&limit=20`
      : tab === 'withdrawals'
        ? `/individual/me/withdrawals?page=${page}&limit=20`
        : '/individual/me/balance-history?limit=60',
    { deps: [tab, page] },
  );

  // The home screen links straight into the withdraw sheet.
  useEffect(() => {
    if (params.get('withdraw') === '1') {
      setWithdrawOpen(true);
      params.delete('withdraw');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const w = wallet.data;

  const onWithdrawn = () => {
    setWithdrawOpen(false);
    wallet.reload({ quiet: true });
    if (tab === 'withdrawals') list.reload({ quiet: true });
    else setTab('withdrawals');
  };

  if (wallet.loading && !w) return <Loading label="Loading your wallet" />;

  return (
    <div className="stack">
      {/* Balance */}
      <div className="hero-card anim-rise">
        <div className="hero-inner">
          <div className="hero-label">Account balance</div>
          <div className="hero-amount">{tzs(w?.balance_tzs)}</div>
          <div className="hero-sub">Tanzanian Shilling</div>

          <div style={{ marginTop: 'var(--s-5)' }}>
            <Button
              variant="teal"
              block
              icon="send"
              onClick={() => setWithdrawOpen(true)}
              disabled={!w?.can_withdraw}
            >
              Withdraw to mobile money
            </Button>
            {!w?.can_withdraw && (
              <div
                style={{
                  fontSize: 'var(--t-sm)',
                  color: 'rgba(255,255,255,.55)',
                  marginTop: 10,
                  textAlign: 'center',
                }}
              >
                {!w?.mobile_money_verified
                  ? 'Add and verify your mobile money number in Profile first'
                  : `Minimum withdrawal is ${tzs(w?.min_withdrawal_tzs)}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lifetime summary */}
      <div className="grid-3 keep-2">
        <Card>
          <div className="stat-label">Lifetime earned</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(w?.lifetime_earned_tzs, { compact: true })}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Withdrawn</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(w?.lifetime_withdrawn_tzs, { compact: true })}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Processing</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {tzs(w?.withdrawals_processing_tzs, { compact: true })}
          </div>
        </Card>
      </div>

      {/* Trend */}
      {chart.data?.series?.some((d) => d.value > 0) && (
        <Card pad={false}>
          <div className="card-head">
            <div>
              <div className="card-title">Earnings, last 30 days</div>
              <div className="card-subtitle">Commissions paid into your wallet</div>
            </div>
          </div>
          <div style={{ padding: 'var(--s-4) var(--s-4) var(--s-3)' }}>
            <TrendAreaChart data={chart.data.series} height={190} />
          </div>
        </Card>
      )}

      {/* Ledger */}
      <Card pad={false}>
        <div style={{ padding: '0 var(--s-5)' }}>
          <Tabs
            tabs={[
              { value: 'earnings', label: 'Earnings' },
              { value: 'withdrawals', label: 'Withdrawals' },
              { value: 'balance', label: 'Balance' },
            ]}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setPage(1);
            }}
          />
        </div>

        <div style={{ padding: '0 var(--s-5)' }}>
          {list.loading && !list.data ? (
            <SkeletonRows count={5} />
          ) : tab === 'earnings' ? (
            <EarningsList data={list.data} />
          ) : tab === 'withdrawals' ? (
            <WithdrawalsList data={list.data} />
          ) : (
            <BalanceList data={list.data} />
          )}
        </div>

        {tab !== 'balance' && list.data?.total > list.data?.limit && (
          <Pagination
            page={list.data.page}
            pages={list.data.pages}
            total={list.data.total}
            limit={list.data.limit}
            onPage={setPage}
          />
        )}
      </Card>

      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        wallet={w}
        onDone={onWithdrawn}
        toast={toast}
      />
    </div>
  );
}

function EarningsList({ data }) {
  if (!data?.items?.length)
    return (
      <EmptyState
        icon="banknote"
        title="No commissions yet"
        text="When someone buys a bundle with your code, the commission lands here."
      />
    );
  return (
    <div>
      {data.items.map((t) => (
        <div className="row-item" key={t.id}>
          <span className={`row-icon ${t.status === 'paid' ? 'green' : 'amber'}`}>
            <Icon name="banknote" size={17} />
          </span>
          <div className="row-body">
            <div className="row-title">{t.bundle_type || 'Data bundle'}</div>
            <div className="row-sub">
              {statusLabel(t.transaction_type)} · {dateTime(t.created_at)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={`row-amount ${t.status === 'paid' ? 'pos' : ''}`}>
              {tzs(t.commission_tzs, { sign: t.status === 'paid' })}
            </div>
            <Badge status={t.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WithdrawalsList({ data }) {
  if (!data?.items?.length)
    return (
      <EmptyState
        icon="send"
        title="No withdrawals yet"
        text="Money you send to mobile money will be listed here with its status."
      />
    );
  return (
    <div>
      {data.items.map((w) => (
        <div className="row-item" key={w.id}>
          <span
            className={`row-icon ${w.status === 'completed' ? 'green' : w.status === 'failed' ? 'red' : 'amber'}`}
          >
            <Icon name={w.status === 'failed' ? 'alert-circle' : 'arrow-up-right'} size={17} />
          </span>
          <div className="row-body">
            <div className="row-title">To {w.destination}</div>
            <div className="row-sub">
              {dateTime(w.requested_at)}
              {w.reference ? ` · ${w.reference}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="row-amount neg">-{tzs(w.amount_tzs)}</div>
            <Badge status={w.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function BalanceList({ data }) {
  if (!data?.items?.length)
    return <EmptyState icon="receipt" title="No balance history" text="Your running balance will build up here." />;
  return (
    <div>
      {data.items.map((e) => (
        <div className="row-item" key={`${e.kind}-${e.id}`}>
          <span className={`row-icon ${e.delta_tzs > 0 ? 'green' : 'amber'}`}>
            <Icon name={e.delta_tzs > 0 ? 'arrow-down-left' : 'arrow-up-right'} size={17} />
          </span>
          <div className="row-body">
            <div className="row-title">
              {e.kind === 'earning' ? e.label || 'Commission' : `Withdrawal to ${e.label}`}
            </div>
            <div className="row-sub">{date(e.created_at)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={`row-amount ${e.delta_tzs > 0 ? 'pos' : 'neg'}`}>
              {tzs(e.delta_tzs, { sign: true })}
            </div>
            <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
              Balance {num(e.balance_after_tzs)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Amount entry with quick presets, validated against the live balance. */
function WithdrawModal({ open, onClose, wallet, onDone, toast }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setAmount('');
      setError(null);
    }
  }, [open]);

  if (!wallet) return null;

  const balance = wallet.balance_tzs;
  const min = wallet.min_withdrawal_tzs;
  const value = parseInt(String(amount).replace(/\D/g, ''), 10) || 0;

  const presets = [5000, 10000, 25000, 50000].filter((p) => p <= balance);

  const submit = async () => {
    if (value < min) return setError(`The smallest withdrawal is ${tzs(min)}`);
    if (value > balance) return setError(`You can withdraw up to ${tzs(balance)}`);

    setBusy(true);
    setError(null);
    try {
      await api.post('/individual/me/withdraw', { amount_tzs: value });
      toast.success(`${tzs(value)} is on its way to ${wallet.mobile_money_masked}`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return null;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Withdraw to mobile money"
      subtitle={`Available: ${tzs(balance)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="teal" onClick={submit} loading={busy} disabled={value < min}>
            Withdraw {value > 0 ? tzs(value) : ''}
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <Field label="Amount" hint={`Minimum ${tzs(min)} · Maximum ${tzs(balance)}`} htmlFor="amt">
        <div className="input-group">
          <span className="input-prefix">TZS</span>
          <Input
            id="amt"
            value={value ? value.toLocaleString('en-US') : ''}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            placeholder="0"
            inputMode="numeric"
            style={{ fontSize: 'var(--t-xl)', fontWeight: 700 }}
            autoFocus
          />
        </div>
      </Field>

      {presets.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--s-5)' }}>
          {presets.map((p) => (
            <Button key={p} variant="secondary" size="sm" onClick={() => setAmount(String(p))}>
              {num(p)}
            </Button>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setAmount(String(balance))}>
            All
          </Button>
        </div>
      )}

      <div className="label">Sending to</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: 'var(--s-4)',
        }}
      >
        <span className="row-icon teal">
          <Icon name="smartphone" size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{wallet.mobile_money_masked}</div>
          <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
            Your verified mobile money account
          </div>
        </div>
        <Icon name="lock" size={15} style={{ color: 'var(--gray-400)' }} />
      </div>

      <div style={{ marginTop: 'var(--s-4)' }}>
        <Banner tone="info">
          Mobile money transfers usually arrive within minutes. You will get a notification the
          moment it lands.
        </Banner>
      </div>
    </Modal>
  );
}
