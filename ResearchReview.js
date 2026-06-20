/*************************************************
 * ResearchReview.gs
 * HAKSAI Central / 商品化候補レビュー Markdown出力
 *
 * 使い方：
 * 1) GASメニュー「HAKSAI > 商品化候補レビューを出力」を選択
 *    または generateResearchReviewMarkdown() を直接実行
 * 2) Googleドライブに .md ファイルが保存される
 * 3) ログに表示されたURLを開いてコピー → Claude/ChatGPTに貼り付け
 *
 * 依存：
 *   Code.gs の SPREADSHEET_ID, DRIVE_FOLDER_ID,
 *   SHEET_PRODUCT_LIFECYCLE, SHEET_TRANSACTION_HISTORY,
 *   SHEET_REORDER_HISTORY, REQUIRED_HEADERS_LIFECYCLE
 *************************************************/

// 直近何ヶ月分の売上を集計するか
const REVIEW_PERIOD_MONTHS = 3;

// ============================================
// メイン
// ============================================

function generateResearchReviewMarkdown(options) {
  options = options || {};
  var config = normalizeResearchReviewSidebarOptions_(options);

  try {
    Logger.log('=== 商品化候補レビュー生成開始 ===');
    Logger.log('出力モード: ' + config.mode);
    Logger.log('集計期間（月）: ' + config.periodMonths);
    Logger.log('販売中上位件数: ' + config.topSellingLimit);
    Logger.log('リサーチ詳細件数: ' + config.topResearchDetailLimit);

    // 1. データ収集
    var lifecycleRows = loadProductLifecycle_();

    // ★ サイドバー指定の集計期間を使う
    var targetPeriods = getRecentPeriodKeys_(config.periodMonths);

    var salesByAsin = aggregateSalesByAsin_(targetPeriods);
    var reorderMap  = buildReorderMap_();

    // 2. 販売中商品・リサーチカードに分類
    var sellingProducts = lifecycleRows.filter(function(r) {
      return normalizeBoolean_RR_(r.is_launched) && !normalizeBoolean_RR_(r.is_deleted);
    });

    var researchCards = lifecycleRows.filter(function(r) {
      return !normalizeBoolean_RR_(r.is_launched) && !normalizeBoolean_RR_(r.is_deleted);
    });

    Logger.log('販売中: ' + sellingProducts.length + '件 / リサーチ: ' + researchCards.length + '件');
    Logger.log('集計対象期間: ' + targetPeriods.join(', '));

    // 3. Markdown生成
    // ★ configを渡す。これでcompact/full、上位件数、詳細件数が反映される
    var md = buildMarkdown_(
      sellingProducts,
      researchCards,
      salesByAsin,
      reorderMap,
      targetPeriods,
      config
    );

    // 4. Drive保存
    var fileUrl = '';

    if (config.writeToDrive) {
      fileUrl = saveMarkdownToDrive_(md);
      Logger.log('ファイルURL: ' + fileUrl);
    } else {
      Logger.log('Drive保存なし');
    }

    Logger.log('=== 生成完了 ===');
    Logger.log('Markdown文字数: ' + md.length);

    // ★ サイドバーからも扱いやすいように object で返す
    return {
      status: 'ok',
      mode: config.mode,
      periodMonths: config.periodMonths,
      topSellingLimit: config.topSellingLimit,
      topResearchDetailLimit: config.topResearchDetailLimit,
      markdown: md,
      fileUrl: fileUrl,
      charCount: md.length,
      sellingCount: sellingProducts.length,
      researchCount: researchCards.length,
      targetPeriods: targetPeriods
    };

  } catch (e) {
    Logger.log('エラー: ' + e.message + '\n' + e.stack);

    // UIがある時だけ通知。サイドバー・エディタ実行でも事故りにくいようにする
    if (typeof notifyRR_ === 'function') {
      notifyRR_('エラーが発生しました: ' + e.message);
    }

    throw e;
  }
}

// ============================================
// Markdown組み立て
// ============================================

function buildMarkdown_(sellingProducts, researchCards, salesByAsin, reorderMap, targetPeriods, config) {
  config = config || normalizeResearchReviewSidebarOptions_({});

  var now = new Date();
  var nowStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm'
  );

  var lines = [];

  var sellingInsights = buildSellingInsights_(
    sellingProducts,
    salesByAsin,
    reorderMap,
    config
  );

  var researchInsights = buildResearchInsights_(
    researchCards,
    config
  );

  lines.push('# HAKSAI 商品化候補レビュー');
  lines.push('');
  lines.push('生成日時：' + nowStr);
  lines.push('出力モード：' + config.mode);
  lines.push('集計期間：' + (targetPeriods || []).join('・') + '（直近 ' + config.periodMonths + 'ヶ月）');
  lines.push('販売中商品：' + (sellingProducts || []).length + '件');
  lines.push('リサーチ中アイデア：' + (researchCards || []).length + '件');
  lines.push('');
  lines.push('---');
  lines.push('');

  // 既存の全体サマリーは残す
  if (typeof buildSellingSummarySection_ === 'function') {
    lines = lines.concat(buildSellingSummarySection_(sellingProducts, salesByAsin));
  }

  // compact/full 共通：勝ち筋と抜粋
  lines = lines.concat(buildSellingWinsSection_(sellingInsights, config));
  lines = lines.concat(buildSelectedSellingSection_(sellingInsights, config));

  // リサーチ：一覧＋注目詳細
  lines = lines.concat(buildResearchOverviewSection_(researchInsights, config));
  lines = lines.concat(buildResearchFocusSection_(researchInsights, config));

  // 既存相談文があれば使う。なければ簡易版。
  if (typeof buildConsultSection_ === 'function') {
    lines = lines.concat(buildConsultSection_());
  } else {
    lines = lines.concat(buildDefaultResearchReviewConsultSection_());
  }

  // full のときだけ旧台帳を付録に退避
  if (config.mode === 'full') {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('# 付録：全データ台帳');
    lines.push('');
    lines.push('fullモードのため、既存の全件詳細を付録として出力します。通常のAI相談ではcompact推奨です。');
    lines.push('');

    if (typeof buildSellingDetailSection_ === 'function') {
      lines = lines.concat(buildSellingDetailSection_(sellingProducts, salesByAsin, reorderMap));
    }

    if (typeof buildResearchSection_ === 'function') {
      lines = lines.concat(buildResearchSection_(researchCards));
    }
  }

  return lines.join('\n');
}

