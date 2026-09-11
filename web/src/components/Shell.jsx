import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { Logo } from './Logo.jsx';
import { Avatar, Button, EmptyState } from './UI.jsx';
import { useAuth } from '../app/AuthContext.jsx';
import { useApi, useIsMobile } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import { greeting, relative } from '../lib/format.js';

/* ================================================================
   Notifications bell + panel — shared by every shell
   ================================================================ */
function NotificationBell({ basePath }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { data, reload } = useApi(`${basePath}?limit=15`);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Poll quietly so a new commission appears without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => reload({ quiet: true }), 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const unread = data?.unread || 0;
  const items = data?.items || [];

  const markAll = async () => {
    try {
      await api.put(`${basePath.split('?')[0]}/read-all`);
      reload({ quiet: true });
    } catch {
      /* the badge simply stays until the next poll */
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon name="bell" size={19} />
        {unread > 0 && <span className="dot" />}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--t-base)' }}>Notifications</div>
              {unread > 0 && (
                <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                  {unread} unread
                </div>
              )}
            </div>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAll}>
                Mark all read
              </Button>
            )}
          </div>

          <div className="notif-list">
            {items.length === 0 ? (
              <EmptyState
                icon="bell"
                title="Nothing yet"
                text="Commission alerts and account updates will appear here."
              />
            ) : (
              items.map((n) => (
                <div key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'}`}>
                  <span className={`row-icon ${iconToneFor(n.type)}`} style={{ width: 32, height: 32 }}>
                    <Icon name={iconFor(n.type)} size={15} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-msg">{n.message}</div>
                    <div className="notif-time">{relative(n.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function iconFor(type) {
  const map = {
    commission_paid: 'banknote',
    commission_accrued: 'banknote',
    commission_pending: 'clock',
    new_referral: 'user-plus',
    withdrawal_complete: 'check-circle',
    withdrawal_requested: 'clock',
    withdrawal_failed: 'alert-circle',
    monthly_payout: 'banknote',
    welcome: 'sparkles',
    account_approved: 'check-circle',
    low_wallet_balance: 'alert-triangle',
    commission_unpaid_alert: 'alert-triangle',
  };
  return map[type] || 'info';
}

function iconToneFor(type) {
  if (type.includes('paid') || type.includes('accrued') || type.includes('complete') || type === 'account_approved')
    return 'green';
  if (type.includes('pending') || type.includes('requested')) return 'amber';
  if (type.includes('failed') || type.includes('alert') || type.includes('low_')) return 'red';
  return 'teal';
}

/* ================================================================
   User menu
   ================================================================ */
function UserMenu({ items = [] }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 2, borderRadius: 999 }}
        aria-label="Account menu"
        aria-expanded={open}
      >
        <Avatar name={user?.name} color={user?.avatar_color} size="md" />
      </button>

      {open && (
        <div
          className="notif-panel"
          style={{ width: 232, maxHeight: 'none' }}
          role="menu"
        >
          <div style={{ padding: 'var(--s-4)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--t-base)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name}
            </div>
            <div
              style={{
                fontSize: 'var(--t-sm)',
                color: 'var(--text-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {user?.email || user?.phone}
            </div>
          </div>
          <div style={{ padding: 'var(--s-2)' }}>
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className="nav-item"
                style={{ color: 'var(--text-2)' }}
                onClick={() => {
                  setOpen(false);
                  item.onClick ? item.onClick() : navigate(item.to);
                }}
              >
                <Icon name={item.icon} size={17} className="nav-item-icon" />
                <span className="nav-item-label">{item.label}</span>
              </button>
            ))}
            <button
              role="menuitem"
              className="nav-item"
              style={{ color: 'var(--red)' }}
              onClick={handleSignOut}
            >
              <Icon name="logout" size={17} className="nav-item-icon" />
              <span className="nav-item-label">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Console shell — business and admin (desktop-first)
   ================================================================ */
export function ConsoleShell({
  nav,
  title,
  subtitle,
  actions,
  children,
  brandTag,
  notificationsPath,
  menuItems,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="shell">
      {drawerOpen && isMobile && (
        <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} />
      )}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Logo height={24} tone="light" />
          {brandTag && <span className="sidebar-brand-tag">{brandTag}</span>}
        </div>

        <nav className="sidebar-nav">
          {nav.map((group) => (
            <div key={group.label || 'main'}>
              {group.label && <div className="nav-group-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon name={item.icon} size={18} className="nav-item-icon" />
                  <span className="nav-item-label">{item.label}</span>
                  {item.count > 0 && (
                    <span className={`nav-item-count ${item.alert ? 'alert' : ''}`}>
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <Avatar name={user?.name} color={user?.avatar_color} size="sm" />
            <div className="sidebar-user-body">
              <div className="sidebar-user-name">{user?.name}</div>
              <div className="sidebar-user-role">{roleLabel(user?.role)}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          {isMobile && (
            <button
              className="icon-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" size={20} />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="topbar-title">{title}</div>
            {subtitle && <div className="topbar-sub">{subtitle}</div>}
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            {actions}
            {notificationsPath && <NotificationBell basePath={notificationsPath} />}
            <UserMenu items={menuItems} />
          </div>
        </header>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}

/* ================================================================
   Partner shell — mobile-first with a bottom tab bar,
   promoting to a sidebar on wide screens
   ================================================================ */
export function PartnerShell({ tabs, title, notificationsPath, menuItems, children, greetingName }) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const location = useLocation();

  if (!isMobile) {
    return (
      <ConsoleShell
        nav={[{ items: tabs.map((t) => ({ ...t, end: t.end })) }]}
        title={title}
        subtitle={greetingName ? `${greeting()}, ${greetingName}` : undefined}
        notificationsPath={notificationsPath}
        menuItems={menuItems}
        brandTag="Partner"
      >
        {children}
      </ConsoleShell>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <Logo height={22} />
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          {notificationsPath && <NotificationBell basePath={notificationsPath} />}
          <UserMenu items={menuItems} />
        </div>
      </header>

      <main className="shell-content has-bottom-nav" style={{ padding: 'var(--s-4)' }}>
        {children}
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `bottom-tab ${isActive ? 'active' : ''}`}
          >
            <Icon name={tab.icon} size={21} className="bottom-tab-icon" />
            <span className="bottom-tab-label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function roleLabel(role) {
  const map = {
    individual: 'Individual partner',
    institution: 'Organisation partner',
    business_owner: 'Business dashboard',
    admin: 'Pazo admin',
    super_admin: 'Pazo super admin',
  };
  return map[role] || role;
}

export { NotificationBell };
