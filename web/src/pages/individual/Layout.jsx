import { Outlet, useLocation } from 'react-router-dom';
import { PartnerShell } from '../../components/Shell.jsx';
import { useAuth } from '../../app/AuthContext.jsx';

const TABS = [
  { to: '/app', label: 'Home', icon: 'home', end: true },
  { to: '/app/wallet', label: 'Wallet', icon: 'wallet' },
  { to: '/app/code', label: 'My code', icon: 'qr' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
];

const TITLES = {
  '/app': 'Home',
  '/app/wallet': 'Wallet',
  '/app/code': 'My referral code',
  '/app/profile': 'Profile',
};

export default function IndividualLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const firstName = (user?.name || '').split(' ')[0];

  return (
    <PartnerShell
      tabs={TABS}
      title={TITLES[location.pathname] || 'Pazo'}
      greetingName={firstName}
      notificationsPath="/individual/me/notifications"
      menuItems={[{ label: 'Profile', icon: 'user', to: '/app/profile' }]}
    >
      <Outlet />
    </PartnerShell>
  );
}
