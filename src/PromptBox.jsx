import { useState } from 'react';

// onSubmit returning false means nothing started (e.g. the key gate opened): the text stays put.
export default function PromptBox({ onSubmit, chips = [], placeholder = 'What if I had a mustache?', autoFocus = true, hint = '', initial = '' }) {
  const [text, setText] = useState(initial);
  const submit = (t = text) => {
    t = t.trim();
    if (!t) return;
    if (onSubmit(t) !== false) setText('');
  };
  return (
    <div className="prompt nodrag nopan nowheel">
      <div className="row">
        <textarea
          rows={2}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } }}
        />
        <button onClick={() => submit()} disabled={!text.trim()} title="Generate (Enter)">➤</button>
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => <button key={c} onClick={() => submit(c)} title={c}>{c}</button>)}
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