// ── セクション1：販売中商品 全体サマリー ──

function buildSellingSummarySection_(sellingProducts, salesByAsin) {
  var lines = [];
  lines.push('## 1. 販売中商品サマリー（直近 ' + REVIEW_PERIOD_MONTHS + 'ヶ月合計）');
  lines.push('');

  var totalSales       = 0;
  var totalNet         = 0;
  var totalGrossProfit = 0;
  var totalQty         = 0;
  var withProfitCount  = 0;

  sellingProducts.forEach(function(p) {
    var asin = safeStr_RR_(p.asin);
    if (!asin) return;
    var s = salesByAsin[asin];
    if (!s) return;
    totalSales       += s.salesTaxin;
    totalNet         += s.net;
    totalQty         += s.qty;
    if (s.grossProfit !== null) {
      totalGrossProfit += s.grossProfit;
      withProfitCount++;
    }
  });

  lines.push('| 項目 | 金額 |');
  lines.push('|---|---|');
  lines.push('| 売上合計（税込） | ¥' + numFmt_(totalSales) + ' |');
  lines.push('| 手取り合計（net） | ¥' + numFmt_(totalNet) + ' |');
  lines.push('| 粗利合計（原価設定あり商品のみ） | ¥' + numFmt_(totalGrossProfit) + ' |');
  lines.push('| 販売数合計 | ' + numFmt_(totalQty) + '個 |');
  lines.push('| 原価設定済み商品数 | ' + withProfitCount + '/' + sellingProducts.length + '件 |');
  lines.push('');
  lines.push('');

  return lines;
}

// ── セクション2：販売中商品 個別データ ──

