const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const core = fs.readFileSync('コア/コード.js', 'utf8');
const html = fs.readFileSync('_github_HAKSAI-Central/index.html', 'utf8');
const feedback = fs.readFileSync('listing_feedback.gs', 'utf8');
const debug = fs.readFileSync('デバッグ_保守/デバッグ.js', 'utf8');

function functionSource(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' not found');
  let depth = 0, opened = false;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') { depth++; opened = true; }
    if (text[i] === '}') depth--;
    if (opened && depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(name + ' source is incomplete');
}

const server = { Set, Array, JSON, String, Number, Date, Math, isFinite };
vm.createContext(server);
['normalizeOwnListingObject_','hasOwnAsin_','isGraduated_','resolveSaleStartDate_','buildActualPack_']
  .forEach(name => vm.runInContext(functionSource(core, name), server));
vm.runInContext(functionSource(core, 'legacyOriginTypeFromSource_'), server);

assert.strictEqual(server.hasOwnAsin_(JSON.stringify({primary_asin:'b012345678'})), true);
assert.strictEqual(server.isGraduated_({origin_type:'import',is_launched:true,own_listing:{primary_asin:'B012345678'}}, null), false);
assert.strictEqual(server.isGraduated_({origin_type:'research',is_launched:true,own_listing:{}}, {own_listing:{child_asins:['B012345678']}}), true);
assert.strictEqual(server.isGraduated_({origin_type:'research',is_launched:true,asin:'COMPETE001'}, null), false);
assert.strictEqual(server.legacyOriginTypeFromSource_('csv_import'), 'import');
assert.strictEqual(server.legacyOriginTypeFromSource_(''), 'import');
assert.strictEqual(server.legacyOriginTypeFromSource_('Amazon'), 'research');

const actual = server.buildActualPack_({sales_actual:[
  {period:'2026-03',qty:3,sales_taxin:3000,gross_profit:900},
  {period:'2026-01',qty:1,sales_taxin:800,gross_profit:null},
  {period:'2026-04',qty:0,sales_taxin:0,gross_profit:null},
  {period:'2026-02',qty:2,sales_taxin:1800,gross_profit:400}
]});
assert.deepStrictEqual(Array.from(actual.periods), ['2026-02','2026-03','2026-04']);
assert.strictEqual(actual.price, 960);
assert.strictEqual(actual.monthly_sales, 5 / 3);
assert.strictEqual(Math.round(actual.profit_rate * 1000), 271);

// --- New Tests for verification_fix_brief_antigravity ---
// Setup specific current date for testing (2026-07-12)
const originalDateNow = Date.now;
const originalDate = Date;
// Mock global Date/now for context
server.Date = function(...args) {
  if (args.length === 0) return new originalDate('2026-07-12T15:00:00+09:00');
  return new originalDate(...args);
};
server.Date.now = () => new originalDate('2026-07-12T15:00:00+09:00').getTime();
server.Date.UTC = originalDate.UTC;
server.Date.parse = originalDate.parse;

// Test Case 1: Start month only (current month only, completed month = 0) -> provisional speed-read
const testCard1 = {
  own_listing: { primary_asin: 'B0TEST0001', connected_at: '2026-07-01T00:00:00+09:00' },
  sales_actual: [
    { period: '2026-07', qty: 12, sales_taxin: 12000, gross_profit: 3000 }
  ]
};
const res1 = server.buildActualPack_(testCard1);
assert.strictEqual(res1.provisional, true);
// 12 qty * 31 days / 12 days passed = 31 expected qty
assert.strictEqual(Math.round(res1.monthly_sales), 31);
assert.strictEqual(res1.basis[0].prorated, true);

// Test Case 2: Partial start month + 1 completed month + current month
// May is partial start (started May 22, 10 days remaining of 31 days). June is completed. July is current.
const testCard2 = {
  own_listing: { primary_asin: 'B0TEST0002', connected_at: '2026-05-22T00:00:00+09:00' },
  sales_actual: [
    { period: '2026-05', qty: 10, sales_taxin: 10000, gross_profit: 2000 },
    { period: '2026-06', qty: 24, sales_taxin: 24000, gross_profit: 4800 },
    { period: '2026-07', qty: 9, sales_taxin: 9000, gross_profit: 1800 }
  ]
};
const res2 = server.buildActualPack_(testCard2);
assert.strictEqual(res2.provisional, false);
// July is current month (excluded). May is partial start month and we have another completed month (June), so May is excluded.
// Only June is used.
assert.deepStrictEqual(Array.from(res2.periods), ['2026-06']);
assert.strictEqual(res2.monthly_sales, 24);
assert.strictEqual(res2.basis.find(b => b.period === '2026-05').excluded, true);

