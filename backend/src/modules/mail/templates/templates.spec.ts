import { MAIL_TEMPLATE_NAMES, renderMail, SAMPLE_DATA } from './index.js';

const ctx = { appUrl: 'https://app.example.com', productName: 'InterviewPrep' };

describe('mail templates', () => {
  it.each(MAIL_TEMPLATE_NAMES)('%s renders subject, HTML and text', (name) => {
    const mail = renderMail(name, SAMPLE_DATA[name] as never, ctx);
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain('InterviewPrep');
    expect(mail.text.length).toBeGreaterThan(20);
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });

  it('puts the code in the body but never in the stored subject', () => {
    for (const name of [
      'verify_email',
      'reset_password',
      'staff_invite',
    ] as const) {
      const data = { ...SAMPLE_DATA[name], code: '918273' };
      const mail = renderMail(name, data as never, ctx);
      expect(mail.html).toContain('918273');
      expect(mail.text).toContain('918273');
      expect(mail.subject).not.toContain('918273');
    }
  });

  it('builds links from APP_BASE_URL', () => {
    const mail = renderMail(
      'verify_email',
      { ...SAMPLE_DATA.verify_email, email: 'a+b@x.com' },
      ctx,
    );
    expect(mail.text).toContain(
      'https://app.example.com/verify-email?email=a%2Bb%40x.com',
    );
    expect(
      renderMail('reset_password', SAMPLE_DATA.reset_password, ctx).html,
    ).toContain('href="https://app.example.com/forgot-password"');
  });

  it('escapes user-controlled values in HTML', () => {
    const mail = renderMail(
      'exam_reminder',
      {
        ...SAMPLE_DATA.exam_reminder,
        name: '<script>x</script>',
        examTitle: 'A & B "quiz"',
      },
      ctx,
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('A &amp; B &quot;quiz&quot;');
  });
});