function buildSellingDetailSection_(sellingProducts, salesByAsin, reorderMap) {
  var lines = [];
  lines.push('## 2. 販売中商品 個別データ');
  lines.push('');

  // 売上降順でソート
  var sorted = sellingProducts.slice().sort(function(a, b) {
    var sa = salesByAsin[safeStr_RR_(a.asin)];
    var sb = salesByAsin[safeStr_RR_(b.asin)];
    return ((sb && sb.salesTaxin) || 0) - ((sa && sa.salesTaxin) || 0);
  });

  sorted.forEach(function(p, idx) {
    var emoji = safeStr_RR_(p.emoji) || '📦';
    var title = safeStr_RR_(p.title) || '（タイトル未設定）';
    var asin  = safeStr_RR_(p.asin);

    lines.push('### ' + (idx + 1) + '. ' + emoji + ' ' + title);
    if (asin) lines.push('ASIN: `' + asin + '`');
    lines.push('');

    // 売上データ
    var s = asin ? salesByAsin[asin] : null;
    if (s) {
      lines.push('**【売上・粗利】**');
      lines.push('| 項目 | 値 |');
      lines.push('|---|---|');
      lines.push('| 売上（税込） | ¥' + numFmt_(s.salesTaxin) + ' |');
      lines.push('| 手取り（net） | ¥' + numFmt_(s.net) + ' |');
      lines.push('| 販売数 | ' + numFmt_(s.qty) + '個 |');
      if (s.grossProfit !== null) {
        lines.push('| 粗利合計 | ¥' + numFmt_(s.grossProfit) + ' |');
        lines.push('| 粗利/個 | ¥' + numFmt_(s.grossProfitPerUnit) + ' |');
      } else {
        lines.push('| 粗利 | 原価未設定 |');
      }
      if (s.returnQty > 0) {
        lines.push('| 返品数 | ' + s.returnQty + '個（¥' + numFmt_(s.returnAmount) + '） |');
      }
      lines.push('');
    } else {
      lines.push('**【売上・粗利】** 集計対象期間内のデータなし');
      lines.push('');
    }

    // FBA在庫・日販
    lines.push('**【FBA在庫・日販】**');
    lines.push('| 項目 | 値 |');
    lines.push('|---|---|');
    lines.push('| FBA在庫 | ' + numOrDash_(p.fba_stock) + '個 |');
    lines.push('| FBA入庫中 | ' + numOrDash_(p.fba_inbound) + '個 |');
    lines.push('| 日販（7日平均） | ' + numOrDash_(p.fba_daily_t7) + '個/日 |');
    lines.push('| 残日数 | ' + numOrDash_(p.fba_days_remain) + '日 |');
    if (safeStr_RR_(p.fba_alert)) {
      lines.push('| アラート | ' + safeStr_RR_(p.fba_alert) + ' |');
    }
    lines.push('');

    // 価格・原価
    lines.push('**【価格・原価】**');
    lines.push('| 項目 | 値 |');
    lines.push('|---|---|');
    lines.push('| 販売価格 | ' + priceStr_(p.price) + ' |');
    lines.push('| 着地原価 | ' + (safeStr_RR_(p.current_landed_cost) ? '¥' + numFmt_(Number(p.current_landed_cost)) : '未設定') + ' |');
    lines.push('');

    // レビュー
    lines.push('**【レビュー】**');
    lines.push('| 項目 | 値 |');
    lines.push('|---|---|');
    lines.push('| レビュー数 | ' + (safeStr_RR_(p.reviews) || '不明') + ' |');
    lines.push('');

    // idea_tags_json（将来的に販売中商品にもタグが付く想定）
    var tagsObj = safeJsonParse_RR_(p.idea_tags_json, null);
    if (tagsObj) {
      lines.push('**【タグ情報】**');
      lines = lines.concat(formatIdeaTags_(tagsObj));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  return lines;
}

// ── セクション3：リサーチ中アイデア一覧 ──

function buildResearchSection_(researchCards) {
  var lines = [];
  lines.push('## 3. リサーチ中アイデア一覧');
  lines.push('');

  if (!researchCards.length) {
    lines.push('リサーチ中のアイデアはありません。');
    lines.push('');
    return lines;
  }

  // audit.status で優先度順ソート
  var statusOrder = { 'go': 0, 'check': 1, 'wait': 2, 'stop': 3 };
  var sorted = researchCards.slice().sort(function(a, b) {
    var auditA = safeJsonParse_RR_(a.audit, {});
    var auditB = safeJsonParse_RR_(b.audit, {});
    var sa = statusOrder[safeStr_RR_(auditA.status)] !== undefined ? statusOrder[safeStr_RR_(auditA.status)] : 99;
    var sb = statusOrder[safeStr_RR_(auditB.status)] !== undefined ? statusOrder[safeStr_RR_(auditB.status)] : 99;
    return sa - sb;
  });

  sorted.forEach(function(card, idx) {
    var emoji = safeStr_RR_(card.emoji) || '🔍';
    var title = safeStr_RR_(card.title) || '（タイトル未設定）';
    var audit  = safeJsonParse_RR_(card.audit,  {});
    var produce = safeJsonParse_RR_(card.produce, {});

    var auditStatus = safeStr_RR_(audit.status) || '未判定';
    var badge = statusBadge_(auditStatus);

    lines.push('### ' + (idx + 1) + '. ' + emoji + ' ' + title + '　' + badge);
    lines.push('');

    // 基本情報
    lines.push('| 項目 | 値 |');
    lines.push('|---|---|');
    lines.push('| カテゴリ | ' + (safeStr_RR_(card.category) || '不明') + ' |');
    lines.push('| 一言サマリー | ' + (safeStr_RR_(card.summary) || '－') + ' |');
    lines.push('| 競合価格 | ' + priceStr_(card.price) + ' |');
    lines.push('| 月販目安 | ' + (safeStr_RR_(card.monthly_sales) || '不明') + ' |');
    lines.push('| 競合レビュー数 | ' + (safeStr_RR_(card.reviews) || '不明') + ' |');
    lines.push('| 審査ステータス | ' + auditStatus + ' |');
    lines.push('| 審査信頼度 | ' + (safeStr_RR_(audit.confidence) || '不明') + ' |');
    lines.push('');

    // 競合の弱点・差別化
    if (safeStr_RR_(card.weakness)) {
      lines.push('**競合の弱点・顧客不満：**');
      lines.push('> ' + safeStr_RR_(card.weakness));
      lines.push('');
    }

    if (safeStr_RR_(produce.diff)) {
      lines.push('**差別化軸：**');
      lines.push('> ' + safeStr_RR_(produce.diff));
      lines.push('');
    }

    // 審査コメント
    if (safeStr_RR_(audit.commentary)) {
      lines.push('**審査官コメント：**');
      lines.push('> ' + safeStr_RR_(audit.commentary).replace(/\n/g, '\n> '));
      lines.push('');
    }

    // プロデューサーコメント
    if (safeStr_RR_(produce.commentary)) {
      lines.push('**プロデューサーコメント：**');
      lines.push('> ' + safeStr_RR_(produce.commentary).replace(/\n/g, '\n> '));
      lines.push('');
    }

    // リスクフラグ
    var riskFlags = Array.isArray(audit.risk_flags) ? audit.risk_flags : [];
    if (riskFlags.length) {
      lines.push('**リスクフラグ：** ' + riskFlags.join('　/　'));
      lines.push('');
    }

    // 1688検索キーワード
    var supplierKws = toStringArray_RR_(card.supplier_keywords);
    if (supplierKws.length) {
      lines.push('**1688検索キーワード：** `' + supplierKws.join('`　`') + '`');
      lines.push('');
    }

    // idea_tags_json
    var tagsObj = safeJsonParse_RR_(card.idea_tags_json, null);
    if (tagsObj && hasAnyTagContent_(tagsObj)) {
      lines.push('**【タグ情報】**');
      lines = lines.concat(formatIdeaTags_(tagsObj));
    } else {
      lines.push('**【タグ情報】** 未生成（後付けバッチまたはリサーチ時に自動付与）');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines;
}

// ── セクション4：AIへの相談文 ──

function buildConsultSection_() {
  var lines = [];
  lines.push('## 4. AIへの相談文');
  lines.push('');
  lines.push('以下のプロンプトをそのまま使用してください。');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('上記の情報は、HAKSAIというAmazon FBAブランドの現状データです。');
  lines.push('以下の観点から分析・提案をしてください。');
  lines.push('');
  lines.push('**① 商品化優先度の判定**');
  lines.push('リサーチ中のアイデアを優先度順にランキングしてください。');
  lines.push('根拠として、販売中商品との類似性・既存顧客層との重複・¥750優遇ティアの活用可否などを考慮してください。');
  lines.push('');
  lines.push('**② 横展開候補の検出**');
  lines.push('販売中商品のタグ・カテゴリ・顧客層をもとに、');
  lines.push('「同一顧客への追加提案」「季節補完」「サイズ/カラー展開の漏れ」などを指摘してください。');
  lines.push('');
  lines.push('**③ バリエーション漏れの検出**');
  lines.push('販売中商品のラインナップを見て、明らかに欠けているバリエーション（色・サイズ・用途）があれば指摘してください。');
  lines.push('');
  lines.push('**④ 撤退・縮小候補の指摘**');
  lines.push('売上・粗利・FBA残日数のデータから、継続すべきでない商品があれば理由とともに指摘してください。');
  lines.push('');
  lines.push('**⑤ 初回発注方針の提案**（優先度1位のアイデアについて）');
  lines.push('初回発注数・仕入単価の目安・VINE投入タイミングの推奨を教えてください。');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> ※ このMarkdownはHAKSAI Central（Google Apps Script）が自動生成しました。');
  lines.push('');

  return lines;
}

// ============================================
// データ取得・集計
// ============================================

/**
 * product_lifecycle を全件読み込む
 */
function loadProductLifecycle_() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  if (!sheet) throw new Error('product_lifecycle シートが見つかりません。');

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0].map(function(h) { return String(h || '').trim(); });

  return data.slice(1)
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
}

/**
 * 直近N件の period_key を降順で取得
 */
function getRecentPeriodKeys_(n) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TRANSACTION_HISTORY);
  if (!sheet) return [];

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h || '').trim(); });
  var pIdx    = headers.indexOf('period_key');
  if (pIdx === -1) return [];

  var set = {};
  for (var i = 1; i < data.length; i++) {
    var pk = String(data[i][pIdx] || '').trim();
    if (pk) set[pk] = true;
  }

  return Object.keys(set).sort().reverse().slice(0, n);
}

