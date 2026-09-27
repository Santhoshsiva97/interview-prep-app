import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../../features/auth/useAuth';
import { ProfileMenu } from '../../features/profile/components/ProfileMenu';
import { Icon } from '../icons/Icon';
import styles from './AppShell.module.css';
import type { NavItem } from './portalNav';

interface AppShellProps {
  /** Items the current user's role can't see are filtered out. */
  nav: NavItem[];
  homePath: string;
  /** Accessible name of the sidebar, e.g. "Portal" or "Admin". */
  label: string;
  /** Small tag next to the brand, e.g. "Admin". */
  badge?: string;
}

/**
 * Signed-in shell shared by the candidate portal and the admin console:
 * sidebar nav (off-canvas drawer ≤900px) + top bar with the profile menu.
 */
export function AppShell({ nav, homePath, label, badge }: AppShellProps) {
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const visible = nav.filter(
    (item) =>
      !item.roles ||
      (user && (user.role === 'super_admin' || item.roles.includes(user.role))),
  );
  const brand = (
    <>
      InterviewPrep
      {badge && <span className={styles.brandBadge}>{badge}</span>}
    </>
  );

  return (
    <div className={styles.portal}>
      <aside
        id="shell-nav"
        className={styles.sidebar}
        data-open={navOpen}
        aria-label={label}
      >
        <div className={styles.sidebarHeader}>
          <Link to={homePath} className={styles.brand} onClick={closeNav}>
            {brand}
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
            {visible.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
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
            aria-controls="shell-nav"
            aria-expanded={navOpen}
          >
            <Icon name="menu" />
          </button>
          <Link
            to={homePath}
            className={`${styles.brand} ${styles.topbarBrand}`}
          >
            {brand}
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
