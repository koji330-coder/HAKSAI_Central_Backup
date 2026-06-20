/****************************************************
 * ResearchReviewSidebar.gs
 * 商品化候補レビューMarkdown サイドバー操作用
 ****************************************************/

var RESEARCH_REVIEW_DEFAULT_OPTIONS = {
  mode: 'compact',
  periodMonths: 3,
  topSellingLimit: 10,
  topResearchDetailLimit: 10,
  writeToDrive: true,
  includeStockRisk: true,
  includeWeakProducts: true
};

/**
 * 既存 onOpen にこの関数を呼ばせる。
 * onOpenを2個作らないこと。GASが静かに片方を無視して人間を試します。
 */
function addResearchReviewMenu_(ui) {
  ui = ui || SpreadsheetApp.getUi();

  ui.createMenu('🧠 HAKSAI AIレビュー')
    .addItem('商品化候補レビューを生成', 'showResearchReviewSidebar')
    .addSeparator()
    .addItem('compact版を即生成', 'generateResearchReviewCompactToDrive')
    .addItem('full版を即生成', 'generateResearchReviewFullToDrive')
    .addToUi();
}

/**
 * 既存onOpenがない場合だけ使う。
 * 既にonOpenがあるなら、そこに addResearchReviewMenu_(); を追加すること。
 */
function onOpen(e) {
  addResearchReviewMenu_();
}

/**
 * サイドバー表示
 */
function showResearchReviewSidebar() {
  var tmpl = HtmlService.createTemplateFromFile('ResearchReviewSidebar');
  tmpl.defaultsJson = JSON.stringify(RESEARCH_REVIEW_DEFAULT_OPTIONS);

  var html = tmpl.evaluate()
    .setTitle('商品化候補レビュー')
    .setWidth(420);

  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * サイドバーから呼ばれる本体
 */
function generateResearchReviewFromSidebar(form) {
  var options = normalizeResearchReviewSidebarOptions_(form);

  var result = generateResearchReviewMarkdown(options);

  var markdown = '';
  var fileUrl = '';

  if (typeof result === 'string') {
    markdown = result;
  } else if (result && typeof result === 'object') {
    markdown = result.markdown || '';
    fileUrl = result.fileUrl || '';
  }

  if (!markdown) {
    throw new Error('Markdownが生成されませんでした。generateResearchReviewMarkdown の戻り値を確認してください。');
  }

  if (options.writeToDrive && !fileUrl) {
    fileUrl = saveResearchReviewMarkdownToDrive_(markdown, options);
  }

  return {
    status: 'ok',
    mode: options.mode,
    periodMonths: options.periodMonths,
    topSellingLimit: options.topSellingLimit,
    topResearchDetailLimit: options.topResearchDetailLimit,
    charCount: markdown.length,
    fileUrl: fileUrl,
    preview: markdown.slice(0, 5000)
  };
}

/**
 * compact即生成
 */
function generateResearchReviewCompactToDrive() {
  var res = generateResearchReviewFromSidebar({
    mode: 'compact',
    periodMonths: 3,
    topSellingLimit: 10,
    topResearchDetailLimit: 10,
    writeToDrive: true,
    includeStockRisk: true,
    includeWeakProducts: true
  });

  notifyResearchReview_('compact版を生成しました。\n' + (res.fileUrl || 'Drive保存なし'));
  return res;
}

/**
 * full即生成
 */
function generateResearchReviewFullToDrive() {
  var res = generateResearchReviewFromSidebar({
    mode: 'full',
    periodMonths: 3,
    topSellingLimit: 20,
    topResearchDetailLimit: 999,
    writeToDrive: true,
    includeStockRisk: true,
    includeWeakProducts: true
  });

  notifyResearchReview_('full版を生成しました。\n' + (res.fileUrl || 'Drive保存なし'));
  return res;
}

/**
 * サイドバー入力値を正規化
 */
function normalizeResearchReviewSidebarOptions_(form) {
  form = form || {};

  var mode = String(form.mode || 'compact').trim();
  if (mode !== 'compact' && mode !== 'full') mode = 'compact';

  return {
    mode: mode,
    periodMonths: clampNumber_(form.periodMonths, 1, 24, 3),
    topSellingLimit: clampNumber_(form.topSellingLimit, 3, 50, 10),
    topResearchDetailLimit: clampNumber_(form.topResearchDetailLimit, 3, 100, 10),
    writeToDrive: normalizeBool_RR_(form.writeToDrive, true),
    includeStockRisk: normalizeBool_RR_(form.includeStockRisk, true),
    includeWeakProducts: normalizeBool_RR_(form.includeWeakProducts, true)
  };
}

function saveResearchReviewMarkdownToDrive_(markdown, options) {
  var ts = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );

  var filename = [
    'HAKSAI_商品化候補レビュー',
    options.mode,
    options.periodMonths + 'ヶ月',
    ts
  ].join('_') + '.md';

  filename = sanitizeResearchReviewFilename_(filename);

  var file = DriveApp.createFile(
    filename,
    markdown,
    MimeType.PLAIN_TEXT
  );

  return file.getUrl();
}

function sanitizeResearchReviewFilename_(name) {
  return String(name || 'research_review.md')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 150);
}

function clampNumber_(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeBool_RR_(value, fallback) {
  if (value === undefined || value === null || value === '') return !!fallback;
  if (value === true) return true;
  if (value === false) return false;

  var s = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'はい'].indexOf(s) >= 0;
}

function notifyResearchReview_(message) {
  Logger.log(message);

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log('UI通知スキップ: ' + e.message);
  }

  return message;
}