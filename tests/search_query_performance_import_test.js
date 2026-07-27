const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeCell {
  constructor(row, column) {
    this.row = row;
    this.column = column;
  }
  getRow() { return this.row; }
  getColumn() { return this.column; }
}

class FakeTextFinder {
  constructor(range, text) {
    this.range = range;
    this.text = String(text);
  }
  matchEntireCell() { return this; }
  findAll() {
    const matches = [];
    for (let rowOffset = 0; rowOffset < this.range.numRows; rowOffset++) {
      for (let colOffset = 0; colOffset < this.range.numCols; colOffset++) {
        const value = this.range.sheet.valueAt(
          this.range.row + rowOffset,
          this.range.column + colOffset
        );
        if (String(value == null ? '' : value) === this.text) {
          matches.push(new FakeCell(
            this.range.row + rowOffset,
            this.range.column + colOffset
          ));
        }
      }
    }
    return matches;
  }
}

class FakeRange {
  constructor(sheet, row, column, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
    return Array.from({ length: this.numRows }, (_, rowOffset) =>
      Array.from({ length: this.numCols }, (_, colOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.column + colOffset)
      )
    );
  }
  setValues(values) {
    assert.strictEqual(values.length, this.numRows);
    values.forEach(row => assert.strictEqual(row.length, this.numCols));
    for (let rowOffset = 0; rowOffset < this.numRows; rowOffset++) {
      for (let colOffset = 0; colOffset < this.numCols; colOffset++) {
        this.sheet.setValueAt(
          this.row + rowOffset,
          this.column + colOffset,
          values[rowOffset][colOffset]
        );
      }
    }
    return this;
  }
  setValue(value) {
    this.sheet.setValueAt(this.row, this.column, value);
    return this;
  }
  setNumberFormat() {
    this.sheet.numberFormatWrites++;
    return this;
  }
  createTextFinder(text) {
    this.sheet.textFinderCalls++;
    return new FakeTextFinder(this, text);
  }
  clearContent() {
    this.sheet.fullBodyClearCalls++;
    throw new Error('scope局所置換でclearContent()を呼んではいけません。');
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.fullDataRangeCalls = 0;
    this.fullBodyClearCalls = 0;
    this.numberFormatWrites = 0;
    this.deletedGroups = [];
    this.textFinderCalls = 0;
  }
  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }
  setValueAt(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }
  getRange(row, column, numRows, numCols) {
    return new FakeRange(this, row, column, numRows, numCols);
  }
  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }
  deleteRows(start, count) {
    assert.ok(start >= 2, 'ヘッダー行を削除してはいけない');
    this.deletedGroups.push({ start, count });
    this.rows.splice(start - 1, count);
  }
  getDataRange() {
    this.fullDataRangeCalls++;
    throw new Error('scope局所置換でgetDataRange()を呼んではいけません。');
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = new Map();
  }
  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

let uuidSequence = 0;
let driveSequence = 0;
let waitLockCalls = 0;
let releaseLockCalls = 0;
const spreadsheet = new FakeSpreadsheet();

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
    ),
    base64Decode: value => Array.from(Buffer.from(value, 'base64')),
    getUuid: () => `UUID-${++uuidSequence}`,
    formatDate: date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  },
  Session: {
    getActiveUser: () => ({ getEmail: () => 'test@example.com' }),
    getScriptTimeZone: () => 'Asia/Tokyo'
  },
  LockService: {
    getScriptLock: () => ({
      waitLock: () => { waitLockCalls++; },
      releaseLock: () => { releaseLockCalls++; }
    })
  },
  getReportSpreadsheet_: () => spreadsheet,
  archiveRawToDrive_: () => `DRIVE-${++driveSequence}`
};
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', '商品登録', '検索クエリパフォーマンス取込.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);

