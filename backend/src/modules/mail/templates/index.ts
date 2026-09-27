import {
  codeBlock,
  escapeHtml,
  greeting,
  renderLayout,
  type MailContext,
} from './layout.js';

/** Data each template needs (FRD §4.5). */
export interface MailTemplates {
  verify_email: {
    email: string;
    code: string;
    expiresInMinutes: number;
    name?: string;
  };
  reset_password: {
    email: string;
    code: string;
    expiresInMinutes: number;
    name?: string;
  };
  /** New staff account (Step 4): same reset-code flow, invitation wording. */
  staff_invite: {
    email: string;
    code: string;
    expiresInMinutes: number;
    role: string;
    name?: string;
  };
  /**
   * PLACEHOLDER — no trigger yet. Step 7 (exam engine) sends this before a
   * scheduled exam/interview starts.
   */
  exam_reminder: {
    name: string;
    examTitle: string;
    /** ISO timestamp. */
    startsAt: string;
    durationMinutes: number;
    /** Deep link to the exam lobby; defaults to the dashboard. */
    examPath?: string;
  };
}

export type MailTemplateName = keyof MailTemplates;
export const MAIL_TEMPLATE_NAMES = [
  'verify_email',
  'reset_password',
  'staff_invite',
  'exam_reminder',
] as const satisfies readonly MailTemplateName[];

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

type Renderer<T> = (data: T, ctx: MailContext) => RenderedMail;

const link = (
  ctx: MailContext,
  path: string,
  params?: Record<string, string>,
) => {
  const url = new URL(path, `${ctx.appUrl}/`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return url.toString();
};

const RENDERERS: { [K in MailTemplateName]: Renderer<MailTemplates[K]> } = {
  verify_email: (d, ctx) => {
    const url = link(ctx, 'verify-email', { email: d.email });
    return {
      // Never put the code in the subject: subjects are stored in mail_messages.
      subject: `Your ${ctx.productName} verification code`,
      html: renderLayout(ctx, {
        preheader: `Your verification code is ${d.code}`,
        heading: 'Verify your email',
        bodyHtml: `${greeting(d.name)}
          <p style="margin:0">Enter this code to finish creating your account:</p>
          ${codeBlock(d.code)}
          <p style="margin:0">It expires in ${d.expiresInMinutes} minutes.</p>`,
        cta: { label: 'Open verification page', url },
        footnoteHtml: `Didn’t sign up? You can ignore this email — the account can’t be activated without this code.`,
      }),
      text: `Verify your email

Your ${ctx.productName} verification code is: ${d.code}
It expires in ${d.expiresInMinutes} minutes.

Enter it at: ${url}

Didn't sign up? You can ignore this email.`,
    };
  },

  reset_password: (d, ctx) => {
    const url = link(ctx, 'forgot-password');
    return {
      subject: `Your ${ctx.productName} password reset code`,
      html: renderLayout(ctx, {
        preheader: `Your password reset code is ${d.code}`,
        heading: 'Reset your password',
        bodyHtml: `${greeting(d.name)}
          <p style="margin:0">Use this code to choose a new password:</p>
          ${codeBlock(d.code)}
          <p style="margin:0">It expires in ${d.expiresInMinutes} minutes. Resetting your password signs you out of all devices.</p>`,
        cta: { label: 'Reset password', url },
        footnoteHtml: `Didn’t ask to reset your password? Ignore this email — your password stays the same.`,
      }),
      text: `Reset your password

Your ${ctx.productName} password reset code is: ${d.code}
It expires in ${d.expiresInMinutes} minutes.

Reset it at: ${url}

Didn't ask for this? Ignore this email - your password stays the same.`,
    };
  },

  staff_invite: (d, ctx) => {
    const url = link(ctx, 'forgot-password');
    const role = escapeHtml(d.role);
    return {
      subject: `You’ve been invited to ${ctx.productName} as ${d.role}`,
      html: renderLayout(ctx, {
        preheader: `Set your password with code ${d.code}`,
        heading: `Welcome to the ${ctx.productName} team`,
        bodyHtml: `${greeting(d.name)}
          <p style="margin:0">An account has been created for you with the <strong>${role}</strong> role. Set your password with this code:</p>
          ${codeBlock(d.code)}
          <p style="margin:0">On the page below, enter <strong>${escapeHtml(d.email)}</strong>, then this code and your new password. The code expires in ${d.expiresInMinutes} minutes — if it does, just request a new one there.</p>`,
        cta: { label: 'Set your password', url },
      }),
      text: `Welcome to the ${ctx.productName} team

An account has been created for you (${d.email}) with the ${d.role} role.
Set your password with this code: ${d.code}
It expires in ${d.expiresInMinutes} minutes - request a new one on the same page if needed.

Set your password at: ${url}`,
    };
  },

  exam_reminder: (d, ctx) => {
    const url = link(ctx, d.examPath ?? 'dashboard');
    const when = new Date(d.startsAt).toUTCString();
    return {
      subject: `Reminder: ${d.examTitle} starts soon`,
      html: renderLayout(ctx, {
        preheader: `${d.examTitle} starts ${when}`,
        heading: `${d.examTitle} starts soon`,
        bodyHtml: `${greeting(d.name)}
          <p style="margin:0 0 12px">This is a reminder that your session is coming up:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;font-size:15px">
            <tr><td style="padding:2px 16px 2px 0;color:#6b7280">Starts</td><td>${escapeHtml(when)}</td></tr>
            <tr><td style="padding:2px 16px 2px 0;color:#6b7280">Duration</td><td>${d.durationMinutes} minutes</td></tr>
          </table>
          <p style="margin:0">Find a quiet spot and a stable connection before you begin.</p>`,
        cta: { label: 'Go to your exam', url },
      }),
      text: `${d.examTitle} starts soon

Starts: ${when}
Duration: ${d.durationMinutes} minutes

Open it at: ${url}`,
    };
  },
};

export function renderMail<T extends MailTemplateName>(
  template: T,
  data: MailTemplates[T],
  ctx: MailContext,
): RenderedMail {
  return RENDERERS[template](data, ctx);
}

/** Sample data for admin previews (GET /admin/mail/templates/:name/preview). */
export const SAMPLE_DATA: { [K in MailTemplateName]: MailTemplates[K] } = {
  verify_email: {
    email: 'priya@example.com',
    code: '482913',
    expiresInMinutes: 10,
    name: 'Priya Sharma',
  },
  reset_password: {
    email: 'priya@example.com',
    code: '731045',
    expiresInMinutes: 10,
    name: 'Priya Sharma',
  },
  staff_invite: {
    email: 'dev@example.com',
    code: '305118',
    expiresInMinutes: 10,
    role: 'Editor',
    name: 'Dev Patel',
  },
  exam_reminder: {
    name: 'Priya Sharma',
    examTitle: 'Backend Engineer Mock Interview',
    startsAt: '2026-10-01T09:30:00.000Z',
    durationMinutes: 60,
  },
};
