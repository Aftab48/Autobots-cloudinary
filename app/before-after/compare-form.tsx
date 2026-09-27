'use client';
import { useActionState } from 'react';
import { compare } from './actions';

// Disabled while pending so a double click cannot pay for the same pair twice.
export default function CompareForm({ label, children }: { label: string; children?: React.ReactNode }) {
  const [state, action, pending] = useActionState(compare, null);
  return <form className="filter-form" action={action}>{children}<button type="submit" disabled={pending}>{pending ? 'Comparing…' : label}</button>{state?.error && <p role="alert">{state.error}</p>}</form>;
}
