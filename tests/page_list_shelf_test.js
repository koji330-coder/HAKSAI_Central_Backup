const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const core = fs.readFileSync('コア/コード.js', 'utf8');
const html = fs.readFileSync('_github_HAKSAI-Central/index.html', 'utf8');

function functionSource(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' not found');
  let depth = 0, opened = false;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') { depth++; opened = true; }
    if (text[i] === '}') depth--;
    if (opened && depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(name + ' incomplete');
}

let project = {
  id:'p1', source_card_id:'c1', status:'素材追加中', title:'商品', shelf_state:'',
  extracted_input:{evidence:[{field:'material',value:'steel'}]},
  listing_handoff:{ready:true,confirmed_facts:[{field:'material',value:'steel'}]},
  page_draft:{concept:'concept'}
};
const events = [];
const ctx = {
  getAllPageProjects: () => [JSON.parse(JSON.stringify(project))],
  updatePageProjectInSheet: p => { project = JSON.parse(JSON.stringify(p)); return true; },
  logPageProjectEvent_: (id,source,type,reason,payload,actor) => { events.push({id,source,type,reason,payload,actor}); },
  getPageProjectEvents_: () => events.map(e => ({page_project_id:e.id,event_type:e.type,payload:e.payload||{},created_at:new Date().toISOString()})),
  Date, Math
};
vm.createContext(ctx);
vm.runInContext(functionSource(core, 'shelvePageProject_'), ctx);
vm.runInContext(functionSource(core, 'wakePageProject_'), ctx);

ctx.shelvePageProject_('p1', '季節待ち', '2026-08-11T00:00:00.000Z');
assert.strictEqual(project.shelf_state, 'shelved');
assert.strictEqual(project.status, '素材追加中');
assert.strictEqual(project.page_draft.concept, 'concept');
assert.strictEqual(project.listing_handoff.ready, true);
assert.strictEqual(events[0].type, 'shelved');

ctx.wakePageProject_('p1', 'extend', '2026-09-11T00:00:00.000Z');
assert.strictEqual(project.shelf_state, 'shelved');
assert.strictEqual(events[1].type, 'shelf_extended');
assert.strictEqual(events[1].payload.extend_count, 1);

ctx.wakePageProject_('p1', 'manual', '');
assert.strictEqual(project.shelf_state, '');
assert.strictEqual(project.status, '素材追加中');
assert.strictEqual(events[2].type, 'woke_manual');

const ui = {};
vm.createContext(ui);
vm.runInContext(functionSource(html, 'getPageEffortMeta_'), ui);
assert.strictEqual(ui.getPageEffortMeta_({}, {nextAction:{type:'adopt_extracted_input'}}, false).key, 'one_tap');
assert.strictEqual(ui.getPageEffortMeta_({}, {nextAction:{type:'generate_draft'}}, false).key, 'ai');
assert.strictEqual(ui.getPageEffortMeta_({}, {nextAction:{type:'review_draft'}}, false).key, 'finish');
assert.strictEqual(ui.getPageEffortMeta_({}, {nextAction:{type:'connect_own_asin'}}, false).key, 'finish');
assert.strictEqual(ui.getPageEffortMeta_({}, {nextAction:{type:'add_screenshots'}}, false).key, 'materials');
assert.strictEqual(ui.getPageEffortMeta_({}, {nextAction:{type:'add_screenshots'}}, true).key, 'welcome');

assert(core.includes("'shelf_state', 'shelved_at', 'wake_at', 'shelf_reason'"));
assert(core.includes("action === 'shelvePageProject'"));
assert(core.includes("action === 'wakePageProject'"));
assert(core.includes("SHEET_PAGE_EVENTS = 'page_project_events'"));
assert(html.includes('page-group-title'));
assert(html.includes('page-shelf-wrap'));
assert(html.includes('page-momentum'));

console.log('page_list_shelf_test: ok');
