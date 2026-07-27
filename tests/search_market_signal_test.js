const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function digestBytes(input) {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return Buffer.from(Array.from(input, value => (Number(value) + 256) % 256));
}

const context = {
  console,
  Date,
  JSON,
  Math,
  Number,
  Object,
  Set,
  String,
  isFinite,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_algorithm, input) => Array.from(
      crypto.createHash('sha256').update(digestBytes(input)).digest(),
      value => value > 127 ? value - 256 : value
    )
  }
};
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', '商品登録', '検索クエリパフォーマンス取込.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);

function snapshot(raw, rank, marketPurchase, asinPurchase, overrides = {}) {
  const impressionTotal = overrides.impression_total ?? 1000;
  const impressionAsin = overrides.impression_asin ?? 20;
  const clickTotal = overrides.click_total ?? 100;
  const clickAsin = overrides.click_asin ?? 10;
  const cartTotal = overrides.cart_total ?? 50;
  const cartAsin = overrides.cart_asin ?? 10;
  return {
    period_key: overrides.period_key ?? '2026-06',
    search_query_raw: raw,
    search_query_normalized: raw,
    normalization_version: 'query_norm_v1',
    normalization_collision: overrides.normalization_collision ?? false,
    search_query_rank: rank,
    search_query_volume: overrides.search_query_volume ?? 1000,
    impression_total: impressionTotal,
    impression_asin: impressionAsin,
    impression_share: impressionTotal > 0 ? impressionAsin / impressionTotal : null,
    click_total: clickTotal,
    click_asin: clickAsin,
    click_share: clickTotal > 0 ? clickAsin / clickTotal : null,
    cart_total: cartTotal,
    cart_asin: cartAsin,
    cart_share: cartTotal > 0 ? cartAsin / cartTotal : null,
    purchase_total: marketPurchase,
    purchase_asin: asinPurchase,
    purchase_share: marketPurchase > 0 ? asinPurchase / marketPurchase : null
  };
}

function queryFact(raw, rank, marketPurchase, asinPurchase, overrides = {}) {
  const current = snapshot(raw, rank, marketPurchase, asinPurchase, overrides.current || {});
  const previous = overrides.previous === null
    ? null
    : snapshot(
      raw,
      overrides.previous?.rank ?? rank + 1,
      overrides.previous?.marketPurchase ?? Math.max(1, marketPurchase - 1),
      overrides.previous?.asinPurchase ?? Math.max(0, asinPurchase - 1),
      {
        period_key: '2026-05',
        search_query_volume: overrides.previous?.search_query_volume ?? 900,
        ...(overrides.previous || {})
      }
    );
  const currentAggregate = context.sqpAggregateSnapshots_([current]);
  const previousAggregate = previous ? context.sqpAggregateSnapshots_([previous]) : null;
  return {
    search_query_raw: raw,
    identity_rule: 'RAW_EXACT',
    search_query_normalized_values: [raw],
    normalization_collision: overrides.normalization_collision ?? false,
    current_status: overrides.current_status ?? (previous ? 'CONTINUED' : 'ENTERED_TOP100'),
    current_snapshot: current,
    previous_snapshot: previous,
    trend: previous ? {
      rank_change: previous.search_query_rank - current.search_query_rank,
      aggregate_changes: context.sqpAggregateChanges_(currentAggregate, previousAggregate)
    } : null,
    period_count_requested: 4,
    period_count_available: previous ? 4 : 1,
    missing_periods: [],
    evidence_inputs: context.sqpEvidenceInputs_(
      currentAggregate,
      4,
      previous ? 4 : 1,
      previous ? 4 : 1
    ),
    data_usability: {
      current_state: 'VALID',
      month_over_month: previous ? 'VALID' : 'INVALID',
      multi_period_trend: previous ? 'VALID' : 'LIMITED',
      normalized_join: 'LIMITED',
      share: context.sqpShareUsability_(currentAggregate)
    },
    points: previous ? [previous, current] : [current]
  };
}

function diagnostics(queryFacts, usabilityOverrides = {}) {
  return {
    schema_version: 'search_market_diagnostic_v1',
    observation_version: 'facts_v1',
    marketplace: 'JP',
    asin: 'B0FXTQPGSB',
    period_key: '2026-06',
    lookback_months: 4,
    identity_rule: 'RAW_EXACT',
    coverage: {
      report_scope: 'TOP_QUERIES',
      scope_status: 'COMPLETE',
      universe_coverage: 'PARTIAL_UNKNOWN',
      query_limit: 100,
      page_number: 1,
      returned_query_count: 100,
      stored_query_count: 100,
      reasons: []
    },
    data_usability: {
      current_state: 'VALID',
      month_over_month: 'VALID',
      matched_cohort: 'VALID',
      multi_period_trend: 'VALID',
      market_universe_inference: 'LIMITED',
      normalized_join: 'LIMITED',
      share: {
        impression: 'VALID',
        click: 'VALID',
        cart: 'VALID',
        purchase: 'VALID'
      },
      ...usabilityOverrides
    },
    query_facts: queryFacts
  };
}

