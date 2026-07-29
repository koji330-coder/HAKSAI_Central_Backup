const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSource = fs.readFileSync(
  path.join(__dirname, '..', 'コア', 'コード.js'),
  'utf8'
);
const domesticSource = fs.readFileSync(
  path.join(__dirname, '..', '原価_在庫', '国内仕入れ管理.js'),
  'utf8'
);

const REQUIRED_HEADERS_REORDER = [
  'id', 'product_id', 'sku', 'order_date', 'quantity',
  'unit_price_1688', 'landed_cost_actual',
  'lead_time_days', 'expected_arrival_date',
  'fba_fee_at_order', 'selling_price_at_order',
  'notes', 'created_at'
];

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} がソースに存在すること`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} の終端を検出できません。`);
}

class FakeRange {
  constructor(sheet, row, column) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
  }
  getValues() {
    return [[...this.sheet.headers]];
  }
  setValue(value) {
    this.sheet.writes.push({ row: this.row, column: this.column, value });
    return this;
  }
}

class FakeSheet {
  constructor(headers) {
    this.headers = [...headers];
    this.appended = [];
    this.writes = [];
  }
  getLastColumn() {
    return this.headers.length;
  }
  getRange(row, column) {
    return new FakeRange(this, row, column);
  }
  appendRow(row) {
    this.appended.push([...row]);
  }
}

function buildContext(reorderSheet) {
  const costUpdates = [];
  const context = {
    console,
    Array,
    Date,
    Set,
    String,
    SHEET_REORDER_HISTORY: 'reorder_history',
    REQUIRED_HEADERS_REORDER,
    Utilities: { getUuid: () => 'REORDER-ID-1' },
    getSheetByName_: () => reorderSheet,
    updateProductCurrentLandedCost: (productId, cost) => {
      costUpdates.push({ productId, cost });
    }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(coreSource, 'buildRowFromHeaders_'), context);
  vm.runInContext(extractFunction(coreSource, 'addReorderRecord'), context);
  return { context, costUpdates };
}

function sampleInput() {
  return {
    sku: 'GG-TRPZ-GC0U',
    order_date: '2026-07-23',
    quantity: 50,
    landed_cost_actual: 5940,
    expected_arrival_date: '',
    notes: '[DOMESTIC:DOMESTIC-ID-1]'
  };
}

function rowObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
}

