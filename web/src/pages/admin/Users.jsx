import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  CopyField,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  PasswordInput,
  SearchInput,
  Select,
  SkeletonRows,
} from '../../components/UI.jsx';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { api, downloadFile, qs } from '../../lib/api.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { date, num, relative } from '../../lib/format.js';

const ROLE_LABEL = {
  individual: 'Individual partner',
  institution: 'Organisation partner',
  business_owner: 'Business dashboard',
  admin: 'Pazo admin',
  super_admin: 'Pazo super admin',
};

/** Every account on the platform, with the controls a super admin needs. */
export default function AdminUsers() {
  const toast = useToast();
  const { isSuperAdmin, user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const q = useDebounced(search, 350);

  const list = useApi(`/admin/users${qs({ page, limit: 25, q, role, status })}`, {
    deps: [page, q, role, status],
  });

  useEffect(() => setPage(1), [q, role, status]);

  const changeStatus = async () => {
    try {
      await api.put(`/admin/users/${statusTarget.user.id}/status`, { status: statusTarget.status });
      toast.success('Account updated');
      setStatusTarget(null);
      list.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const resetPassword = async () => {
    try {
      const res = await api.post(`/admin/users/${resetTarget.id}/reset-password`);
      setResetTarget(null);
      setTempPassword({ password: res.temporary_password, email: res.email });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="stack">
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">All accounts</div>
            <div className="card-subtitle">
              {list.data ? `${num(list.data.total)} users across every role` : 'Every login on the platform'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              icon="download"
              onClick={() =>
                downloadFile(
                  `/admin/users${qs({ q, role, status, format: 'csv', limit: 100 })}`,
                  'pazo-users.csv',
                ).catch(() => toast.error('Could not export'))
              }
            >
              Export
            </Button>
            {isSuperAdmin && (
              <Button variant="primary" size="sm" icon="user-plus" onClick={() => setCreateOpen(true)}>
                Add admin
              </Button>
            )}
          </div>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
          <div className="filter-bar">
            <SearchInput value={search} onChange={setSearch} placeholder="Name, email or phone" />
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">All roles</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Closed</option>
            </Select>
          </div>
        </div>

        {list.loading && !list.data ? (
          <SkeletonRows count={8} />
        ) : !list.data?.items?.length ? (
          <EmptyState icon="users" title="No accounts match" />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Last sign-in</th>
                  <th>Joined</th>
                  <th>Status</th>
                  {isSuperAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-primary" data-label="Name">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={u.name} size="sm" />
                        {u.name}
                      </span>
                    </td>
                    <td data-label="Contact">
                      {u.email && <span style={{ display: 'block' }}>{u.email}</span>}
                      {u.phone && (
                        <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                          {u.phone}
                        </span>
                      )}
                    </td>
                    <td data-label="Role">
                      <Badge
                        tone={
                          u.role === 'super_admin'
                            ? 'red'
                            : u.role === 'admin'
                              ? 'blue'
                              : u.role === 'business_owner'
                                ? 'teal'
                                : 'gray'
                        }
                      >
                        {ROLE_LABEL[u.role] || u.role}
                      </Badge>
                    </td>
                    <td data-label="Last sign-in">
                      {u.last_login_at ? relative(u.last_login_at) : 'Never'}
                    </td>
                    <td data-label="Joined">{date(u.created_at)}</td>
                    <td data-label="Status">
                      <Badge status={u.status} />
                    </td>
                    {isSuperAdmin && (
                      <td data-label="Actions">
                        {u.id !== me?.id && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="key"
                              onClick={() => setResetTarget(u)}
                            >
                              Reset
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setStatusTarget({
                                  user: u,
                                  status: u.status === 'active' ? 'suspended' : 'active',
                                })
                              }
                              style={{ color: u.status === 'active' ? 'var(--red)' : 'var(--teal)' }}
                            >
                              {u.status === 'active' ? 'Suspend' : 'Activate'}
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

      <CreateAdminModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          list.reload({ quiet: true });
          toast.success('Admin account created');
        }}
      />

      <ConfirmDialog
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={changeStatus}
        title={
          statusTarget?.status === 'suspended'
            ? `Suspend ${statusTarget?.user.name}?`
            : `Reactivate ${statusTarget?.user.name}?`
        }
        message={
          statusTarget?.status === 'suspended'
            ? 'They are signed out of every session immediately and cannot sign in again until reactivated.'
            : 'They can sign in again straight away.'
        }
        confirmLabel={statusTarget?.status === 'suspended' ? 'Suspend account' : 'Reactivate'}
        tone={statusTarget?.status === 'suspended' ? 'danger' : 'teal'}
      />

      <ConfirmDialog
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={resetPassword}
        title={`Reset the password for ${resetTarget?.name}?`}
        message="A temporary password is generated and shown once. Every active session for this account is signed out."
        confirmLabel="Reset password"
        tone="danger"
      />

      <Modal
        open={!!tempPassword}
        onClose={() => setTempPassword(null)}
        title="Temporary password"
        subtitle="Share it securely — it is shown once"
        footer={
          <Button variant="primary" onClick={() => setTempPassword(null)}>
            Done
          </Button>
        }
      >
        <Banner tone="warn">
          Ask them to change this password the first time they sign in.
        </Banner>
        <div style={{ marginTop: 'var(--s-5)' }} className="stack-sm">
          <div>
            <div className="label">Email</div>
            <CopyField value={tempPassword?.email || ''} label="Email" />
          </div>
          <div>
            <div className="label">Temporary password</div>
            <CopyField value={tempPassword?.password || ''} label="Password" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateAdminModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'admin' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', password: '', role: 'admin' });
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/users', form);
      onCreated();
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
      title="Add a Pazo admin"
      subtitle="Internal staff account with access to this dashboard"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Create account
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Full name">
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Neema Kileo"
          autoFocus
        />
      </Field>
      <Field label="Email address">
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="neema@pazo.co.tz"
          autoCapitalize="none"
        />
      </Field>
      <Field label="Temporary password" hint="At least 8 characters, with a number and a capital letter">
        <PasswordInput
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
      <Field
        label="Role"
        hint="Super admins can change platform configuration and manage other admins"
      >
        <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="admin">Pazo admin</option>
          <option value="super_admin">Pazo super admin</option>
        </Select>
      </Field>
    </Modal>
  );
}
