import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { statusTone, statusLabel, initials as toInitials, copyToClipboard } from '../lib/format.js';
import { useToast } from '../app/ToastContext.jsx';

/* ---------------- Button ---------------- */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  block = false,
  className = '',
  disabled,
  ...rest
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    block && 'btn-block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="btn-spinner" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={16} /> : null}
    </button>
  );
}

/* ---------------- Card ---------------- */
export function Card({ children, className = '', pad = true, hoverable = false, ...rest }) {
  return (
    <div
      className={`card ${pad ? 'card-pad' : ''} ${hoverable ? 'card-hoverable' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }) {
  return (
    <div className="card-head">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {icon && (
          <span className="stat-icon">
            <Icon name={icon} size={16} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export function Badge({ status, children, tone, dot = false, className = '' }) {
  const resolved = tone || statusTone(status);
  return (
    <span className={`badge badge-${resolved} ${className}`}>
      {dot && <span className="badge-dot" />}
      {children || statusLabel(status)}
    </span>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({ name, color = '#007b84', size = 'md', square = false }) {
  return (
    <div
      className={`avatar avatar-${size} ${square ? 'avatar-square' : ''}`}
      style={{ background: color }}
      aria-hidden="true"
    >
      {toInitials(name)}
    </div>
  );
}

/* ---------------- Stat ---------------- */
export function Stat({ label, value, icon, delta, hint, tone, onClick }) {
  const deltaClass = delta === undefined || delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return (
    <div
      className="stat"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="stat-icon">
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <div className={`stat-value ${tone === 'teal' ? 'teal' : ''}`}>{value}</div>
      {(deltaClass || hint) && (
        <div className="stat-foot">
          {deltaClass && (
            <span className={`delta ${deltaClass}`}>
              <Icon name={delta > 0 ? 'trend-up' : delta < 0 ? 'trend-down' : 'minus'} size={12} />
              {Math.abs(delta)}%
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, subtitle, children, footer, width = 'md' }) {
  const ref = useRef(null);

  // Escape closes; body scroll is locked while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Move focus into the dialog so keyboard users are not left behind.
  useEffect(() => {
    if (open && ref.current) {
      const target = ref.current.querySelector(
        'input:not([type=hidden]), textarea, select, button',
      );
      setTimeout(() => target?.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  const widthClass = width === 'wide' ? 'modal-wide' : width === 'xwide' ? 'modal-xwide' : '';

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className={`modal ${widthClass}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Drawer ---------------- */
export function Drawer({ open, onClose, title, subtitle, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="drawer-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Field ---------------- */
export function Field({ label, hint, error, children, optional = false, htmlFor }) {
  return (
    <div className="field">
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label} {optional && <span className="opt">(optional)</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className="field-error">
          <Icon name="alert-circle" size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function Input({ error, ...rest }) {
  return <input className={`input ${error ? 'error' : ''}`} {...rest} />;
}

export function Select({ error, children, ...rest }) {
  return (
    <select className={`select ${error ? 'error' : ''}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ error, ...rest }) {
  return <textarea className={`textarea ${error ? 'error' : ''}`} {...rest} />;
}

/** A password field with a reveal toggle. */
export function PasswordInput({ error, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="input-group">
      <input
        className={`input ${error ? 'error' : ''}`}
        type={shown ? 'text' : 'password'}
        style={{ paddingLeft: 14, paddingRight: 44 }}
        {...rest}
      />
      <div className="input-suffix">
        <button
          type="button"
          className="modal-close"
          style={{ width: 28, height: 28 }}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Switch ---------------- */
export function Switch({ checked, onChange, label, description, disabled }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 0',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--t-base)', fontWeight: 600, color: 'var(--navy)' }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', marginTop: 2, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={!!checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          aria-label={label}
        />
        <span className="switch-track" />
      </label>
    </div>
  );
}

/* ---------------- Banner ---------------- */
export function Banner({ tone = 'info', title, children, action, onDismiss, icon }) {
  const icons = {
    info: 'info',
    success: 'check-circle',
    warn: 'alert-triangle',
    error: 'alert-circle',
  };
  return (
    <div className={`banner banner-${tone}`}>
      <span className="banner-icon">
        <Icon name={icon || icons[tone]} size={18} />
      </span>
      <div className="banner-body">
        {title && <div className="banner-title">{title}</div>}
        {children}
      </div>
      {action}
      {onDismiss && (
        <button className="modal-close" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

/* ---------------- Empty state ---------------- */
export function EmptyState({ icon = 'inbox', title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action}
    </div>
  );
}

/* ---------------- Loading ---------------- */
export function Loading({ label = 'Loading' }) {
  return (
    <div className="spinner-page">
      <div className="spinner" />
      <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>{label}</div>
    </div>
  );
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 6 }) {
  return (
    <div style={{ padding: 'var(--s-4)' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 0' }}>
          <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-text" style={{ width: '42%' }} />
            <div className="skeleton skeleton-text" style={{ width: '26%', marginBottom: 0 }} />
          </div>
          <div className="skeleton skeleton-text" style={{ width: 72, marginBottom: 0 }} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- Copy field ---------------- */
export function CopyField({ value, label, mono = true, onCopied }) {
  const toast = useToast();
  const [done, setDone] = useState(false);

  const copy = useCallback(async () => {
    const okay = await copyToClipboard(value);
    if (okay) {
      setDone(true);
      toast.success(onCopied || `${label || 'Copied'} to clipboard`);
      setTimeout(() => setDone(false), 2000);
    } else {
      toast.error('Could not copy. Select the text and copy manually.');
    }
  }, [value, label, onCopied, toast]);

  return (
    <div className="copy-field">
      {mono ? <code>{value}</code> : <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>}
      <Button variant={done ? 'teal' : 'secondary'} size="sm" onClick={copy} icon={done ? 'check' : 'copy'}>
        {done ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/* ---------------- Pagination ---------------- */
export function Pagination({ page, pages, total, limit, onPage }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </div>
      <div className="pagination-controls">
        <Button
          variant="secondary"
          size="sm"
          icon="chevron-left"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Back
        </Button>
        <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', padding: '0 4px' }}>
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          iconRight="chevron-right"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Search ---------------- */
export function SearchInput({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="search-input">
      <Icon name="search" size={16} />
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="search"
      />
    </div>
  );
}

/* ---------------- Segmented control ---------------- */
export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={`segment ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 'var(--t-xs)',
                background: value === t.value ? 'var(--teal-xlight)' : 'var(--gray-100)',
                color: value === t.value ? 'var(--teal)' : 'var(--text-3)',
                padding: '2px 7px',
                borderRadius: 'var(--r-pill)',
                fontWeight: 700,
              }}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Confirm dialog ---------------- */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 'var(--t-base)', color: 'var(--text-2)', lineHeight: 1.65 }}>{message}</p>
    </Modal>
  );
}

/* ---------------- Definition list ---------------- */
export function DetailList({ items }) {
  return (
    <dl style={{ display: 'grid', gap: 1, background: 'var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      {items
        .filter((i) => i)
        .map((item) => (
          <div
            key={item.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              padding: '11px 14px',
              background: 'var(--surface)',
              flexWrap: 'wrap',
            }}
          >
            <dt style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', fontWeight: 500 }}>
              {item.label}
            </dt>
            <dd
              style={{
                fontSize: 'var(--t-base)',
                fontWeight: 600,
                color: 'var(--navy)',
                textAlign: 'right',
                overflowWrap: 'anywhere',
              }}
            >
              {item.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}