const facts = [
  queryFact('主要query A', 5, 100, 30),
  queryFact('主要query B', 6, 80, 20),
  queryFact('主要query C', 7, 60, 15),
  queryFact('少数1件query', 1, 1, 1, {
    current: {
      impression_total: 100,
      impression_asin: 1,
      click_total: 10,
      click_asin: 1,
      cart_total: 2,
      cart_asin: 1
    }
  }),
  queryFact('新規query', 8, 10, 2, { previous: null }),
  queryFact('表記揺れquery', 20, 5, 1, { normalization_collision: true })
];

const response = context.sqpBuildCandidateSignalResponse_(diagnostics(facts));
assert.strictEqual(response.policy.policy_version, 'search_market_signal_v0');
assert.strictEqual(response.policy.mode, 'SHADOW');
assert.strictEqual(response.policy.evidence_policy_version, null);
assert.strictEqual(response.policy.evidence_thresholds, 'NOT_CONFIGURED');
assert.strictEqual(response.selection_scope, 'WITHIN_EACH_SIGNAL_FAMILY');
assert.strictEqual(response.cross_family_ranking, false);
assert.ok(!Object.prototype.hasOwnProperty.call(response, 'selected_signals'));

const exposureFamily = response.families.find(family => family.family === 'EXPOSURE_LEVERAGE');
assert.strictEqual(exposureFamily.selection_limit, 3);
assert.deepStrictEqual(
  Array.from(exposureFamily.selected_signals, signal => signal.query_identity.raw),
  ['主要query A', '主要query B', '主要query C']
);
const smallSuppressed = exposureFamily.suppressed_candidates.find(
  signal => signal.query_identity.raw === '少数1件query'
);
assert.strictEqual(smallSuppressed.suppression_reasons[0].code, 'FAMILY_SELECTION_LIMIT');
assert.strictEqual(smallSuppressed.priority_basis.market_purchase, 1);
assert.strictEqual(smallSuppressed.priority_basis.asin_purchase, 1);

const selected = response.families.flatMap(family => Array.from(family.selected_signals));
assert.ok(selected.length > 0);
assert.ok(selected.every(signal => ['CHECK', 'WATCH'].includes(signal.action_class)));
assert.ok(selected.every(signal => signal.signal_id.startsWith('SMV0-202606-')));
assert.ok(selected.every(signal => signal.facts && signal.evidence_inputs));
assert.ok(selected.every(signal => signal.selection_reason.code === 'SELECTED_BY_FAMILY_LEXICOGRAPHIC_PRIORITY'));
const repeatedSelected = context.sqpBuildCandidateSignalResponse_(diagnostics(facts)).families
  .flatMap(family => Array.from(family.selected_signals));
assert.deepStrictEqual(
  Array.from(repeatedSelected, signal => signal.signal_id),
  Array.from(selected, signal => signal.signal_id)
);

const normalizationFamily = response.families.find(
  family => family.family === 'NORMALIZATION_QUALITY'
);
assert.strictEqual(normalizationFamily.selected_signals[0].action_class, 'WATCH');
assert.ok(
  normalizationFamily.selected_signals[0].classification_reasons
    .includes('LIMITED_DATA_DEMOTED_CHECK_TO_WATCH')
);

const limitedResponse = context.sqpBuildCandidateSignalResponse_(
  diagnostics(facts, { current_state: 'LIMITED' })
);
const limitedExposure = limitedResponse.families.find(
  family => family.family === 'EXPOSURE_LEVERAGE'
).selected_signals[0];
assert.strictEqual(limitedExposure.data_usability, 'LIMITED');
assert.strictEqual(limitedExposure.action_class, 'WATCH');

const invalidResponse = context.sqpBuildCandidateSignalResponse_(
  diagnostics(facts, { current_state: 'INVALID' })
);
const invalidExposure = invalidResponse.families.find(
  family => family.family === 'EXPOSURE_LEVERAGE'
);
assert.strictEqual(invalidExposure.selected_count, 0);
assert.ok(invalidExposure.suppressed_candidates.every(signal =>
  signal.suppression_reasons[0].code === 'DATA_USABILITY_INVALID'
));

