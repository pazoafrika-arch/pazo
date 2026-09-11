import { Icon } from '../../components/Icon.jsx';
import { Banner, Button, Card, CopyField, Loading } from '../../components/UI.jsx';
import { useApi } from '../../hooks/useApi.js';
import { downloadFile } from '../../lib/api.js';
import { copyToClipboard, pct } from '../../lib/format.js';
import { useToast } from '../../app/ToastContext.jsx';

/**
 * The share screen. Everything a partner needs to get their code in front of
 * a traveller: the code itself, the link, a scannable QR, and one-tap sharing.
 * Works for both individual and institution partners via the `scope` prop.
 */
export default function ReferralScreen({ scope = 'individual' }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/${scope}/me/referral`);

  if (loading && !data) return <Loading label="Loading your code" />;
  if (error)
    return (
      <Banner
        tone="error"
        title="Could not load your referral details"
        action={
          <Button size="sm" variant="secondary" onClick={() => reload()}>
            Retry
          </Button>
        }
      >
        {error}
      </Banner>
    );
  if (!data) return null;

  const copy = async (value, label) => {
    const okay = await copyToClipboard(value);
    toast[okay ? 'success' : 'error'](okay ? `${label} copied` : 'Could not copy');
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join The Travela',
          text: data.share_message,
          url: data.referral_link,
        });
        return;
      } catch {
        // Sheet dismissed — fall through to copy.
      }
    }
    copy(data.share_message, 'Share message');
  };

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(data.share_message)}`, '_blank', 'noopener');
  };

  const downloadQr = async () => {
    try {
      await downloadFile(data.qr_download_url.replace('/api/v1', ''), `pazo-${data.referral_code}-qr.png`);
      toast.success('QR code downloaded');
    } catch {
      toast.error('Could not download the QR code');
    }
  };

  return (
    <div className="stack">
      {/* Code */}
      <div className="code-hero anim-rise">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="hero-label" style={{ color: 'rgba(255,255,255,.6)' }}>
            My referral code
          </div>
          <div className="code-value">{data.referral_code}</div>
          <div className="hero-sub" style={{ color: 'rgba(255,255,255,.6)' }}>
            Permanent · Cannot be changed
          </div>
        </div>
      </div>

      {/* Performance */}
      <div className="grid-3 keep-2">
        <Card>
          <div className="stat-label">Signups</div>
          <div className="stat-value teal" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {data.signups}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Link clicks</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {data.clicks}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Conversion</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-xl)', marginTop: 4 }}>
            {pct(data.conversion_rate)}
          </div>
        </Card>
      </div>

      {/* Link */}
      <Card>
        <div className="label">Referral link</div>
        <CopyField value={data.referral_link} label="Link" mono={false} />
        <div className="field-hint" style={{ marginTop: 8 }}>
          Anyone who signs up through this link is linked to you permanently — you earn on every
          purchase they ever make.
        </div>
      </Card>

      {/* QR */}
      <Card>
        <div className="card-title" style={{ marginBottom: 'var(--s-4)' }}>
          QR code
        </div>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-block',
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--s-4)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <img
              src={data.qr_data_url}
              alt={`QR code for referral code ${data.referral_code}`}
              width={180}
              height={180}
              style={{ display: 'block', width: 180, height: 180 }}
            />
          </div>
          <div
            style={{
              fontSize: 'var(--t-sm)',
              color: 'var(--text-3)',
              margin: 'var(--s-4) 0',
              lineHeight: 1.6,
            }}
          >
            Scanning this opens your referral link. Print it for a reception desk, a poster or a
            business card.
          </div>
          <Button variant="secondary" icon="download" onClick={downloadQr}>
            Download QR code (PNG)
          </Button>
        </div>
      </Card>

      {/* Share */}
      <Card>
        <div className="card-title" style={{ marginBottom: 'var(--s-4)' }}>
          Share
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--s-3)',
          }}
        >
          <ShareTile icon="copy" label="Copy code" onClick={() => copy(data.referral_code, 'Code')} />
          <ShareTile icon="whatsapp" label="WhatsApp" onClick={shareWhatsApp} />
          <ShareTile icon="link" label="Copy link" onClick={() => copy(data.referral_link, 'Link')} />
          <ShareTile icon="share" label="More" onClick={share} />
        </div>
      </Card>
    </div>
  );
}

function ShareTile({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 'var(--s-4)',
        background: 'var(--surface-sunken)',
        border: '1.5px solid var(--border)',
        borderRadius: 'var(--r-md)',
        color: 'var(--navy)',
        fontSize: 'var(--t-sm)',
        fontWeight: 600,
        transition: 'all var(--fast) var(--ease)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--teal)';
        e.currentTarget.style.color = 'var(--teal)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.color = 'var(--navy)';
      }}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
}
