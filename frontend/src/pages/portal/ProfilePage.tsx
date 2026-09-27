import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  FormAlert,
  FormField,
  TextAreaField,
} from '../../components/form/FormField';
import { Icon } from '../../components/icons/Icon';
import {
  AVATAR_UPLOAD,
  formatBytes,
  profileApi,
  RESUME_UPLOAD,
  type Profile,
  type ProfileUpdate,
} from '../../features/profile/api';
import { Avatar } from '../../features/profile/components/Avatar';
import { useProfile } from '../../features/profile/useProfile';
import { errorMessage } from '../../lib/api';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { profile, loading, error } = useProfile();

  if (loading) return <p aria-busy="true">Loading your profile…</p>;
  if (!profile) return <p role="alert">{error || 'Could not load profile.'}</p>;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Your profile</h1>
        <p className={styles.subtitle}>
          Keep your details up to date. Your profile is{' '}
          <strong>{profile.completeness.percent}% complete</strong>.
        </p>
      </header>
      <PhotoSection profile={profile} />
      {/* Remount the form when the saved data changes so it starts clean. */}
      <DetailsSection key={profile.user.id} profile={profile} />
      <ResumeSection profile={profile} />
    </div>
  );
}

/** Shared upload/remove flow for photo and resume. */
function useFileAction(limit: { maxBytes: number; label: string }) {
  const { setProfile } = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<Profile>) {
    setError('');
    setBusy(true);
    try {
      setProfile(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function upload(
    e: ChangeEvent<HTMLInputElement>,
    send: (file: File) => Promise<Profile>,
  ) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > limit.maxBytes) {
      setError(`That file is too large. Use ${limit.label}.`);
      return;
    }
    void run(() => send(file));
  }

  return { busy, error, run, upload };
}

function PhotoSection({ profile }: { profile: Profile }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run, upload } = useFileAction(AVATAR_UPLOAD);

  return (
    <section className={styles.card} aria-labelledby="photo-heading">
      <h2 id="photo-heading">Profile photo</h2>
      <div className={styles.photoRow}>
        <Avatar name={profile.user.name} url={profile.avatarUrl} size={88} />
        <div className={styles.photoActions}>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Icon name="upload" size={18} />
              {busy
                ? 'Uploading…'
                : profile.avatarUrl
                  ? 'Change photo'
                  : 'Upload photo'}
            </button>
            {profile.avatarUrl && (
              <button
                type="button"
                className={styles.danger}
                onClick={() => void run(profileApi.removeAvatar)}
                disabled={busy}
              >
                Remove
              </button>
            )}
          </div>
          <small className={styles.hint}>{AVATAR_UPLOAD.label}.</small>
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_UPLOAD.accept}
            hidden
            onChange={(e) => upload(e, profileApi.uploadAvatar)}
          />
        </div>
      </div>
      <FormAlert>{error}</FormAlert>
    </section>
  );
}

type DetailsForm = Required<
  Pick<
    ProfileUpdate,
    | 'name'
    | 'phone'
    | 'headline'
    | 'targetRole'
    | 'location'
    | 'bio'
    | 'linkedinUrl'
    | 'githubUrl'
  >
> & { experienceYears: string };

const toForm = ({ user, profile }: Profile): DetailsForm => ({
  name: user.name,
  phone: user.phone ?? '',
  headline: profile.headline ?? '',
  targetRole: profile.targetRole ?? '',
  experienceYears: profile.experienceYears?.toString() ?? '',
  location: profile.location ?? '',
  bio: profile.bio ?? '',
  linkedinUrl: profile.linkedinUrl ?? '',
  githubUrl: profile.githubUrl ?? '',
});

