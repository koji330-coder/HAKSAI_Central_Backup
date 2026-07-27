const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function digestBytes(input) {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return Buffer.from(Array.from(input, value => (Number(value) + 256) % 256));
}

class FakeBlob {
  constructor(value) {
    this.buffer = typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : Buffer.from(Array.from(value || [], byte => (Number(byte) + 256) % 256));
  }
  getDataAsString() { return this.buffer.toString('utf8'); }
}

const context = {
  console,
  Date,
  JSON,
  Math,
  Number,
  Object,
  String,
  isFinite,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_algorithm, input) => Array.from(
      crypto.createHash('sha256').update(digestBytes(input)).digest(),
      value => value > 127 ? value - 256 : value
    ),
    base64Decode: value => Array.from(
      Buffer.from(value, 'base64'),
      byte => byte > 127 ? byte - 256 : byte
    ),
    newBlob: value => new FakeBlob(value)
  }
};
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', '分析', '広告キーワード分析.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);

const targetHeaders = [
  '状態', 'キーワード', 'ターゲットマッチタイプ', 'ステータスコード', 'ステータス',
  '推奨入札額 (低)(JPY)', '推奨入札額 (中央値)(JPY)', '推奨入札額 (高)(JPY)',
  '入札額 (JPY)', 'インプレッション', '検索結果上部のインプレッションシェア',
  '合計費用 (JPY)', '商品購入数', '売上 (JPY)', 'ROAS'
];
const targetRows = [
  ['有効', 'チンベル', '完全一致', 'LIVE', '配信中', '14', '18', '23', '21', '2130', '<5%', '808.96', '9', '6800', '8.405854430379746'],
  ['有効', '呼び鈴', '完全一致', 'LIVE', '配信中', '15', '20', '25', '18', '620', '9.43%', '646.11', '8', '9502', '14.706474129792143'],
  ['有効', 'カウンターベル', '完全一致', 'LIVE', '配信中', '15', '19', '23', '15', '1521', '28.10%', '563.51', '8', '5440', '9.653777217795604'],
  ['一時停止', 'ハンドベル', '完全一致', 'PAUSED', '一時停止', '37', '50', '62', '15', '2565', '<5%', '112.5', '0', '0', '0'],
  ['有効', 'デスクベル', '完全一致', 'LIVE', '配信中', '14', '18', '23', '15', '298', '<5%', '22.5', '0', '0', '0'],
  ['有効', '卓上呼び鈴', '完全一致', 'LIVE', '配信中', '14', '18', '20', '15', '21', '<5%', '0', '0', '0', '0'],
  ['有効', '呼び出しベル 卓上', '完全一致', 'LIVE', '配信中', '14', '17', '21', '15', '59', '20.78%', '0', '0', '0', '0'],
  ['一時停止', 'keyword-group="category"', '—', 'PAUSED', '一時停止', '14', '15', '16', '19', '0', '0', '0', '0', '0', '0'],
  ['一時停止', 'デスクベル', '部分一致', 'PAUSED', '一時停止', '18', '27', '31', '15', '0', '0', '0', '0', '0', '0'],
  ['有効', '受付ベル', '完全一致', 'LIVE', '配信中', '15', '19', '24', '21', '53', '25.42%', '0', '0', '0', '0'],
  ['有効', '受付 ベル', '完全一致', 'LIVE', '配信中', '15', '19', '24', '21', '4', '0', '0', '0', '0', '0'],
  ['有効', 'チーン ベル', '完全一致', 'LIVE', '配信中', '14', '15', '16', '15', '0', '0', '0', '0', '0', '0'],
  ['有効', '呼び出しベル', '完全一致', 'LIVE', '配信中', '14', '15', '16', '15', '0', '0', '0', '0', '0', '0'],
  ['有効', 'よびだしベル', '完全一致', 'LIVE', '配信中', '14', '15', '16', '11', '0', '0', '0', '0', '0', '0'],
  ['有効', '呼び鈴 卓上ベル', '完全一致', 'LIVE', '配信中', '16', '21', '26', '18', '0', '0', '0', '0', '0', '0'],
  ['有効', '卓上ベル', '完全一致', 'LIVE', '配信中', '16', '21', '26', '18', '0', '0', '0', '0', '0', '0'],
  ['有効', 'ベル', '完全一致', 'LIVE', '配信中', '15', '20', '25', '20', '0', '0', '0', '0', '0', '0']
];
const searchHeaders = [
  '次として追加：', 'お客様の検索用語', 'キーワード', 'ターゲットの入札額 (JPY)',
  '合計費用 (JPY)', '商品購入数', '売上 (JPY)', 'ROAS'
];
const searchRows = [
  ['キーワード: 完全一致', 'チンベル', 'チンベル', '21', '808.96', '9', '6800', '8.405854430379746'],
  ['キーワード: 完全一致', 'カウンターベル', 'カウンターベル', '15', '563.51', '8', '5440', '9.653777217795604'],
  ['キーワード: 完全一致', '呼び鈴', '呼び鈴', '18', '646.11', '8', '9502', '14.706474129792143'],
  ['', 'ハンドベル', 'ハンドベル', '15', '112.5', '0', '0', '0'],
  ['キーワード: 完全一致', 'デスクベル', 'デスクベル', '15', '22.5', '0', '0', '0']
];

