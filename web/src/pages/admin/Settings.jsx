import { useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  Loading,
  Select,
  Switch,
} from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';

/**
 * Platform configuration (PRD 5.9). Rendered from the settings table itself,
 * so adding a setting on the server makes it appear here without a UI change.
 */
const CATEGORY_META = {
  general: { label: 'General', description: 'Platform identity and access' },
  commissions: { label: 'Commissions', description: 'Defaults applied to new businesses' },
  payouts: { label: 'Payouts', description: 'Withdrawal limits and the payout cycle' },
  security: { label: 'Security', description: 'Sessions, codes and lockouts' },
};

export default function AdminSettings() {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const { data, loading, reload } = useApi('/admin/config');
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.settings) {
      const next = {};
      for (const s of data.settings) next[s.setting_key] = s.setting_value;
      setValues(next);
    }
  }, [data]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const s of data?.settings || []) {
      (groups[s.category] ||= []).push(s);
    }
    return groups;
  }, [data]);

  const dirty = useMemo(() => {
    if (!data?.settings) return false;
    return data.settings.some((s) => values[s.setting_key] !== s.setting_value);
  }, [data, values]);

  if (loading && !data) return <Loading label="Loading configuration" />;

  const save = async () => {
    setSaving(true);
    try {
      const changed = {};
      for (const s of data.settings) {
        if (values[s.setting_key] !== s.setting_value) changed[s.setting_key] = values[s.setting_key];
      }
      await api.put('/admin/config', { settings: changed });
      toast.success('Configuration saved');
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {!isSuperAdmin && (
        <Banner tone="info" title="View only">
          Only a Pazo super admin can change platform configuration.
        </Banner>
      )}

      {Object.entries(grouped).map(([category, settings]) => {
        const meta = CATEGORY_META[category] || { label: category, description: '' };
        return (
          <Card pad={false} key={category}>
            <div className="card-head">
              <div>
                <div className="card-title">{meta.label}</div>
                {meta.description && <div className="card-subtitle">{meta.description}</div>}
              </div>
            </div>
            <div style={{ padding: 'var(--s-5)' }}>
              {settings.map((s) =>
                s.value_type === 'bool' ? (
                  <Switch
                    key={s.setting_key}
                    label={s.label}
                    description={s.description}
                    checked={values[s.setting_key] === 'true'}
                    disabled={!isSuperAdmin}
                    onChange={(checked) =>
                      setValues({ ...values, [s.setting_key]: checked ? 'true' : 'false' })
                    }
                  />
                ) : (
                  <Field key={s.setting_key} label={s.label} hint={s.description}>
                    <Input
                      value={values[s.setting_key] ?? ''}
                      onChange={(e) => setValues({ ...values, [s.setting_key]: e.target.value })}
                      disabled={!isSuperAdmin}
                      inputMode={
                        s.value_type === 'int' || s.value_type === 'decimal' ? 'decimal' : undefined
                      }
                    />
                  </Field>
                ),
              )}
            </div>
          </Card>
        );
      })}

      {isSuperAdmin && (
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
                for (const s of data.settings) next[s.setting_key] = s.setting_value;
                setValues(next);
              }}
            >
              Discard changes
            </Button>
          )}
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            {dirty ? 'Save configuration' : 'No changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
