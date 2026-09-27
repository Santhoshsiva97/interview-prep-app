import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { RequireAuth } from '../../features/auth/RequireAuth';
import { ProfileMenu } from '../../features/profile/components/ProfileMenu';
import { ProfileProvider } from '../../features/profile/ProfileProvider';
import { Icon } from '../icons/Icon';
import { PORTAL_NAV } from './portalNav';
import styles from './PortalLayout.module.css';

/** Authenticated shell: sidebar nav (drawer on small screens) + top bar. */
export function PortalLayout() {
  return (
    <RequireAuth>
      <ProfileProvider>
        <PortalShell />
      </ProfileProvider>
    </RequireAuth>
  );
}

function PortalShell() {
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={styles.portal}>
      <aside
        id="portal-nav"
        className={styles.sidebar}
        data-open={navOpen}
        aria-label="Portal"
      >
        <div className={styles.sidebarHeader}>
          <Link to="/dashboard" className={styles.brand} onClick={closeNav}>
            InterviewPrep
          </Link>
          <button
            type="button"
            className={styles.iconButton}
            onClick={closeNav}
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav>
          <ul className={styles.navList}>
            {PORTAL_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    isActive
                      ? `${styles.navLink} ${styles.active}`
                      : styles.navLink
                  }
                  onClick={closeNav}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.soon && <span className={styles.soon}>Soon</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {navOpen && (
        <div
          className={styles.backdrop}
          onClick={closeNav}
          aria-hidden="true"
        />
      )}

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.menuButton}`}
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-controls="portal-nav"
            aria-expanded={navOpen}
          >
            <Icon name="menu" />
          </button>
          <Link
            to="/dashboard"
            className={`${styles.brand} ${styles.topbarBrand}`}
          >
            InterviewPrep
          </Link>
          <div className={styles.topbarEnd}>
            <ProfileMenu />
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
