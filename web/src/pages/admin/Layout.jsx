import { Outlet, useLocation } from 'react-router-dom';
import { ConsoleShell } from '../../components/Shell.jsx';
import { useApi } from '../../hooks/useApi.js';

const TITLES = {
  '/admin': ['Platform overview', 'Every business, partner and transaction'],
  '/admin/businesses': ['Businesses', 'Clients running a partner programme'],
  '/admin/partners': ['Partners', 'Individuals and organisations across all businesses'],
  '/admin/approvals': ['Approvals', 'Organisation applications awaiting review'],
  '/admin/transactions': ['Transactions', 'Commission monitor across the platform'],
  '/admin/payouts': ['Payouts', 'Monthly institution payouts and agent withdrawals'],
  '/admin/communications': ['Communications', 'Messages, announcements and templates'],
  '/admin/users': ['Accounts', 'Every login on the platform'],
  '/admin/content': ['Site content', 'The public marketing site'],
  '/admin/settings': ['Configuration', 'Platform-wide settings'],
  '/admin/audit': ['Logs', 'Admin actions and integration requests'],
};

export default function AdminLayout() {
  const location = useLocation();
  // Counts in the sidebar surface work waiting to be done from any screen.
  const { data } = useApi('/admin/overview');
  const pendingApprovals = data?.attention?.pending_approvals || 0;
  const pendingCommissions = data?.attention?.pending_commission_count || 0;

  const nav = [
    {
      items: [
        { to: '/admin', label: 'Overview', icon: 'grid', end: true },
        { to: '/admin/businesses', label: 'Businesses', icon: 'briefcase' },
        { to: '/admin/partners', label: 'Partners', icon: 'users' },
        {
          to: '/admin/approvals',
          label: 'Approvals',
          icon: 'inbox',
          count: pendingApprovals,
          alert: pendingApprovals > 0,
        },
      ],
    },
    {
      label: 'Money',
      items: [
        {
          to: '/admin/transactions',
          label: 'Transactions',
          icon: 'receipt',
          count: pendingCommissions,
          alert: pendingCommissions > 0,
        },
        { to: '/admin/payouts', label: 'Payouts', icon: 'banknote' },
      ],
    },
    {
      label: 'Platform',
      items: [
        { to: '/admin/communications', label: 'Communications', icon: 'megaphone' },
        { to: '/admin/users', label: 'Accounts', icon: 'shield' },
        { to: '/admin/content', label: 'Site content', icon: 'globe' },
        { to: '/admin/settings', label: 'Configuration', icon: 'settings' },
        { to: '/admin/audit', label: 'Logs', icon: 'list-checks' },
      ],
    },
  ];

  const [title, subtitle] = TITLES[location.pathname] || ['Pazo Admin', ''];

  return (
    <ConsoleShell
      nav={nav}
      brandTag="Admin"
      title={title}
      subtitle={subtitle}
      notificationsPath="/admin/notifications"
      menuItems={[
        { label: 'Configuration', icon: 'settings', to: '/admin/settings' },
        { label: 'Logs', icon: 'list-checks', to: '/admin/audit' },
      ]}
    >
      <Outlet />
    </ConsoleShell>
  );
}