/**
 * 指定期間のtransaction_historyを集計し、ASIN別サマリーを返す
 * { [asin]: { salesTaxin, net, qty, grossProfit, grossProfitPerUnit, returnQty, returnAmount } }
 */
function aggregateSalesByAsin_(periodKeys) {
  if (!periodKeys || !periodKeys.length) return {};

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TRANSACTION_HISTORY);
  if (!sheet) return {};

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h || '').trim(); });

  var tPeriod = headers.indexOf('period_key');
  var tSku    = headers.indexOf('sku');
  var tAsin   = headers.indexOf('asin');
  var tType   = headers.indexOf('transaction_type');
  var tTaxin  = headers.indexOf('sales_taxin');
  var tNet    = headers.indexOf('net');
  var tQty    = headers.indexOf('qty');

  // sku → asin 逆引き
  var skuToAsin = buildSkuToAsinMap_();

  // reorder履歴（原価逆引き用）
  var reorderMap = buildReorderMap_();

  var periodSet = {};
  periodKeys.forEach(function(pk) { periodSet[pk] = true; });

  // ASIN別集計
  var summary = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var pk  = String(row[tPeriod] || '').trim();
    if (!periodSet[pk]) continue;

    var type = String(row[tType] || '');
    if (type !== '注文' && type !== '返金') continue;

    var sku   = String(row[tSku]  || '').trim();
    var asin  = String(row[tAsin] || '').trim() || skuToAsin[sku] || '';
    if (!asin) continue;

    var taxin = Number(row[tTaxin]) || 0;
    var net   = Number(row[tNet])   || 0;
    var qty   = Number(row[tQty])   || 0;

    if (!summary[asin]) {
      summary[asin] = {
        salesTaxin: 0, net: 0, qty: 0,
        returnQty: 0, returnAmount: 0,
        costLines: []
      };
    }

    var s = summary[asin];

    if (type === '注文') {
      s.salesTaxin += taxin;
      s.net        += net;
      s.qty        += qty;

      // 原価逆引き
      if (sku && reorderMap[sku]) {
        var cost = getLatestLandedCost_(reorderMap[sku]);
        if (cost > 0) s.costLines.push({ cost: cost, qty: qty });
      }
    } else {
      s.returnQty    += qty;
      s.returnAmount += net;
    }
  }

  // 粗利計算
  Object.keys(summary).forEach(function(asin) {
    var s = summary[asin];
    var costQty   = s.costLines.reduce(function(acc, l) { return acc + l.qty; }, 0);
    var costTotal = s.costLines.reduce(function(acc, l) { return acc + l.cost * l.qty; }, 0);

    if (costQty > 0) {
      var coveredNet       = s.qty > 0 ? s.net * (costQty / s.qty) : 0;
      s.grossProfit        = Math.round(coveredNet - costTotal);
      s.grossProfitPerUnit = Math.round(s.grossProfit / costQty);
    } else {
      s.grossProfit        = null;
      s.grossProfitPerUnit = null;
    }

    s.salesTaxin   = Math.round(s.salesTaxin);
    s.net          = Math.round(s.net);
    s.returnAmount = Math.round(s.returnAmount);
    delete s.costLines; // 出力には不要
  });

  return summary;
}

/**
 * reorder_history を { sku: [{order_date, landed_cost_actual}] } にまとめる
 */
function buildReorderMap_() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_REORDER_HISTORY);
  if (!sheet) return {};

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h || '').trim(); });

  var skuIdx  = headers.indexOf('sku');
  var dateIdx = headers.indexOf('order_date');
  var costIdx = headers.indexOf('landed_cost_actual');

  if (skuIdx === -1 || costIdx === -1) return {};

  var map = {};
  for (var i = 1; i < data.length; i++) {
    var sku  = String(data[i][skuIdx]  || '').trim();
    var cost = Number(data[i][costIdx]) || 0;
    if (!sku || !cost) continue;
    if (!map[sku]) map[sku] = [];
    map[sku].push({ order_date: data[i][dateIdx], landed_cost_actual: cost });
  }
  return map;
}

