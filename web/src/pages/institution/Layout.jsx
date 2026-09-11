import { Outlet, useLocation } from 'react-router-dom';
import { PartnerShell } from '../../components/Shell.jsx';
import { useAuth } from '../../app/AuthContext.jsx';

const TABS = [
  { to: '/institution', label: 'Home', icon: 'home', end: true },
  { to: '/institution/earnings', label: 'Earnings', icon: 'banknote' },
  { to: '/institution/payouts', label: 'Payouts', icon: 'calendar' },
  { to: '/institution/code', label: 'Our code', icon: 'qr' },
  { to: '/institution/profile', label: 'Profile', icon: 'building' },
];

const TITLES = {
  '/institution': 'Home',
  '/institution/earnings': 'Earnings',
  '/institution/payouts': 'Monthly payouts',
  '/institution/code': 'Our referral code',
  '/institution/profile': 'Organisation profile',
};

export default function InstitutionLayout() {
  const { user } = useAuth();
  const location = useLocation();

  return (
    <PartnerShell
      tabs={TABS}
      title={TITLES[location.pathname] || 'Pazo'}
      greetingName={user?.name}
      notificationsPath="/institution/me/notifications"
      menuItems={[{ label: 'Organisation profile', icon: 'building', to: '/institution/profile' }]}
    >
      <Outlet />
    </PartnerShell>
  );
}