const dataHeaders = vm.runInContext('REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE.slice()', context);
const dataSheet = spreadsheet.insertSheet('search_query_performance_period');
dataSheet.getRange(1, 1, 1, dataHeaders.length).setValues([dataHeaders]);
const sentinel = Object.fromEntries(dataHeaders.map(header => [header, '']));
sentinel.id = 'OTHER-ID';
sentinel.scope_key = 'OTHER-SCOPE';
sentinel.marketplace = 'JP';
sentinel.period_type = 'MONTH';
sentinel.date_from = '2026-05-01';
sentinel.date_to = '2026-05-31';
sentinel.period_key = '2026-05';
sentinel.asin = 'B000000001';
sentinel.search_query_raw = '別scopeの行';
dataSheet.getRange(2, 1, 1, dataHeaders.length).setValues([
  dataHeaders.map(header => sentinel[header])
]);

function makeRow(rank, query = `匿名検索クエリ ${rank}`) {
  const volume = 100 + rank;
  const impressionTotal = 1000 + rank;
  const impressionAsin = rank;
  const clickTotal = 20 + rank;
  const clickAsin = 1 + (rank % 5);
  const cartTotal = 10 + rank;
  const cartAsin = rank % 4;
  const purchaseTotal = rank % 10 === 0 ? 0 : 5 + rank;
  const purchaseAsin = purchaseTotal === 0 ? 0 : rank % 3;
  return {
    search_query_raw: query,
    search_query_normalized: query.toLowerCase(),
    normalization_version: 'query_norm_v1',
    normalization_collision: false,
    search_query_score: rank,
    search_query_rank: rank,
    search_query_volume: volume,
    impression_total: impressionTotal,
    impression_asin: impressionAsin,
    impression_asin_share_reported: impressionAsin / impressionTotal,
    click_total: clickTotal,
    click_rate_reported: clickTotal / volume,
    click_asin: clickAsin,
    click_asin_share_reported: clickAsin / clickTotal,
    click_price_median: 1100 + rank,
    click_asin_price_median: 1000 + rank,
    click_same_day: 0,
    click_one_day: clickTotal,
    click_two_day: 0,
    cart_total: cartTotal,
    cart_rate_reported: cartTotal / volume,
    cart_asin: cartAsin,
    cart_asin_share_reported: cartAsin / cartTotal,
    cart_price_median: 1050 + rank,
    cart_asin_price_median: cartAsin === 0 ? null : 1000 + rank,
    cart_same_day: 0,
    cart_one_day: cartTotal,
    cart_two_day: 0,
    purchase_total: purchaseTotal,
    purchase_rate_reported: purchaseTotal / volume,
    purchase_asin: purchaseAsin,
    purchase_asin_share_reported: purchaseTotal === 0 ? null : purchaseAsin / purchaseTotal,
    purchase_price_median: purchaseTotal === 0 ? null : 1000 + rank,
    purchase_asin_price_median: purchaseAsin === 0 ? null : 950 + rank,
    purchase_same_day: 0,
    purchase_one_day: purchaseTotal,
    purchase_two_day: 0
  };
}

function makeReport(
  rows = Array.from({ length: 100 }, (_, index) => makeRow(index + 1)),
  periodKey = '2026-06'
) {
  const [year, month] = periodKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dateFrom = `${periodKey}-01`;
  const dateTo = `${periodKey}-${String(lastDay).padStart(2, '0')}`;
  return {
    metadata: {
      marketplace: 'JP',
      asin: 'B0FXTQPGSB',
      period_type: 'MONTH',
      date_from: dateFrom,
      date_to: dateTo,
      period_key: periodKey,
      report_date: dateTo,
      report_scope: 'TOP_QUERIES',
      query_limit: 100,
      page_number: 1,
      returned_query_count: rows.length,
      source_type: 'SELLER_CENTRAL_CSV'
    },
    rows
  };
}

const rawBase64 = Buffer.from('anonymous search query fixture', 'utf8').toString('base64');
function sync(report) {
  return context.syncSearchQueryPerformance(
    report,
    rawBase64,
    'JP_search_query_fixture.csv',
    ''
  );
}

function countScope(scopeKey) {
  const scopeIndex = dataHeaders.indexOf('scope_key');
  return dataSheet.rows.slice(1).filter(row => row[scopeIndex] === scopeKey).length;
}

