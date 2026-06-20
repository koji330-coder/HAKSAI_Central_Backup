/*************************************************
 * IdeaTagsBackfill.gs
 * HAKSAI Central / product_lifecycle 用
 * 既存のリサーチカードに後付けで idea_tags_json を付与する
 *
 * 使い方：
 * 1) スクリプトプロパティに GEMINI_API_KEY を設定
 * 2) createIdeaTagsBackfillSheet() を実行
 * 3) idea_tags_backfill シートで suggested_tags_json を確認
 * 4) 反映したい行の apply を TRUE にする
 * 5) applyIdeaTagsBackfill() を実行
 *************************************************/

const HAKSAI_PRODUCT_SHEET = 'product_lifecycle';
const HAKSAI_BACKFILL_SHEET = 'idea_tags_backfill';
const HAKSAI_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const HAKSAI_BACKFILL_LIMIT = 10; // 1回で処理する件数（多すぎるとGAS6分制限で死ぬ）

/**
 * メイン：未タグのリサーチカードを抽出し、idea_tags_json候補を作る
 */
function createIdeaTagsBackfillSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureIdeaTagsColumns_();
  var productRows = getSheetObjectsByHeader_(ss, HAKSAI_PRODUCT_SHEET);
  var backfillSheet = ensureBackfillSheet_();
  var backfillRows = getSheetObjectsByHeader_(ss, HAKSAI_BACKFILL_SHEET);

  // 既に候補シートに出した product_id は重複出力しない
  var queuedMap = {};
  backfillRows.forEach(function(row) {
    var productId = pick_(row, ['product_id']);
    if (productId) queuedMap[productId] = true;
  });

  var outputRows = [];
  var processed = 0;

  for (var i = 0; i < productRows.length; i++) {
    if (processed >= HAKSAI_BACKFILL_LIMIT) break;

    var row = productRows[i];
    var id = pick_(row, ['id']);
    var title = pick_(row, ['title']);

    if (!id || !title) continue;

    var isLaunched = normalizeBoolean_(pick_(row, ['is_launched']));
    var isDeleted = normalizeBoolean_(pick_(row, ['is_deleted']));
    var existingIdeaTags = pick_(row, ['idea_tags_json']);

    // リサーチカードだけ対象
    if (isLaunched || isDeleted) continue;

    // すでに付与済みならスキップ
    if (existingIdeaTags && String(existingIdeaTags).trim() !== '') continue;

    // すでに候補シートに出していたらスキップ
    if (queuedMap[id]) continue;

    var sourceSnapshot = buildIdeaTagSourceSnapshot_(row);

    var suggestedTagsJson = '';
    var notes = '';
    var error = '';

    try {
      var tagObj = generateIdeaTagsWithGemini_(sourceSnapshot);
      suggestedTagsJson = JSON.stringify(tagObj, null, 2);
      notes = tagObj.notes || '';
    } catch (e) {
      error = e.message || String(e);
    }

    outputRows.push([
      new Date(),                       // created_at
      id,                               // product_id
      title,                            // title
      pick_(row, ['status']),           // status
      pick_(row, ['summary']),          // summary
      stringifyForCell_(pick_(row, ['tags'])),               // existing_tags
      stringifyForCell_(pick_(row, ['supplier_keywords'])),  // supplier_keywords
      sourceSnapshot,                   // source_snapshot
      suggestedTagsJson,                // suggested_tags_json
      notes,                            // notes
      false,                            // apply
      '',                               // applied_at
      '',                               // apply_result
      error                             // error
    ]);

    processed++;
    Utilities.sleep(400); // API連打を少し落ち着かせる。人間も見習え。
  }

  if (!outputRows.length) {
  return notifyIdeaTags_('追加候補なし：未タグのリサーチカードが見つかりませんでした。');
}

  backfillSheet.getRange(
    backfillSheet.getLastRow() + 1,
    1,
    outputRows.length,
    outputRows[0].length
  ).setValues(outputRows);

  return notifyIdeaTags_(
  'idea_tags_backfill に ' + outputRows.length + '件の候補を追加しました。'
);
}

