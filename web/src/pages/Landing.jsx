import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo, LogoLockup } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import { Button } from '../components/UI.jsx';
import { useApi } from '../hooks/useApi.js';
import { num, tzs } from '../lib/format.js';
import '../styles/public.css';

/**
 * The public entry point. Copy comes from the CMS so the Pazo team can edit
 * it from the admin dashboard without a deploy; the constants here are the
 * fallback if the API is unreachable.
 */

const FALLBACK = {
  hero_eyebrow: 'Partner programme · Powered by Pazo',
  hero_title: 'Refer. Connect. Earn.',
  hero_subtitle:
    'The Travela gives anyone instant mobile connectivity wherever they travel — no roaming fees, no paperwork. Share your link and earn every time someone connects through you.',
  hero_cta: 'Join us',
  steps_eyebrow: 'How it works',
  steps_title: 'Simple. Earn forever.',
  step_1_title: 'Create your account and get your code',
  step_1_body:
    'Sign up and choose your personal referral code. Your link and QR code are generated automatically.',
  step_2_title: 'Share your link, QR, or code',
  step_2_body:
    'Someone scans your QR, taps your link, or types your code when they create a Travela account.',
  step_3_title: 'They connect. You get paid.',
  step_3_body:
    'Every time that traveller buys data — today or months from now — you earn commission.',
  login_eyebrow: 'Partner access',
  login_title: 'Already joined? Log in to your account.',
  footer_note: 'Partner programme for The Travela · Powered by Pazo',
};

