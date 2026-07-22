const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const atlasPath = 'C:/Users/koji3/Documents/GAS/Seller-ATLAS/gas/コード.js';
const atlas = fs.readFileSync(atlasPath, 'utf8');
const central = fs.readFileSync('コア/コード.js', 'utf8');
const ui = fs.readFileSync('_github_HAKSAI-Central/index.html', 'utf8');

const start = atlas.indexOf('function buildSourcingDecisionScreen_');
const end = atlas.indexOf('\nfunction getOrFetchRichDataForHaksai_', start);
assert(start >= 0 && end > start, 'ATLAS decision screen function not found');
const context = { Date, Number, String, Array, Set };
vm.createContext(context);
vm.runInContext(atlas.slice(start, end), context);

const low = context.buildSourcingDecisionScreen_(
  { monthly_sold: 300, current_new_price: 698, image_count: 4, has_aplus: false, has_video: false, buy_box_is_amazon: false },
  { exclude_reason: '価格安すぎ' },
  { has_aplus: false, has_video: false }
);
assert.strictEqual(low.result, 'PASS_LOW_PRICE');
assert(low.reason_codes.includes('LOW_PRICE_LANE'));
assert(low.reason_codes.includes('PAGE_NO_APLUS'));
assert.strictEqual(low.final_decision, null);

const unknown = context.buildSourcingDecisionScreen_(
  { monthly_sold: null, current_new_price: null, image_count: null }, {}, {}
);
assert.strictEqual(unknown.result, 'INSUFFICIENT_DATA');
assert(unknown.missing_fields.includes('monthly_sold'));
assert(unknown.missing_fields.includes('market_price'));

const blocked = context.buildSourcingDecisionScreen_(
  { monthly_sold: 2000, current_new_price: 1600, image_count: 8, buy_box_is_amazon: true }, {}, {}
);
assert.strictEqual(blocked.result, 'BLOCKED');
assert.strictEqual(blocked.provisional_pattern, 'PATTERN_B_LARGE_MARKET');

assert(atlas.includes("action:'upsertDecisionCard'"), 'ATLAS must call the dedicated UPSERT endpoint');
assert(central.includes("action === 'upsertDecisionCard'"), 'Central endpoint missing');
assert(central.includes('decisionCardAuthOk_'), 'Central endpoint must authenticate');
assert(!central.includes('upsertDecisionCandidateProjection_'), 'legacy candidate projection must be removed');
assert(central.includes("const SHEET_PRODUCT_LIFECYCLE = 'product_lifecycle'"), 'product_lifecycle source of truth missing');
assert(ui.includes("keyword:'SourcingDecision'"), 'Central research filter missing');

console.log('atlas_decision_contract_test: ok');