/**
 * reorderのレコード群から最新の着地原価を返す
 */
function getLatestLandedCost_(records) {
  if (!records || !records.length) return 0;
  var sorted = records.slice().sort(function(a, b) {
    return new Date(b.order_date) - new Date(a.order_date);
  });
  return Number(sorted[0].landed_cost_actual) || 0;
}

// ============================================
// Drive保存
// ============================================

function saveMarkdownToDrive_(content) {
  var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  var dateStr  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  var fileName = 'HAKSAI_商品化候補レビュー_' + dateStr + '.md';

  var blob = Utilities.newBlob(content, 'text/plain', fileName);
  blob.setContentTypeFromExtension();

  var file;
  if (folderId) {
    var folder = DriveApp.getFolderById(folderId);
    file = folder.createFile(blob);
  } else {
    // フォルダ未設定の場合はマイドライブ直下
    file = DriveApp.createFile(blob);
  }

  file.setName(fileName);
  return file.getUrl();
}

// ============================================
// フォーマットヘルパー
// ============================================

function formatIdeaTags_(obj) {
  var lines = [];
  if (!obj) return lines;

  lines.push('| タグ種別 | 内容 |');
  lines.push('|---|---|');

  if (obj.category && obj.category.length)           lines.push('| カテゴリ | ' + obj.category.join('　') + ' |');
  if (obj.use_scene && obj.use_scene.length)         lines.push('| 使用シーン | ' + obj.use_scene.join('　') + ' |');
  if (obj.customer && obj.customer.length)           lines.push('| 想定顧客 | ' + obj.customer.join('　') + ' |');
  if (obj.season && obj.season.length)               lines.push('| 季節性 | ' + obj.season.join('　') + ' |');
  if (obj.product_form && obj.product_form.length)   lines.push('| 商品形態 | ' + obj.product_form.join('　') + ' |');
  if (obj.price_band)                                lines.push('| 価格帯 | ' + obj.price_band + ' |');
  if (obj.related_keywords && obj.related_keywords.length) {
    lines.push('| 関連KW | ' + obj.related_keywords.join('　') + ' |');
  }
  if (obj.risk_tags && obj.risk_tags.length)         lines.push('| リスクタグ | ' + obj.risk_tags.join('　') + ' |');
  if (obj.notes)                                     lines.push('| メモ | ' + obj.notes + ' |');

  return lines;
}

function statusBadge_(status) {
  var map = { 'go': '🟢 GO', 'check': '🟡 CHECK', 'wait': '🟠 WAIT', 'stop': '🔴 STOP' };
  return map[String(status).toLowerCase()] || '⚪ ' + status;
}

function numFmt_(n) {
  if (n === null || n === undefined || n === '') return '－';
  return Math.round(Number(n)).toLocaleString();
}

function numOrDash_(v) {
  var n = Number(v);
  if (isNaN(n) || v === '' || v === null || v === undefined) return '－';
  return n.toLocaleString();
}

function priceStr_(v) {
  var s = safeStr_RR_(v);
  if (!s || s === '要調査') return s || '不明';
  var n = Number(String(s).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? s : '¥' + n.toLocaleString();
}

function hasAnyTagContent_(obj) {
  if (!obj || typeof obj !== 'object') return false;
  var arrayKeys = ['category', 'use_scene', 'customer', 'season', 'product_form', 'related_keywords', 'risk_tags'];
  for (var i = 0; i < arrayKeys.length; i++) {
    if (Array.isArray(obj[arrayKeys[i]]) && obj[arrayKeys[i]].length) return true;
  }
  return !!(obj.price_band || obj.notes);
}

// ============================================
// 汎用ユーティリティ（RR_ suffix = ResearchReview固有）
// ============================================

function safeStr_RR_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch(e) { return ''; }
  }
  return String(v).trim();
}

function safeJsonParse_RR_(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object' && !Array.isArray(v)) return v; // 既にオブジェクト
  try {
    var parsed = JSON.parse(String(v));
    return parsed;
  } catch (e) {
    return fallback;
  }
}

function normalizeBoolean_RR_(v) {
  if (v === true) return true;
  var s = String(v || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'はい'].indexOf(s) >= 0;
}

function toStringArray_RR_(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  var s = String(v).trim();
  if (!s) return [];
  try {
    var parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  } catch(e) {}
  return s.split(/[\n,、/／|]+/).map(function(x) { return x.trim(); }).filter(Boolean);
}

function notifyRR_(message) {
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log('UI通知スキップ: ' + e.message);
  }
}