function csv(headers, rows) {
  const escape = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `\uFEFF${[headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n')}`;
}

function fileInput(name, text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    fileName: name,
    rawBase64: bytes.toString('base64'),
    fileSha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
  };
}

const request = {
  asin: 'B0FXTQPGSB',
  periodFrom: '2026-07-01',
  periodTo: '2026-07-26',
  marketplace: 'JP',
  targetAcos: 0.3,
  targetFile: fileInput('Sponsored_Products_Target_Jul_26_2026.csv', csv(targetHeaders, targetRows)),
  searchTermFile: fileInput('Sponsored_Products_SearchTerm_Jul_26_2026.csv', csv(searchHeaders, searchRows))
};
const prepared = context.akaPrepare_(request);

function marketRow(raw, rank, purchaseTotal, purchaseAsin, overrides = {}) {
  return {
    search_query_raw: raw,
    comparison_status: 'CONTINUED',
    current_rank: rank,
    previous_rank: rank + 1,
    rank_change: 1,
    data_period: '2026-07',
    snapshot: {
      period_key: '2026-07',
      search_query_raw: raw,
      search_query_normalized: context.akaNormalizeQueryV1_(raw),
      normalization_version: 'query_norm_v1',
      normalization_collision: false,
      search_query_rank: rank,
      search_query_volume: 1000 - rank,
      impression_total: 5000 - rank,
      impression_asin: 100,
      impression_share: 100 / (5000 - rank),
      click_total: 300,
      click_asin: 20,
      click_share: 20 / 300,
      cart_total: 80,
      cart_asin: 10,
      cart_share: 10 / 80,
      purchase_total: purchaseTotal,
      purchase_asin: purchaseAsin,
      purchase_share: purchaseTotal ? purchaseAsin / purchaseTotal : null,
      ...overrides
    }
  };
}

const marketSummary = {
  marketplace: 'JP',
  asin: 'B0FXTQPGSB',
  period_key: '2026-07',
  report_scope: 'TOP_QUERIES',
  query_limit: 100,
  returned_query_count: 6,
  current_query_count: 6,
  rows: [
    marketRow('チンベル', 1, 40, 9),
    marketRow('呼び鈴', 2, 35, 8),
    marketRow('カウンターベル', 3, 30, 8),
    marketRow('ハンドベル', 4, 20, 0),
    marketRow('デスクベル', 5, 18, 0),
    marketRow('レジベル', 6, 25, 3)
  ]
};
const central = {
  period_key: '2026-07',
  monthly: {
    period: '2026-07',
    sales: 120000,
    units: 100,
    gross_profit: 48000,
    ad_spend: 12000,
    ad_sales: 60000,
    profit_after_ad: 36000,
    sessions: 1800,
    cvr: 0.055,
    inventory: {
      snapshot_date: '2026-07-26',
      available: 262,
      inbound: 0,
      days_remain: 12,
      alert: '🚨 至急発注（FBA残12日・入荷予定なし）'
    }
  },
  monthly_scope: 'ASIN_PERIOD_GUARDRAIL_NOT_QUERY_ALLOCATION',
  search_market: marketSummary,
  warnings: []
};

