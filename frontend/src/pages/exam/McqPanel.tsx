import { useId } from 'react';
import type {
  McqResponse,
  RuntimeQuestion,
  SessionItem,
} from '../../features/exams/api';
import styles from './ExamRuntime.module.css';

type McqQuestion = Extract<RuntimeQuestion, { mcq: unknown }>;

export function McqPanel({
  item,
  question,
  onChange,
}: {
  item: SessionItem;
  question: McqQuestion;
  onChange: (response: McqResponse | null) => void;
}) {
  const name = useId();
  const multi = question.mcq.allowMultiple;
  const chosen =
    item.response && 'optionIds' in item.response
      ? item.response.optionIds
      : [];

  const toggle = (id: string, checked: boolean) => {
    const next = multi
      ? checked
        ? [...chosen, id]
        : chosen.filter((x) => x !== id)
      : [id];
    onChange(next.length ? { optionIds: next } : null);
  };

  return (
    <fieldset className={styles.options}>
      <legend className={styles.optionsLegend}>
        {multi ? 'Select all that apply' : 'Select one answer'}
      </legend>
      {question.mcq.options.map((o, i) => {
        const checked = chosen.includes(o.id);
        return (
          <label key={o.id} className={styles.option} data-checked={checked}>
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={name}
              checked={checked}
              onChange={(e) => toggle(o.id, e.target.checked)}
            />
            <span className={styles.optionKey} aria-hidden="true">
              {String.fromCharCode(65 + i)}
            </span>
            <span>{o.text}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
