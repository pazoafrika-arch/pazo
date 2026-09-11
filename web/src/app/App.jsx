import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, HOME_FOR_ROLE } from './AuthContext.jsx';
import { ToastProvider } from './ToastContext.jsx';
import { Loading } from '../components/UI.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/layout.css';

/* Public */
import Landing from '../pages/Landing.jsx';
import Login from '../pages/Login.jsx';
import Join from '../pages/Join.jsx';
import JoinIndividual from '../pages/JoinIndividual.jsx';
import JoinOrganisation from '../pages/JoinOrganisation.jsx';
import ForgotPassword from '../pages/ForgotPassword.jsx';
import Legal from '../pages/Legal.jsx';
import NotFound from '../pages/NotFound.jsx';

/* Individual */
import IndividualLayout from '../pages/individual/Layout.jsx';
import IndividualHome from '../pages/individual/Home.jsx';
import IndividualWallet from '../pages/individual/Wallet.jsx';
import ReferralScreen from '../pages/individual/Referral.jsx';
import IndividualProfile from '../pages/individual/Profile.jsx';

/* Institution */
import InstitutionLayout from '../pages/institution/Layout.jsx';
import InstitutionHome from '../pages/institution/Home.jsx';
import InstitutionEarnings from '../pages/institution/Earnings.jsx';
import InstitutionPayouts from '../pages/institution/Payouts.jsx';
import InstitutionProfile from '../pages/institution/Profile.jsx';

/* Business and admin are heavier, data-dense consoles. Loading them lazily
   keeps the partner bundle small, which matters most on a phone over 4G. */
const BusinessLayout = lazy(() => import('../pages/business/Layout.jsx'));
const BusinessOverview = lazy(() => import('../pages/business/Overview.jsx'));
const BusinessPartners = lazy(() => import('../pages/business/Partners.jsx'));
const BusinessReferrals = lazy(() => import('../pages/business/Referrals.jsx'));
const BusinessCommissions = lazy(() => import('../pages/business/Commissions.jsx'));
const BusinessWallet = lazy(() => import('../pages/business/Wallet.jsx'));
const BusinessSettings = lazy(() => import('../pages/business/Settings.jsx'));

const AdminLayout = lazy(() => import('../pages/admin/Layout.jsx'));
const AdminOverview = lazy(() => import('../pages/admin/Overview.jsx'));
const AdminBusinesses = lazy(() => import('../pages/admin/Businesses.jsx'));
const AdminPartners = lazy(() => import('../pages/admin/Partners.jsx'));
const AdminApprovals = lazy(() => import('../pages/admin/Approvals.jsx'));
const AdminTransactions = lazy(() => import('../pages/admin/Transactions.jsx'));
const AdminPayouts = lazy(() => import('../pages/admin/Payouts.jsx'));
const AdminCommunications = lazy(() => import('../pages/admin/Communications.jsx'));
const AdminUsers = lazy(() => import('../pages/admin/Users.jsx'));
const AdminContent = lazy(() => import('../pages/admin/Content.jsx'));
const AdminSettings = lazy(() => import('../pages/admin/Settings.jsx'));
const AdminAudit = lazy(() => import('../pages/admin/Audit.jsx'));

/** Gate a route on being signed in with one of the allowed roles. */
function Protected({ roles, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <Loading label="Checking your session" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to={HOME_FOR_ROLE[user.role] || '/'} replace />;

  return children;
}

/** Send a signed-in visitor to their own dashboard instead of the landing page. */
function PublicOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (user) return <Navigate to={HOME_FOR_ROLE[user.role] || '/'} replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                {/* Public */}
                <Route path="/" element={<Landing />} />
                <Route
                  path="/login"
                  element={
                    <PublicOnly>
                      <Login />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/join"
                  element={
                    <PublicOnly>
                      <Join />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/join/individual"
                  element={
                    <PublicOnly>
                      <JoinIndividual />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/join/organisation"
                  element={
                    <PublicOnly>
                      <JoinOrganisation />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/forgot-password"
                  element={
                    <PublicOnly>
                      <ForgotPassword />
                    </PublicOnly>
                  }
                />
                <Route path="/legal/:doc" element={<Legal />} />

                {/* Individual partner */}
                <Route
                  path="/app"
                  element={
                    <Protected roles={['individual']}>
                      <IndividualLayout />
                    </Protected>
                  }
                >
                  <Route index element={<IndividualHome />} />
                  <Route path="wallet" element={<IndividualWallet />} />
                  <Route path="code" element={<ReferralScreen scope="individual" />} />
                  <Route path="profile" element={<IndividualProfile />} />
                </Route>

                {/* Institution partner */}
                <Route
                  path="/institution"
                  element={
                    <Protected roles={['institution']}>
                      <InstitutionLayout />
                    </Protected>
                  }
                >
                  <Route index element={<InstitutionHome />} />
                  <Route path="earnings" element={<InstitutionEarnings />} />
                  <Route path="payouts" element={<InstitutionPayouts />} />
                  <Route path="code" element={<ReferralScreen scope="institution" />} />
                  <Route path="profile" element={<InstitutionProfile />} />
                </Route>

                {/* Business */}
                <Route
                  path="/business"
                  element={
                    <Protected roles={['business_owner']}>
                      <BusinessLayout />
                    </Protected>
                  }
                >
                  <Route index element={<BusinessOverview />} />
                  <Route path="partners" element={<BusinessPartners />} />
                  <Route path="referrals" element={<BusinessReferrals />} />
                  <Route path="commissions" element={<BusinessCommissions />} />
                  <Route path="wallet" element={<BusinessWallet />} />
                  <Route path="settings" element={<BusinessSettings />} />
                </Route>

                {/* Admin */}
                <Route
                  path="/admin"
                  element={
                    <Protected roles={['admin', 'super_admin']}>
                      <AdminLayout />
                    </Protected>
                  }
                >
                  <Route index element={<AdminOverview />} />
                  <Route path="businesses" element={<AdminBusinesses />} />
                  <Route path="partners" element={<AdminPartners />} />
                  <Route path="approvals" element={<AdminApprovals />} />
                  <Route path="transactions" element={<AdminTransactions />} />
                  <Route path="payouts" element={<AdminPayouts />} />
                  <Route path="communications" element={<AdminCommunications />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="content" element={<AdminContent />} />
                  <Route path="settings" element={<AdminSettings />} />
                  <Route path="audit" element={<AdminAudit />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
