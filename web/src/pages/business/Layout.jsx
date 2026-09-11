import { Outlet, useLocation } from 'react-router-dom';
import { ConsoleShell } from '../../components/Shell.jsx';
import { useApi } from '../../hooks/useApi.js';

const NAV = (pendingCount) => [
  {
    items: [
      { to: '/business', label: 'Overview', icon: 'grid', end: true },
      { to: '/business/partners', label: 'Partners', icon: 'users' },
      { to: '/business/referrals', label: 'Referral activity', icon: 'user-plus' },
      { to: '/business/commissions', label: 'Commissions', icon: 'receipt' },
      {
        to: '/business/wallet',
        label: 'Wallet',
        icon: 'wallet',
        count: pendingCount,
        alert: pendingCount > 0,
      },
    ],
  },
  {
    label: 'Configure',
    items: [{ to: '/business/settings', label: 'Settings', icon: 'settings' }],
  },
];

const TITLES = {
  '/business': 'Overview',
  '/business/partners': 'Partners',
  '/business/referrals': 'Referral activity',
  '/business/commissions': 'Commission history',
  '/business/wallet': 'Wallet',
  '/business/settings': 'Settings',
};

const SUBTITLES = {
  '/business': 'Your partner programme at a glance',
  '/business/partners': 'Everyone referring customers to you',
  '/business/referrals': 'Every signup attributed to a partner',
  '/business/commissions': 'Every commission event',
  '/business/wallet': 'The balance commissions are paid from',
  '/business/settings': 'Programme, API and team',
};

export default function BusinessLayout() {
  const location = useLocation();
  // A pending-commission count in the sidebar makes a funding problem visible
  // from anywhere in the dashboard, not just on the wallet screen.
  const { data } = useApi('/business/me/overview');
  const pendingCount = data?.wallet?.pending_commissions_tzs > 0 ? 1 : 0;

  return (
    <ConsoleShell
      nav={NAV(pendingCount)}
      brandTag={data?.business?.name?.split(' ').slice(-1)[0] || 'Business'}
      title={TITLES[location.pathname] || 'Business'}
      subtitle={SUBTITLES[location.pathname]}
      notificationsPath="/business/me/notifications"
      menuItems={[{ label: 'Settings', icon: 'settings', to: '/business/settings' }]}
    >
      <Outlet />
    </ConsoleShell>
  );
}
