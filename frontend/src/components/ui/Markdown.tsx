import ReactMarkdown from 'react-markdown';
import styles from './Markdown.module.css';

/**
 * Renders question text, exam instructions etc. Raw HTML in the source is
 * not rendered (react-markdown escapes it), so content can't inject markup.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        components={{
          // Links open in a new tab so candidates don't leave the exam.
          a: ({ href, children: text }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {text}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
