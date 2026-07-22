const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Date, Object, Math, String, Number, JSON, isNaN, isFinite };
vm.createContext(context);
vm.runInContext(fs.readFileSync('原価_在庫/cost_sim_actualize.js', 'utf8'), context);

const parsed = vm.runInContext("csaParseJsonObject_('{\"price\":3000,\"cost\":800,\"custom\":\"keep\"}')", context);
assert.strictEqual(parsed.price, 3000);
assert.strictEqual(parsed.custom, 'keep');

const legacy = vm.runInContext("csaParseJsonObject_('{price=3000.0, cost=800.0}')", context);
assert.strictEqual(legacy.price, 3000);
assert.strictEqual(legacy.cost, 800);

const result = vm.runInContext(`csaRecalculateProfit_({
  price: 3000, cost: 800, rakumart: 100, shipping: 200,
  amazon: 300, fba: 400, ad: 150, other: 50, custom: 'keep'
})`, context);
assert.strictEqual(result.net, 1000);
assert.strictEqual(result.rate, 33.3);
assert.strictEqual(result.custom, 'keep');

console.log('cost_sim_actualize_test: OK');