// PR4.5-3: 同一raw queryの複数familyを1つのquery synthesisへ統合する。
const mixedFact = queryFact('混合query', 3, 100, 30, {
  current: {
    search_query_volume: 800,
    impression_total: 1000,
    impression_asin: 10,
    click_total: 100,
    click_asin: 10,
    cart_total: 50,
    cart_asin: 10
  },
  previous: {
    rank: 4,
    search_query_volume: 900,
    marketPurchase: 100,
    asinPurchase: 20,
    impression_total: 1000,
    impression_asin: 20,
    click_total: 100,
    click_asin: 10,
    cart_total: 50,
    cart_asin: 10
  }
});
const discoveryFact = queryFact('新規発見query', 9, 10, 1, {
  previous: null,
  current: {
    impression_total: 100,
    impression_asin: 10,
    click_total: 50,
    click_asin: 5,
    cart_total: 20,
    cart_asin: 2
  }
});
const multiStageDeclineFact = queryFact('複数stage低下query', 10, 100, 5, {
  current: {
    search_query_volume: 900,
    impression_total: 1000,
    impression_asin: 20,
    click_total: 100,
    click_asin: 5,
    cart_total: 50,
    cart_asin: 2
  },
  previous: {
    rank: 10,
    search_query_volume: 900,
    marketPurchase: 100,
    asinPurchase: 20,
    impression_total: 1000,
    impression_asin: 20,
    click_total: 100,
    click_asin: 10,
    cart_total: 50,
    cart_asin: 10
  }
});
const narrativeFacts = facts.concat([mixedFact, discoveryFact, multiStageDeclineFact]);
const narrativeDiagnostics = diagnostics(narrativeFacts);
const currentAggregateForNarrative = context.sqpAggregateSnapshots_(
  narrativeFacts.map(fact => fact.current_snapshot).filter(Boolean)
);
const previousSnapshotsForNarrative = narrativeFacts
  .map(fact => fact.previous_snapshot)
  .filter(Boolean);
const previousAggregateForNarrative = context.sqpAggregateSnapshots_(
  previousSnapshotsForNarrative
);
const matchedCurrentForNarrative = narrativeFacts
  .filter(fact => fact.current_snapshot && fact.previous_snapshot)
  .map(fact => fact.current_snapshot);
const matchedPreviousForNarrative = narrativeFacts
  .filter(fact => fact.current_snapshot && fact.previous_snapshot)
  .map(fact => fact.previous_snapshot);
narrativeDiagnostics.snapshot_comparison = {
  comparison_status: 'COMPARABLE',
  current: currentAggregateForNarrative,
  previous: previousAggregateForNarrative,
  changes: context.sqpAggregateChanges_(
    currentAggregateForNarrative,
    previousAggregateForNarrative
  ),
  continued_query_count: matchedCurrentForNarrative.length,
  entered_query_count: 2,
  left_query_count: 0
};
narrativeDiagnostics.matched_cohort_comparison = {
  comparison_status: 'COMPARABLE',
  identity_rule: 'RAW_EXACT',
  matched_query_count: matchedCurrentForNarrative.length,
  excluded_entered_query_count: 2,
  excluded_left_query_count: 0,
  current: context.sqpAggregateSnapshots_(matchedCurrentForNarrative),
  previous: context.sqpAggregateSnapshots_(matchedPreviousForNarrative),
  changes: context.sqpAggregateChanges_(
    context.sqpAggregateSnapshots_(matchedCurrentForNarrative),
    context.sqpAggregateSnapshots_(matchedPreviousForNarrative)
  )
};
narrativeDiagnostics.data_quality = {
  invalid_scope_count: 0,
  normalization_collision_row_count: 1,
  period_count_requested: 4,
  period_count_available: 4,
  reasons: ['UNIVERSE_COVERAGE_PARTIAL_UNKNOWN']
};
const narrativeSignals = context.sqpBuildCandidateSignalResponse_(narrativeDiagnostics);
const usableSignals = context.sqpAllUsableSignalCandidates_(narrativeSignals);
const mixedSignals = usableSignals.filter(signal => signal.query_identity.raw === '混合query');
const mixedSynthesis = context.sqpQuerySynthesis_(
  narrativeDiagnostics,
  '混合query',
  mixedSignals
);
assert.ok(mixedSynthesis.synthesis_codes.includes('IMPRESSION_DECLINE_WITH_EXPOSURE_LEVERAGE'));
assert.ok(mixedSynthesis.synthesis_codes.includes('DEMAND_DOWN_PURCHASE_SHARE_UP'));
assert.strictEqual(mixedSynthesis.section, 'check');
assert.ok(mixedSynthesis.source_signal_ids.length > 1);
assert.ok(mixedSynthesis.source_signal_refs.every(ref => ref.facts));
const declineSignals = usableSignals.filter(
  signal => signal.query_identity.raw === '複数stage低下query'
);
const declineSynthesis = context.sqpQuerySynthesis_(
  narrativeDiagnostics,
  '複数stage低下query',
  declineSignals
);
assert.ok(declineSynthesis.synthesis_codes.includes('MULTI_STAGE_SHARE_DECLINE'));
assert.deepStrictEqual(
  Array.from(declineSynthesis.facts.share_loss_stages),
  ['click', 'cart', 'purchase']
);

