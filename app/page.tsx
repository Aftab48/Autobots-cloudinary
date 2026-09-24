import Link from 'next/link';

export default function Home() {
  return <main><p className="eyebrow">PS02 / EVIDENCE INGESTION</p><h1>Collect the evidence.</h1><p>Uploads go to Cloudinary. The pipeline groups duplicates, checks quality and visual relevance, and sends uncertain photos for review.</p><nav><Link href="/upload">Upload evidence →</Link><Link href="/evidence">View evidence →</Link><Link href="/search">Search evidence →</Link><Link href="/review">Review queue →</Link></nav></main>;
}
