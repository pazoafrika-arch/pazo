import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import { Banner, Button, Field, Input, Select, Textarea } from '../components/UI.jsx';
import { api } from '../lib/api.js';
import { useApi, useSubmit } from '../hooks/useApi.js';
import '../styles/public.css';

/**
 * Organisations do not self-serve (PRD 3.2). This form submits an application
 * to the Pazo admin queue; the account is created on approval.
 */
export default function JoinOrganisation() {
  const navigate = useNavigate();
  const { data: industries } = useApi('/public/industries');
  const { data: publicData } = useApi('/public/content');

  const [done, setDone] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({
    organisation_name: '',
    industry_type: '',
    contact_person_name: '',
    contact_email: '',
    contact_phone: '',
    payout_method: 'bank',
    payout_bank_name: '',
    payout_account: '',
    notes: '',
  });

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFieldErrors((fe) => ({ ...fe, [key]: null }));
  };

  const { submit, busy, error, setError } = useSubmit(
    async () => {
      const res = await api.post('/auth/register/institution', form);
      setDone(true);
      return res;
    },
  );

  const onSubmit = (e) => {
    e.preventDefault();
    const errs = {};
    if (form.organisation_name.trim().length < 2) errs.organisation_name = 'Enter your organisation name';
    if (!form.industry_type) errs.industry_type = 'Choose your industry';
    if (form.contact_person_name.trim().length < 2) errs.contact_person_name = 'Enter a contact person';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.contact_email.trim()))
      errs.contact_email = 'Enter a valid email address';
    const digits = form.contact_phone.replace(/\D/g, '');
    if (!/^(255|0)?[67]\d{8}$/.test(digits)) errs.contact_phone = 'Enter a valid Tanzanian number';
    if (form.payout_account.trim().length < 5)
      errs.payout_account = 'Enter the account we should pay into';

    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError(null);
      return;
    }
    submit();
  };

  const supportEmail = publicData?.config?.support_email || 'partners@pazo.co.tz';

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-head">
            <Logo height={26} />
            <h1 className="auth-title">Registration received</h1>
          </div>
          <div className="auth-body">
            <div className="success-block">
              <div className="success-ring">
                <Icon name="check" size={30} strokeWidth={2.6} />
              </div>
              <div className="success-title">Thank you, {form.contact_person_name.split(' ')[0]}</div>
              <div className="success-text">
                Our team reviews applications within 24 hours. We will email{' '}
                <strong>{form.contact_email}</strong> with your login details, referral code and QR
                code once {form.organisation_name} is approved.
              </div>
              <div style={{ marginBottom: 'var(--s-5)' }}>
                <Banner tone="info">
                  Questions in the meantime? Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
                </Banner>
              </div>
              <Button variant="primary" block onClick={() => navigate('/')}>
                Back to home
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide">
        <div className="auth-head">
          <Link to="/" style={{ display: 'inline-block' }}>
            <Logo height={26} />
          </Link>
          <h1 className="auth-title">Register your organisation</h1>
          <p className="auth-sub">
            If your work brings you close to people who travel, let us partner
          </p>
        </div>

        <div className="auth-body">
          {error && (
            <div style={{ marginBottom: 'var(--s-4)' }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <Field label="Organisation name" error={fieldErrors.organisation_name} htmlFor="org">
              <Input
                id="org"
                value={form.organisation_name}
                onChange={set('organisation_name')}
                placeholder="Serena Hotel Dar es Salaam"
                error={fieldErrors.organisation_name}
                autoFocus
              />
            </Field>

            <Field label="Industry" error={fieldErrors.industry_type} htmlFor="ind">
              <Select
                id="ind"
                value={form.industry_type}
                onChange={set('industry_type')}
                error={fieldErrors.industry_type}
              >
                <option value="">Select your industry</option>
                {(industries?.items || []).map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="field-row">
              <Field label="Contact person" error={fieldErrors.contact_person_name} htmlFor="cp">
                <Input
                  id="cp"
                  value={form.contact_person_name}
                  onChange={set('contact_person_name')}
                  placeholder="Grace Mwangi"
                  error={fieldErrors.contact_person_name}
                  autoComplete="name"
                />
              </Field>
              <Field label="Contact phone" error={fieldErrors.contact_phone} htmlFor="cph">
                <Input
                  id="cph"
                  type="tel"
                  value={form.contact_phone}
                  onChange={set('contact_phone')}
                  placeholder="0754 000 000"
                  error={fieldErrors.contact_phone}
                  inputMode="tel"
                />
              </Field>
            </div>

            <Field
              label="Contact email"
              error={fieldErrors.contact_email}
              hint="This becomes your login and receives your account details"
              htmlFor="cem"
            >
              <Input
                id="cem"
                type="email"
                value={form.contact_email}
                onChange={set('contact_email')}
                placeholder="grace@serenahotels.com"
                error={fieldErrors.contact_email}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck="false"
              />
            </Field>

            <div className="divider" />

            <Field label="How should we pay you?" htmlFor="pm">
              <Select id="pm" value={form.payout_method} onChange={set('payout_method')}>
                <option value="bank">Bank transfer</option>
                <option value="mobile_money">Mobile money</option>
              </Select>
            </Field>

            {form.payout_method === 'bank' && (
              <Field label="Bank name" optional htmlFor="bank">
                <Input
                  id="bank"
                  value={form.payout_bank_name}
                  onChange={set('payout_bank_name')}
                  placeholder="CRDB Bank"
                />
              </Field>
            )}

            <Field
              label={form.payout_method === 'bank' ? 'Account number' : 'Mobile money number'}
              error={fieldErrors.payout_account}
              hint="Payouts are sent here on the 1st of each month"
              htmlFor="acct"
            >
              <Input
                id="acct"
                value={form.payout_account}
                onChange={set('payout_account')}
                placeholder={form.payout_method === 'bank' ? '0152847391200' : '0754 000 000'}
                error={fieldErrors.payout_account}
              />
            </Field>

            <Field label="Anything else we should know?" optional htmlFor="notes">
              <Textarea
                id="notes"
                value={form.notes}
                onChange={set('notes')}
                placeholder="Tell us about your organisation and how you plan to refer travellers"
                rows={3}
              />
            </Field>

            <Button type="submit" variant="primary" block loading={busy} iconRight="arrow-right">
              Submit registration
            </Button>

            <div className="auth-foot">
              Already registered? <Link to="/login">Log in</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