function DetailsSection({ profile }: { profile: Profile }) {
  const { setProfile } = useProfile();
  const [form, setForm] = useState<DetailsForm>(() => toForm(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const initial = toForm(profile);
  const dirty = (Object.keys(form) as (keyof DetailsForm)[]).some(
    (k) => form[k] !== initial[k],
  );

  const bind = (key: keyof DetailsForm) => ({
    name: key,
    value: form[key] ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setSaved(false);
      setForm((f) => ({ ...f, [key]: e.target.value }));
    },
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updated = await profileApi.update({
        ...form,
        // Blank optional fields are sent as null to clear them.
        experienceYears:
          form.experienceYears === '' ? null : Number(form.experienceYears),
      });
      setProfile(updated);
      setForm(toForm(updated));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="details-heading">
      <h2 id="details-heading">Personal details</h2>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.grid}>
          <FormField
            label="Full name"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            {...bind('name')}
          />
          <FormField
            label="Email"
            type="email"
            value={profile.user.email}
            readOnly
            hint="Contact support to change your email."
          />
          <FormField
            label="Phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="+919876543210"
            hint="International format, with country code."
            {...bind('phone')}
          />
          <FormField
            label="Location"
            maxLength={100}
            autoComplete="address-level2"
            placeholder="Bengaluru, India"
            {...bind('location')}
          />
          <FormField
            label="Headline"
            maxLength={120}
            placeholder="Backend engineer · 3 yrs Java"
            {...bind('headline')}
          />
          <FormField
            label="Target role"
            maxLength={100}
            placeholder="SDE II"
            {...bind('targetRole')}
          />
          <FormField
            label="Years of experience"
            type="number"
            inputMode="numeric"
            min={0}
            max={50}
            step={1}
            {...bind('experienceYears')}
          />
          <FormField
            label="LinkedIn"
            type="url"
            maxLength={255}
            placeholder="https://www.linkedin.com/in/you"
            {...bind('linkedinUrl')}
          />
          <FormField
            label="GitHub"
            type="url"
            maxLength={255}
            placeholder="https://github.com/you"
            {...bind('githubUrl')}
          />
        </div>
        <TextAreaField
          label="About you"
          maxLength={1000}
          placeholder="A few lines about your background and the roles you’re preparing for."
          {...bind('bio')}
        />
        <FormAlert>{error}</FormAlert>
        {saved && !dirty && (
          <FormAlert kind="success">Profile saved.</FormAlert>
        )}
        <div className={styles.buttons}>
          <button className={styles.primary} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setForm(initial)}
              disabled={saving}
            >
              Discard
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function ResumeSection({ profile }: { profile: Profile }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run, upload } = useFileAction(RESUME_UPLOAD);
  const { resume } = profile;

  return (
    <section className={styles.card} aria-labelledby="resume-heading">
      <h2 id="resume-heading">Resume</h2>
      {resume ? (
        <div className={styles.fileRow}>
          <Icon name="file" size={28} className={styles.fileIcon} />
          <div className={styles.fileInfo}>
            <a href={resume.url} target="_blank" rel="noopener noreferrer">
              {resume.fileName}
            </a>
            <small className={styles.hint}>
              {formatBytes(resume.sizeBytes)} · uploaded{' '}
              {new Date(resume.uploadedAt).toLocaleDateString()}
            </small>
          </div>
        </div>
      ) : (
        <p className={styles.hint}>
          No resume uploaded yet. Adding one helps tailor interview practice to
          your experience.
        </p>
      )}
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Icon name="upload" size={18} />
          {busy ? 'Uploading…' : resume ? 'Replace resume' : 'Upload resume'}
        </button>
        {resume && (
          <button
            type="button"
            className={styles.danger}
            onClick={() => void run(profileApi.removeResume)}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
      <small className={styles.hint}>{RESUME_UPLOAD.label}.</small>
      <input
        ref={inputRef}
        type="file"
        accept={RESUME_UPLOAD.accept}
        hidden
        onChange={(e) => upload(e, profileApi.uploadResume)}
      />
      <FormAlert>{error}</FormAlert>
    </section>
  );
}
