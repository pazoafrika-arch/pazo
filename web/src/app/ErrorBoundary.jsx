import { Component } from 'react';

/**
 * Catches render errors so a single broken screen does not leave the user
 * staring at a blank page. Offers the two things that actually help: reload,
 * or go home.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[pazo] render error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#F0FAFA',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            textAlign: 'center',
            background: '#fff',
            border: '1px solid rgba(13,33,55,.09)',
            borderRadius: 18,
            padding: 40,
            boxShadow: '0 12px 32px rgba(13,33,55,.12)',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#FEF2F2',
              color: '#DC2626',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 20px',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01" />
            </svg>
          </div>

          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: '#0D2137',
              marginBottom: 8,
              letterSpacing: '-0.03em',
            }}
          >
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#7A9AAA', lineHeight: 1.65, marginBottom: 24 }}>
            This screen could not be displayed. Your data is safe. Reloading usually fixes it.
          </p>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#0D2137',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                padding: '11px 22px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reload the page
            </button>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              style={{
                background: '#fff',
                color: '#0D2137',
                border: '1.5px solid rgba(13,33,55,.16)',
                borderRadius: 999,
                padding: '11px 22px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Go home
            </button>
          </div>

          {import.meta.env.DEV && (
            <pre
              style={{
                marginTop: 24,
                textAlign: 'left',
                fontSize: 11,
                color: '#DC2626',
                background: '#FEF2F2',
                padding: 12,
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 180,
                whiteSpace: 'pre-wrap',
              }}
            >
              {this.state.error?.stack || String(this.state.error)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
