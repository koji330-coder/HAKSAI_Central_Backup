const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = vm.createContext({ console, Set });
const sourcePath = path.join(__dirname, '..', '商品登録', '検索クエリパフォーマンス取込.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);

function snapshot(overrides = {}) {
  return {
    period_key: '2026-06',
    search_query_raw: 'ベル',
    search_query_normalized: 'ベル',
    search_query_rank: 1,
    search_query_volume: 10,
    impression_total: 8,
    impression_asin: 2,
    click_total: 4,
    click_asin: 1,
    cart_total: 2,
    cart_asin: 1,
    purchase_total: 1,
    purchase_asin: 1,
    normalization_collision: false,
    ...overrides
  };
}

const aggregate = context.sqpAggregateSnapshots_([
  snapshot(),
  snapshot({
    search_query_raw: '卓上ベル',
    search_query_rank: 2,
    search_query_volume: 20,
    impression_total: 12,
    impression_asin: 3,
    click_total: 6,
    click_asin: 2,
    cart_total: 3,
    cart_asin: 1,
    purchase_total: 0,
    purchase_asin: 0
  })
]);
assert.strictEqual(aggregate.query_count, 2);
assert.strictEqual(aggregate.search_query_volume, 30);
assert.strictEqual(aggregate.impression.market_denominator, 20);
assert.strictEqual(aggregate.impression.asin_numerator, 5);
assert.strictEqual(aggregate.impression.share, 0.25);
assert.strictEqual(aggregate.purchase.market_denominator, 1);
assert.strictEqual(aggregate.purchase.asin_numerator, 1);
assert.strictEqual(aggregate.purchase.share, 1);

// matched cohortを含む集約Shareはquery Shareの平均ではなく、分子合計÷分母合計。
const weightedAggregate = context.sqpAggregateSnapshots_([
  snapshot({ impression_total: 2, impression_asin: 1 }),
  snapshot({ impression_total: 8, impression_asin: 1 })
]);
assert.strictEqual(weightedAggregate.impression.share, 2 / 10);
assert.notStrictEqual(weightedAggregate.impression.share, ((1 / 2) + (1 / 8)) / 2);

const zeroAggregate = context.sqpAggregateSnapshots_([
  snapshot({ purchase_total: 0, purchase_asin: 0 })
]);
assert.strictEqual(zeroAggregate.purchase.share, null);
assert.strictEqual(context.sqpShareUsability_(zeroAggregate).purchase, 'INVALID');

const changes = context.sqpAggregateChanges_(
  context.sqpAggregateSnapshots_([snapshot({ search_query_volume: 12 })]),
  context.sqpAggregateSnapshots_([snapshot({ search_query_volume: 10 })])
);
assert.strictEqual(changes.search_query_volume.absolute, 2);
assert.strictEqual(changes.search_query_volume.relative, 0.2);
assert.strictEqual(changes.purchase.share_points, 0);

const completeLog = {
  report_scope: 'TOP_QUERIES',
  query_limit: 2,
  page_number: 1,
  returned_query_count: 2
};
const completeCoverage = context.sqpScopeCoverage_(
  completeLog,
  [snapshot({ search_query_rank: 1 }), snapshot({ search_query_rank: 2 })]
);
assert.strictEqual(completeCoverage.scope_status, 'COMPLETE');
assert.strictEqual(completeCoverage.universe_coverage, 'PARTIAL_UNKNOWN');

const nonContiguousCoverage = context.sqpScopeCoverage_(
  completeLog,
  [snapshot({ search_query_rank: 1 }), snapshot({ search_query_rank: 3 })]
);
assert.strictEqual(nonContiguousCoverage.scope_status, 'PARTIAL_UNKNOWN');

const shortCoverage = context.sqpScopeCoverage_(
  { ...completeLog, returned_query_count: 1 },
  [snapshot({ search_query_rank: 1 })]
);
assert.strictEqual(shortCoverage.scope_status, 'PARTIAL_UNKNOWN');

const invalidCoverage = context.sqpScopeCoverage_(
  completeLog,
  [snapshot({ search_query_rank: 1 })]
);
assert.strictEqual(invalidCoverage.scope_status, 'INVALID');

assert.deepStrictEqual(
  Array.from(context.sqpPeriodSequenceEnding_('2026-02', 4)),
  ['2025-11', '2025-12', '2026-01', '2026-02']
);
assert.strictEqual(
  context.sqpRawContinuityMonths_(
    [
      snapshot({ period_key: '2026-04' }),
      snapshot({ period_key: '2026-06' })
    ],
    ['2026-03', '2026-04', '2026-05', '2026-06']
  ),
  1
);
assert.throws(() => context.sqpDiagnosticLookbackMonths_(0), /1〜24/);
assert.throws(() => context.sqpDiagnosticLookbackMonths_(25), /1〜24/);

console.log('search_market_diagnostics_test: OK');