function buildSellingInsights_(sellingProducts, salesByAsin, reorderMap, config) {
  sellingProducts = sellingProducts || [];
  salesByAsin = salesByAsin || {};
  config = config || {};

  var rows = sellingProducts.map(function(p) {
    var asin = rrSafeStr_(p.asin);
    var s = salesByAsin[asin] || {};

    var sales = rrNumRaw_(s.salesTaxin || s.sales_taxin || 0);
    var net = rrNumRaw_(s.net || 0);
    var qty = rrNumRaw_(s.qty || 0);

    var grossRaw = s.grossProfit;
    if (grossRaw === undefined) grossRaw = s.gross_profit;

    var gross = grossRaw === null || grossRaw === undefined || grossRaw === ''
      ? null
      : rrNumRaw_(grossRaw);

    var margin = sales && gross !== null
      ? gross / sales * 100
      : null;

    return {
      product: p,
      asin: asin,
      title: rrSafeStr_(p.title || p.product_name),
      salesTaxin: sales,
      net: net,
      qty: qty,
      grossProfit: gross,
      margin: margin,
      fbaStock: rrNumRaw_(p.fba_stock),
      fbaDaily: rrNumRaw_(p.fba_daily_t7),
      fbaDaysRemain: rrSafeStr_(p.fba_days_remain),
      fbaAlert: rrSafeStr_(p.fba_alert),
      landedCost: rrSafeStr_(p.current_landed_cost),
      keywordHint: rrBuildKeywordHintFromProduct_(p)
    };
  });

  var activeRows = rows.filter(function(r) {
    return r.salesTaxin > 0 || r.qty > 0 || r.grossProfit !== null;
  });

  var limit = Number(config.topSellingLimit || 10);

  var topSales = activeRows.slice()
    .sort(function(a, b) { return b.salesTaxin - a.salesTaxin; })
    .slice(0, limit);

  var topGross = activeRows.filter(function(r) {
    return r.grossProfit !== null;
  }).sort(function(a, b) {
    return b.grossProfit - a.grossProfit;
  }).slice(0, limit);

  var topMargin = activeRows.filter(function(r) {
    return r.grossProfit !== null && r.salesTaxin > 0 && r.qty >= 3;
  }).sort(function(a, b) {
    return b.margin - a.margin;
  }).slice(0, limit);

  var stockRisks = config.includeStockRisk
    ? rows.filter(function(r) {
        return /🚨|🔴|⚠️|発注|在庫切れ|至急|急いで/.test(r.fbaAlert);
      }).slice(0, limit)
    : [];

  var weakProducts = config.includeWeakProducts
    ? rows.filter(function(r) {
        return r.qty === 0 && r.fbaStock > 0;
      }).slice(0, limit)
    : [];

  var selected = rrUniqueByAsin_(
    [].concat(topSales, topGross, topMargin, stockRisks, weakProducts)
  );

  return {
    rows: rows,
    activeRows: activeRows,
    topSales: topSales,
    topGross: topGross,
    topMargin: topMargin,
    stockRisks: stockRisks,
    weakProducts: weakProducts,
    selected: selected
  };
}