const baseReport = makeReport();
const initial = sync(baseReport);
assert.deepStrictEqual(
  [initial.added, initial.replaced, initial.removed, initial.unchanged, initial.finalSavedRows],
  [100, 0, 0, 0, 100]
);
assert.strictEqual(initial.backupRows, 0);
assert.strictEqual(initial.currentStoredRows, 0);
assert.strictEqual(initial.sheetTotalRows, 101);
assert.strictEqual(countScope(initial.scopeKey), 100);

const identicalPreview = context.previewSearchQueryPerformance(baseReport);
assert.strictEqual(identicalPreview.currentStoredRows, 100);
assert.deepStrictEqual(
  [
    identicalPreview.added,
    identicalPreview.replaced,
    identicalPreview.removed,
    identicalPreview.unchanged,
    identicalPreview.finalSavedRows
  ],
  [0, 0, 0, 100, 100]
);

const identical = sync(baseReport);
assert.strictEqual(identical.currentStoredRows, 100);
assert.deepStrictEqual(
  [identical.added, identical.replaced, identical.removed, identical.unchanged, identical.finalSavedRows],
  [0, 0, 0, 100, 100]
);
assert.strictEqual(identical.backupRows, 0);
assert.strictEqual(identical.sheetTotalRows, 101);
assert.strictEqual(countScope(initial.scopeKey), 100);

const oneChangedReport = JSON.parse(JSON.stringify(baseReport));
const changed = oneChangedReport.rows[9];
changed.click_total += 1;
changed.click_rate_reported = changed.click_total / changed.search_query_volume;
changed.click_asin_share_reported = changed.click_asin / changed.click_total;
const oneChangedPreview = context.previewSearchQueryPerformance(oneChangedReport);
assert.strictEqual(oneChangedPreview.currentStoredRows, 100);
assert.deepStrictEqual(
  [
    oneChangedPreview.added,
    oneChangedPreview.replaced,
    oneChangedPreview.removed,
    oneChangedPreview.unchanged,
    oneChangedPreview.finalSavedRows
  ],
  [0, 1, 0, 99, 100]
);
const oneChanged = sync(oneChangedReport);
assert.strictEqual(oneChanged.currentStoredRows, 100);
assert.deepStrictEqual(
  [oneChanged.added, oneChanged.replaced, oneChanged.removed, oneChanged.unchanged, oneChanged.finalSavedRows],
  [0, 1, 0, 99, 100]
);
assert.strictEqual(oneChanged.backupRows, 100);
assert.strictEqual(oneChanged.sheetTotalRows, 101);
assert.strictEqual(countScope(initial.scopeKey), 100);

const inOutReport = JSON.parse(JSON.stringify(oneChangedReport));
inOutReport.rows = inOutReport.rows.slice(1);
inOutReport.rows.push(makeRow(1, '新規ランクイン検索クエリ'));
inOutReport.metadata.returned_query_count = inOutReport.rows.length;
const inOutPreview = context.previewSearchQueryPerformance(inOutReport);
assert.strictEqual(inOutPreview.currentStoredRows, 100);
assert.deepStrictEqual(
  [
    inOutPreview.added,
    inOutPreview.replaced,
    inOutPreview.removed,
    inOutPreview.unchanged,
    inOutPreview.finalSavedRows
  ],
  [1, 0, 1, 99, 100]
);
const inOut = sync(inOutReport);
assert.strictEqual(inOut.currentStoredRows, 100);
assert.deepStrictEqual(
  [inOut.added, inOut.replaced, inOut.removed, inOut.unchanged, inOut.finalSavedRows],
  [1, 0, 1, 99, 100]
);
assert.strictEqual(inOut.backupRows, 100);
assert.strictEqual(inOut.sheetTotalRows, 101);
assert.strictEqual(countScope(initial.scopeKey), 100);