/**
 * 候補シートで apply=TRUE の行を product_lifecycle.idea_tags_json に反映
 */
function applyIdeaTagsBackfill() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 必要列を必ず先に整える
  ensureIdeaTagsColumns_();
  var backfillSheet = ensureBackfillSheet_();

  var productSheet = ss.getSheetByName(HAKSAI_PRODUCT_SHEET);
  if (!productSheet) throw new Error('product_lifecycle シートが見つかりません。');
  if (!backfillSheet) throw new Error('idea_tags_backfill シートが見つかりません。');

  var productData = productSheet.getDataRange().getValues();
  var productHeaders = productData[0].map(function(v) {
    return String(v || '').trim();
  });

  var backfillData = backfillSheet.getDataRange().getValues();
  var backfillHeaders = backfillData[0].map(function(v) {
    return String(v || '').trim();
  });

  var pMap = headerMap_(productHeaders);
  var bMap = headerMap_(backfillHeaders);

  // 必須列チェック。ここで明示的に落とす。GASの謎エラーに殴らせない。
  var pCol = {
    id: requireColumn_(pMap, 'id', HAKSAI_PRODUCT_SHEET),
    idea_tags_json: requireColumn_(pMap, 'idea_tags_json', HAKSAI_PRODUCT_SHEET),
    idea_tags_updated_at: requireColumn_(pMap, 'idea_tags_updated_at', HAKSAI_PRODUCT_SHEET),
    idea_tags_source: requireColumn_(pMap, 'idea_tags_source', HAKSAI_PRODUCT_SHEET)
  };

  var bCol = {
    product_id: requireColumn_(bMap, 'product_id', HAKSAI_BACKFILL_SHEET),
    suggested_tags_json: requireColumn_(bMap, 'suggested_tags_json', HAKSAI_BACKFILL_SHEET),
    apply: requireColumn_(bMap, 'apply', HAKSAI_BACKFILL_SHEET),
    applied_at: requireColumn_(bMap, 'applied_at', HAKSAI_BACKFILL_SHEET),
    apply_result: requireColumn_(bMap, 'apply_result', HAKSAI_BACKFILL_SHEET)
  };

  var productIdToRow = {};

  for (var i = 1; i < productData.length; i++) {
    var pid = String(productData[i][pCol.id] || '').trim();
    if (pid) productIdToRow[pid] = i + 1; // シート上の行番号
  }

  var appliedCount = 0;
  var skippedCount = 0;

  for (var r = 1; r < backfillData.length; r++) {
    var applyVal = backfillData[r][bCol.apply];
    var appliedAt = backfillData[r][bCol.applied_at];
    var productId = String(backfillData[r][bCol.product_id] || '').trim();
    var suggestedJson = String(backfillData[r][bCol.suggested_tags_json] || '').trim();

    if (!normalizeBoolean_(applyVal)) {
      skippedCount++;
      continue;
    }

    if (appliedAt && String(appliedAt).trim() !== '') {
      skippedCount++;
      continue;
    }

    if (!productId) {
      backfillSheet.getRange(r + 1, bCol.apply_result + 1).setValue('product_id が空');
      backfillSheet.getRange(r + 1, bCol.applied_at + 1).setValue(new Date());
      skippedCount++;
      continue;
    }

    if (!suggestedJson) {
      backfillSheet.getRange(r + 1, bCol.apply_result + 1).setValue('suggested_tags_json が空');
      backfillSheet.getRange(r + 1, bCol.applied_at + 1).setValue(new Date());
      skippedCount++;
      continue;
    }

    var targetRow = productIdToRow[productId];

    if (!targetRow) {
      backfillSheet.getRange(r + 1, bCol.apply_result + 1).setValue('product_lifecycle に該当IDなし');
      backfillSheet.getRange(r + 1, bCol.applied_at + 1).setValue(new Date());
      skippedCount++;
      continue;
    }

    var parsed;

    try {
      parsed = sanitizeIdeaTagsObject_(JSON.parse(suggestedJson));
    } catch (e) {
      backfillSheet.getRange(r + 1, bCol.apply_result + 1).setValue('JSON不正: ' + e.message);
      backfillSheet.getRange(r + 1, bCol.applied_at + 1).setValue(new Date());
      skippedCount++;
      continue;
    }

    productSheet.getRange(targetRow, pCol.idea_tags_json + 1)
      .setValue(JSON.stringify(parsed, null, 2));

    productSheet.getRange(targetRow, pCol.idea_tags_updated_at + 1)
      .setValue(new Date());

    productSheet.getRange(targetRow, pCol.idea_tags_source + 1)
      .setValue('backfill_gemini');

    backfillSheet.getRange(r + 1, bCol.apply_result + 1).setValue('OK');
    backfillSheet.getRange(r + 1, bCol.applied_at + 1).setValue(new Date());

    appliedCount++;
  }

  return notifyIdeaTags_(
    '反映完了: ' + appliedCount + '件 / スキップ: ' + skippedCount + '件'
  );
}