const first = context.analyzeAdvertisingKeywordSnapshot_(prepared, JSON.parse(JSON.stringify(central)), null);
const second = context.analyzeAdvertisingKeywordSnapshot_(prepared, JSON.parse(JSON.stringify(central)), null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)), '同じ入力は同じ候補順序・入札額になる');
assert.strictEqual(first.policy.policy_version, 'advertising_keyword_decision_v0');
assert.strictEqual(first.policy.recommendation_primary, 'DIRECTION_AND_REASON');
assert.strictEqual(first.policy.numeric_bid_role, 'USER_ADJUSTABLE_REFERENCE');
assert.strictEqual(first.policy.inventory_caution_suppresses_direction, false);
assert.strictEqual(first.selection_scope, 'WITHIN_EACH_CANDIDATE_FAMILY');
assert.strictEqual(first.cross_family_ranking, false);
assert.strictEqual(first.central_context.monthly.sales, 120000);
assert.strictEqual(first.central_context.monthly_scope, 'ASIN_PERIOD_GUARDRAIL_NOT_QUERY_ALLOCATION');
assert.strictEqual(first.central_context.operational_cautions[0].code, 'INVENTORY_ATTENTION');
assert.strictEqual(first.joins.monthly_allocation_rule, 'ASIN_PERIOD_GUARDRAIL_NOT_QUERY_ALLOCATION');
assert.strictEqual(first.joins.search_market_period_rule, 'LATEST_AVAILABLE_ON_OR_BEFORE_AD_PERIOD');

const deskJoin = first.joins.target_search_term.find(join => join.customer_search_term_raw === 'デスクベル');
assert.strictEqual(deskJoin.method, 'RAW_AND_DECLARED_MATCH_TYPE');
assert.strictEqual(deskJoin.target_match_type, 'EXACT');
const handJoin = first.joins.target_search_term.find(join => join.customer_search_term_raw === 'ハンドベル');
assert.strictEqual(handJoin.method, 'RAW_UNIQUE_LIMITED');
assert.strictEqual(handJoin.ambiguity_reason, 'MATCH_TYPE_NOT_DECLARED');
const chimeMarketJoin = first.joins.search_term_search_market.find(join => join.customer_search_term_raw === 'チンベル');
assert.strictEqual(chimeMarketJoin.method, 'RAW_EXACT');

const ambiguousReports = JSON.parse(JSON.stringify(prepared.preview.reports));
ambiguousReports.search_term.rows.find(row => row.customer_search_term_raw === 'デスクベル').added_match_type = null;
const ambiguous = context.akaBuildTargetSearchTermJoins_(
  ambiguousReports.target.rows,
  ambiguousReports.search_term.rows
).find(join => join.customer_search_term_raw === 'デスクベル');
assert.strictEqual(ambiguous.method, 'AMBIGUOUS');
assert.strictEqual(ambiguous.ambiguity_reason, 'MATCH_TYPE_NOT_DECLARED_AND_MULTIPLE_TARGETS');

const collisionJoin = context.akaBuildSearchMarketJoins_([
  {
    source_row_number: 99,
    customer_search_term_raw: 'ＢＥＬＬ',
    customer_search_term_normalized: 'bell'
  }
], [
  {
    search_query_raw: 'bell',
    search_query_normalized: 'bell',
    normalization_collision: true
  },
  {
    search_query_raw: 'ＢＥＬＬ ',
    search_query_normalized: 'bell',
    normalization_collision: true
  }
])[0];
assert.strictEqual(collisionJoin.method, 'AMBIGUOUS');
assert.strictEqual(collisionJoin.ambiguity_reason, 'NORMALIZED_SEARCH_MARKET_COLLISION');

const allCandidates = first.families.flatMap(family => [
  ...family.selected_candidates,
  ...family.suppressed_candidates
]);
const productTarget = allCandidates.find(candidate =>
  candidate.keyword_raw === 'keyword-group="category"'
);
assert.strictEqual(productTarget.family, 'DATA_QUALITY');
assert.strictEqual(productTarget.suppression_reason, 'PRODUCT_OR_UNKNOWN_TARGET_EXCLUDED');