function buildSellingWinsSection_(insights, config) {
  var lines = [];

  lines.push('## 2. 既存商品の勝ち筋サマリー');
  lines.push('');
  lines.push('売上・粗利・在庫面で特徴的な既存商品を抜粋しています。外部AIがリサーチアイデアとの関連性を推定するための材料です。');
  lines.push('');

  lines.push('### 売上上位');
  lines.push('');
  lines.push('| 商品 | ASIN | 売上税込 | 数量 | 粗利 | 粗利率 | SEO/タグ材料 |');
  lines.push('|---|---|---:|---:|---:|---:|---|');

  insights.topSales.forEach(function(r) {
    lines.push(
      '|' + rrMd_(rrShort_(r.title, 38)) +
      '|' + rrMd_(r.asin) +
      '|' + rrYen_(r.salesTaxin) +
      '|' + rrNum_(r.qty) +
      '|' + rrYenOrDash_(r.grossProfit) +
      '|' + rrPctOrDash_(r.margin) +
      '|' + rrMd_(r.keywordHint) +
      '|'
    );
  });

  if (!insights.topSales.length) {
    lines.push('| 該当なし |  | ¥0 | 0 | - | - |  |');
  }

  lines.push('');
  lines.push('### 粗利上位');
  lines.push('');
  lines.push('| 商品 | ASIN | 粗利 | 売上税込 | 数量 | 粗利率 | SEO/タグ材料 |');
  lines.push('|---|---|---:|---:|---:|---:|---|');

  insights.topGross.forEach(function(r) {
    lines.push(
      '|' + rrMd_(rrShort_(r.title, 38)) +
      '|' + rrMd_(r.asin) +
      '|' + rrYenOrDash_(r.grossProfit) +
      '|' + rrYen_(r.salesTaxin) +
      '|' + rrNum_(r.qty) +
      '|' + rrPctOrDash_(r.margin) +
      '|' + rrMd_(r.keywordHint) +
      '|'
    );
  });

  if (!insights.topGross.length) {
    lines.push('| 該当なし |  | - | ¥0 | 0 | - |  |');
  }

  lines.push('');
  lines.push('### 在庫・機会損失候補');
  lines.push('');
  lines.push('| 商品 | ASIN | 売上税込 | 数量 | FBA在庫 | 残日数 | アラート |');
  lines.push('|---|---|---:|---:|---:|---:|---|');

  insights.stockRisks.forEach(function(r) {
    lines.push(
      '|' + rrMd_(rrShort_(r.title, 38)) +
      '|' + rrMd_(r.asin) +
      '|' + rrYen_(r.salesTaxin) +
      '|' + rrNum_(r.qty) +
      '|' + rrNum_(r.fbaStock) +
      '|' + rrMd_(r.fbaDaysRemain) +
      '|' + rrMd_(r.fbaAlert) +
      '|'
    );
  });

  if (!insights.stockRisks.length) {
    lines.push('| 該当なし |  | - | - | - | - | - |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines;
}

function buildSelectedSellingSection_(insights, config) {
  var lines = [];

  lines.push('## 3. 販売中商品の抜粋');
  lines.push('');
  lines.push('売上上位・粗利上位・高粗利率・在庫リスク・低迷候補から重複を除いて抜粋しています。');
  lines.push('');

  lines.push('| 商品 | ASIN | 数量 | 売上税込 | 粗利 | 粗利率 | FBA在庫 | 残日数 | アラート |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---|');

  insights.selected.forEach(function(r) {
    lines.push(
      '|' + rrMd_(rrShort_(r.title, 42)) +
      '|' + rrMd_(r.asin) +
      '|' + rrNum_(r.qty) +
      '|' + rrYen_(r.salesTaxin) +
      '|' + rrYenOrDash_(r.grossProfit) +
      '|' + rrPctOrDash_(r.margin) +
      '|' + rrNum_(r.fbaStock) +
      '|' + rrMd_(r.fbaDaysRemain) +
      '|' + rrMd_(r.fbaAlert) +
      '|'
    );
  });

  if (!insights.selected.length) {
    lines.push('| 該当なし |  | 0 | ¥0 | - | - | 0 |  |  |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines;
}

function buildResearchInsights_(researchCards, config) {
  researchCards = researchCards || [];
  config = config || {};

  var sorted = researchCards.slice().sort(function(a, b) {
    var aw = rrResearchStatusWeight_(a);
    var bw = rrResearchStatusWeight_(b);

    if (aw !== bw) return bw - aw;

    return rrResearchScore_(b) - rrResearchScore_(a);
  });

  var detailLimit = Number(config.topResearchDetailLimit || 10);

  var focusCards = sorted.filter(function(card) {
    var status = rrResearchStatus_(card);
    var tags = rrSafeJson_(card.idea_tags_json, {});
    var hasTags = Object.keys(tags || {}).some(function(k) {
      var v = tags[k];
      return Array.isArray(v) ? v.length > 0 : !!v;
    });

    return status === 'go' ||
      status === 'check' ||
      hasTags ||
      rrResearchScore_(card) >= 20;
  }).slice(0, detailLimit);

  return {
    sorted: sorted,
    focusCards: focusCards
  };
}

function buildResearchOverviewSection_(insights, config) {
  var lines = [];

  lines.push('## 4. リサーチ中アイデア一覧');
  lines.push('');
  lines.push('全リサーチカードを一覧化しています。意味的な関連性判断は外部AIに任せます。');
  lines.push('');

  lines.push('| No | アイデア | 状態 | スコア | カテゴリ | 価格 | 月販 | タグ要約 | 1688KW |');
  lines.push('|---:|---|---|---:|---|---:|---:|---|---|');

  insights.sorted.forEach(function(card, idx) {
    var tagObj = rrSafeJson_(card.idea_tags_json, {});

    lines.push(
      '|' + (idx + 1) +
      '|' + rrMd_(rrShort_(rrSafeStr_(card.title), 34)) +
      '|' + rrMd_(rrResearchStatus_(card) || rrSafeStr_(card.status)) +
      '|' + rrNum_(rrResearchScore_(card)) +
      '|' + rrMd_(rrSafeStr_(card.category)) +
      '|' + rrPrice_(card.price) +
      '|' + rrMd_(rrSafeStr_(card.monthly_sales)) +
      '|' + rrMd_(rrSummarizeIdeaTags_(tagObj)) +
      '|' + rrMd_(rrToArray_(card.supplier_keywords).slice(0, 4).join(' / ')) +
      '|'
    );
  });

  if (!insights.sorted.length) {
    lines.push('| 0 | 該当なし |  | 0 |  |  |  |  |  |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines;
}

function buildResearchFocusSection_(insights, config) {
  var lines = [];

  lines.push('## 5. 注目リサーチアイデア詳細');
  lines.push('');
  lines.push('GO/CHECK・高スコア・タグ情報ありのカードを中心に、詳細判断用の材料だけ抜粋しています。');
  lines.push('');

  insights.focusCards.forEach(function(card, idx) {
    lines = lines.concat(buildOneResearchCardDetailCompact_(card, idx + 1));
  });

  if (!insights.focusCards.length) {
    lines.push('注目アイデアはありません。');
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines;
}

function buildOneResearchCardDetailCompact_(card, no) {
  var lines = [];

  var audit = rrSafeJson_(card.audit, {});
  var produce = rrSafeJson_(card.produce, {});
  var tags = rrSafeJson_(card.idea_tags_json, {});

  lines.push('### ' + no + '. ' + rrSafeStr_(card.title));
  lines.push('');
  lines.push('- 状態：' + rrMd_(rrResearchStatus_(card) || card.status || ''));
  lines.push('- スコア：' + rrNum_(rrResearchScore_(card)));
  lines.push('- サマリー：' + rrMd_(rrSafeStr_(card.summary)));
  lines.push('- 価格：' + rrPrice_(card.price));
  lines.push('- 月販目安：' + rrMd_(rrSafeStr_(card.monthly_sales)));
  lines.push('- 1688KW：' + rrMd_(rrToArray_(card.supplier_keywords).join(' / ')));
  lines.push('- タグ：' + rrMd_(rrSummarizeIdeaTags_(tags)));
  lines.push('');

  if (rrSafeStr_(card.weakness)) {
    lines.push('**競合/市場の弱点**');
    lines.push('');
    lines.push(rrMd_(card.weakness));
    lines.push('');
  }

  if (produce.diff) {
    lines.push('**差別化軸**');
    lines.push('');
    lines.push(rrMd_(produce.diff));
    lines.push('');
  }

  if (audit.commentary) {
    lines.push('**仕入れ審査官コメント**');
    lines.push('');
    lines.push(rrMd_(audit.commentary));
    lines.push('');
  }

  if (produce.commentary) {
    lines.push('**編集プロデューサーコメント**');
    lines.push('');
    lines.push(rrMd_(produce.commentary));
    lines.push('');
  }

  if (Array.isArray(tags.risk_tags) && tags.risk_tags.length) {
    lines.push('**リスクタグ**：' + rrMd_(tags.risk_tags.join(' / ')));
    lines.push('');
  }

  return lines;
}

function rrSafeStr_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return String(v).trim();
}

function rrNumRaw_(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').replace(/[,\s¥￥]/g, '').replace(/[^\d.-]/g, '');
  var n = Number(s);
  return isFinite(n) ? n : 0;
}

function rrNum_(v) {
  return Math.round(rrNumRaw_(v)).toLocaleString('ja-JP');
}

function rrYen_(v) {
  var n = Math.round(rrNumRaw_(v));
  var sign = n < 0 ? '-' : '';
  return sign + '¥' + Math.abs(n).toLocaleString('ja-JP');
}

function rrYenOrDash_(v) {
  if (v === null || v === undefined || v === '') return '-';
  return rrYen_(v);
}

function rrPctOrDash_(v) {
  if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '-';
  return Number(v).toFixed(1) + '%';
}

function rrMd_(v) {
  return rrSafeStr_(v)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function rrShort_(text, len) {
  var s = rrSafeStr_(text);
  len = len || 40;
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function rrSafeJson_(value, fallback) {
  fallback = fallback === undefined ? {} : fallback;

  if (!value) return fallback;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(String(value));
  } catch (e) {
    return fallback;
  }
}

function rrToArray_(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(rrSafeStr_).filter(Boolean);
  }

  if (typeof value === 'object') {
    return [rrSafeStr_(value)];
  }

  var s = String(value).trim();
  if (!s) return [];

  if (/^\[Ljava\.lang\.Object;@/.test(s)) {
    return [];
  }

  try {
    var parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      return parsed.map(rrSafeStr_).filter(Boolean);
    }
  } catch (e) {}

  return s.split(/[\n,、/／|]+/)
    .map(function(x) { return x.trim(); })
    .filter(Boolean);
}

function rrUniqueByAsin_(rows) {
  var seen = {};
  var out = [];

  (rows || []).forEach(function(r) {
    var key = r.asin || r.title;
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(r);
  });

  return out;
}

function rrBuildKeywordHintFromProduct_(p) {
  var parts = [];

  parts.push(p.title);
  parts.push(p.subtitle);
  parts.push(p.category);

  rrToArray_(p.tags).forEach(function(v) { parts.push(v); });
  rrToArray_(p.supplier_keywords).forEach(function(v) { parts.push(v); });

  var ideaTags = rrSafeJson_(p.idea_tags_json, {});
  ['category', 'use_scene', 'customer', 'season', 'product_form', 'related_keywords'].forEach(function(k) {
    rrToArray_(ideaTags[k]).forEach(function(v) { parts.push(v); });
  });

  var seen = {};
  return parts.map(rrSafeStr_)
    .filter(Boolean)
    .filter(function(v) {
      if (seen[v]) return false;
      seen[v] = true;
      return true;
    })
    .slice(0, 12)
    .join(' / ');
}

function rrResearchStatus_(card) {
  var audit = rrSafeJson_(card.audit, {});
  return rrSafeStr_(audit.status || card.status).toLowerCase();
}

function rrResearchStatusWeight_(card) {
  var s = rrResearchStatus_(card);

  if (s === 'go') return 40;
  if (s === 'check') return 30;
  if (s === 'wait') return 20;
  if (s === 'stop') return 10;

  return 0;
}

function rrResearchScore_(card) {
  var scores = rrSafeJson_(card.scores || card.score_breakdown, {});
  var keys = ['market', 'profit', 'diff', 'differentiation', 'risk', 'supply', 'fit', 'haksai_fit'];

  return keys.reduce(function(sum, k) {
    return sum + rrNumRaw_(scores[k]);
  }, 0);
}

function rrSummarizeIdeaTags_(tags) {
  tags = tags || {};

  var parts = [];

  ['category', 'use_scene', 'customer', 'season', 'product_form'].forEach(function(k) {
    rrToArray_(tags[k]).forEach(function(v) {
      parts.push(v);
    });
  });

  if (tags.price_band) parts.push(tags.price_band);

  var seen = {};
  return parts.filter(Boolean).filter(function(v) {
    if (seen[v]) return false;
    seen[v] = true;
    return true;
  }).slice(0, 10).join(' / ');
}

function rrPrice_(value) {
  var raw = rrSafeStr_(value);
  var n = rrNumRaw_(value);

  if (!raw && !n) return '不明';

  if (n > 500000) {
    return '要確認（' + rrMd_(raw) + '）';
  }

  if (n > 0) return rrYen_(n);

  return rrMd_(raw || '不明');
}

function buildDefaultResearchReviewConsultSection_() {
  var lines = [];

  lines.push('## 6. AIへの相談文');
  lines.push('');
  lines.push('以下の既存商品の実績とリサーチ中アイデアを比較し、どのアイデアを優先的に商品化すべきか評価してください。');
  lines.push('');
  lines.push('GAS側では意味的な関連性判断をしていません。商品名・SEOキーワード・タグ・売上・粗利・在庫状況を読んで、外部AI側で推定してください。');
  lines.push('');
  lines.push('特に見てほしい観点：');
  lines.push('');
  lines.push('1. 既存商品の勝ち筋を活かせるアイデア');
  lines.push('2. 既存商品群の季節・サイズ・用途の未展開領域');
  lines.push('3. 商品化優先度ランキング');
  lines.push('4. 後回しにすべきアイデアと理由');
  lines.push('5. 初回発注数・商品ページ訴求・追加リサーチ項目');
  lines.push('');
  lines.push('---');
  lines.push('');

  return lines;
}