// 現行本番と同じ「skuが末尾」の物理列順でも、値をヘッダー名で配置する。
{
  const headers = [
    'id', 'product_id', 'order_date', 'quantity', 'unit_price_1688',
    'landed_cost_actual', 'lead_time_days', 'expected_arrival_date',
    'fba_fee_at_order', 'selling_price_at_order', 'notes', 'created_at', 'sku'
  ];
  const sheet = new FakeSheet(headers);
  const { context, costUpdates } = buildContext(sheet);
  const result = context.addReorderRecord('PRODUCT-ID-1', sampleInput());
  const saved = rowObject(headers, sheet.appended[0]);

  assert.equal(result.id, 'REORDER-ID-1');
  assert.equal(saved.id, 'REORDER-ID-1');
  assert.equal(saved.product_id, 'PRODUCT-ID-1');
  assert.equal(saved.order_date, '2026-07-23');
  assert.equal(saved.quantity, 50);
  assert.equal(saved.landed_cost_actual, 5940);
  assert.equal(saved.notes, '[DOMESTIC:DOMESTIC-ID-1]');
  assert.equal(saved.sku, 'GG-TRPZ-GC0U');
  assert.match(saved.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(costUpdates, [{ productId: 'PRODUCT-ID-1', cost: 5940 }]);
}

// 定義上の標準列順も従来どおり保存できる。
{
  const sheet = new FakeSheet(REQUIRED_HEADERS_REORDER);
  const { context } = buildContext(sheet);
  context.addReorderRecord('PRODUCT-ID-1', sampleInput());
  const saved = rowObject(REQUIRED_HEADERS_REORDER, sheet.appended[0]);
  assert.equal(saved.sku, 'GG-TRPZ-GC0U');
  assert.equal(saved.order_date, '2026-07-23');
  assert.equal(saved.landed_cost_actual, 5940);
}

// 任意の追加列が途中にあっても、既存値をずらさず追加列は空欄にする。
{
  const headers = [...REQUIRED_HEADERS_REORDER];
  headers.splice(5, 0, 'legacy_comment');
  const sheet = new FakeSheet(headers);
  const { context } = buildContext(sheet);
  context.addReorderRecord('PRODUCT-ID-1', sampleInput());
  const saved = rowObject(headers, sheet.appended[0]);
  assert.equal(saved.legacy_comment, '');
  assert.equal(saved.quantity, 50);
  assert.equal(saved.landed_cost_actual, 5940);
}

// 欠損・重複ヘッダーは不正行を追加せず、現在原価も更新しない。
{
  const missingSheet = new FakeSheet(
    REQUIRED_HEADERS_REORDER.filter(header => header !== 'sku')
  );
  const missing = buildContext(missingSheet);
  assert.throws(
    () => missing.context.addReorderRecord('PRODUCT-ID-1', sampleInput()),
    /required headers missing: sku/
  );
  assert.equal(missingSheet.appended.length, 0);
  assert.equal(missing.costUpdates.length, 0);

  const duplicateSheet = new FakeSheet([
    ...REQUIRED_HEADERS_REORDER,
    'notes'
  ]);
  const duplicate = buildContext(duplicateSheet);
  assert.throws(
    () => duplicate.context.addReorderRecord('PRODUCT-ID-1', sampleInput()),
    /duplicate headers: notes/
  );
  assert.equal(duplicateSheet.appended.length, 0);
  assert.equal(duplicate.costUpdates.length, 0);
}

// 国内仕入れの入荷確定から同じ安全な書き込み経路を通ることを確認する。
{
  const reorderHeaders = [
    'id', 'product_id', 'order_date', 'quantity', 'unit_price_1688',
    'landed_cost_actual', 'lead_time_days', 'expected_arrival_date',
    'fba_fee_at_order', 'selling_price_at_order', 'notes', 'created_at', 'sku'
  ];
  const reorderSheet = new FakeSheet(reorderHeaders);
  const domesticHeaders = [
    'id', 'actual_arrival_date', 'status', 'reorder_record_id', 'updated_at'
  ];
  const domesticSheet = new FakeSheet(domesticHeaders);
  const current = {
    __rowNumber: 2,
    id: 'DOMESTIC-ID-1',
    product_id: 'PRODUCT-ID-1',
    sku: 'GG-TRPZ-GC0U',
    supplier: '',
    order_number: '',
    quantity: 50,
    landed_cost_per_unit: 5940,
    expected_arrival_date: '',
    notes: '',
    status: 'pending',
    reorder_record_id: ''
  };
  const { context } = buildContext(reorderSheet);
  Object.assign(context, {
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        releaseLock: () => {}
      })
    },
    getDomesticOrderSheet_: () => domesticSheet,
    domesticObjects_: () => [current],
    domesticDate_: value => String(value || '').slice(0, 10),
    domesticText_: value => String(value == null ? '' : value).trim(),
    domesticNumber_: value => Number(value) || 0,
    findDomesticReorderMarker_: () => '',
    getHeaders_: () => domesticHeaders,
    REQUIRED_HEADERS_DOMESTIC_ORDERS: domesticHeaders
  });
  vm.runInContext(extractFunction(domesticSource, 'receiveDomesticOrder_'), context);

  const result = context.receiveDomesticOrder_('DOMESTIC-ID-1', '2026-07-23');
  const saved = rowObject(reorderHeaders, reorderSheet.appended[0]);
  assert.equal(result.reorder_record_id, 'REORDER-ID-1');
  assert.equal(saved.order_date, '2026-07-23');
  assert.equal(saved.quantity, 50);
  assert.equal(saved.landed_cost_actual, 5940);
  assert.equal(saved.sku, 'GG-TRPZ-GC0U');
  assert.equal(saved.notes, '[DOMESTIC:DOMESTIC-ID-1]');
}

// 仮登録の編集はreorder_historyへ直接書き込まない契約を維持する。
{
  const updateSource = extractFunction(domesticSource, 'updateDomesticOrder_');
  assert.ok(!updateSource.includes('addReorderRecord'));
  assert.ok(!updateSource.includes('SHEET_REORDER_HISTORY'));
}

console.log('domestic order reorder write tests passed');