/**
 * product_lifecycle に必要列を追加
 */
function ensureBackfillSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HAKSAI_BACKFILL_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(HAKSAI_BACKFILL_SHEET);
  }

  var headers = [
    'created_at',
    'product_id',
    'title',
    'status',
    'summary',
    'existing_tags',
    'supplier_keywords',
    'source_snapshot',
    'suggested_tags_json',
    'notes',
    'apply',
    'applied_at',
    'apply_result',
    'error'
  ];

  // 完全空シートの場合
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) {
      return String(v || '').trim();
    });

  // ヘッダー行が空っぽの場合
  var hasAnyHeader = currentHeaders.some(function(h) {
    return h !== '';
  });

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  headers.forEach(function(h) {
    if (currentHeaders.indexOf(h) === -1) {
      var insertAfter = sheet.getLastColumn();
      sheet.insertColumnAfter(insertAfter);
      sheet.getRange(1, insertAfter + 1).setValue(h);
    }
  });

  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * 候補シートを用意
 */
function ensureIdeaTagsColumns_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HAKSAI_PRODUCT_SHEET);
  if (!sheet) throw new Error('product_lifecycle シートが見つかりません。');

  var required = [
    'idea_tags_json',
    'idea_tags_updated_at',
    'idea_tags_source'
  ];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) {
      return String(v || '').trim();
    });

  required.forEach(function(colName) {
    if (headers.indexOf(colName) !== -1) return;

    var newCol = sheet.getLastColumn() + 1;

    if (newCol > sheet.getMaxColumns()) {
      sheet.insertColumnAfter(sheet.getMaxColumns());
    }

    sheet.getRange(1, newCol).setValue(colName);
    headers.push(colName);
  });
}

/**
 * リサーチカードから、AIタグ付けに使う情報を1つのテキストにまとめる
 */