// Test Case 3: Partial start month is the only completed month + current month
// June is partial start (started June 21, 10 days remaining of 30 days). July is current (excluded).
const testCard3 = {
  own_listing: { primary_asin: 'B0TEST0003', connected_at: '2026-06-21T00:00:00+09:00' },
  sales_actual: [
    { period: '2026-06', qty: 10, sales_taxin: 10000, gross_profit: 2000 },
    { period: '2026-07', qty: 9, sales_taxin: 9000, gross_profit: 1800 }
  ]
};
const res3 = server.buildActualPack_(testCard3);
assert.strictEqual(res3.provisional, false);
// Only June is used, but since it is partial and the only completed month, it is prorated.
// 10 qty * 30 days / 10 days remaining = 30 expected qty
assert.strictEqual(Math.round(res3.monthly_sales), 30);
assert.strictEqual(res3.basis[0].prorated, true);

// Restore original Date
server.Date = originalDate;

const observing = server.resolveSaleStartDate_({sales_actual:[{period:'2026-05'}]});
assert.strictEqual(observing.getFullYear(), 2026);
assert.strictEqual(observing.getMonth(), 4);

assert(core.includes("'own_listing', 'origin_type'"));
assert(core.includes("action === 'getResearchLessons'"));
assert(core.includes("action === 'connectOwnListing'"));
assert(core.includes("action === 'generateRetrospective'"));
assert(!core.includes("action === 'createGraduatedSeedCard'"));
assert(!core.includes('function createGraduatedSeedCard_'));
assert(core.includes("origin_type: 'import'"));
assert(!functionSource(html, 'applyDetailInputsToCurrentCard').includes('connected_at'));
assert(functionSource(html, 'validateConnectedAsins').includes('ASINリストを読み込めていません'));
assert(functionSource(html, 'getFilteredCards').includes('isGraduated_'));
assert(!html.includes('function createSeedFromLesson'));
assert(html.includes('function buildLessonLibrary_'));
assert(html.includes('横展開の参考'));
assert(feedback.includes('assertAsinsInSkuMaster_'));
assert(feedback.includes('if(!p.document_status)'));
const duplicateContext = {};
vm.createContext(duplicateContext);
vm.runInContext(functionSource(debug, 'legacyMergeNormalizeTitle_'), duplicateContext);
vm.runInContext(functionSource(debug, 'legacyMergeTitleScore_'), duplicateContext);
assert(duplicateContext.legacyMergeTitleScore_('HAKSAI ハンドベル 呼び鈴', '真鍮製ハンドベル 呼び出し用') > 0.2);
assert(debug.includes("confirmation !== 'MERGE'"));
assert(debug.includes('product_lifecycle_merge_archive'));
assert(debug.includes("plan.selling.asin=''"));

const lessonContext = {
  priceBand_: () => '500-999',
  getAllCards_ProductLifecycle: () => [{id:'c1',title:'実例商品',sales_actual:[{period:'2026-01'}]}],
  getResearchLessons_: () => [{lesson_id:'l1',card_id:'c1',verdict:'外れ',category:'ベル',price_band:'500-999',entry_thesis_tags:['価格'],own_asin:'B012345678',created_at:'2026-07-01',lessons_json:[{tag:'需要',text:'条件→帰結',applies_to:'sourcing'}],hypothesis_snapshot_json:{price:800,monthly_sales:50,profit_rate:.1},actual_snapshot_json:{price:700,monthly_sales:6,profit_rate:.2}}],
  resolveSaleStartDate_: () => new Date(Date.now()-10*86400000), PRICE_BAND_SIZE:500, Date, Math, Number, String, Array, Set, isFinite
};
vm.createContext(lessonContext);vm.runInContext(functionSource(core,'getLessonsForCandidate_'),lessonContext);
const matched=lessonContext.getLessonsForCandidate_({category:'ベル',price:700,entry_thesis_tags:['価格']});
assert.strictEqual(matched.length,1);assert(matched[0].example);assert.strictEqual(matched[0].example.hypothesis.monthly_qty,50);assert.strictEqual(matched[0].lesson.text,'条件→帰結');

console.log('graduated_tab_test: ok');
