'use client';

import { useRef, useState } from 'react';

const examples = [
  'Show me evidence of community participation during the river restoration campaign between January and March.',
  'Find photos showing volunteers planting trees near the river.',
  'Show infrastructure work completed in March.',
];

export default function SearchForm({ initialQuery, keywordOnly }: { initialQuery: string; keywordOnly: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  return <form action="/search" method="get" className="panel search-form" aria-busy={pending} onSubmit={() => setPending(true)}>
    <label htmlFor="search-query">What evidence are you looking for?</label>
    <textarea ref={input} id="search-query" name="q" value={query} onChange={event => setQuery(event.target.value)}
      rows={3} maxLength={1000} placeholder="Describe an activity, place or capture date…" aria-describedby="search-query-help" />
    <p id="search-query-help" className="search-help">Search captions, tags, signals and activities. Dates refer to when evidence was captured.</p>
    <div className="search-actions">
      <label className="toggle"><input type="checkbox" name="llm" value="off" defaultChecked={keywordOnly} />Use keyword/date fallback only</label>
      <button type="submit" disabled={pending}>{pending ? 'Searching…' : 'Search evidence →'}</button>
    </div>
    <p className="search-help">Query interpretation runs only when you submit. Keyword/date fallback makes no AI request.</p>
    {pending && <p role="status" className="search-help">Searching this project’s evidence. Please wait.</p>}
    <fieldset className="search-examples" disabled={pending}>
      <legend>Try an example <span>— select, then search</span></legend>
      {examples.map((example, index) => <button key={example} type="button" onClick={() => { setQuery(example); input.current?.focus(); }}>
        <span aria-hidden="true">0{index + 1}</span>{example}
      </button>)}
    </fieldset>
  </form>;
}
