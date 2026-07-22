/** amazon-listing-page.skill を交換可能なGeminiプロンプトパックとして扱う。 */
const PAGE_SKILL_PROP_FILE_ID = 'PAGE_SKILL_ACTIVE_FILE_ID';
const PAGE_SKILL_CACHE_KEY = 'page_skill_prompt_v1';
const PAGE_SKILL_MAX_BYTES = 2 * 1024 * 1024;

function pageSkillFolder_() {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_IDが未設定です。');
  const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const found = root.getFoldersByName('page-skill-packs');
  return found.hasNext() ? found.next() : root.createFolder('page-skill-packs');
}

function pageSkillEntriesFromBlob_(blob) {
  const blobs = Utilities.unzip(blob);
  const entries = {};
  blobs.forEach(function(fileBlob) {
    const path = String(fileBlob.getName() || '').replace(/\\/g, '/');
    if (!/(^|\/)SKILL\.md$/i.test(path) && !/(^|\/)references\/[^/]+\.md$/i.test(path)) return;
    entries[path] = fileBlob.getDataAsString('UTF-8');
  });
  return entries;
}

function validatePageSkillEntries_(entries) {
  const skillPath = Object.keys(entries).find(function(path) { return /(^|\/)SKILL\.md$/i.test(path); });
  if (!skillPath) throw new Error('SKILL.mdが見つかりません。');
  const skill = String(entries[skillPath] || '');
  const front = skill.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!front) throw new Error('SKILL.mdのYAML frontmatterが不正です。');
  const name = (front[1].match(/^name:\s*["']?([^\n"']+)/m) || [])[1];
  if (String(name || '').trim() !== 'amazon-listing-page') {
    throw new Error('amazon-listing-pageスキルではありません。name=' + String(name || '(missing)'));
  }
  const totalChars = Object.keys(entries).reduce(function(sum, key) { return sum + entries[key].length; }, 0);
  if (totalChars > 120000) throw new Error('プロンプト用Markdownが大きすぎます。');
  return { name: name.trim(), skill_path: skillPath, markdown_files: Object.keys(entries).sort(), total_chars: totalChars };
}

function uploadPageSkillPack_(filename, base64) {
  filename = String(filename || '').trim();
  if (!/\.skill$/i.test(filename)) throw new Error('.skillファイルを選択してください。');
  const bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length || bytes.length > PAGE_SKILL_MAX_BYTES) throw new Error('スキルファイルのサイズが不正です。');
  const blob = Utilities.newBlob(bytes, 'application/zip', filename);
  const entries = pageSkillEntriesFromBlob_(blob);
  const validated = validatePageSkillEntries_(entries);
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  blob.setName('amazon-listing-page_' + stamp + '_' + hash.slice(0, 8) + '.skill');
  const file = pageSkillFolder_().createFile(blob);
  file.setDescription(JSON.stringify({ uploaded_at: new Date().toISOString(), hash: hash, source_name: filename, validated: validated }));
  PropertiesService.getScriptProperties().setProperty(PAGE_SKILL_PROP_FILE_ID, file.getId());
  CacheService.getScriptCache().remove(PAGE_SKILL_CACHE_KEY);
  return Object.assign({ active: true, file_id: file.getId(), file_name: file.getName(), hash: hash }, validated);
}

function getActivePageSkillPackInfo_() {
  const id = PropertiesService.getScriptProperties().getProperty(PAGE_SKILL_PROP_FILE_ID) || '';
  if (!id) return { active: false };
  try {
    const file = DriveApp.getFileById(id);
    let description = {};
    try { description = JSON.parse(file.getDescription() || '{}'); } catch (_) {}
    return { active: true, file_id: id, file_name: file.getName(), updated_at: file.getLastUpdated().toISOString(), hash: description.hash || '' };
  } catch (err) {
    return { active: false, error: String(err) };
  }
}

function getActivePageSkillPrompt_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PAGE_SKILL_CACHE_KEY);
  if (cached) return cached;
  const id = PropertiesService.getScriptProperties().getProperty(PAGE_SKILL_PROP_FILE_ID) || '';
  if (!id) return '';
  const entries = pageSkillEntriesFromBlob_(DriveApp.getFileById(id).getBlob());
  const meta = validatePageSkillEntries_(entries);
  const ordered = [meta.skill_path].concat(meta.markdown_files.filter(function(path) { return path !== meta.skill_path; }));
  const text = ordered.map(function(path) { return '\n# FILE: ' + path + '\n' + entries[path]; }).join('\n');
  if (text.length <= 90000) cache.put(PAGE_SKILL_CACHE_KEY, text, 600);
  return text;
}

/** スクショを事実へ変換する。空欄を推測で補完しない。 */
function extractPageInputsFromScreenshots_(projectData, images) {
  const p = projectData || {}, extra = p.extra_texts || {};
  const factPack = p.page_draft && p.page_draft.atlas_fact_pack ? p.page_draft.atlas_fact_pack : null;
  const prompt = `あなたはEC商品資料の入力担当です。添付スクリーンショットと既存事実から、読み取れる内容だけを構造化してください。
推測で仕様を埋めないでください。画像内に明記されていない内容はnullまたは空配列にしてください。
中国語は日本語に訳し、元表記もevidence_noteへ残してください。価格は通貨を区別してください。

仕入元URL: ${extra.supplier_url || ''}
既存仕入元メモ: ${extra.supplier_info || ''}
ATLAS事実: ${JSON.stringify(factPack || {})}

JSONのみで返してください:
{
  "supplier":{"url":"","title":"","unit_price_cny":null,"material":"","dimensions":{},"package_contents":[],"variations":[],"claims":[]},
  "selected_offer":{"planned_price":null,"selected_variations":[]},
  "competitors":[],
  "regulatory_candidates":[],
  "confirmed_facts":[],
  "unknown_fields":[],
  "evidence":[{"field":"","value":"","source_image":1,"confidence":"high|medium|low","evidence_note":""}]
}`;
  const parts = [];
  (images || []).forEach(function(img, idx) {
    if (!img || !img.base64) return;
    parts.push({ text: '【仕入元・競合スクリーンショット' + (idx + 1) + '】' });
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.base64 } });
  });
  if (!parts.length) throw new Error('解析するスクリーンショットを追加してください。');
  parts.push({ text: prompt });
  const raw = callGeminiWithRetry({ contents: [{ parts: parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' } });
  const api = JSON.parse(raw);
  if (!api.candidates || !api.candidates.length) throw new Error('Geminiの回答が空です。');
  const result = extractJson_(api.candidates[0].content.parts[0].text);
  result._meta = { extracted_at: new Date().toISOString(), generated_by: GEMINI_MODEL, review_status: 'needs-human-review' };
  return result;
}
