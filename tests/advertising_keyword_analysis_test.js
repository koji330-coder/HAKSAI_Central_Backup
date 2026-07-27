const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeBlob {
  constructor(value, contentType, name) {
    this.buffer = typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : Buffer.from(Array.from(value || [], byte => (Number(byte) + 256) % 256));
    this.contentType = contentType || 'application/octet-stream';
    this.name = name || '';
  }
  getDataAsString() { return this.buffer.toString('utf8'); }
  getBytes() { return Array.from(this.buffer, byte => byte > 127 ? byte - 256 : byte); }
  getContentType() { return this.contentType; }
}

let fileSequence = 0;
let folderSequence = 0;
const files = new Map();

class FakeFile {
  constructor(blob) {
    this.id = `FILE-${++fileSequence}`;
    this.blob = blob;
    files.set(this.id, this);
  }
  getId() { return this.id; }
  getBlob() { return this.blob; }
  setContent(text) {
    this.blob = new FakeBlob(text, this.blob.contentType, this.blob.name);
    return this;
  }
}

class FakeIterator {
  constructor(values) {
    this.values = values;
    this.index = 0;
  }
  hasNext() { return this.index < this.values.length; }
  next() { return this.values[this.index++]; }
}

class FakeFolder {
  constructor(name) {
    this.id = `FOLDER-${++folderSequence}`;
    this.name = name;
    this.folders = [];
    this.files = [];
    this.trashed = false;
  }
  getFoldersByName(name) {
    return new FakeIterator(this.folders.filter(folder => folder.name === name && !folder.trashed));
  }
  createFolder(name) {
    const folder = new FakeFolder(name);
    this.folders.push(folder);
    return folder;
  }
  createFile(blob) {
    const file = new FakeFile(blob);
    this.files.push(file);
    return file;
  }
  setTrashed(value) { this.trashed = Boolean(value); }
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
      Array.from({ length: this.numCols }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''
      )
    );
  }
  setValues(values) {
    values.forEach((sourceRow, rowOffset) => {
      while (this.sheet.rows.length < this.row + rowOffset) this.sheet.rows.push([]);
      sourceRow.forEach((value, columnOffset) => {
        this.sheet.rows[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
      });
    });
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
}

class FakeSheet {
  constructor(name, headers) {
    this.name = name;
    this.rows = [headers.slice()];
  }
  getRange(row, column, numRows, numCols) {
    return new FakeRange(this, row, column, numRows, numCols);
  }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0]?.length || 0; }
  appendRow(row) { this.rows.push(row.slice()); return this; }
  getDataRange() {
    return new FakeRange(this, 1, 1, this.rows.length, this.getLastColumn());
  }
}

const sheets = new Map();
const rootFolder = new FakeFolder('root');
let waitLockCalls = 0;
let releaseLockCalls = 0;
let uuidSequence = 0;
let monthlyCalls = 0;
let searchMarketPeriodCalls = 0;
let searchMarketCalls = 0;

function digestBytes(input) {
  return typeof input === 'string'
    ? Buffer.from(input, 'utf8')
    : Buffer.from(Array.from(input, value => (Number(value) + 256) % 256));
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
  DRIVE_FOLDER_ID: 'ROOT',
  Logger: { log: () => {} },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (_algorithm, input) => Array.from(
      crypto.createHash('sha256').update(digestBytes(input)).digest(),
      value => value > 127 ? value - 256 : value
    ),
    base64Decode: value => Array.from(Buffer.from(value, 'base64'), byte => byte > 127 ? byte - 256 : byte),
    newBlob: (value, contentType, name) => new FakeBlob(value, contentType, name),
    getUuid: () => `UUID-${++uuidSequence}`
  },
  DriveApp: {
    getFolderById: id => {
      assert.strictEqual(id, 'ROOT');
      return rootFolder;
    },
    getFileById: id => {
      const file = files.get(id);
      if (!file) throw new Error(`missing file ${id}`);
      return file;
    }
  },
  Session: {
    getActiveUser: () => ({ getEmail: () => 'test@example.com' })
  },
  LockService: {
    getScriptLock: () => ({
      waitLock: () => { waitLockCalls++; },
      releaseLock: () => { releaseLockCalls++; }
    })
  },
  ensureHeaders_: (name, headers) => {
    if (!sheets.has(name)) sheets.set(name, new FakeSheet(name, headers));
    const sheet = sheets.get(name);
    headers.forEach(header => {
      if (!sheet.rows[0].includes(header)) sheet.rows[0].push(header);
    });
  },
  getSheetByName_: (name, headers) => {
    if (!sheets.has(name)) sheets.set(name, new FakeSheet(name, headers));
    return sheets.get(name);
  },
  getHeaders_: sheet => sheet.rows[0].slice()
  ,
  getProductMonthlyData_: (asin, months, period) => {
    monthlyCalls++;
    assert.strictEqual(asin, 'B0FXTQPGSB');
    assert.strictEqual(months, 1);
    return {
      points: [{
        period,
        sales: 10000,
        gross_profit: 4000,
        ad_spend: 1000,
        profit_after_ad: 3000
      }]
    };
  },
  getSearchMarketPeriods_: () => {
    searchMarketPeriodCalls++;
    return {
      asins: [{
        marketplace: 'JP',
        asin: 'B0FXTQPGSB',
        periods: ['2026-05', '2026-06'],
        latest_period: '2026-06'
      }],
      available_periods: ['2026-05', '2026-06']
    };
  },
  getSearchMarketSummary_: (asin, period, marketplace) => {
    searchMarketCalls++;
    assert.strictEqual(period, '2026-06', '広告月以前の最新検索市場月を参照する');
    return {
      asin,
      period_key: period,
      marketplace,
      report_scope: 'TOP_QUERIES',
      query_limit: 100,
      returned_query_count: 0,
      current_query_count: 0,
      rows: []
    };
  }
};
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', '分析', '広告キーワード分析.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);

