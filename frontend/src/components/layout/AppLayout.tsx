import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../features/auth/useAuth';
import styles from './AppLayout.module.css';

const navItems = [
  { to: '/practice', label: 'Practice' },
  { to: '/exams', label: 'Mock Exams' },
  { to: '/interviews', label: 'Interviews' },
  { to: '/pricing', label: 'Pricing' },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink;

export function AppLayout() {
  const { user, initializing, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link to="/" className={styles.brand}>
            InterviewPrep
          </Link>
          <nav className={styles.nav} aria-label="Main">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.actions}>
            {initializing ? null : user ? (
              <>
                <Link to="/account" className={styles.navLink}>
                  {user.name}
                </Link>
                <button
                  type="button"
                  className={styles.logout}
                  onClick={() => {
                    // Leave protected pages first so RequireAuth doesn't bounce to /login.
                    navigate('/');
                    void logout();
                  }}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className={styles.navLink}>
                  Log in
                </Link>
                <Link to="/signup" className="button">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.inner}>
          <Outlet />
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.inner}>
          © {new Date().getFullYear()} Interview Prep Portal
        </div>
      </footer>
    </div>
  );
}
