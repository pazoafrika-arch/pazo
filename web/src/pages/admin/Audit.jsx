import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Pagination,
  SearchInput,
  SkeletonRows,
  Tabs,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { downloadFile, qs } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { dateTime, relative } from '../../lib/format.js';
import { humanAction } from './Overview.jsx';

/** Admin audit trail and the integration request log. */
export default function AdminAudit() {
  const [tab, setTab] = useState('audit');

  return (
    <div className="stack">
      <Card pad={false}>
        <div style={{ padding: '0 var(--s-5)' }}>
          <Tabs
            tabs={[
              { value: 'audit', label: 'Admin actions' },
              { value: 'api', label: 'API requests' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </Card>

      {tab === 'audit' ? <AuditLog /> : <ApiLog />}
    </div>
  );
}

function AuditLog() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 350);
  const { data, loading } = useApi(`/admin/audit-log${qs({ page, limit: 30, actor: q })}`, {
    deps: [page, q],
  });

  useEffect(() => setPage(1), [q]);

  return (
    <Card pad={false}>
      <div className="card-head">
        <div>
          <div className="card-title">Admin actions</div>
          <div className="card-subtitle">
            Every privileged action with the actor, target and time
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          onClick={() =>
            downloadFile('/admin/audit-log?format=csv&limit=100', 'pazo-audit-log.csv').catch(() =>
              toast.error('Could not export'),
            )
          }
        >
          Export
        </Button>
      </div>

      <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Filter by who did it" />
      </div>

      {loading && !data ? (
        <SkeletonRows count={8} />
      ) : !data?.items?.length ? (
        <EmptyState icon="shield" title="No actions logged yet" />
      ) : (
        <>
          <div style={{ padding: '0 var(--s-5)' }}>
            {data.items.map((a) => (
              <div className="row-item" key={a.id}>
                <span className="row-icon gray">
                  <Icon name={iconForAction(a.action)} size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">{humanAction(a.action)}</div>
                  <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {a.actor_name || 'System'}
                    {a.actor_role ? ` (${a.actor_role.replace('_', ' ')})` : ''}
                    {a.resource_type ? ` · ${a.resource_type}` : ''}
                    {a.detail ? ` · ${summariseDetail(a.detail)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                    {relative(a.created_at)}
                  </div>
                  {a.ip_address && (
                    <div style={{ fontSize: 'var(--t-xs)', color: 'var(--gray-400)' }}>
                      {a.ip_address}
                    </div>
                  )}
                </div>
              </div>
            ))}
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

function ApiLog() {
  const [page, setPage] = useState(1);
  const { data, loading } = useApi(`/admin/api-logs?page=${page}&limit=30`, { deps: [page] });

  return (
    <Card pad={false}>
      <div className="card-head">
        <div>
          <div className="card-title">Integration requests</div>
          <div className="card-subtitle">
            Every call a business made to the referral and transaction endpoints
          </div>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonRows count={8} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon="code"
          title="No API requests yet"
          text="Calls appear here as soon as a business integration starts sending traffic."
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Business</th>
                  <th>Endpoint</th>
                  <th>Status</th>
                  <th className="num">Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-primary" data-label="Time">
                      {dateTime(l.created_at)}
                    </td>
                    <td data-label="Business">{l.business_name || '—'}</td>
                    <td data-label="Endpoint">
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                        {l.method} {l.endpoint}
                      </code>
                    </td>
                    <td data-label="Status">
                      <Badge
                        tone={
                          l.status_code < 300 ? 'green' : l.status_code < 500 ? 'amber' : 'red'
                        }
                      >
                        {l.status_code}
                      </Badge>
                    </td>
                    <td className="num" data-label="Duration">
                      {l.duration_ms}ms
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

function iconForAction(action) {
  if (action.includes('wallet') || action.includes('topup')) return 'wallet';
  if (action.includes('payout') || action.includes('withdrawal')) return 'banknote';
  if (action.includes('api_key')) return 'key';
  if (action.includes('partner') || action.includes('user')) return 'users';
  if (action.includes('business')) return 'briefcase';
  if (action.includes('config') || action.includes('settings')) return 'settings';
  if (action.includes('comms') || action.includes('announcement')) return 'megaphone';
  if (action.includes('institution')) return 'building';
  return 'shield';
}

/** Turn the JSON detail column into a short readable phrase. */
function summariseDetail(detail) {
  try {
    const obj = typeof detail === 'string' ? JSON.parse(detail) : detail;
    if (!obj || typeof obj !== 'object') return '';
    if (obj.note) return obj.note;
    return Object.entries(obj)
      .filter(([, v]) => v !== null && typeof v !== 'object')
      .slice(0, 3)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join(', ');
  } catch {
    return '';
  }
}
