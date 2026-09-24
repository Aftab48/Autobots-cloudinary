'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="evidence"><p className="eyebrow">PS02 / PROJECT EVIDENCE</p><h1>Evidence is unavailable.</h1><p>The project could not be loaded. Try again in a moment.</p><button onClick={reset}>Try again</button></main>; }
