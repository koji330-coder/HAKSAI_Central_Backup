const assert = require('assert');
const fs = require('fs');

const core = fs.readFileSync('コア/コード.js', 'utf8');
const pack = fs.readFileSync('page_skill_pack.gs', 'utf8');
const ui = fs.readFileSync('_github_HAKSAI-Central/index.html', 'utf8');

assert(pack.includes("name || '').trim() !== 'amazon-listing-page'"), 'skill name validation missing');
assert(pack.includes('PAGE_SKILL_MAX_BYTES'), 'skill upload size guard missing');
assert(pack.includes('needs-human-review'), 'screenshot extraction must require human review');
assert(pack.includes('推測で仕様を埋めないでください'), 'extraction anti-hallucination rule missing');

assert(core.includes("action === 'uploadPageSkillPack'"), 'skill upload endpoint missing');
assert(core.includes("action === 'extractPageInputs'"), 'screenshot extraction endpoint missing');
assert(core.includes('Object.assign({}, projectData.page_draft || {}, draft)'), 'page draft must preserve fact pack');
assert(core.includes("const allowed = new Set(["), 'ATLAS upsert must use an explicit field allowlist');
assert(core.includes('getActivePageSkillPrompt_()'), 'active skill is not included in generation');
assert(core.includes("calculated_by: 'central-deterministic-checks'"), 'deterministic submission checks missing');
assert(core.includes("'extracted_input', 'extraction_meta', 'prompt_pack_meta'"), 'page project schema missing');

assert(ui.includes('id="page-skill-file"'), 'skill upload UI missing');
assert(ui.includes('id="extractPageInputsBtn"'), 'screenshot extraction UI missing');
assert(ui.includes('HAKSAI 商品ページ制作パック'), 'GPT handoff markdown missing');
assert(ui.includes('仕入元URL'), 'supplier URL handoff missing');
assert(ui.includes('画像制作時は、仕入元URLの実物画像をGPTへ手動添付'), 'manual image handoff instruction missing');

console.log('page_skill_workflow_test: ok');
