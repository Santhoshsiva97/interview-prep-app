import type { SessionItem, SessionView } from '../../features/exams/api';
import styles from './ExamRuntime.module.css';
import { paletteState, type PaletteState } from './paletteState';

const LEGEND: { state: PaletteState; label: string }[] = [
  { state: 'answered', label: 'Answered' },
  { state: 'skipped', label: 'Not answered' },
  { state: 'unvisited', label: 'Not visited' },
  { state: 'review', label: 'Marked for review' },
  { state: 'answered-review', label: 'Answered & marked' },
];

const STATE_LABEL: Record<PaletteState, string> = {
  answered: 'answered',
  'answered-review': 'answered, marked for review',
  review: 'marked for review',
  skipped: 'not answered',
  unvisited: 'not visited',
  locked: 'locked',
};

/** Question grid grouped by section, with a colour legend. */
export function QuestionPalette({
  session,
  items,
  currentId,
  onPick,
}: {
  session: SessionView;
  items: SessionItem[];
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  // Numbers run across the whole attempt, as on the question header.
  let n = 0;
  const numbers = new Map(
    items.filter((i) => i.question).map((i) => [i.id, ++n]),
  );
  return (
    <div className={styles.paletteInner}>
      {session.sections.map((section) => {
        const inSection = items.filter((i) => i.sectionIndex === section.index);
        const locked = section.state === 'done' || section.state === 'upcoming';
        return (
          <section key={section.index} className={styles.paletteSection}>
            <h2>
              {section.title}
              {section.state === 'done' && <small> · finished</small>}
              {section.state === 'upcoming' && <small> · later</small>}
            </h2>
            <div className={styles.grid}>
              {inSection.map((item, i) => {
                const state = paletteState(item);
                const label = numbers.get(item.id) ?? i + 1;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.cell}
                    data-state={state}
                    aria-current={item.id === currentId ? 'true' : undefined}
                    aria-label={`Question ${label}, ${STATE_LABEL[state]}`}
                    disabled={locked}
                    onClick={() => onPick(item.id)}
                  >
                    {locked ? i + 1 : label}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <ul className={styles.legend}>
        {LEGEND.map((l) => (
          <li key={l.state}>
            <span className={styles.cellSwatch} data-state={l.state} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
