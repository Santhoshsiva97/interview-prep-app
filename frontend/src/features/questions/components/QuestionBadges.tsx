import styles from '../../../pages/admin/Admin.module.css';
import {
  DIFFICULTY_LABELS,
  STATUS_LABELS,
  type Difficulty,
  type QuestionStatus,
} from '../api';

const STATUS_TONE: Record<QuestionStatus, string | undefined> = {
  draft: undefined,
  pending_review: 'primary',
  published: 'success',
  rejected: 'danger',
  archived: undefined,
};

export function StatusBadge({ status }: { status: QuestionStatus }) {
  return (
    <span className={styles.badge} data-tone={STATUS_TONE[status]}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const DIFFICULTY_TONE: Record<Difficulty, string> = {
  easy: 'success',
  medium: 'primary',
  hard: 'danger',
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={styles.badge} data-tone={DIFFICULTY_TONE[difficulty]}>
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  );
}
