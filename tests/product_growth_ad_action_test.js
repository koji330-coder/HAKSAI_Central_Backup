const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let sequence = 0;
const files = new Map();
class FakeFile {
  constructor(blob) { this.id = `FILE-${++sequence}`; this.blob = blob; this.trashed = false; files.set(this.id, this); }
  getId() { return this.id; }
  getBlob() { return { getDataAsString: () => String(this.blob.value || '') }; }
  setTrashed(value) { this.trashed = Boolean(value); }
}
class FakeIterator {
  constructor(values) { this.values = values; this.index = 0; }
  hasNext() { return this.index < this.values.length; }
  next() { return this.values[this.index++]; }
}
class FakeFolder {
  constructor(name) { this.name = name; this.folders = []; this.files = []; }
  getFoldersByName(name) { return new FakeIterator(this.folders.filter(folder => folder.name === name)); }
  createFolder(name) { const folder = new FakeFolder(name); this.folders.push(folder); return folder; }
  createFile(blob) { const file = new FakeFile(blob); this.files.push(file); return file; }
}

const root = new FakeFolder('root');
const appended = [];
const headers = [
  'context_id','action_id','asin','analysis_session_id','candidate_ids_json',
  'execution_detail_mode','before_snapshot_file_id','after_snapshot_file_id',
  'evaluation_status','comparison_json','created_at','updated_at'
];
class FakeRange {
  constructor(sheet, row, column, numRows = 1, numCols = 1) {
    this.sheet=sheet;this.row=row;this.column=column;this.numRows=numRows;this.numCols=numCols;
  }
  getValues() {
    return Array.from({length:this.numRows},(_,r)=>Array.from({length:this.numCols},(_,c)=>
      this.sheet.rows[this.row-1+r]?.[this.column-1+c] ?? ''
    ));
  }
  setValue(value) {
    while(this.sheet.rows.length<this.row)this.sheet.rows.push([]);
    this.sheet.rows[this.row-1][this.column-1]=value;
    return this;
  }
}
class FakeSheet {
  constructor() { this.rows=[headers.slice()]; }
  appendRow(row) { this.rows.push(row.slice()); appended.push(row); }
  getDataRange() { return new FakeRange(this,1,1,this.rows.length,headers.length); }
  getRange(row,column,numRows=1,numCols=1) { return new FakeRange(this,row,column,numRows,numCols); }
}
const contextSheet = new FakeSheet();
const candidate = {
  candidate_id: 'CAND-1',
  family: 'NEW_EXACT',
  facts: [{ code:'ORDERS', value:3 }]
};
const session = {
  session_id: 'AKA-1',
  policy_version: 'advertising_keyword_decision_v1',
  target_file_id: 'TARGET-FILE',
  search_term_file_id: 'SEARCH-FILE',
  result_drive_file_id: 'RESULT-FILE',
  preview: {
    parser_version: 'advertising_console_csv_v2',
    metadata: {
      asin: 'B0FXTQPGSB',
      period_from: '2026-07-01',
      period_to: '2026-07-27',
      file_scope_status: 'COMPLETE',
      universe_coverage: 'PARTIAL_UNKNOWN',
      returned_target_count: 2,
      returned_search_term_count: 1,
      target_file_sha256: 'target-sha',
      search_term_file_sha256: 'search-sha'
    },
    reports: {
      target: {
        rows: [
          { impressions:100, clicks:10, spend_yen:100, orders:2, sales_yen:1000 },
          { impressions:50, clicks:5, spend_yen:60, orders:1, sales_yen:500 }
        ],
        stats: { click_metrics_available:true }
      },
      search_term: {
        rows: [{ impressions:80, clicks:8, spend_yen:90, orders:2, sales_yen:800 }],
        stats: { click_metrics_available:true }
      }
    }
  },
  analysis: {
    families: [{ selected_candidates:[candidate], suppressed_candidates:[] }],
    central_context: { period_key:'2026-07' }
  }
};
const afterSession = JSON.parse(JSON.stringify(session));
afterSession.session_id='AKA-2';
afterSession.preview.metadata.period_from='2026-07-28';
afterSession.preview.metadata.period_to='2026-08-23';
afterSession.preview.metadata.target_file_sha256='target-sha-after';
afterSession.preview.metadata.search_term_file_sha256='search-sha-after';
afterSession.preview.reports.target.rows=[
  { impressions:200, clicks:20, spend_yen:220, orders:5, sales_yen:2200 }
];