// family枠外candidateもquery synthesisの根拠として再利用する。
const smallSignals = usableSignals.filter(signal => signal.query_identity.raw === '少数1件query');
const smallSynthesis = context.sqpQuerySynthesis_(
  narrativeDiagnostics,
  '少数1件query',
  smallSignals
);
assert.ok(smallSynthesis.selection_reason.uses_family_suppressed_candidates);
assert.ok(smallSynthesis.source_signal_refs.some(ref =>
  ref.suppression_reasons.some(reason => reason.code === 'FAMILY_SELECTION_LIMIT')
));

const narrative = context.sqpBuildSearchMarketNarrative_(
  narrativeDiagnostics,
  narrativeSignals
);
assert.strictEqual(narrative.policy.policy_version, 'search_market_narrative_v0');
assert.strictEqual(narrative.builder_contract.gemini_used, false);
assert.strictEqual(narrative.builder_contract.action_generated, false);
assert.strictEqual(narrative.builder_contract.cross_query_score, false);
assert.ok(narrative.display_item_count <= 8);
assert.strictEqual(
  narrative.sections.conclusion[0].selection_reason.code,
  'MATCHED_COHORT_COMPARISON_PRIORITIZED'
);
assert.strictEqual(
  narrative.sections.conclusion[0].facts.comparison_source,
  'MATCHED_COHORT'
);
assert.ok(narrative.sections.watch.some(item => item.primary_code === 'ENTERED_TOP100'));
assert.ok(narrative.sections.data_quality[0].source_signal_refs.every(
  ref => ref.family === 'NORMALIZATION_QUALITY'
));
assert.ok(
  ['positive', 'concern', 'check'].every(section =>
    narrative.sections[section].every(item =>
      item.source_signal_refs.every(ref => ref.family !== 'NORMALIZATION_QUALITY')
    )
  )
);
assert.strictEqual(
  narrative.presentation.display_policy.policy_version,
  'search_market_display_v0'
);
assert.ok(narrative.presentation.do_now.length <= 2);
assert.ok(narrative.presentation.keep.length <= 2);
assert.strictEqual(
  narrative.presentation.evaluation.comparison_source,
  'MATCHED_COHORT'
);
assert.strictEqual(narrative.presentation.contract.gemini_used, false);
assert.strictEqual(
  narrative.presentation.contract.formal_action_generated,
  false
);
const displayedQueries = narrative.presentation.do_now
  .concat(narrative.presentation.keep)
  .flatMap(item => item.target_queries);
assert.strictEqual(new Set(displayedQueries).size, displayedQueries.length);
assert.ok(
  1 + narrative.presentation.do_now.length + narrative.presentation.keep.length
    + (narrative.presentation.ignore_for_now.hidden_count ? 1 : 0)
  <= 5
);

const displayPolicy = context.sqpDisplayPolicyV0_();
const lowRelevanceGate = context.sqpBusinessRelevanceGate_({
  facts: {
    current_rank: 86,
    previous_rank: null,
    current_query_volume: 25,
    current_market_purchase: 1,
    current_asin_purchase: 0
  }
}, displayPolicy);
assert.strictEqual(lowRelevanceGate.eligible, false);
assert.ok(lowRelevanceGate.suppression_reasons.includes('LOW_BUSINESS_RELEVANCE'));
assert.ok(lowRelevanceGate.suppression_reasons.includes('SINGLE_PERIOD_ONLY'));
const relevantGate = context.sqpBusinessRelevanceGate_({
  facts: {
    current_rank: 6,
    previous_rank: 20,
    current_query_volume: 656,
    current_market_purchase: 29,
    current_asin_purchase: 14
  }
}, displayPolicy);
assert.strictEqual(relevantGate.eligible, true);

console.log('search_market_signal_test: OK');
