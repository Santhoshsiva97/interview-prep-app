import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import { useSyncExternalStore } from 'react';
import type { Language } from '../../questions/api';

// Bundle Monaco with the app instead of @monaco-editor/react's default CDN
// loader, so the exam runtime works offline-first and without third-party scripts.
window.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript'
      ? new TsWorker()
      : new EditorWorker(),
};
loader.config({ monaco });

const MONACO_LANGUAGE: Record<Language, string> = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const subscribe = (cb: () => void) => {
  darkQuery.addEventListener('change', cb);
  return () => darkQuery.removeEventListener('change', cb);
};

interface CodeEditorProps {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/** Monaco code editor. Loaded lazily (it's large): import via React.lazy. */
export default function CodeEditor({
  language,
  value,
  onChange,
  label,
}: CodeEditorProps) {
  const dark = useSyncExternalStore(subscribe, () => darkQuery.matches);
  return (
    <Editor
      height="100%"
      language={MONACO_LANGUAGE[language]}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme={dark ? 'vs-dark' : 'vs'}
      loading={<p aria-busy="true">Loading editor…</p>}
      options={{
        ariaLabel: label,
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: language === 'python' ? 4 : 2,
        // Candidates practise without autocomplete hints, as in most assessments.
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: 'off',
      }}
    />
  );
}
