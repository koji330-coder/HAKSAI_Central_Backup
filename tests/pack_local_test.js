const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const now = new Date();
const recent = new Date(now.getTime() - 5 * 864e5);
const main = {
  sku_master: [['sku', 'product_name'], ['SKU1', '商品1']],
  transaction_history: [
    ['order_id', 'transaction_type', 'date', 'sku', 'asin', 'qty', 'sales_taxin', 'fee', 'fba_fee'],
    ['ORDER1', ' 注文 ', recent, 'SKU1', 'B000000001', 2, 4000, -400, -600]
  ],
  reorder_history: [
    ['sku', 'order_date', 'unit_price_1688', 'landed_cost_actual'],
    ['SKU1', recent, 48, 1760]
  ],
  product_lifecycle: [
    ['asin', 'title', 'category', 'price', 'current_landed_cost', 'status', 'source', 'urls', 'keepa_data'],
    ['B000000001', '候補商品', 'カテゴリ', 2000, 800, 'research', 'ATLAS_SOURCING_DECISION',
      JSON.stringify(['https://keepa.com/#!product/5-B000000001']),
      JSON.stringify({
        product_facts:{ title:'候補商品', price:2000, monthly_sold:100 },
        page_facts:{ image_count:7, has_aplus:true },
        market_facts:{ total_offer_count:5, fba_offer_count:3 },
        decision_screen:{ pipeline:'sourcing-decision', result:'PASS' }
      })]
  ]
};
const report = {
  business_report_period: [
    ['period_key', 'asin', 'title', 'sessions', 'page_views', 'unit_session_rate', 'ordered_units', 'ordered_sales'],
    ['2026-06', 'B000000001', '商品1', 100, 120, 12.5, 10, 20000],
    ['2026-07', 'B000000001', '商品1', 120, 140, 0.15, 18, 36000]
  ],
  ad_product_daily: [
    ['date', 'asin', 'impressions', 'clicks', 'spend', 'sales', 'units'],
    [recent, 'B000000001', 1000, 20, 1000, 5000, 4]
  ],
  inventory_snapshot: [
    ['snapshot_date', 'asin', 'available', 'inbound', 'days_remain', 'alert'],
    [recent, 'B000000001', 20, 5, 30, '']
  ]
};

function spreadsheet(data) {
  return {
    getSheetByName(name) {
      const rows = data[name];
      if (!rows) return null;
      return {
        getLastRow: () => rows.length,
        getDataRange: () => ({ getValues: () => rows })
      };
    }
  };
}

const context = {
  console,
  Date,
  Set,
  Object,
  Math,
  String,
  Number,
  isNaN,
  getSpreadsheet_: () => spreadsheet(main),
  getReportSpreadsheet_: () => spreadsheet(report),
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
  Logger: { log() {} },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: text => ({ setMimeType: () => text })
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('sourcing_decision_pack.gs', 'utf8'), context);
vm.runInContext(fs.readFileSync('listing_audit_pack.gs', 'utf8'), context);

const decision = vm.runInContext("buildDecisionPack('B000000001')", context);
assert.strictEqual(vm.runInContext("dpDate_('2026/04/01 0:02:47 JST').getHours()", context), 0);
assert.strictEqual(decision.yen_per_cny_composite_median, 36.67);
assert.strictEqual(decision.fee_table[0].fee_rate_taxin, 0.1);
assert.strictEqual(decision.fee_table[0].fba_fee_unit, 300);
assert.strictEqual(decision.fee_table[0].orders_90d, 1);
assert.strictEqual(decision.fee_table[0].transaction_lines_90d, 1);
assert.strictEqual(decision.fee_table[0].units_90d, 2);
assert.strictEqual(decision.candidate.asin, 'B000000001');
assert.strictEqual(decision.own_baseline[0].cvr, 0.15);

const audit = vm.runInContext("buildAuditPack('')", context);
assert.strictEqual(vm.runInContext("apDate_('2026/04/01 0:02:47 JST').getSeconds()", context), 47);
assert.strictEqual(audit.asin_count, 1);
assert.strictEqual(audit.cvr_baseline_median, 0.15);
assert.strictEqual(audit.audit_table[0].prev.cvr, 0.125);
assert.strictEqual(audit.audit_table[0].unit_margin, 700);
assert.strictEqual(audit.audit_table[0].ad_30d.acos, 0.2);
console.log('pack_local_test: OK');