function csv(headers, rows) {
  const escape = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `\uFEFF${[headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n')}`;
}

const targetText = csv(
  [
    '状態', 'キーワード', 'ターゲットマッチタイプ', 'ステータスコード', 'ステータス',
    '推奨入札額 (低)(JPY)', '推奨入札額 (中央値)(JPY)', '推奨入札額 (高)(JPY)',
    '入札額 (JPY)', 'インプレッション', '検索結果上部のインプレッションシェア',
    '合計費用 (JPY)', '商品購入数', '売上 (JPY)', 'ROAS'
  ],
  [
    ['有効', 'チンベル', '完全一致', 'LIVE', '配信中', '14', '18', '23', '21', '2130', '<5%', '808.96', '9', '6800', '8.405854430379746'],
    ['一時停止', 'keyword-group="category"', '—', 'PAUSED', '一時停止', '14', '15', '16', '19', '0', '0', '0', '0', '0', '0']
  ]
);
const searchText = csv(
  ['次として追加：', 'お客様の検索用語', 'キーワード', 'ターゲットの入札額 (JPY)', '合計費用 (JPY)', '商品購入数', '売上 (JPY)', 'ROAS'],
  [
    ['キーワード: 完全一致', 'チンベル', 'チンベル', '21', '808.96', '9', '6800', '8.405854430379746'],
    ['', 'ハンドベル', 'ハンドベル', '15', '112.5', '0', '0', '0']
  ]
);

function fileInput(fileName, text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    fileName,
    rawBase64: bytes.toString('base64'),
    fileSha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
  };
}

function request(overrides = {}) {
  return {
    asin: 'B0FXTQPGSB',
    periodFrom: '2026-07-01',
    periodTo: '2026-07-26',
    marketplace: 'JP',
    targetFile: fileInput('target.csv', targetText),
    searchTermFile: fileInput('search-term.csv', searchText),
    ...overrides
  };
}

const filesBeforePreview = fileSequence;
const preview = context.previewAdvertisingKeywordAnalysis(request());
assert.strictEqual(preview.schema_version, 'advertising_keyword_analysis_preview_v1');
assert.strictEqual(preview.file_presence, 'TARGET_AND_SEARCH_TERM');
assert.strictEqual(preview.metadata.returned_target_count, 2);
assert.strictEqual(preview.metadata.returned_search_term_count, 2);
assert.strictEqual(preview.reports.target.rows[0].keyword_raw, 'チンベル');
assert.strictEqual(preview.reports.target.rows[1].entity_type, 'PRODUCT_TARGET');
assert.strictEqual(preview.reports.target.rows[0].top_of_search_impression_share.operator, 'LT');
assert.strictEqual(preview.reports.search_term.rows[1].added_match_type, null);
assert.strictEqual(preview.data_usability.existing_bid_decision, 'VALID');
assert.strictEqual(preview.data_usability.new_exact_decision, 'VALID');
assert.strictEqual(fileSequence, filesBeforePreview, 'previewはDriveへ書き込まない');
assert.strictEqual(sheets.size, 0, 'previewはSheetへ書き込まない');
assert.strictEqual(monthlyCalls, 0, 'previewはCentral月次を読まない');
assert.strictEqual(searchMarketPeriodCalls, 0, 'previewは検索市場indexを読まない');
assert.strictEqual(searchMarketCalls, 0, 'previewは検索市場を読まない');