export default function Landing() {
  const navigate = useNavigate();
  const { data } = useApi('/public/content');
  const { data: stats } = useApi('/public/stats');
  const [openFaq, setOpenFaq] = useState(0);

  const c = { ...FALLBACK, ...(data?.content || {}) };
  const config = data?.config || {};
  const selfSignupOpen = config.self_signup_open !== false;

  const faqs = [1, 2, 3]
    .map((i) => ({ q: c[`faq_${i}_q`], a: c[`faq_${i}_a`] }))
    .filter((f) => f.q && f.a);

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  // The headline's final word is tinted, matching the brand prototype.
  const titleParts = String(c.hero_title).trim().split(/\s+/);
  const lastWord = titleParts.pop();

  return (
    <div className="public-page">
      <nav className="public-nav">
        <LogoLockup height={26} partner={String(config.business_website || 'travela').replace(/\.com$/, '')} />
        <div className="public-nav-links">
          <button className="public-nav-link" onClick={() => scrollTo('how')}>
            How it works
          </button>
          {faqs.length > 0 && (
            <button className="public-nav-link" onClick={() => scrollTo('faq')}>
              Questions
            </button>
          )}
          <Link to="/login" className="public-nav-link">
            Log in
          </Link>
          <Button variant="primary" size="sm" onClick={() => navigate('/join')}>
            {c.hero_cta}
          </Button>
        </div>
        <div style={{ display: 'none' }} className="mobile-cta" />
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate('/join')}
          className="only-mobile-cta"
          style={{ display: 'none' }}
        >
          {c.hero_cta}
        </Button>
      </nav>

      {/* HERO */}
      <section className="hero-section">
        <div className="hero-pill">
          <span className="hero-pill-dot" />
          {c.hero_eyebrow}
        </div>
        <h1 className="hero-h1">
          {titleParts.map((w) => (
            <span key={w}>
              {w}
              <br />
            </span>
          ))}
          <em>{lastWord}</em>
        </h1>
        <p className="hero-lede">{c.hero_subtitle}</p>

        <div className="hero-cta-row">
          <Button variant="primary" size="lg" iconRight="arrow-right" onClick={() => navigate('/join')}>
            {c.hero_cta}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => scrollTo('how')}>
            How it works
          </Button>
        </div>

        <div className="hero-note">
          Already joined? <Link to="/login">Log in to your account</Link>
        </div>

        {stats && stats.active_partners > 0 && (
          <div className="hero-proof">
            <div className="proof-item">
              <div className="proof-value">{num(stats.active_partners)}</div>
              <div className="proof-label">Active partners</div>
            </div>
            <div className="proof-item">
              <div className="proof-value">{num(stats.total_referrals)}</div>
              <div className="proof-label">Travellers referred</div>
            </div>
            <div className="proof-item">
              <div className="proof-value">{tzs(stats.commissions_paid_tzs, { compact: true })}</div>
              <div className="proof-label">Paid to partners</div>
            </div>
          </div>
        )}
      </section>

      {/* HOW IT WORKS */}
      <div className="public-band" id="how">
        <div className="public-section">
          <div className="eyebrow">{c.steps_eyebrow}</div>
          <h2 className="public-section-title">
            {String(c.steps_title).split('.')[0]}.
            <br />
            <em>{String(c.steps_title).split('.').slice(1).join('.').trim()}</em>
          </h2>
          <div className="steps-grid">
            {[1, 2, 3].map((i) => (
              <div className="step-card" key={i}>
                <div className="step-num">{i}</div>
                <div className="step-title">{c[`step_${i}_title`]}</div>
                <div className="step-body">{c[`step_${i}_body`]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ACCESS */}
      <div className="public-section" id="access">
        <div className="eyebrow">{c.login_eyebrow}</div>
        <h2 className="public-section-title" style={{ marginBottom: 'var(--s-8)' }}>
          {String(c.login_title).split('?')[0]}?
          <br />
          <em>{String(c.login_title).split('?').slice(1).join('?').trim()}</em>
        </h2>

        <div className="access-grid">
          <button className="access-card" onClick={() => navigate('/login')}>
            <span className="access-icon">
              <Icon name="user" size={21} />
            </span>
            <span>
              <span className="access-title" style={{ display: 'block' }}>
                Individual login
              </span>
              <span className="access-sub" style={{ display: 'block' }}>
                Your code, earnings and wallet
              </span>
            </span>
            <Icon name="chevron-right" size={19} className="access-arrow" />
          </button>

          <button className="access-card" onClick={() => navigate('/login')}>
            <span className="access-icon">
              <Icon name="building" size={21} />
            </span>
            <span>
              <span className="access-title" style={{ display: 'block' }}>
                Organisation login
              </span>
              <span className="access-sub" style={{ display: 'block' }}>
                Monthly payouts and statements
              </span>
            </span>
            <Icon name="chevron-right" size={19} className="access-arrow" />
          </button>
        </div>

        {selfSignupOpen && (
          <p style={{ fontSize: 'var(--t-base)', color: 'var(--text-3)', marginBottom: 'var(--s-5)' }}>
            New here? <Link to="/join">Join the programme</Link> — it takes about two minutes.
          </p>
        )}

        <div className="quiet-links">
          <Link to="/login" className="quiet-link">
            {config.business_name || 'The Travela'} — business dashboard
          </Link>
          <span style={{ color: 'var(--border-strong)' }}>·</span>
          <Link to="/login" className="quiet-link">
            Pazo admin
          </Link>
        </div>
      </div>

      {/* FAQ */}
      {faqs.length > 0 && (
        <div className="public-band" id="faq">
          <div className="public-section">
            <div className="eyebrow">Questions</div>
            <h2 className="public-section-title">
              Good to <em>know.</em>
            </h2>
            <div className="faq-list">
              {faqs.map((f, i) => (
                <div className="faq-item" key={f.q}>
                  <button
                    className="faq-q"
                    onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                    aria-expanded={openFaq === i}
                  >
                    {f.q}
                    <Icon
                      name="chevron-down"
                      size={18}
                      className={`faq-chevron ${openFaq === i ? 'open' : ''}`}
                    />
                  </button>
                  {openFaq === i && <div className="faq-a">{f.a}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="public-footer">
        <Logo height={20} tone="light" />
        <div className="footer-note">
          {c.footer_note} · © {new Date().getFullYear()}
        </div>
        <div className="footer-links">
          <Link to="/legal/terms" className="footer-link">
            Terms
          </Link>
          <Link to="/legal/privacy" className="footer-link">
            Privacy
          </Link>
          <a href={`mailto:${config.support_email || 'partners@pazo.co.tz'}`} className="footer-link">
            Contact
          </a>
        </div>
      </footer>
    </div>
  );
}