const callBell = allCandidates.find(candidate =>
  candidate.keyword_raw === '呼び鈴'
  && candidate.family === 'EXISTING_BID'
);
assert.strictEqual(callBell.current_bid_yen, 18);
assert.strictEqual(callBell.decision, 'RAISE_TEST');
assert.strictEqual(callBell.bid_direction, 'RAISE');
assert.ok(callBell.direction_reason_codes.includes('ACOS_AT_OR_BELOW_USER_TARGET'));
assert.ok(callBell.direction_reason_codes.includes('ORDERS_OBSERVED'));
assert.strictEqual(callBell.proposed_bid_yen, 20);
assert.strictEqual(callBell.numeric_bid_role, 'USER_ADJUSTABLE_REFERENCE');
assert.strictEqual(callBell.operational_cautions[0].suppresses_bid_direction, false);
const handBell = allCandidates.find(candidate =>
  candidate.keyword_raw === 'ハンドベル'
  && candidate.family === 'MAINTAIN'
);
assert.strictEqual(handBell.facts.find(fact => fact.code === 'TARGET_STATE').value, 'PAUSED');
assert.strictEqual(handBell.decision, 'HOLD');

const negativeFamily = first.families.find(family => family.family === 'NEGATIVE_REVIEW');
assert.strictEqual(negativeFamily.selected_candidates.length, 0);
assert.ok(negativeFamily.suppressed_candidates.length >= 1);
assert.ok(negativeFamily.suppressed_candidates.every(candidate =>
  candidate.suppression_reason === 'MISSING_CLICK_METRICS_AND_INTENT_EVIDENCE'
));
const existingNewExact = first.families.find(family => family.family === 'NEW_EXACT')
  .suppressed_candidates.find(candidate => candidate.search_term_raw === 'チンベル');
assert.strictEqual(existingNewExact.suppression_reason, 'EXACT_TARGET_ALREADY_EXISTS');

allCandidates.forEach(candidate => {
  assert.ok(candidate.candidate_id);
  assert.ok(Array.isArray(candidate.facts));
  assert.ok(Array.isArray(candidate.missing_information));
  assert.ok(Object.prototype.hasOwnProperty.call(candidate, 'bid_basis'));
  assert.ok(Object.prototype.hasOwnProperty.call(candidate, 'suppression_reason'));
  assert.strictEqual(candidate.policy_version, 'advertising_keyword_decision_v0');
});
assert.ok(allCandidates.every(candidate =>
  !candidate.facts.some(fact => fact.code === 'ALLOCATED_CENTRAL_SALES')
));

const appliedPrepared = JSON.parse(JSON.stringify(prepared));
appliedPrepared.preview.reports.target.rows
  .find(row => row.keyword_raw === '呼び鈴' && row.match_type === 'EXACT')
  .current_bid_yen = callBell.proposed_bid_yen;
const afterApplied = context.analyzeAdvertisingKeywordSnapshot_(
  appliedPrepared,
  JSON.parse(JSON.stringify(central)),
  { analysis: first }
);
const appliedCandidate = afterApplied.families
  .flatMap(family => family.selected_candidates)
  .find(candidate => candidate.keyword_raw === '呼び鈴');
assert.strictEqual(appliedCandidate.execution_status, 'ALREADY_APPLIED');
assert.strictEqual(appliedCandidate.family, 'MAINTAIN');
assert.strictEqual(appliedCandidate.current_bid_yen, 20);

const shadowRun = first.families.map(family => ({
  family: family.family,
  selected: family.selected_candidates.map(candidate => ({
    keyword: candidate.keyword_raw || candidate.search_term_raw || '(session)',
    decision: candidate.decision,
    current_bid_yen: candidate.current_bid_yen,
    proposed_bid_yen: candidate.proposed_bid_yen,
    reason: candidate.selection_reason?.code || null
  })),
  suppressed: family.suppressed_candidates.slice(0, 8).map(candidate => ({
    keyword: candidate.keyword_raw || candidate.search_term_raw || '(session)',
    decision: candidate.decision,
    reason: candidate.suppression_reason
  }))
}));
console.log(JSON.stringify({
  selected_count: first.selected_count,
  suppressed_count: first.suppressed_count,
  families: shadowRun
}, null, 2));
console.log('advertising_keyword_candidate_engine_test: OK');
