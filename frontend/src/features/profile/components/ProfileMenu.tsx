import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Icon } from '../../../components/icons/Icon';
import { isStaff } from '../../../components/layout/portalNav';
import { useAuth } from '../../auth/useAuth';
import { useProfile } from '../useProfile';
import { Avatar } from './Avatar';
import styles from './ProfileMenu.module.css';

/** Top-bar account button with a dropdown (profile, subscription, log out). */
export function ProfileMenu() {
  const { user, logout } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const inAdmin = useLocation().pathname.startsWith('/admin');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const close = () => setOpen(false);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Account menu for ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.name} url={profile?.avatarUrl} size={32} />
        <span className={styles.name}>{user.name}</span>
        <Icon name="chevronDown" size={16} />
      </button>

      {open && (
        <div id={menuId} role="menu" className={styles.menu}>
          <div className={styles.header}>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <Link role="menuitem" to="/profile" onClick={close}>
            <Icon name="profile" size={18} /> Your profile
          </Link>
          <Link role="menuitem" to="/subscription" onClick={close}>
            <Icon name="subscription" size={18} /> Subscription
          </Link>
          {isStaff(user.role) &&
            (inAdmin ? (
              <Link role="menuitem" to="/dashboard" onClick={close}>
                <Icon name="dashboard" size={18} /> Candidate portal
              </Link>
            ) : (
              <Link role="menuitem" to="/admin" onClick={close}>
                <Icon name="shield" size={18} /> Admin console
              </Link>
            ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              navigate('/');
              void logout();
            }}
          >
            <Icon name="logout" size={18} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
