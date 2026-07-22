const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('_github_HAKSAI-Central/index.html', 'utf8');
const sourcing = fs.readFileSync('rakumart_sourcing.gs', 'utf8');
const core = fs.readFileSync('コア/コード.js', 'utf8');

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

const uiContext = {
  safeObject: v => v && typeof v === 'object' && !Array.isArray(v) ? v : {},
  safeArray: v => Array.isArray(v) ? v : []
};
vm.createContext(uiContext);
vm.runInContext(functionSource(html, 'buildMaikaPageGuide_'), uiContext);
vm.runInContext(functionSource(html, 'derivePageProductionProgress'), uiContext);

const blocked = uiContext.derivePageProductionProgress({
  id: 'p1', source_card_id: 'atlas_x', tags: ['ATLAS'], sourcing_state: 'needs_search_brief',
  extra_texts: { supplier_url: 'https://example.com/item' }, extra_image_ids: ['1','2'],
  extracted_input: { _meta: { extracted_at: 'now' }, evidence: [
    { field: 'material', value: 'ステンレス', source_image: 1, confidence: 'high' }
  ] }, extraction_meta: { extracted_at: 'now' }, listing_handoff: {}, page_draft: {}
}, {});
assert.strictEqual(blocked.gated, true);
assert.strictEqual(blocked.nextAction.type, 'adopt_extracted_input');

const ready = uiContext.derivePageProductionProgress({
  tags: ['ATLAS'], extra_texts: { supplier_url: 'https://example.com/item' }, extra_image_ids: ['1'],
  extracted_input: { _meta: {}, confirmed_facts: [{ field: 'size', value: '25cm' }] },
  listing_handoff: { ready: true, confirmed_facts: [{ field: 'size', value: '25cm' }] },
  adopted_candidate_id: 'extracted:p1', sourcing_state: 'supplier_adopted', page_draft: {}
}, {});
assert.strictEqual(ready.gated, false);
assert.strictEqual(ready.nextAction.type, 'generate_draft');

const nonAtlas = uiContext.derivePageProductionProgress({
  tags: [], sourcing_state: 'needs_search_brief', extra_texts: {}, extra_image_ids: [], page_draft: {}
}, {});
assert.strictEqual(nonAtlas.gated, false);

const completed = uiContext.derivePageProductionProgress({
  status: 'ページ案完成', tags: ['ATLAS'], extra_texts: {supplier_url:'https://example.com'},
  extra_image_ids:['1'], extracted_input:{_meta:{},confirmed_facts:[{field:'size',value:'25cm'}]},
  listing_handoff:{ready:true,confirmed_facts:[{field:'size',value:'25cm'}]},
  adopted_candidate_id:'extracted:p2', sourcing_state:'supplier_adopted', page_draft:{concept:'done'}, own_listing:{}
}, {});
assert.strictEqual(completed.nextAction.type, 'connect_own_asin');

let savedProject = null;
const sourceProject = {
  id: 'p1', source_card_id: '', tags: ['ATLAS'], extra_texts: {}, extra_image_ids: ['img1'],
  extracted_input: { _meta: { extracted_at: 'now' }, supplier: { title: '候補' }, evidence: [
    { field: 'material', value: 'ステンレス', source_image: 1, confidence: 'high' },
    { field: '', value: '推定', source_image: null }
  ], inferred_facts: [{ field: 'waterproof', value: true }], unknown_fields: ['MOQ'] },
  extraction_meta: { extracted_at: 'now' }, sourcing_brief: {}
};
const serverContext = {
  getAllPageProjects: () => [JSON.parse(JSON.stringify(sourceProject))],
  calculateRoughProfit_: () => null,
  updatePageProjectInSheet: p => { savedProject = p; return true; },
  getCardDetail_ProductLifecycle: () => null,
  updateCardInLifecycle: () => true,
  Logger: { log() {} }, Date
};
vm.createContext(serverContext);
vm.runInContext(functionSource(sourcing, 'adoptExtractedInputAsSupplier_'), serverContext);
const adopted = serverContext.adoptExtractedInputAsSupplier_('p1', 'https://example.com/item');
assert.strictEqual(adopted.ready, true);
assert.strictEqual(savedProject.listing_handoff.confirmed_facts.length, 1);
assert.strictEqual(savedProject.listing_handoff.confirmed_facts[0].field, 'material');
assert.strictEqual(savedProject.listing_handoff.claim_guard.prohibited_claims[0], 'MOQ');
assert.strictEqual(savedProject.adopted_candidate_id, 'extracted:p1');

assert(core.includes("action === 'adoptExtractedInputAsSupplier'"));
assert(core.includes('const storedProject = getAllPageProjects()'));
assert(!core.includes("String(p.sourcing_state || '') === 'needs_search_brief'"));
assert(html.includes('src="maica-avatar.svg"'));
assert.strictEqual((html.match(/const noOverlayCloseModals =/g) || []).length, 1);
assert(!functionSource(html, 'secretaryToolButtons_').includes('addEventListener'));
assert(html.includes("genBtn.classList.remove('btn-primary')"));

console.log('page_production_ux_test: ok');
