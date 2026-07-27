const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_BASE = process.env.HAKSAI_CENTRAL_API_BASE
  || 'https://haksai-central-api.koji330.workers.dev/';
const ASIN = process.env.HAKSAI_SEARCH_MARKET_ASIN || 'B0FXTQPGSB';
const MARKETPLACE = process.env.HAKSAI_SEARCH_MARKET_MARKETPLACE || 'JP';
const PERIODS = (process.env.HAKSAI_SEARCH_MARKET_PERIODS || '2026-03,2026-04,2026-05,2026-06')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

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

async function fetchSummary(period) {
  const url = new URL(API_BASE);
  url.searchParams.set('action', 'getSearchMarketSummary');
  url.searchParams.set('asin', ASIN);
  url.searchParams.set('period', period);
  url.searchParams.set('marketplace', MARKETPLACE);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${period}`);
  const payload = await response.json();
  if (payload.status !== 'ok' || !payload.data) {
    throw new Error(payload.message || `summaryが空です: ${period}`);
  }
  return payload.data;
}

function currentSnapshots(summary, period) {
  return summary.rows
    .filter(row => row.data_period === period && row.comparison_status !== 'LEFT_TOP100')
    .map(row => row.snapshot)
    .sort((a, b) => a.search_query_rank - b.search_query_rank);
}

function coverage(summary, snapshots) {
  return context.sqpScopeCoverage_({
    report_scope: summary.report_scope,
    query_limit: summary.query_limit,
    page_number: summary.page_number,
    returned_query_count: summary.returned_query_count
  }, snapshots);
}

function simplifiedSignal(signal) {
  return {
    signal_id: signal.signal_id,
    code: signal.code,
    action_class: signal.action_class,
    query: signal.query_identity.raw,
    rank_band: signal.priority_basis.amazon_query_rank_band,
    rank: signal.priority_basis.amazon_query_rank,
    market_purchase: signal.priority_basis.market_purchase,
    asin_purchase: signal.priority_basis.asin_purchase,
    primary_change_abs: signal.priority_basis.primary_change_abs,
    family_rank: signal.family_rank,
    selection_reason: signal.selection_reason?.code || null,
    suppression_reasons: signal.suppression_reasons.map(reason => reason.code)
  };
}

function reasonCounts(signals) {
  return signals.reduce((counts, signal) => {
    signal.suppression_reasons.forEach(reason => {
      counts[reason.code] = (counts[reason.code] || 0) + 1;
    });
    return counts;
  }, {});
}

async function main() {
  if (PERIODS.length < 2) throw new Error('shadow-runには2期間以上必要です。');
  const summaries = await Promise.all(PERIODS.map(fetchSummary));
  const periodScopes = summaries.map((summary, index) => {
    const period = PERIODS[index];
    const snapshots = currentSnapshots(summary, period);
    return {
      period_key: period,
      snapshots,
      coverage: coverage(summary, snapshots)
    };
  });
  const currentPeriod = PERIODS[PERIODS.length - 1];
  const previousPeriod = PERIODS[PERIODS.length - 2];
  const currentScope = periodScopes[periodScopes.length - 1];
  const previousScope = periodScopes[periodScopes.length - 2];
  const currentByRaw = new Map(
    currentScope.snapshots.map(snapshot => [snapshot.search_query_raw, snapshot])
  );
  const previousByRaw = new Map(
    previousScope.snapshots.map(snapshot => [snapshot.search_query_raw, snapshot])
  );
  const matchedRaw = Array.from(currentByRaw.keys()).filter(raw => previousByRaw.has(raw));
  const matchedCurrent = matchedRaw.map(raw => currentByRaw.get(raw));
  const matchedPrevious = matchedRaw.map(raw => previousByRaw.get(raw));
  const matchedCurrentAggregate = context.sqpAggregateSnapshots_(matchedCurrent);
  const matchedPreviousAggregate = context.sqpAggregateSnapshots_(matchedPrevious);
  const invalidScopeCount = periodScopes.filter(
    scope => scope.coverage.scope_status === 'INVALID'
  ).length;
  const limitedScopeCount = periodScopes.filter(
    scope => scope.coverage.scope_status === 'PARTIAL_UNKNOWN'
  ).length;
  const normalizationCollisionCount = periodScopes.reduce(
    (total, scope) => total + scope.snapshots.filter(
      snapshot => snapshot.normalization_collision
    ).length,
    0
  );
  const queryFacts = context.sqpQueryFacts_(
    periodScopes,
    PERIODS,
    currentPeriod,
    previousPeriod
  );
  const diagnostics = {
    schema_version: 'search_market_diagnostic_v1',
    observation_version: 'facts_v1',
    marketplace: MARKETPLACE,
    asin: ASIN,
    period_key: currentPeriod,
    lookback_months: PERIODS.length,
    identity_rule: 'RAW_EXACT',
    coverage: currentScope.coverage,
    data_usability: {
      current_state: currentScope.coverage.scope_status === 'COMPLETE' ? 'VALID' : 'LIMITED',
      month_over_month: currentScope.coverage.scope_status === 'INVALID'
        || previousScope.coverage.scope_status === 'INVALID'
        ? 'INVALID'
        : (currentScope.coverage.scope_status === 'COMPLETE'
          && previousScope.coverage.scope_status === 'COMPLETE' ? 'VALID' : 'LIMITED'),
      matched_cohort: matchedRaw.length
        ? (currentScope.coverage.scope_status === 'COMPLETE'
          && previousScope.coverage.scope_status === 'COMPLETE' ? 'VALID' : 'LIMITED')
        : 'INVALID',
      multi_period_trend: invalidScopeCount
        ? 'INVALID'
        : (!limitedScopeCount ? 'VALID' : 'LIMITED'),
      market_universe_inference: 'LIMITED',
      normalized_join: 'LIMITED',
      share: context.sqpShareUsability_(
        context.sqpAggregateSnapshots_(currentScope.snapshots)
      )
    },
    query_facts: queryFacts
  };
  const currentAggregate = context.sqpAggregateSnapshots_(currentScope.snapshots);
  const previousAggregate = context.sqpAggregateSnapshots_(previousScope.snapshots);
  const enteredCount = Array.from(currentByRaw.keys()).filter(
    raw => !previousByRaw.has(raw)
  ).length;
  const leftCount = Array.from(previousByRaw.keys()).filter(
    raw => !currentByRaw.has(raw)
  ).length;
  diagnostics.snapshot_comparison = {
    comparison_status: 'COMPARABLE',
    current: currentAggregate,
    previous: previousAggregate,
    changes: context.sqpAggregateChanges_(currentAggregate, previousAggregate),
    continued_query_count: matchedRaw.length,
    entered_query_count: enteredCount,
    left_query_count: leftCount
  };
  diagnostics.matched_cohort_comparison = {
    comparison_status: matchedRaw.length ? 'COMPARABLE' : 'NO_RAW_EXACT_MATCH',
    identity_rule: 'RAW_EXACT',
    matched_query_count: matchedRaw.length,
    excluded_entered_query_count: enteredCount,
    excluded_left_query_count: leftCount,
    current: matchedCurrentAggregate,
    previous: matchedPreviousAggregate,
    changes: matchedRaw.length
      ? context.sqpAggregateChanges_(matchedCurrentAggregate, matchedPreviousAggregate)
      : null
  };
  diagnostics.data_quality = {
    invalid_scope_count: invalidScopeCount,
    normalization_collision_row_count: normalizationCollisionCount,
    period_count_requested: PERIODS.length,
    period_count_available: periodScopes.length,
    reasons: ['UNIVERSE_COVERAGE_PARTIAL_UNKNOWN']
  };
  const signals = context.sqpBuildCandidateSignalResponse_(diagnostics);
  const narrative = context.sqpBuildSearchMarketNarrative_(diagnostics, signals);
  const result = {
    source: {
      api_base: API_BASE,
      asin: ASIN,
      marketplace: MARKETPLACE,
      periods: PERIODS,
      fetched_rows_by_period: Object.fromEntries(
        periodScopes.map(scope => [scope.period_key, scope.snapshots.length])
      ),
      universe_coverage: currentScope.coverage.universe_coverage,
      normalization_collision_row_count: normalizationCollisionCount
    },
    matched_cohort_contract_check: {
      matched_query_count: matchedRaw.length,
      aggregation_rule: 'SUM_ASIN_NUMERATOR_DIVIDED_BY_SUM_MARKET_DENOMINATOR',
      previous_purchase: matchedPreviousAggregate.purchase,
      current_purchase: matchedCurrentAggregate.purchase
    },
    policy: signals.policy,
    cross_family_ranking: signals.cross_family_ranking,
    candidate_count: signals.candidate_count,
    selected_count: signals.selected_count,
    suppressed_count: signals.suppressed_count,
    narrative: {
      policy_version: narrative.policy.policy_version,
      display_item_count: narrative.display_item_count,
      query_synthesis_count: narrative.query_synthesis_count,
      discovery_count: narrative.discovery_count,
      sections: Object.fromEntries(Object.entries(narrative.sections).map(([section, items]) => [
        section,
        items.map(item => ({
          primary_code: item.primary_code,
          title: item.title,
          body: item.body,
          query: item.query_identity?.raw || null,
          source_signal_count: item.source_signal_ids.length,
          uses_family_suppressed_candidates:
            item.selection_reason.uses_family_suppressed_candidates,
          selection_reason: item.selection_reason.code
        }))
      ])),
      suppressed_narrative_count: narrative.suppressed_narratives.length,
      builder_contract: narrative.builder_contract,
      presentation: {
        schema_version: narrative.presentation.schema_version,
        display_policy: narrative.presentation.display_policy,
        evaluation: narrative.presentation.evaluation,
        do_now: narrative.presentation.do_now.map(item => ({
          display_id: item.display_id,
          title: item.title,
          what: item.what,
          why: item.why,
          target_queries: item.target_queries,
          source_narrative_ids: item.source_narrative_ids,
          source_signal_ids: item.source_signal_ids
        })),
        keep: narrative.presentation.keep.map(item => ({
          display_id: item.display_id,
          title: item.title,
          what: item.what,
          why: item.why,
          target_queries: item.target_queries,
          source_narrative_ids: item.source_narrative_ids,
          source_signal_ids: item.source_signal_ids
        })),
        ignore_for_now: narrative.presentation.ignore_for_now,
        specifically_checked_hidden_queries: narrative.presentation.hidden_narratives
          .filter(item => [
            'カウンターベル 卓上ベル',
            'ベル テーブル'
          ].includes(item.query_identity?.raw))
          .map(item => ({
            query: item.query_identity.raw,
            reasons: item.reasons,
            threshold_facts: item.threshold_facts
          })),
        normal_display_item_count:
          1 + narrative.presentation.do_now.length + narrative.presentation.keep.length
          + (narrative.presentation.ignore_for_now.hidden_count ? 1 : 0),
        contract: narrative.presentation.contract
      }
    },
    families: signals.families.map(family => ({
      family: family.family,
      candidate_count: family.candidate_count,
      selected_count: family.selected_count,
      suppressed_count: family.suppressed_count,
      selected: family.selected_signals.map(simplifiedSignal),
      suppression_reason_counts: reasonCounts(family.suppressed_candidates),
      suppressed_examples: family.suppressed_candidates.slice(0, 5).map(simplifiedSignal)
    }))
  };
  if (process.env.HAKSAI_SHADOW_NARRATIVE_ONLY === '1') {
    console.log(JSON.stringify({
      source: result.source,
      matched_cohort_contract_check: result.matched_cohort_contract_check,
      candidate_count: result.candidate_count,
      selected_signal_count: result.selected_count,
      suppressed_signal_count: result.suppressed_count,
      narrative: result.narrative
    }, null, 2));
  } else if (process.env.HAKSAI_SHADOW_COMPACT === '1') {
    console.log(JSON.stringify({
      source: result.source,
      matched_cohort_contract_check: result.matched_cohort_contract_check,
      policy_version: result.policy.policy_version,
      selection_mode: result.policy.selection_mode,
      cross_family_ranking: result.cross_family_ranking,
      candidate_count: result.candidate_count,
      selected_count: result.selected_count,
      suppressed_count: result.suppressed_count,
      narrative: result.narrative,
      families: result.families.map(family => ({
        family: family.family,
        candidate_count: family.candidate_count,
        selected: family.selected.map(signal => ({
          code: signal.code,
          action_class: signal.action_class,
          query: signal.query,
          rank: signal.rank,
          market_purchase: signal.market_purchase,
          asin_purchase: signal.asin_purchase,
          primary_change_abs: signal.primary_change_abs,
          selection_reason: signal.selection_reason
        })),
        suppressed_count: family.suppressed_count,
        suppression_reason_counts: family.suppression_reason_counts,
        suppressed_examples: family.suppressed_examples.slice(0, 3).map(signal => ({
          code: signal.code,
          query: signal.query,
          family_rank: signal.family_rank,
          suppression_reasons: signal.suppression_reasons
        }))
      }))
    }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