const invalidAsin = JSON.parse(JSON.stringify(baseReport));
invalidAsin.metadata.asin = 'INVALID';
assert.throws(
  () => context.sqpNormalizeReport_(invalidAsin),
  /ASINが不正/
);

const invalidPeriod = JSON.parse(JSON.stringify(baseReport));
invalidPeriod.metadata.date_to = '2026-06-29';
assert.throws(
  () => context.sqpNormalizeReport_(invalidPeriod),
  /date_to\/report_date/
);

const unsupportedPage = JSON.parse(JSON.stringify(baseReport));
unsupportedPage.metadata.page_number = 2;
assert.throws(
  () => context.sqpNormalizeReport_(unsupportedPage),
  /page_number=1のみ対応/
);

const invalidNumber = JSON.parse(JSON.stringify(baseReport));
invalidNumber.rows[0].click_total = -1;
assert.throws(
  () => context.sqpNormalizeReport_(invalidNumber),
  /不正な非負整数/
);

const duplicateQuery = JSON.parse(JSON.stringify(baseReport));
duplicateQuery.rows[1].search_query_raw = duplicateQuery.rows[0].search_query_raw;
duplicateQuery.rows[1].search_query_normalized = duplicateQuery.rows[0].search_query_normalized;
assert.throws(
  () => context.sqpNormalizeReport_(duplicateQuery),
  /検索クエリ原文が重複/
);

const scopeIndex = dataHeaders.indexOf('scope_key');
assert.strictEqual(dataSheet.rows[1][scopeIndex], 'OTHER-SCOPE', '別scope行を変更してはいけない');
assert.strictEqual(dataSheet.fullDataRangeCalls, 0, 'データシート全体を読み込んではいけない');
assert.strictEqual(dataSheet.fullBodyClearCalls, 0, 'データシート全体をclearしてはいけない');
assert.deepStrictEqual(
  dataSheet.deletedGroups.map(group => group.count),
  [100, 100],
  '完全同一再取込ではscope行を削除せず、変更時だけ局所置換する'
);
assert.strictEqual(waitLockCalls, 4);
assert.strictEqual(releaseLockCalls, 4);
assert.strictEqual(driveSequence, 4);

const importLog = spreadsheet.getSheetByName('search_query_import_log');
assert.strictEqual(importLog.getLastRow() - 1, 4);
const backupSheet = spreadsheet.getSheetByName('search_query_scope_backup');
assert.strictEqual(backupSheet.getLastRow() - 1, 200);

// SheetsがYYYY-MMをDateへ自動変換した既存import logでも、read APIは対象月を復元する。
const importLogPeriodIndex = importLog.rows[0].indexOf('period_key');
importLog.rows.slice(1).forEach(row => {
  if (row[importLogPeriodIndex] === '2026-06') row[importLogPeriodIndex] = new Date('2026-06-01T00:00:00.000Z');
});
assert.strictEqual(
  context.sqpStoredPeriodKey_('Mon Jun 01 2026 00:00:00 GMT+0900 (日本標準時)'),
  '2026-06'
);

// PR4 read API: 前月レポート欠損時は全件NEWにしない。
const juneSummary = context.getSearchMarketSummary_('B0FXTQPGSB', '2026-06', 'JP');
assert.strictEqual(juneSummary.previous_period_available, false);
assert.strictEqual(juneSummary.comparison_status, 'PREVIOUS_PERIOD_MISSING');
assert.ok(juneSummary.rows.every(row => row.comparison_status === 'PREVIOUS_PERIOD_MISSING'));
assert.ok(juneSummary.rows.every(row => row.previous_rank === null && row.rank_change === null));

