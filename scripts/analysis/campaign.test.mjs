import test from 'node:test';
import assert from 'node:assert/strict';
// Offline: URL building and an injected fake SQL; nothing is fetched or uploaded.
process.env.CLOUDINARY_URL = 'cloudinary://key:secret@demo';
const { CAMPAIGN_FORMATS, campaignCards, campaignText, getCampaign } = await import('../../lib/reports.mjs');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const R = uuid(90), C = uuid(91), P = uuid(99);
const photo = { cloudinary_public_id: 'ps02/project/photo', version: 7 };

test('each format blurs faces first, then smart-crops to its size, blurs again, then overlays the claim; nothing generative', () => {
  const cards = campaignCards(photo, 'People collect trash on river steps at Site A.');
  assert.deepEqual(cards.map(c => [c.format, c.width, c.height]), [['1:1', 1080, 1080], ['9:16', 1080, 1920], ['16:9', 1920, 1080]]);
  assert.equal(cards.length, CAMPAIGN_FORMATS.length);
  for (const { url, width, height } of cards) {
    const steps = new URL(url).pathname.split('/').slice(4);
    assert.match(steps[0], /^e_blur_faces:\d+$/, 'face blur is the first step');
    assert.ok(Number(steps[0].split(':')[1]) >= 1000, 'blur is strong enough to anonymise');
    assert.equal(steps[1], `c_fill,g_auto,h_${height},q_auto,w_${width}`);
    assert.equal(steps[2], steps[0], 'second face-blur pass on the cropped frame');
    assert.match(steps[3], /(^|,)l_text:Arial_48_bold_center/);
    assert.match(steps[3], new RegExp(`(^|,)c_fit(,|$).*w_${width - 160}$`));
    assert.match(steps[3], /(^|,)b_rgb:000000b3(,|$)/, 'text sits on a background box');
    assert.match(steps[4], /^fl_layer_apply,g_south,y_\d+$/);
    assert.match(url, /\/v7\/ps02\/project\/photo\.jpg/);
    assert.doesNotMatch(url, /gen_|background_removal|upscale|enhance|restore|improve|e_replace/);
  }
});

test('card text is the claim verbatim, or a word-boundary prefix with an ellipsis', () => {
  const short = 'At Site A, the after photo shows less visible waste than the before photo.';
  assert.equal(campaignText(short), short);
  assert.equal(campaignText(`  ${short.replace(' ', '\n  ')} `), short, 'only whitespace is normalised');
  const long = '5 accepted evidence records show river cleanup, with people collecting trash and loading sacks on stone steps beside the river at Site A and Site B between two dates in spring.';
  for (const max of [40, 60, 80, 159]) {
    const out = campaignText(long, max);
    assert.ok(out.endsWith('…') && out.length <= max, out);
    const kept = out.slice(0, -1);
    assert.ok(long.startsWith(kept), 'kept text is an unchanged prefix');
    assert.match(long.slice(kept.length), /^[\s,;:]/, 'cut falls on a word boundary');
  }
  assert.equal(campaignText('People plant saplings 🌱 by the river 🇮🇳.'), 'People plant saplings by the river .', 'emoji are removed, nothing else');
});

test('commas, slashes, %, #, ? and $( are escaped for l_text', () => {
  const [card] = campaignCards(photo, 'Waste, bags / sacks: 50% #1? $(x)');
  const text = new URL(card.url).pathname.split('/')[7].match(/l_text:[^:]+:([^,]+)/)[1];
  assert.equal(text, 'Waste%252C%20bags%20%252F%20sacks%3A%2050%2525%20%231%3F%20%2524%28x%29');
  assert.ok(!new URL(card.url).pathname.includes('#') && !card.url.split('?')[0].includes('?'));
  assert.equal(decodeURIComponent(decodeURIComponent(text)), 'Waste, bags / sacks: 50% #1? $(x)', 'Cloudinary decodes twice back to the claim');
});

function fakeSql(rows) {
  const calls = [];
  return { calls, sql: { query: async (text, values) => { calls.push({ text, values }); return rows; } } };
}
const row = (over = {}) => ({ id: C, text: 'Photos show people standing on a riverbank.', report_id: R, asset_id: null, accepted_id: null, cloudinary_public_id: null, version: null, resource_type: null, ...over });

test('a claim citing accepted photos gets three cards from the chosen cited photo, scoped to report and project', async () => {
  const { sql, calls } = fakeSql([row({ asset_id: uuid(1), accepted_id: uuid(1), cloudinary_public_id: 'a1', version: 1, resource_type: 'image' }),
    row({ asset_id: uuid(2), accepted_id: uuid(2), cloudinary_public_id: 'a2', version: 2, resource_type: 'image' })]);
  const first = await getCampaign(R, C, P, { sql });
  assert.deepEqual(calls[0].values, [C, R, P]);
  assert.match(calls[0].text, /a\.status = 'accepted'/);
  assert.equal(first.asset.id, uuid(1));
  assert.equal(first.cards.length, 3);
  assert.equal(first.reason, null);
  assert.equal(first.claim.text, 'Photos show people standing on a riverbank.');
  assert.ok(first.cards.every(c => c.url.includes('/v1/a1.jpg')));
  const picked = await getCampaign(R, C, P, { sql, assetId: uuid(2) });
  assert.equal(picked.asset.id, uuid(2));
  assert.equal((await getCampaign(R, C, P, { sql, assetId: uuid(3) })).asset.id, uuid(1), 'only a cited accepted photo can be chosen');
});

test('a comparison-only claim, or one whose photos are no longer accepted, gets no card', async () => {
  const comparisonOnly = await getCampaign(R, C, P, fakeSql([row()]));
  assert.equal(comparisonOnly.asset, null);
  assert.deepEqual(comparisonOnly.cards, []);
  assert.match(comparisonOnly.reason, /only a comparison/);
  const notAccepted = await getCampaign(R, C, P, fakeSql([row({ asset_id: uuid(1) })]));
  assert.deepEqual(notAccepted.cards, []);
  assert.match(notAccepted.reason, /accepted photo/);
  assert.equal(await getCampaign(R, C, P, fakeSql([])), null, 'unknown claim or other project');
  assert.equal(await getCampaign('x', C, P, fakeSql([row()])), null);
});
