import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Card, Field, Input, Loading, Textarea } from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../app/ToastContext.jsx';

/**
 * Content management for the public site. Everything on the landing page is
 * editable here, so marketing copy changes do not need a deployment.
 */
const GROUP_META = {
  landing: { label: 'Landing page', description: 'Headline, steps and access section' },
  faq: { label: 'Questions', description: 'The frequently asked questions block' },
  footer: { label: 'Footer', description: 'Small print at the bottom of the page' },
};

export default function AdminContent() {
  const toast = useToast();
  const { data, loading, reload } = useApi('/admin/cms');
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.items) {
      const next = {};
      for (const c of data.items) next[c.content_key] = c.content_value;
      setValues(next);
    }
  }, [data]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const c of data?.items || []) (groups[c.group_name] ||= []).push(c);
    return groups;
  }, [data]);

  const dirty = useMemo(
    () => (data?.items || []).some((c) => values[c.content_key] !== c.content_value),
    [data, values],
  );

  if (loading && !data) return <Loading label="Loading site content" />;

  const save = async () => {
    setSaving(true);
    try {
      const changed = {};
      for (const c of data.items) {
        if (values[c.content_key] !== c.content_value) changed[c.content_key] = values[c.content_key];
      }
      await api.put('/admin/cms', { content: changed });
      toast.success('Site content updated');
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <Banner tone="info" icon="globe">
        Changes go live on the public site as soon as you save. Open the site in another tab to
        check the result.
      </Banner>

      {Object.entries(grouped).map(([group, items]) => {
        const meta = GROUP_META[group] || { label: group, description: '' };
        return (
          <Card pad={false} key={group}>
            <div className="card-head">
              <div>
                <div className="card-title">{meta.label}</div>
                {meta.description && <div className="card-subtitle">{meta.description}</div>}
              </div>
            </div>
            <div style={{ padding: 'var(--s-5)' }}>
              {items.map((c) => {
                const isLong = (c.content_value || '').length > 90;
                return (
                  <Field key={c.content_key} label={c.label}>
                    {isLong ? (
                      <Textarea
                        value={values[c.content_key] ?? ''}
                        onChange={(e) =>
                          setValues({ ...values, [c.content_key]: e.target.value })
                        }
                        rows={3}
                      />
                    ) : (
                      <Input
                        value={values[c.content_key] ?? ''}
                        onChange={(e) =>
                          setValues({ ...values, [c.content_key]: e.target.value })
                        }
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          </Card>
        );
      })}

      <div
        style={{
          position: 'sticky',
          bottom: 'var(--s-4)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--s-3)',
        }}
      >
        {dirty && (
          <Button
            variant="secondary"
            onClick={() => {
              const next = {};
              for (const c of data.items) next[c.content_key] = c.content_value;
              setValues(next);
            }}
          >
            Discard changes
          </Button>
        )}
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
          {dirty ? 'Publish changes' : 'No changes'}
        </Button>
      </div>
    </div>
  );
}