const both = context.runAdvertisingKeywordAnalysis(request());
assert.strictEqual(both.status, 'ANALYZED');
assert.strictEqual(both.target_file_id, 'FILE-1');
assert.strictEqual(both.search_term_file_id, 'FILE-2');
assert.strictEqual(both.result_drive_file_id, 'FILE-3');
assert.ok(both.selected_candidate_count > 0);
assert.strictEqual(both.policy_version, 'advertising_keyword_decision_v0');
assert.strictEqual(both.analysis.cross_family_ranking, false);
assert.strictEqual(both.analysis.selection_scope, 'WITHIN_EACH_CANDIDATE_FAMILY');
assert.strictEqual(both.analysis.policy.recommendation_primary, 'DIRECTION_AND_REASON');
assert.strictEqual(both.analysis.central_context.search_market_reference.reference_period, '2026-06');
assert.strictEqual(both.analysis.central_context.search_market_reference.lag_months, 1);
assert.strictEqual(both.audit.client_preview_trusted, false);

const sessionSheet = sheets.get('advertising_analysis_sessions');
assert.strictEqual(sessionSheet.rows.length - 1, 1, 'session indexは1session 1行');
assert.ok(!sessionSheet.rows[0].includes('parsed_rows_json'), 'parsed rowをSheetへ複製しない');
assert.strictEqual(sessionSheet.rows[1][sessionSheet.rows[0].indexOf('target_file_sha256')], request().targetFile.fileSha256);
assert.strictEqual(sessionSheet.rows[1][sessionSheet.rows[0].indexOf('search_term_file_sha256')], request().searchTermFile.fileSha256);

const reloaded = context.getAdvertisingKeywordAnalysis_(both.session_id);
assert.strictEqual(reloaded.session_id, both.session_id);
assert.strictEqual(reloaded.preview.reports.target.rows.length, 2);
assert.strictEqual(reloaded.preview.reports.search_term.rows.length, 2);

const targetOnly = context.runAdvertisingKeywordAnalysis(request({ searchTermFile: null }));
assert.strictEqual(targetOnly.preview.file_presence, 'TARGET_ONLY');
assert.strictEqual(targetOnly.preview.data_usability.new_exact_decision, 'INVALID');
assert.ok(targetOnly.preview.warnings.some(issue => issue.code === 'SEARCH_TERM_FILE_NOT_PROVIDED'));
assert.strictEqual(targetOnly.search_term_file_id, null);

const searchOnly = context.runAdvertisingKeywordAnalysis(request({ targetFile: null }));
assert.strictEqual(searchOnly.preview.file_presence, 'SEARCH_TERM_ONLY');
assert.strictEqual(searchOnly.preview.data_usability.existing_bid_decision, 'INVALID');
assert.ok(searchOnly.preview.warnings.some(issue => issue.code === 'TARGET_FILE_NOT_PROVIDED'));
assert.strictEqual(searchOnly.target_file_id, null);
assert.strictEqual(sessionSheet.rows.length - 1, 3);

const filesBeforeInvalid = fileSequence;
const rowsBeforeInvalid = sessionSheet.rows.length;
const invalidHash = request();
invalidHash.targetFile.fileSha256 = '0'.repeat(64);
assert.throws(
  () => context.runAdvertisingKeywordAnalysis(invalidHash),
  /fileSha256が原本CSVと一致/
);
assert.strictEqual(fileSequence, filesBeforeInvalid, 'invalid fileはDriveへ保存しない');
assert.strictEqual(sessionSheet.rows.length, rowsBeforeInvalid, 'invalid fileはsession indexへ保存しない');

const invalidNumeric = request({
  targetFile: fileInput('invalid-number.csv', targetText.replace('808.96', 'not-a-number')),
  searchTermFile: null
});
assert.throws(
  () => context.runAdvertisingKeywordAnalysis(invalidNumeric),
  /合計費用.*不正/
);
assert.strictEqual(fileSequence, filesBeforeInvalid, 'parse errorの原本もDriveへ保存しない');
assert.strictEqual(sessionSheet.rows.length, rowsBeforeInvalid, 'parse errorもsession indexへ保存しない');

assert.throws(
  () => context.previewAdvertisingKeywordAnalysis(request({
    targetFile: fileInput('wrong-slot.csv', searchText),
    searchTermFile: null
  })),
  /指定欄と異なる種類/
);
assert.throws(
  () => context.previewAdvertisingKeywordAnalysis(request({ targetFile: null, searchTermFile: null })),
  /1つ以上指定/
);
assert.strictEqual(waitLockCalls, 3);
assert.strictEqual(releaseLockCalls, 3);
assert.strictEqual(monthlyCalls, 3, 'runごとにASIN×月を1回だけ取得する');
assert.strictEqual(searchMarketPeriodCalls, 3, 'runごとに検索市場indexを1回だけ取得する');
assert.strictEqual(searchMarketCalls, 3, 'runごとに検索市場scopeを1回だけ取得する');

console.log(JSON.stringify({
  preview_file_presence: preview.file_presence,
  both_session_files: 3,
  target_only_session_files: 2,
  search_only_session_files: 2,
  session_index_rows: sessionSheet.rows.length - 1
}, null, 2));
console.log('advertising_keyword_analysis_test: OK');
