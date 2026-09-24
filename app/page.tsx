import Link from 'next/link';

export default function Home() {
  return <main><p className="eyebrow">PS02 / EVIDENCE INGESTION</p><h1>Collect the evidence.</h1><p>Bulk uploads go to Cloudinary. Verified webhooks preserve the original metadata in Neon for review.</p><nav><Link href="/upload">Upload evidence →</Link><Link href="/evidence">View raw evidence →</Link></nav></main>;
}
