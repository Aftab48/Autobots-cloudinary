import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedProjectId } from '../../../../../lib/active-project';
import { assetMedia } from '../../../../../lib/project-views.mjs';
import { getCampaign } from '../../../../../lib/reports.mjs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaign cards · PS02' };

/** Plan section 14.3: accepted evidence → cited claim → campaign cards, each linked back to its claim. */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string; claimId: string }>; searchParams: Promise<{ asset?: string | string[] }> }) {
  const [{ id, claimId }, { asset: picked }] = await Promise.all([params, searchParams]);
  const data = await getCampaign(id, claimId, await selectedProjectId(), { assetId: typeof picked === 'string' ? picked : undefined });
  if (!data) notFound();
  const { claim, assets, asset, cards, reason } = data;
  const claimHref = `/reports/${claim.report_id}#claim-${claim.id}`;
  return <main className="evidence"><p className="eyebrow">PS02 / CAMPAIGN CARDS</p><Link href={claimHref}>← Back to the claim</Link><h1>Campaign cards</h1>
    <section className="panel" aria-labelledby="claim-heading"><h2 id="claim-heading">Source claim</h2><blockquote className="campaign-claim">{claim.text}</blockquote>
      <p className="small">Claim <Link href={claimHref}><code>{claim.id}</code></Link> · report <code>{claim.report_id}</code>. Card text is this sentence word for word, shortened with an ellipsis only when it’s too long. Nothing new gets added.</p></section>
    {asset ? <>
      <p className="analysis-source">Faces blurred · edited for campaign use</p>
      <p className="small muted">Cloudinary blurs the faces it detects, smart-crops each format, blurs faces again on the crop and then adds the claim text. Face detection can miss small or turned faces, so check each card before you share it. Nothing generative touches the image, and the original stays untouched.</p>
      <ul className="campaign-cards">{cards.map(card => <li key={card.format}><h2>{card.format} · {card.width} × {card.height}</h2>
        <a href={card.url} target="_blank" rel="noreferrer"><img src={card.url} alt={`${card.format} campaign card: evidence photo with faces blurred and the claim text`} width={card.width} height={card.height} loading="lazy" /></a>
        <p className="small"><a href={card.url} target="_blank" rel="noreferrer">Open full size ↗</a> · <Link href={claimHref}>Source claim</Link> · <Link href={`/evidence/${asset.id}`}>source evidence</Link></p></li>)}</ul>
      <section className="panel trace-chain" aria-labelledby="source-heading"><p className="eyebrow">FROM CLAIM TO ORIGINAL</p><h2 id="source-heading">Trace chain</h2><ol className="trace-steps">
        <li><h3>Report claim</h3><p className="small">The sentence above: claim <Link href={claimHref}><code>{claim.id}</code></Link> · report <code>{claim.report_id}</code></p></li>
        <li><h3>Cited evidence asset</h3><p className="small">Evidence <Link href={`/evidence/${asset.id}`}><code>{asset.id}</code></Link></p>
          {assets.length > 1 && <><p className="small"><strong>Other accepted photos this claim cites</strong></p><ul className="small">{assets.filter(a => a.id !== asset.id).map(a => <li key={a.id}><Link href={`?asset=${a.id}`}>Make cards from <code>{a.id}</code></Link></li>)}</ul></>}</li>
        <li><h3>Derived images · transformation URLs</h3><p className="small">Each URL shows exactly what was done: face blur, smart crop and the claim text. No generative transformation.</p>
          {cards.map(card => <div key={card.format}><p className="trace-label">{card.format} card</p><a className="trace-url" href={card.url} target="_blank" rel="noreferrer">{card.url}</a></div>)}</li>
        <li><h3>Original Cloudinary asset</h3><p className="small">Public ID <code>{asset.cloudinary_public_id}</code> · version <code>{asset.version ?? 'Not supplied'}</code></p><a className="button-link" href={assetMedia(asset).original} target="_blank" rel="noreferrer">Open original asset ↗</a></li>
      </ol></section>
    </> : <div className="panel search-empty"><h2>No campaign card is available.</h2><p>{reason}</p><p><Link href={claimHref}>← Back to the claim</Link></p></div>}
  </main>;
}
