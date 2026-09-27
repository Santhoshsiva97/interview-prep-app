import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { FormAlert } from '../../components/form/FormField';
import btn from '../../components/ui/Button.module.css';
import { Dialog } from '../../components/ui/Dialog';
import {
  questionsApi,
  type Tag,
  type TagKind,
  type Topic,
} from '../../features/questions/api';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';
import q from './questions/Questions.module.css';

type Editing =
  | { kind: 'topic'; item: Topic | null }
  | { kind: 'tag'; item: Tag | null; tagKind: TagKind };

/** Topic & tag taxonomy management (FRD §4.11). */
export function TaxonomyPage() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: 'topic' | 'tag';
    id: string;
    name: string;
  } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([questionsApi.topics(), questionsApi.tags()])
      .then(([t, g]) => {
        if (cancelled) return;
        setTopics(t);
        setTags(g);
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const refresh = () => setReload((n) => n + 1);

  if (error) return <p role="alert">{error}</p>;
  if (!topics) return <p aria-busy="true">Loading taxonomy…</p>;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Taxonomy</h1>
        <p className={styles.subtitle}>
          Topics organise the question bank; tags add skills and companies.
          Slugs are what <Link to="/admin/questions/import">bulk upload</Link>{' '}
          files refer to.
        </p>
      </header>

      <section aria-labelledby="topics-heading" className={styles.stack}>
        <div className={q.headerRow}>
          <h2
            id="topics-heading"
            className={styles.sectionTitle}
            style={{ margin: 0 }}
          >
            Topics ({topics.length})
          </h2>
          <button
            type="button"
            className={btn.primary}
            onClick={() => setEditing({ kind: 'topic', item: null })}
          >
            + Add topic
          </button>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Slug</th>
              <th scope="col">Questions</th>
              <th scope="col">Order</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className={styles.userCell}>
                    <strong>{t.name}</strong>
                    {t.description && <span>{t.description}</span>}
                  </div>
                </td>
                <td data-label="Slug">
                  <code>{t.slug}</code>
                </td>
                <td data-label="Questions">
                  <Link to={`/admin/questions?topicId=${t.id}`}>
                    {t.questionCount}
                  </Link>
                </td>
                <td data-label="Order">{t.sortOrder}</td>
                <td>
                  <RowActions
                    onEdit={() => setEditing({ kind: 'topic', item: t })}
                    onDelete={() =>
                      setDeleting({ kind: 'topic', id: t.id, name: t.name })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(['skill', 'company'] as const).map((kind) => {
        const list = tags.filter((t) => t.kind === kind);
        return (
          <section
            key={kind}
            aria-labelledby={`${kind}-heading`}
            className={styles.stack}
          >
            <div className={q.headerRow}>
              <h2
                id={`${kind}-heading`}
                className={styles.sectionTitle}
                style={{ margin: 0 }}
              >
                {kind === 'skill' ? 'Skill tags' : 'Company tags'} (
                {list.length})
              </h2>
              <button
                type="button"
                className={btn.secondary}
                onClick={() =>
                  setEditing({ kind: 'tag', item: null, tagKind: kind })
                }
              >
                + Add {kind === 'skill' ? 'skill' : 'company'}
              </button>
            </div>
            <div className={q.chips}>
              {list.length === 0 && <p className={styles.muted}>None yet.</p>}
              {list.map((t) => (
                <span
                  key={t.id}
                  className={q.chip}
                  style={{
                    display: 'inline-flex',
                    gap: 8,
                    alignItems: 'center',
                    cursor: 'default',
                  }}
                >
                  <button
                    type="button"
                    className={styles.linkish}
                    onClick={() =>
                      setEditing({ kind: 'tag', item: t, tagKind: t.kind })
                    }
                    aria-label={`Edit tag ${t.name}`}
                  >
                    {t.name}
                  </button>
                  <small className={styles.muted}>{t.questionCount ?? 0}</small>
                  <button
                    type="button"
                    className={styles.linkish}
                    aria-label={`Delete tag ${t.name}`}
                    onClick={() =>
                      setDeleting({ kind: 'tag', id: t.id, name: t.name })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <EditDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={q.headerActions} style={{ justifyContent: 'flex-end' }}>
      <button type="button" className={btn.secondary} onClick={onEdit}>
        Edit
      </button>
      <button type="button" className={btn.ghost} onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

function EditDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isTopic = editing.kind === 'topic';
  const item = editing.item;
  const [name, setName] = useState(item?.name ?? '');
  const [slug, setSlug] = useState(item?.slug ?? '');
  const [description, setDescription] = useState(
    isTopic ? (editing.item?.description ?? '') : '',
  );
  const [sortOrder, setSortOrder] = useState(
    isTopic ? String(editing.item?.sortOrder ?? 0) : '0',
  );
  const [tagKind, setTagKind] = useState<TagKind>(
    editing.kind === 'tag' ? editing.tagKind : 'skill',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const base = {
        name: name.trim(),
        ...(slug.trim() && { slug: slug.trim() }),
      };
      if (editing.kind === 'topic') {
        const body = {
          ...base,
          description: description.trim() || undefined,
          sortOrder: Number(sortOrder) || 0,
        };
        if (editing.item) await questionsApi.updateTopic(editing.item.id, body);
        else await questionsApi.createTopic(body);
      } else if (editing.item) {
        await questionsApi.updateTag(editing.item.id, {
          ...base,
          kind: tagKind,
        });
      } else {
        await questionsApi.createTag({ ...base, kind: tagKind });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const noun = isTopic ? 'topic' : 'tag';
  return (
    <Dialog
      open
      title={item ? `Edit ${noun}` : `New ${noun}`}
      onClose={() => !busy && onClose()}
      actions={
        <>
          <button
            type="button"
            className={btn.secondary}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={btn.primary}
            onClick={() => void save()}
            disabled={busy || name.trim().length < (isTopic ? 2 : 1)}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form className={q.form} onSubmit={(e) => void save(e)}>
        <div className={q.field}>
          <label htmlFor="tx-name">Name</label>
          <input
            id="tx-name"
            className={styles.input}
            value={name}
            maxLength={isTopic ? 80 : 60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={q.field}>
          <label htmlFor="tx-slug">Slug</label>
          <input
            id="tx-slug"
            className={styles.input}
            value={slug}
            placeholder="Generated from the name"
            maxLength={isTopic ? 80 : 60}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          {item && slug !== item.slug && (
            <small className={q.hint}>
              Import files using the old slug will stop matching.
            </small>
          )}
        </div>
        {isTopic ? (
          <>
            <div className={q.field}>
              <label htmlFor="tx-desc">Description</label>
              <input
                id="tx-desc"
                className={styles.input}
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className={q.field}>
              <label htmlFor="tx-order">Sort order</label>
              <input
                id="tx-order"
                className={styles.input}
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className={q.field}>
            <span className={q.fieldLabel}>Kind</span>
            <div className={q.segmented} role="group" aria-label="Tag kind">
              {(['skill', 'company'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tagKind === k}
                  onClick={() => setTagKind(k)}
                >
                  {k === 'skill' ? 'Skill' : 'Company'}
                </button>
              ))}
            </div>
          </div>
        )}
        <FormAlert>{error}</FormAlert>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: { kind: 'topic' | 'tag'; id: string; name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      if (target.kind === 'topic') await questionsApi.deleteTopic(target.id);
      else await questionsApi.deleteTag(target.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Delete ${target.kind} “${target.name}”?`}
      onClose={() => !busy && onClose()}
      actions={
        <>
          <button
            type="button"
            className={btn.secondary}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={btn.danger}
            onClick={() => void remove()}
            disabled={busy}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p>
        {target.kind === 'topic'
          ? 'Only topics with no questions can be deleted.'
          : 'The tag is removed from every question that uses it.'}
      </p>
      <FormAlert>{error}</FormAlert>
    </Dialog>
  );
}
