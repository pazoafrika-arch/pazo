import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import { Button } from '../components/UI.jsx';
import { useAuth, HOME_FOR_ROLE } from '../app/AuthContext.jsx';
import '../styles/public.css';

/** A 404 that offers a way back rather than a dead end. */
export default function NotFound() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user ? HOME_FOR_ROLE[user.role] || '/' : '/';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <Link to="/" style={{ display: 'inline-block' }}>
            <Logo height={26} />
          </Link>
          <h1 className="auth-title">Page not found</h1>
          <p className="auth-sub">That link does not lead anywhere on Pazo.</p>
        </div>
        <div className="auth-body">
          <div className="empty-icon" style={{ margin: '0 auto var(--s-5)' }}>
            <Icon name="search" size={24} />
          </div>
          <Button variant="primary" block iconRight="arrow-right" onClick={() => navigate(home)}>
            {user ? 'Back to my dashboard' : 'Back to home'}
          </Button>
        </div>
      </div>
    </div>
  );
}
