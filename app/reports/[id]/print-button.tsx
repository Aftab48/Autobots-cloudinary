'use client';
// PDF comes from the browser's print dialog (plan section 14.2); print CSS hides this button.
export default function PrintButton() { return <button type="button" onClick={() => window.print()}>Print or save as PDF</button>; }