// 直前暦月がある場合のみCONTINUED / ENTERED / LEFTを構築する。
const julyRows = [
  makeRow(1, '匿名検索クエリ 2'),
  makeRow(2, '七月の新規クエリ'),
  makeRow(3, '匿名検索クエリ　3')
];
julyRows[2].search_query_normalized = '匿名検索クエリ 3';
sync(makeReport(julyRows, '2026-07'));
const julySummary = context.getSearchMarketSummary_('B0FXTQPGSB', '2026-07', 'JP');
const continued = julySummary.rows.find(row => row.search_query_raw === '匿名検索クエリ 2');
const entered = julySummary.rows.find(row => row.search_query_raw === '七月の新規クエリ');
const hintedEntered = julySummary.rows.find(row => row.search_query_raw === '匿名検索クエリ　3');
const left = julySummary.rows.find(row => row.search_query_raw === '匿名検索クエリ 3');
assert.deepStrictEqual(
  [continued.comparison_status, continued.previous_rank, continued.current_rank, continued.rank_change],
  ['CONTINUED', 2, 1, 1]
);
assert.strictEqual(entered.comparison_status, 'ENTERED_TOP100');
assert.strictEqual(left.comparison_status, 'LEFT_TOP100');
assert.strictEqual(hintedEntered.comparison_status, 'ENTERED_TOP100');
assert.strictEqual(hintedEntered.normalized_continuity_hint.candidate_query_raw, '匿名検索クエリ 3');
assert.strictEqual(left.normalized_continuity_hint.candidate_query_raw, '匿名検索クエリ　3');

const detail = context.getSearchMarketQueryDetail_(
  'B0FXTQPGSB',
  '2026-07',
  '匿名検索クエリ 2',
  'JP'
);
assert.strictEqual(detail.snapshot.impression_share, 1 / 1001);
assert.ok(detail.snapshot.price_medians.click_market > 0);
const history = context.getSearchMarketQueryHistory_(
  'B0FXTQPGSB',
  '匿名検索クエリ 2',
  'JP'
);
assert.deepStrictEqual(Array.from(history.points, point => point.period_key), ['2026-06', '2026-07']);
assert.deepStrictEqual(Array.from(history.missing_periods), []);
assert.strictEqual(history.identity_rule, 'RAW_EXACT');

// PR4.5-1 facts API: Top query集合全体とraw完全一致matched cohortを分離する。
const diagnostics = context.getSearchMarketDiagnostics_(
  'B0FXTQPGSB',
  '2026-07',
  'JP',
  4
);
assert.strictEqual(diagnostics.schema_version, 'search_market_diagnostic_v1');
assert.strictEqual(diagnostics.observation_version, 'facts_v1');
assert.deepStrictEqual(
  Array.from(diagnostics.requested_periods),
  ['2026-04', '2026-05', '2026-06', '2026-07']
);
assert.deepStrictEqual(Array.from(diagnostics.available_periods), ['2026-06', '2026-07']);
assert.deepStrictEqual(Array.from(diagnostics.missing_periods), ['2026-04', '2026-05']);
assert.strictEqual(diagnostics.coverage.report_scope, 'TOP_QUERIES');
assert.strictEqual(diagnostics.coverage.scope_status, 'PARTIAL_UNKNOWN');
assert.strictEqual(diagnostics.coverage.universe_coverage, 'PARTIAL_UNKNOWN');
assert.strictEqual(diagnostics.coverage.returned_query_count, 3);
assert.strictEqual(diagnostics.coverage.stored_query_count, 3);
assert.strictEqual(
  diagnostics.period_coverage.find(item => item.period_key === '2026-06').coverage.scope_status,
  'COMPLETE'
);
assert.strictEqual(diagnostics.snapshot_comparison.current.query_count, 3);
assert.strictEqual(diagnostics.snapshot_comparison.previous.query_count, 100);
assert.deepStrictEqual(
  [
    diagnostics.snapshot_comparison.continued_query_count,
    diagnostics.snapshot_comparison.entered_query_count,
    diagnostics.snapshot_comparison.left_query_count
  ],
  [1, 2, 99]
);
assert.strictEqual(diagnostics.matched_cohort_comparison.identity_rule, 'RAW_EXACT');
assert.strictEqual(diagnostics.matched_cohort_comparison.matched_query_count, 1);
assert.strictEqual(diagnostics.matched_cohort_comparison.current.query_count, 1);
assert.strictEqual(diagnostics.matched_cohort_comparison.previous.query_count, 1);
assert.strictEqual(diagnostics.matched_cohort_comparison.current.search_query_volume, 101);
assert.strictEqual(diagnostics.matched_cohort_comparison.previous.search_query_volume, 102);
assert.strictEqual(
  diagnostics.matched_cohort_comparison.changes.search_query_volume.absolute,
  -1
);
assert.strictEqual(diagnostics.data_usability.current_state, 'LIMITED');
assert.strictEqual(diagnostics.data_usability.matched_cohort, 'LIMITED');
assert.strictEqual(diagnostics.data_usability.market_universe_inference, 'LIMITED');
assert.strictEqual(diagnostics.evidence_inputs.periods_requested, 4);
assert.strictEqual(diagnostics.evidence_inputs.periods_available, 2);
assert.ok(!Object.prototype.hasOwnProperty.call(diagnostics, 'evidence_status'));
assert.ok(!Object.prototype.hasOwnProperty.call(diagnostics, 'signals'));
const queryFact = diagnostics.query_facts.find(row => row.search_query_raw === '匿名検索クエリ 2');
assert.strictEqual(queryFact.current_status, 'CONTINUED');
assert.strictEqual(queryFact.period_count_available, 2);
assert.strictEqual(queryFact.evidence_inputs.raw_continuity_months, 2);
assert.strictEqual(queryFact.trend.rank_change, 1);
assert.strictEqual(queryFact.evidence_inputs.market_denominators.purchase, 6);
assert.strictEqual(queryFact.evidence_inputs.asin_numerators.purchase, 1);