function buildIdeaTagSourceSnapshot_(row) {
  var tags = toArray_(pick_(row, ['tags']));
  var supplierKeywords = toArray_(pick_(row, ['supplier_keywords']));
  var audit = toObject_(pick_(row, ['audit']));
  var produce = toObject_(pick_(row, ['produce']));
  var checks = toArrayOfAnything_(pick_(row, ['checks']));
  var researchTasks = toArrayOfAnything_(pick_(row, ['research_tasks']));

  var lines = [];

  lines.push('【基本情報】');
  lines.push('ID: ' + pick_(row, ['id']));
  lines.push('商品名: ' + pick_(row, ['title']));
  lines.push('ステータス: ' + pick_(row, ['status']));
  lines.push('サマリー: ' + pick_(row, ['summary']));
  lines.push('カテゴリ: ' + pick_(row, ['category']));
  lines.push('メモ: ' + firstNonEmpty_([
    pick_(row, ['memo']),
    pick_(row, ['note']),
    pick_(row, ['selling_memo'])
  ]));

  lines.push('');
  lines.push('【既存タグ情報】');
  lines.push('tags: ' + tags.join(', '));
  lines.push('supplier_keywords: ' + supplierKeywords.join(', '));

  lines.push('');
  lines.push('【監査・分析】');
  lines.push('audit.commentary: ' + safeString_(audit.commentary));
  lines.push('produce.commentary: ' + safeString_(produce.commentary));
  lines.push('produce.diff: ' + safeString_(produce.diff));

  if (Array.isArray(produce.image_angles) && produce.image_angles.length) {
    lines.push('produce.image_angles: ' + produce.image_angles.map(toReadableLine_).join(' / '));
  }

  if (checks.length) {
    lines.push('checks: ' + checks.map(toReadableLine_).join(' / '));
  }

  if (researchTasks.length) {
    lines.push('research_tasks: ' + researchTasks.map(toReadableLine_).join(' / '));
  }

  return trimText_(lines.join('\n'), 5000);
}

/**
 * Gemini で idea_tags_json を生成
 */
function generateIdeaTagsWithGemini_(sourceText) {
  var apiKey = getGeminiApiKey_();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(HAKSAI_GEMINI_MODEL) +
    ':generateContent?key=' + encodeURIComponent(apiKey);

  var prompt = [
    'あなたはAmazon FBA物販の商品企画タグ設計アシスタントです。',
    '以下のリサーチカード情報を読み、後付け用のタグJSONを作成してください。',
    '返答はJSONのみで、説明文・前置き・Markdown記法は禁止です。',
    '',
    '出力JSONの必須キー:',
    '{',
    '  "category": [],',
    '  "use_scene": [],',
    '  "customer": [],',
    '  "season": [],',
    '  "product_form": [],',
    '  "price_band": "",',
    '  "related_keywords": [],',
    '  "risk_tags": [],',
    '  "notes": ""',
    '}',
    '',
    'ルール:',
    '- 各配列は 0〜5件程度',
    '- 日本語で簡潔に',
    '- 不明なものは無理に埋めすぎない',
    '- 既存のtitle/summary/tags/supplier_keywords/audit/produce情報から推定する',
    '- season は例: "春夏", "秋冬", "通年"',
    '- price_band は例: "¥750優遇", "低単価", "通常FBA", "高単価"',
    '- notes は人間が確認するときの一言メモ',
    '',
    '【リサーチカード情報】',
    sourceText
  ].join('\n');

  var payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code >= 300) {
    throw new Error('Gemini APIエラー: ' + code + ' / ' + text);
  }

  var json = JSON.parse(text);
  var raw = extractGeminiText_(json);
  if (!raw) throw new Error('Gemini応答テキストを取得できませんでした。');

  var cleaned = extractJsonText_(raw);
  var parsed = JSON.parse(cleaned);

  return sanitizeIdeaTagsObject_(parsed);
}

/**
 * Gemini APIキー取得
 */
function getGeminiApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です。');
  }
  return key;
}

/**
 * Geminiレスポンスからtext部分を抜く
 */
function extractGeminiText_(responseJson) {
  try {
    var candidates = responseJson.candidates || [];
    if (!candidates.length) return '';
    var parts = (((candidates[0] || {}).content || {}).parts || []);
    if (!parts.length) return '';
    return parts.map(function(p) { return p.text || ''; }).join('\n').trim();
  } catch (e) {
    return '';
  }
}

/**
 * ```json ... ``` を剥がして JSON 本体だけ抽出
 */
function extractJsonText_(text) {
  var t = String(text || '').trim();
  t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  var first = t.indexOf('{');
  var last = t.lastIndexOf('}');
  if (first >= 0 && last >= 0 && last > first) {
    t = t.slice(first, last + 1);
  }
  return t;
}

