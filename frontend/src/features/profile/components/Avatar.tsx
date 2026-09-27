import { useState } from 'react';
import styles from './Avatar.module.css';

interface AvatarProps {
  name: string;
  url?: string | null;
  size?: number;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/** Profile photo, falling back to initials (also if the image fails to load). */
export function Avatar({ name, url, size = 36 }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url && url !== failedUrl;

  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {showImage ? (
        <img src={url} alt="" onError={() => setFailedUrl(url)} />
      ) : (
        <span aria-hidden="true">{initials(name) || '?'}</span>
      )}
    </span>
  );
}