// 100 query×4か月でもquery別history APIを呼ばず、各scopeを1回だけ読む。
sync(makeReport(
  Array.from({ length: 100 }, (_, index) => makeRow(index + 1)),
  '2026-06'
));
sync(makeReport(
  Array.from({ length: 100 }, (_, index) => makeRow(index + 1)),
  '2026-07'
));
sync(makeReport(
  Array.from({ length: 100 }, (_, index) => makeRow(index + 1)),
  '2026-08'
));
sync(makeReport(
  Array.from({ length: 100 }, (_, index) => makeRow(index + 1)),
  '2026-09'
));
const storedPeriodIndex = dataHeaders.indexOf('period_key');
const storedRawIndex = dataHeaders.indexOf('search_query_raw');
const storedCollisionIndex = dataHeaders.indexOf('normalization_collision');
const augustCollisionRow = dataSheet.rows.find(row =>
  row[storedPeriodIndex] === '2026-08'
  && row[storedRawIndex] === '匿名検索クエリ 1'
);
augustCollisionRow[storedCollisionIndex] = true;
const textFinderCallsBeforeBulkRead = dataSheet.textFinderCalls;
const fourMonthDiagnostics = context.getSearchMarketDiagnostics_(
  'B0FXTQPGSB',
  '2026-09',
  'JP',
  4
);
assert.deepStrictEqual(
  Array.from(fourMonthDiagnostics.available_periods),
  ['2026-06', '2026-07', '2026-08', '2026-09']
);
assert.strictEqual(fourMonthDiagnostics.query_facts.length, 100);
assert.ok(fourMonthDiagnostics.query_facts.every(row => row.points.length === 4));
assert.strictEqual(
  dataSheet.textFinderCalls - textFinderCallsBeforeBulkRead,
  4,
  'diagnosticsはqueryごとではなく各月scopeを1回だけ読む'
);
assert.strictEqual(
  fourMonthDiagnostics.read_strategy,
  'IMPORT_LOG_INDEX_THEN_ONE_SCOPE_TEXT_FINDER_PER_PERIOD'
);
assert.strictEqual(fourMonthDiagnostics.data_quality.normalization_collision_row_count, 1);
assert.strictEqual(fourMonthDiagnostics.data_usability.normalized_join, 'LIMITED');
const zeroDenominatorFact = fourMonthDiagnostics.query_facts.find(
  row => row.search_query_raw === '匿名検索クエリ 10'
);
assert.strictEqual(zeroDenominatorFact.current_snapshot.purchase_total, 0);
assert.strictEqual(zeroDenominatorFact.current_snapshot.purchase_share, null);
assert.strictEqual(zeroDenominatorFact.data_usability.share.purchase, 'INVALID');
const signalResponse = context.getSearchMarketSignals_(
  'B0FXTQPGSB',
  '2026-09',
  'JP',
  4
);
assert.strictEqual(signalResponse.policy.policy_version, 'search_market_signal_v0');
assert.strictEqual(signalResponse.selection_scope, 'WITHIN_EACH_SIGNAL_FAMILY');
assert.strictEqual(signalResponse.cross_family_ranking, false);
assert.ok(signalResponse.selected_count > 0);
assert.ok(signalResponse.families.every(family =>
  family.selected_signals.every(signal => ['CHECK', 'WATCH'].includes(signal.action_class))
));
assert.ok(!Object.prototype.hasOwnProperty.call(signalResponse, 'selected_signals'));
const narrativeResponse = context.getSearchMarketNarrative_(
  'B0FXTQPGSB',
  '2026-09',
  'JP',
  4
);
assert.strictEqual(narrativeResponse.schema_version, 'search_market_narrative_v1');
assert.strictEqual(
  narrativeResponse.sections.conclusion[0].selection_reason.code,
  'MATCHED_COHORT_COMPARISON_PRIORITIZED'
);
assert.ok(narrativeResponse.display_item_count <= 8);
assert.strictEqual(narrativeResponse.builder_contract.query_identity, 'RAW_EXACT');
assert.strictEqual(narrativeResponse.builder_contract.data_quality_separated, true);
assert.strictEqual(narrativeResponse.builder_contract.gemini_used, false);
assert.strictEqual(narrativeResponse.builder_contract.action_generated, false);
assert.strictEqual(
  narrativeResponse.presentation.schema_version,
  'search_market_decision_presentation_v1'
);
assert.strictEqual(
  narrativeResponse.presentation.display_policy.policy_version,
  'search_market_display_v0'
);
assert.ok(narrativeResponse.presentation.do_now.length <= 2);
assert.ok(narrativeResponse.presentation.keep.length <= 2);
assert.strictEqual(
  narrativeResponse.presentation.contract.formal_action_generated,
  false
);
assert.strictEqual(narrativeResponse.presentation.contract.gemini_used, false);
const storedRankIndex = dataHeaders.indexOf('search_query_rank');
const septemberLastRankRow = dataSheet.rows.find(row =>
  row[storedPeriodIndex] === '2026-09'
  && row[storedRawIndex] === '匿名検索クエリ 100'
);
septemberLastRankRow[storedRankIndex] = 101;
const nonContiguousDiagnostics = context.getSearchMarketDiagnostics_(
  'B0FXTQPGSB',
  '2026-09',
  'JP',
  1
);
assert.strictEqual(nonContiguousDiagnostics.coverage.scope_status, 'PARTIAL_UNKNOWN');
assert.ok(
  Array.from(nonContiguousDiagnostics.coverage.reasons)
    .includes('TOP_QUERY_SCOPE_COMPLETENESS_UNKNOWN')
);

const periodIndex = context.getSearchMarketPeriods_();
assert.deepStrictEqual(
  Array.from(periodIndex.asins[0].periods),
  ['2026-06', '2026-07', '2026-08', '2026-09']
);
assert.strictEqual(dataSheet.fullDataRangeCalls, 0, 'PR4 read APIでもデータシート全体を読んではいけない');

const cases = {
  initial: pick(initial),
  identical: pick(identical),
  one_changed: pick(oneChanged),
  one_in_one_out: pick(inOut)
};
console.log(JSON.stringify(cases, null, 2));
console.log('search_query_performance_import_test: OK');

function pick(result) {
  return {
    added: result.added,
    replaced: result.replaced,
    removed: result.removed,
    unchanged: result.unchanged,
    finalSavedRows: result.finalSavedRows
  };
}