/**
 * idea_tags_json の形を整える
 */
function sanitizeIdeaTagsObject_(obj) {
  obj = obj || {};

  return {
    category: uniqueStrings_(obj.category),
    use_scene: uniqueStrings_(obj.use_scene),
    customer: uniqueStrings_(obj.customer),
    season: uniqueStrings_(obj.season),
    product_form: uniqueStrings_(obj.product_form),
    price_band: safeString_(obj.price_band),
    related_keywords: uniqueStrings_(obj.related_keywords),
    risk_tags: uniqueStrings_(obj.risk_tags),
    notes: safeString_(obj.notes)
  };
}

/**
 * シートをヘッダ名ベースで object 配列に変換
 */
function getSheetObjectsByHeader_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function(h) { return String(h || '').trim(); });

  return values.slice(1).map(function(row, idx) {
    var obj = { __rowNumber: idx + 2 };
    headers.forEach(function(h, col) {
      obj[h] = row[col];
    });
    return obj;
  }).filter(function(obj) {
    return Object.keys(obj).some(function(k) {
      if (k === '__rowNumber') return false;
      var v = obj[k];
      return v !== '' && v !== null && v !== undefined;
    });
  });
}

/**
 * ヘッダ名→列index マップ
 */
function headerMap_(headers) {
  var map = {};
  headers.forEach(function(h, i) {
    map[String(h || '').trim()] = i;
  });
  return map;
}

/**
 * 値の候補から最初の非空を拾う
 */
function pick_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return obj[k];
    }
  }
  return '';
}

function firstNonEmpty_(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] !== undefined && arr[i] !== null && String(arr[i]).trim() !== '') {
      return arr[i];
    }
  }
  return '';
}

function normalizeBoolean_(v) {
  if (v === true) return true;
  var s = String(v || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'はい'].indexOf(s) >= 0;
}

function safeString_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
  return String(v).trim();
}

function stringifyForCell_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function toObject_(v) {
  if (!v) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v;

  var s = String(v).trim();
  if (!s) return {};
  try {
    var parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return {};
}

function toArray_(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return uniqueStrings_(v);
  }

  if (typeof v === 'object') return [];

  var s = String(v).trim();
  if (!s) return [];

  try {
    var parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return uniqueStrings_(parsed);
  } catch (e) {}

  return uniqueStrings_(s.split(/[\n,、/／|]+/));
}

function toArrayOfAnything_(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;

  var s = String(v).trim();
  if (!s) return [];

  try {
    var parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  return s.split(/[\n]+/).map(function(x) { return x.trim(); }).filter(Boolean);
}

function uniqueStrings_(arr) {
  var map = {};
  var out = [];

  (arr || []).forEach(function(v) {
    var s = String(v || '').trim();
    if (!s) return;
    if (!map[s]) {
      map[s] = true;
      out.push(s);
    }
  });

  return out.slice(0, 5);
}

function toReadableLine_(item) {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'object') {
    if (item.text) return item.text;
    if (item.task) return item.task;
    if (item.val) return (item.text || '') + ' ' + item.val;
    try {
      return JSON.stringify(item);
    } catch (e) {
      return String(item);
    }
  }
  return String(item);
}

function trimText_(text, maxLen) {
  var s = String(text || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\n...(truncated)';
}

function notifyIdeaTags_(message) {
  Logger.log(message);

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // エディタ実行・トリガー・Web APIなどUIがない文脈ではここに来る
    Logger.log('UI通知はスキップ: ' + e.message);
  }

  return message;
}

function requireColumn_(headerMap, columnName, sheetName) {
  if (headerMap[columnName] === undefined || headerMap[columnName] === null) {
    throw new Error(
      sheetName + ' シートに必要列 "' + columnName + '" が見つかりません。' +
      'ヘッダー行を確認してください。'
    );
  }

  return headerMap[columnName];
}