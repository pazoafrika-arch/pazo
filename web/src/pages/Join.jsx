import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { Icon } from '../components/Icon.jsx';
import '../styles/public.css';

/** The fork in the road: join as a person, or register an organisation. */
export default function Join() {
  const navigate = useNavigate();

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide">
        <div className="auth-head">
          <Link to="/" style={{ display: 'inline-block' }}>
            <Logo height={28} />
          </Link>
          <h1 className="auth-title">How would you like to join?</h1>
          <p className="auth-sub">Choose the option that fits you</p>
        </div>

        <div className="auth-body">
          <button className="access-card" onClick={() => navigate('/join/individual')} style={{ marginBottom: 12 }}>
            <span className="access-icon">
              <Icon name="user" size={21} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="access-title" style={{ display: 'block' }}>
                Join as an individual
              </span>
              <span className="access-sub" style={{ display: 'block' }}>
                Share your link and earn on every purchase. Paid straight to mobile money.
              </span>
            </span>
            <Icon name="chevron-right" size={19} className="access-arrow" />
          </button>

          <button className="access-card" onClick={() => navigate('/join/organisation')}>
            <span className="access-icon">
              <Icon name="building" size={21} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="access-title" style={{ display: 'block' }}>
                Join as an organisation
              </span>
              <span className="access-sub" style={{ display: 'block' }}>
                Hotels, airlines, tour operators and agencies. Paid monthly with statements.
              </span>
            </span>
            <Icon name="chevron-right" size={19} className="access-arrow" />
          </button>

          <div className="auth-foot">
            Already have an account? <Link to="/login">Log in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
