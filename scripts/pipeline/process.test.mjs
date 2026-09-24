import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcessArgs } from './process.mjs';
import { chooseAnalysisPath } from '../../lib/pipeline-rules.mjs';

const id = '00000000-0000-4000-8000-000000000002';
test('manual runner accepts only one explicit asset and a known trusted tier', () => {
  assert.deepEqual(parseProcessArgs(['--asset', id]), { id, tier: null, forceLlm: false });
  for (const tier of ['bulk', 'showcase', 'demo']) assert.deepEqual(parseProcessArgs(['--asset', id, '--tier', tier, '--llm']), { id, tier, forceLlm: true });
  for (const args of [[], ['--asset', 'all'], ['--asset', id, '--asset', id], ['--asset', id, '--tier', 'anything'], ['--asset', id, '--tier'], ['--asset', id, '--all'], ['--asset', id, '--llm', '--llm']]) assert.throws(() => parseProcessArgs(args));
});
test('designation alone does not enable AI Vision; stored results always win', () => {
  for (const tier of ['bulk', 'showcase', 'demo']) {
    assert.equal(chooseAnalysisPath({ analysis_tier: tier }, { remaining: 100000 }), 'llm_fallback');
    assert.equal(chooseAnalysisPath({ analysis_tier: tier, analysis_result: { activity: 'other' } }, { enabled: true, remaining: 100000 }), 'cached');
    assert.equal(chooseAnalysisPath({ analysis_tier: tier, analysis_completed_at: '2026-09-24' }, { enabled: true, remaining: 100000 }), 'cached');
  }
});
