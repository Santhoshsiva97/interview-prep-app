import type { SessionItem } from '../../features/exams/api';

export type PaletteState =
  | 'answered'
  | 'answered-review'
  | 'review'
  | 'skipped'
  | 'unvisited'
  | 'locked';

export function paletteState(item: SessionItem): PaletteState {
  if (!item.question) return 'locked';
  if (item.answered)
    return item.markedForReview ? 'answered-review' : 'answered';
  if (item.markedForReview) return 'review';
  return item.visited ? 'skipped' : 'unvisited';
}
