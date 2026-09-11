import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  SkeletonRows,
  Switch,
  Tabs,
  Textarea,
} from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';
import { dateTime, num, relative } from '../../lib/format.js';

/** Bulk messaging, templates and site-wide announcements (PRD 5.8). */
export default function AdminCommunications() {
  const [tab, setTab] = useState('compose');

  return (
    <div className="stack">
      <Card pad={false}>
        <div style={{ padding: '0 var(--s-5)' }}>
          <Tabs
            tabs={[
              { value: 'compose', label: 'Compose' },
              { value: 'announcements', label: 'Announcements' },
              { value: 'templates', label: 'Templates' },
              { value: 'history', label: 'Send history' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </Card>

      {tab === 'compose' && <Compose />}
      {tab === 'announcements' && <Announcements />}
      {tab === 'templates' && <Templates />}
      {tab === 'history' && <History />}
    </div>
  );
}

/* ---------------- compose ---------------- */
function Compose() {
  const toast = useToast();
  const templates = useApi('/admin/comms/templates');
  const businesses = useApi('/admin/businesses?limit=50');
  const [form, setForm] = useState({
    channel: 'in_app',
    audience: 'all_partners',
    audience_ref: '',
    subject: '',
    body: '',
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const res = await api.post('/admin/comms/send', form);
      toast.success(
        `Sent to ${res.recipients} recipient${res.recipients === 1 ? '' : 's'}${res.failed ? `, ${res.failed} failed` : ''}`,
      );
      setForm({ ...form, subject: '', body: '' });
      setConfirmOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id) => {
    const t = (templates.data?.items || []).find((x) => x.id === id);
    if (t) setForm({ ...form, channel: t.channel, subject: t.subject || '', body: t.body });
  };

  const audienceLabel = {
    all_partners: 'all partners',
    individuals: 'all individual partners',
    institutions: 'all organisation partners',
    business: 'all business dashboard users',
    business_partners: 'partners of one business',
    single: 'one person',
  }[form.audience];

  return (
    <div className="grid-main-side">
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Compose a message</div>
            <div className="card-subtitle">
              Every message also lands in the recipient's in-app feed
            </div>
          </div>
        </div>

        <div style={{ padding: 'var(--s-5)' }}>
          <div className="field-row">
            <Field label="Channel">
              <Select
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              >
                <option value="in_app">In-app notification</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </Select>
            </Field>
            <Field label="Audience">
              <Select
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value, audience_ref: '' })}
              >
                <option value="all_partners">All partners</option>
                <option value="individuals">Individual partners</option>
                <option value="institutions">Organisation partners</option>
                <option value="business">Business dashboard users</option>
                <option value="business_partners">Partners of one business</option>
                <option value="single">One person</option>
              </Select>
            </Field>
          </div>

          {form.audience === 'business_partners' && (
            <Field label="Business">
              <Select
                value={form.audience_ref}
                onChange={(e) => setForm({ ...form, audience_ref: e.target.value })}
              >
                <option value="">Choose a business</option>
                {(businesses.data?.items || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {form.audience === 'single' && (
            <Field label="Phone number or email">
              <Input
                value={form.audience_ref}
                onChange={(e) => setForm({ ...form, audience_ref: e.target.value })}
                placeholder="0754 000 000 or name@example.com"
                autoCapitalize="none"
              />
            </Field>
          )}

          {form.channel !== 'sms' && (
            <Field label="Subject">
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="New bundles are live"
              />
            </Field>
          )}

          <Field
            label="Message"
            hint={
              form.channel === 'sms'
                ? `${form.body.length} characters · about ${Math.max(1, Math.ceil(form.body.length / 160))} SMS`
                : 'Keep it short and specific'
            }
          >
            <Textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={6}
              placeholder="Write your message"
            />
          </Field>

          <Button
            variant="primary"
            icon="send"
            onClick={() => setConfirmOpen(true)}
            disabled={!form.body.trim() || (form.audience !== 'all_partners' && form.audience !== 'individuals' && form.audience !== 'institutions' && form.audience !== 'business' && !form.audience_ref)}
          >
            Review and send
          </Button>
        </div>
      </Card>

      <Card pad={false}>
        <div className="card-head">
          <div className="card-title">Start from a template</div>
        </div>
        <div style={{ padding: '0 var(--s-5)' }}>
          {!templates.data?.items?.length ? (
            <EmptyState icon="file-text" title="No templates yet" />
          ) : (
            templates.data.items.map((t) => (
              <button
                key={t.id}
                className="row-item"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => applyTemplate(t.id)}
              >
                <span className="row-icon teal">
                  <Icon name="file-text" size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">{t.name}</div>
                  <div className="row-sub">{t.channel.replace('_', '-')}</div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: 'var(--gray-400)' }} />
              </button>
            ))
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={send}
        loading={busy}
        title="Send this message?"
        message={`This goes to ${audienceLabel} over ${form.channel === 'in_app' ? 'the in-app feed' : form.channel.toUpperCase()}. It cannot be recalled once sent.`}
        confirmLabel="Send message"
        tone="primary"
      />
    </div>
  );
}

/* ---------------- announcements ---------------- */
function Announcements() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/admin/announcements');
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const toggle = async (a) => {
    try {
      await api.put(`/admin/announcements/${a.id}`, { active: !a.active });
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/admin/announcements/${deleteTarget.id}`);
      toast.success('Announcement deleted');
      setDeleteTarget(null);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Announcements</div>
            <div className="card-subtitle">
              A banner shown at the top of the matching partner dashboards
            </div>
          </div>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setOpen(true)}>
            New announcement
          </Button>
        </div>

        <div style={{ padding: '0 var(--s-5) var(--s-4)' }}>
          {loading && !data ? (
            <SkeletonRows count={3} />
          ) : !data?.items?.length ? (
            <EmptyState
              icon="megaphone"
              title="No announcements"
              text="Post one to reach every partner the next time they open the dashboard."
            />
          ) : (
            data.items.map((a) => (
              <div className="row-item" key={a.id}>
                <span className={`row-icon ${a.variant === 'warning' ? 'amber' : 'teal'}`}>
                  <Icon name="megaphone" size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">{a.title}</div>
                  <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {a.body}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge tone="gray">{a.audience}</Badge>
                    <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
                      {relative(a.created_at)} by {a.created_by_name || 'Pazo'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label className="switch">
                    <input type="checkbox" checked={!!a.active} onChange={() => toggle(a)} />
                    <span className="switch-track" />
                  </label>
                  <button
                    className="icon-btn"
                    onClick={() => setDeleteTarget(a)}
                    style={{ color: 'var(--red)' }}
                    aria-label="Delete"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <AnnouncementModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          reload({ quiet: true });
          toast.success('Announcement published');
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete this announcement?"
        message="It disappears from every dashboard immediately."
        confirmLabel="Delete"
        tone="danger"
      />
    </>
  );
}

function AnnouncementModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', variant: 'info' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ title: '', body: '', audience: 'all', variant: 'info' });
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/announcements', form);
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
      title="New announcement"
      subtitle="Shown as a banner on the partner dashboards"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Publish
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Title">
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="New bundles are live"
          autoFocus
        />
      </Field>
      <Field label="Message">
        <Textarea
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={3}
          placeholder="East Africa regional bundles are now available. Same commission rate, wider coverage."
        />
      </Field>
      <div className="field-row">
        <Field label="Audience">
          <Select
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })}
          >
            <option value="all">Everyone</option>
            <option value="individuals">Individual partners</option>
            <option value="institutions">Organisation partners</option>
            <option value="business">Business dashboards</option>
          </Select>
        </Field>
        <Field label="Tone">
          <Select
            value={form.variant}
            onChange={(e) => setForm({ ...form, variant: e.target.value })}
          >
            <option value="info">Information</option>
            <option value="success">Good news</option>
            <option value="warning">Needs attention</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- templates ---------------- */
function Templates() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/admin/comms/templates');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const remove = async () => {
    try {
      await api.del(`/admin/comms/templates/${deleteTarget.id}`);
      toast.success('Template deleted');
      setDeleteTarget(null);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <Card pad={false}>
        <div className="card-head">
          <div>
            <div className="card-title">Message templates</div>
            <div className="card-subtitle">
              Reusable copy. Use {'{name}'}, {'{amount}'}, {'{code}'} as placeholders.
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            New template
          </Button>
        </div>

        <div style={{ padding: '0 var(--s-5) var(--s-4)' }}>
          {loading && !data ? (
            <SkeletonRows count={3} />
          ) : !data?.items?.length ? (
            <EmptyState icon="file-text" title="No templates yet" />
          ) : (
            data.items.map((t) => (
              <div className="row-item" key={t.id}>
                <span className="row-icon teal">
                  <Icon name="file-text" size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">{t.name}</div>
                  <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {t.body}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge tone="gray">{t.channel.replace('_', '-')}</Badge>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      setEditing(t);
                      setOpen(true);
                    }}
                    aria-label="Edit"
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => setDeleteTarget(t)}
                    style={{ color: 'var(--red)' }}
                    aria-label="Delete"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <TemplateModal
        open={open}
        template={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          reload({ quiet: true });
          toast.success(editing ? 'Template updated' : 'Template created');
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete this template?"
        message="Messages already sent are not affected."
        confirmLabel="Delete"
        tone="danger"
      />
    </>
  );
}

function TemplateModal({ open, template, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', channel: 'in_app', subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(
        template
          ? {
              name: template.name,
              channel: template.channel,
              subject: template.subject || '',
              body: template.body,
            }
          : { name: '', channel: 'in_app', subject: '', body: '' },
      );
      setError(null);
    }
  }, [open, template]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (template) await api.put(`/admin/comms/templates/${template.id}`, form);
      else await api.post('/admin/comms/templates', form);
      onSaved();
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
      title={template ? 'Edit template' : 'New template'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save template
          </Button>
        </>
      }
    >
      {error && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <Field label="Template name">
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Commission reminder"
          autoFocus
        />
      </Field>
      <Field label="Channel">
        <Select
          value={form.channel}
          onChange={(e) => setForm({ ...form, channel: e.target.value })}
        >
          <option value="in_app">In-app</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </Select>
      </Field>
      {form.channel !== 'sms' && (
        <Field label="Subject" optional>
          <Input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </Field>
      )}
      <Field label="Body" hint="Placeholders: {name} {amount} {code} {month} {reference}">
        <Textarea
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={4}
        />
      </Field>
    </Modal>
  );
}

/* ---------------- history ---------------- */
function History() {
  const { data, loading } = useApi('/admin/comms/history?limit=40');

  return (
    <Card pad={false}>
      <div className="card-head">
        <div>
          <div className="card-title">Send history</div>
          <div className="card-subtitle">Every bulk message sent from this dashboard</div>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonRows count={5} />
      ) : !data?.items?.length ? (
        <EmptyState icon="send" title="Nothing sent yet" />
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Channel</th>
                <th>Audience</th>
                <th>Message</th>
                <th className="num">Recipients</th>
                <th>Sent by</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td className="cell-primary" data-label="Sent">
                    {dateTime(c.created_at)}
                  </td>
                  <td data-label="Channel">
                    <Badge tone="gray">{c.channel.replace('_', '-')}</Badge>
                  </td>
                  <td data-label="Audience">{c.audience.replace(/_/g, ' ')}</td>
                  <td data-label="Message" style={{ maxWidth: 320 }}>
                    {c.subject && <strong style={{ display: 'block' }}>{c.subject}</strong>}
                    <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-2)' }}>{c.body}</span>
                  </td>
                  <td className="num" data-label="Recipients">
                    {num(c.recipient_count)}
                    {c.failed_count > 0 && (
                      <span style={{ color: 'var(--red)', fontSize: 'var(--t-xs)', display: 'block' }}>
                        {c.failed_count} failed
                      </span>
                    )}
                  </td>
                  <td data-label="Sent by">{c.sent_by_name || 'Pazo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
