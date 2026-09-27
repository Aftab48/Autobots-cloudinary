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
      <p className="small">Claim <Link href={claimHref}><code>{claim.id}</code></Link> · report <code>{claim.report_id}</code>. Card text is this sentence word for word, shortened only with an ellipsis when it is too long. No new facts are added.</p></section>
    {asset ? <>
      <p className="analysis-source">Faces blurred · edited for campaign use</p>
      <p className="small muted">Cloudinary blurs detected faces first, then smart-crops each format and adds the claim text. Face detection can miss small or turned faces, so check each card before sharing. No generative transformation is applied and the original is untouched.</p>
      <ul className="campaign-cards">{cards.map(card => <li key={card.format}><h2>{card.format} · {card.width} × {card.height}</h2>
        <a href={card.url} target="_blank" rel="noreferrer"><img src={card.url} alt={`${card.format} campaign card: evidence photo with faces blurred and the claim text`} width={card.width} height={card.height} loading="lazy" /></a>
        <p className="small"><Link href={claimHref}>Source claim</Link> · <Link href={`/evidence/${asset.id}`}>source evidence</Link></p>
        <a className="trace-url" href={card.url} target="_blank" rel="noreferrer">{card.url}</a></li>)}</ul>
      <section className="panel" aria-labelledby="source-heading"><h2 id="source-heading">Source evidence</h2>
        <p className="small">Evidence <Link href={`/evidence/${asset.id}`}><code>{asset.id}</code></Link><br />Public ID <code>{asset.cloudinary_public_id}</code> · version <code>{asset.version ?? 'Not supplied'}</code> · <a href={assetMedia(asset).original} target="_blank" rel="noreferrer">Open original ↗</a></p>
        {assets.length > 1 && <><h3>Other accepted photos this claim cites</h3><ul className="small">{assets.filter(a => a.id !== asset.id).map(a => <li key={a.id}><Link href={`?asset=${a.id}`}>Make cards from <code>{a.id}</code></Link></li>)}</ul></>}
      </section>
    </> : <p className="notice">No campaign card is available. {reason}</p>}
  </main>;
}
