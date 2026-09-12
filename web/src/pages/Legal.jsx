import { Link, useParams } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Button } from '../components/UI.jsx';
import { useApi } from '../hooks/useApi.js';
import '../styles/public.css';

/**
 * Terms and privacy. The privacy text states the platform's actual data
 * behaviour, which is unusually strict: no traveller personal data is stored
 * at all, only an opaque identifier supplied by the business.
 */
const DOCS = {
  terms: {
    title: 'Terms of use',
    sections: [
      {
        h: 'About these terms',
        p: 'These terms govern your use of the Pazo partner platform. By creating an account or using a referral code issued through Pazo you agree to them.',
      },
      {
        h: 'Your account',
        p: 'You are responsible for keeping your password and one-time codes private. Tell Pazo immediately if you believe someone else has access to your account. One person or organisation may hold one partner account per programme.',
      },
      {
        h: 'Referral codes',
        p: 'Your referral code is permanent and cannot be changed once created. A traveller is linked to the first partner whose code they use; that link does not transfer afterwards.',
      },
      {
        h: 'Commissions',
        p: 'Commission is calculated as a percentage of the purchase amount at the rate that applies at the time of the transaction. Individual partners are credited to a withdrawable balance. Organisations accumulate a monthly balance paid on the first of the following month.',
      },
      {
        h: 'Payouts',
        p: 'Individual withdrawals are sent to the verified mobile money account on the partner profile, subject to the platform minimum. Organisation payouts are sent to the verified account on file. Pazo may hold a payout while it verifies an account.',
      },
      {
        h: 'Suspension',
        p: 'Pazo or the business running the programme may suspend a partner account for fraudulent referrals, abuse of the referral system, or breach of these terms. Balances earned before suspension remain payable once any investigation concludes.',
      },
      {
        h: 'Changes',
        p: 'Commission rates and platform settings may change. Changes apply to future transactions only and never alter commissions already recorded.',
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    sections: [
      {
        h: 'What Pazo stores about partners',
        p: 'For partners Pazo stores the name, email address, phone number, payout account and referral activity needed to operate the programme and pay commissions. Passwords are stored only as a bcrypt hash and are never visible to anyone, including Pazo staff.',
      },
      {
        h: 'What Pazo does not store about travellers',
        p: 'Pazo never stores the name, email address, phone number or payment details of the travellers who use a referral code. The business supplies an opaque identifier and that identifier is the only customer data on the platform. Partners never see who signed up with their code, only the amount, bundle and date.',
      },
      {
        h: 'Where data is held',
        p: 'All platform data is stored in Tanzania or the East Africa region. Data is encrypted at rest and every connection to the platform uses HTTPS.',
      },
      {
        h: 'How long data is kept',
        p: 'Partner records are kept for seven years after an account closes, as financial regulation requires. Transaction records are kept permanently as an audit trail. Personal details are removed within thirty days of an account closure request and the remaining transaction records are anonymised.',
      },
      {
        h: 'Your choices',
        p: 'You can edit your personal details at any time from your profile. Changing a phone number or payout account requires a one-time code sent to the new number. You can close your account from your profile once any remaining balance has been withdrawn.',
      },
      {
        h: 'Notifications',
        p: 'Pazo sends notifications about commissions, payouts and account activity in the app, and by SMS, WhatsApp or email where you have given a contact. These are service messages about your own account.',
      },
      {
        h: 'Contact',
        p: 'For any question about your data, email partners@pazo.co.tz.',
      },
    ],
  },
};

export default function Legal() {
  const { doc } = useParams();
  const { data } = useApi('/public/content');
  const content = DOCS[doc] || DOCS.terms;
  const supportEmail = data?.config?.support_email || 'partners@pazo.co.tz';

  return (
    <div className="public-page">
      <nav className="public-nav">
        <Link to="/">
          <Logo height={28} />
        </Link>
        <Link to="/" className="public-nav-link">
          Back to home
        </Link>
      </nav>

      <div className="public-section" style={{ textAlign: 'left', maxWidth: 760 }}>
        <div className="eyebrow">Legal</div>
        <h1 className="public-section-title" style={{ marginBottom: 'var(--s-6)' }}>
          {content.title}
        </h1>
        <p style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', marginBottom: 'var(--s-8)' }}>
          Last updated {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </p>

        {content.sections.map((s) => (
          <div key={s.h} style={{ marginBottom: 'var(--s-8)' }}>
            <h2
              style={{
                fontSize: 'var(--t-lg)',
                fontWeight: 700,
                color: 'var(--navy)',
                marginBottom: 'var(--s-3)',
              }}
            >
              {s.h}
            </h2>
            <p style={{ fontSize: 'var(--t-md)', color: 'var(--text-2)', lineHeight: 1.8 }}>{s.p}</p>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <Link to={doc === 'privacy' ? '/legal/terms' : '/legal/privacy'}>
            <Button variant="secondary">
              Read the {doc === 'privacy' ? 'terms of use' : 'privacy policy'}
            </Button>
          </Link>
          <a href={`mailto:${supportEmail}`}>
            <Button variant="ghost">Contact Pazo</Button>
          </a>
        </div>
      </div>

      <footer className="public-footer">
        <Logo height={24} tone="light" />
        <div className="footer-note">Powered by Pazo · © {new Date().getFullYear()}</div>
        <div className="footer-links">
          <Link to="/legal/terms" className="footer-link">
            Terms
          </Link>
          <Link to="/legal/privacy" className="footer-link">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