const context = {
  console,
  Set,
  Date,
  JSON,
  Math,
  isFinite,
  DRIVE_FOLDER_ID: 'ROOT',
  DriveApp: { getFolderById: () => root, getFileById: id => files.get(String(id)) },
  Utilities: {
    getUuid: () => `UUID-${++sequence}`,
    newBlob: (value, contentType, name) => ({ value, contentType, name })
  },
  Logger: { log: () => {} }
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', '商品グロースカルテ.js'), 'utf8'),
  context
);

context.pgAsin_ = value => String(value).trim().toUpperCase();
context.pgDateKey_ = value => String(value || '').slice(0,10);
context.getProductGrowthData_ = () => ({ points:[] });
context.getAdvertisingKeywordAnalysis_ = id => id === 'AKA-2' ? afterSession : session;
context.saveProductAction_ = input => ({ ...input, attachments:[] });
context.pgEnsureSheet_ = () => ({
  headers,
  sheet: contextSheet
});

const metrics = context.pgAdvertisingMetricSnapshot_(session.preview.reports.target);
assert.equal(metrics.aggregation_scope, 'RETURNED_CSV_ROWS_NOT_ACCOUNT_UNIVERSE');
assert.deepEqual(JSON.parse(JSON.stringify(metrics.totals)), {
  impressions:150,
  clicks:15,
  spend_yen:160,
  orders:3,
  sales_yen:1500,
  ctr:0.1,
  cpc_yen:160 / 15,
  conversion_rate:0.2,
  acos:160 / 1500,
  roas:1500 / 160
});

const saved = context.saveAdvertisingAdjustmentAction_({
  asin:'B0FXTQPGSB',
  action_at:'2026-07-27',
  title:'広告キーワード調整'
}, [], {
  analysis_session_id:'AKA-1',
  candidate_ids:['CAND-1'],
  execution_detail_mode:'NO_DETAIL'
});

assert.equal(saved.action_type, '広告調整');
assert.equal(saved.advertising_context.analysis_session_id, 'AKA-1');
assert.deepEqual(Array.from(saved.advertising_context.candidate_ids), ['CAND-1']);
assert.equal(saved.advertising_context.evaluation_status, 'WAITING_FOR_AFTER');
assert.equal(appended.length, 1);

const attached = context.attachAdvertisingActionAfterSnapshot_(
  saved.action_id,
  'AKA-2'
);
assert.equal(attached.evaluation_status, 'READY');
assert.ok(attached.after_snapshot_file_id);
assert.equal(attached.comparison.before.advertising_efficiency.target_rows.totals.clicks, 15);
assert.equal(attached.comparison.after.advertising_efficiency.target_rows.totals.clicks, 20);
assert.equal(attached.comparison.interpretation_scope, 'BUNDLED_ADJUSTMENT_BEFORE_AFTER_NOT_SINGLE_KEYWORD_CAUSALITY');
assert.throws(
  () => context.attachAdvertisingActionAfterSnapshot_(saved.action_id, 'AKA-2'),
  /既に登録/
);

assert.throws(() => context.saveAdvertisingAdjustmentAction_({
  asin:'B0FXTQPGSB',
  action_at:'2026-07-27',
  title:'広告キーワード調整'
}, [], {
  analysis_session_id:'AKA-1',
  candidate_ids:['UNKNOWN'],
  execution_detail_mode:'NO_DETAIL'
}), /存在しないcandidate ID/);

console.log('product growth advertising action tests passed');
