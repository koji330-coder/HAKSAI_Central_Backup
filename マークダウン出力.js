/****************************************************
 * HAKSAI Central
 * ProductAiExport.gs 完全版
 *
 * 目的：
 * - 商品/商品群をAI相談用Markdownとして出力
 * - ASIN/SKU/FNSKU/商品名検索対応
 * - parent_asinによるバリエーション展開
 * - 全体売上に対する位置付け
 * - バリエーション別 / 柄・カラー別 / サイズ別集計
 * - 原価逆引き：注文日以前の最新reorder_history
 * - 在庫 / 発注履歴 / 期間コスト / 広告速報も含める
 ****************************************************/


/**
 * 必要に応じてここだけ変更。
 * 他ファイルに同名constがあると衝突するので、global constは使わない。
 */
function getHaksaiAiExportSpreadsheetId_() {
  return '1w71T_U8dDRK9FKhAbFP7JqPKuHWxDkJe1Cu2ISjHBsw';
}


/**
 * メイン関数。
 *
 * options:
 * {
 *   query: 'ASIN / SKU / FNSKU / 商品名',
 *   includeVariations: true,
 *   periodMonths: 6,
 *   writeToDrive: true
 * }
 */

/**
 * [CHANGED] Step 2：exportProductAiMarkdownからcutoffDateを計算してloadに渡す。
 */

function exportProductAiMarkdown(options) {
  options = options || {};
 
  var query = String(options.query || '').trim();
  if (!query) {
    throw new Error('query は必須です。ASIN / SKU / FNSKU / 商品名の一部を指定してください。');
  }
 
  var includeVariations =
    options.includeVariations !== false &&
    options.includeVariations !== 'false';
 
  var periodMonths = Number(options.periodMonths || 6);
 
  var writeToDrive =
    options.writeToDrive === true ||
    options.writeToDrive === 'true';
 
  // [CHANGED] Step 2：cutoffDateをここで計算してloadに渡す
  var cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - periodMonths);
 
  var ss = SpreadsheetApp.openById(getHaksaiAiExportSpreadsheetId_());
  var data = loadHaksaiAiExportData_(ss, cutoffDate);   // cutoffDate追加
 
  var group = resolveProductGroupForAiExport_(data, query, includeVariations);
 
  if (!group.products.length && !group.skus.length && !group.asins.length) {
    throw new Error('該当商品が見つかりませんでした: ' + query);
  }
 
  var ctx = buildProductAiContext_(data, group, {
    query: query,
    includeVariations: includeVariations,
    periodMonths: periodMonths
  });
 
  var markdown = buildProductAiMarkdown_(ctx);
 
  var fileUrl = '';
 
  if (writeToDrive) {
    var filename = sanitizeFilename_(
      'HAKSAI_AI相談_' +
      (ctx.mainTitle || query) +
      '_' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') +
      '.md'
    );
 
    var file = DriveApp.createFile(filename, markdown, MimeType.PLAIN_TEXT);
    fileUrl = file.getUrl();
  }
 
  return {
    status: 'ok',
    query: query,
    markdown: markdown,
    fileUrl: fileUrl,
    matchedProductCount: group.products.length,
    matchedSkuCount: group.skus.length,
    matchedAsinCount: group.asins.length
  };
}


/**
 * [NEW] Step 1：reorderIndexを構築する。
 * SKUをキーに、発注日降順でソートした原価エントリの配列を持つ。
 * product_idはSKUが空の行のフォールバック用。
 */
function buildReorderIndex_(reorders) {
  var index = {};
 
  reorders.forEach(function(r) {
    var cost = toNumberLoose_(r.landed_cost_actual);
    if (!cost || cost <= 0) return; // 原価未設定は除外
 
    var orderDate = parseDateLoose_(r.order_date);
 
    var entry = {
      date: orderDate,
      cost: cost
    };
 
    // SKU優先、なければproduct_idをフォールバックキーにする
    var keys = [];
    if (r.sku) keys.push(r.sku);
    if (r.product_id && !r.sku) keys.push('pid:' + r.product_id);
 
    keys.forEach(function(key) {
      if (!index[key]) index[key] = [];
      index[key].push(entry);
    });
  });
 
  // 各キーを発注日降順にソート（一度だけ）
  Object.keys(index).forEach(function(k) {
    index[k].sort(function(a, b) {
      return (b.date ? b.date.getTime() : 0) -
             (a.date ? a.date.getTime() : 0);
    });
  });
 
  return index;
}
 
 
/**
 * [NEW] Step 1：インデックスを使った原価逆引き。
 * 注文日以前の最新発注の原価を返す。
 */
function findLandedCostByIndex_(reorderIndex, sku, productId, orderDate) {
  // SKU優先で検索
  var keys = [];
  if (sku) keys.push(sku);
  if (productId) keys.push('pid:' + productId);
 
  for (var i = 0; i < keys.length; i++) {
    var entries = reorderIndex[keys[i]];
    if (!entries || !entries.length) continue;
 
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      // 降順ソート済みなので、注文日以前の最初のエントリが答え
      if (!orderDate || !e.date || e.date.getTime() <= orderDate.getTime()) {
        return e.cost;
      }
    }
  }
 
  return null;
}
 


/**
 * 動作確認用。
 * queryだけ適宜変更。
 */
function testExportProductAiMarkdown() {
  return exportProductAiMarkdown({
    query: 'バイクカバー',
    includeVariations: true,
    periodMonths: 6,
    writeToDrive: true
  });
}


/**
 * サイドバー等から呼ぶ用。
 */
function generateProductAiMarkdownFromSidebar(form) {
  form = form || {};

  var query = String(form.query || '').trim();
  if (!query) throw new Error('検索対象が空です。');

  return exportProductAiMarkdown({
    query: query,
    includeVariations: form.includeVariations !== false && form.includeVariations !== 'false',
    periodMonths: Number(form.periodMonths || 6),
    writeToDrive: form.writeToDrive !== false && form.writeToDrive !== 'false'
  });
}


/**
 * サイドバー検索用。
 */
function searchProductsForAiExportSidebar(query) {
  query = String(query || '').trim();
  if (!query) return [];

  var ss = SpreadsheetApp.openById(getHaksaiAiExportSpreadsheetId_());
  var data = loadHaksaiAiExportData_(ss);

  var q = normalizeKey_(query);

  var skuByAsin = {};
  data.skuMaster.forEach(function(s) {
    if (!s.asin) return;
    if (!skuByAsin[s.asin]) skuByAsin[s.asin] = [];
    skuByAsin[s.asin].push(s);
  });

  var results = [];

  data.products.forEach(function(p) {
    var skuRows = skuByAsin[p.asin] || [];

    var hay = [
      p.id,
      p.asin,
      p.parent_asin,
      p.title,
      p.subtitle,
      p.summary,
      p.amazon_url,
      skuRows.map(function(s) {
        return [s.sku, s.fnsku, s.product_name].join(' ');
      }).join(' ')
    ].join(' ');

    if (!normalizeKey_(hay).includes(q)) return;

    results.push({
      queryValue: p.asin || (skuRows[0] && skuRows[0].sku) || p.id || '',
      asin: p.asin || '',
      parent_asin: p.parent_asin || '',
      title: p.title || (skuRows[0] && skuRows[0].product_name) || '',
      subtitle: p.subtitle || '',
      status: p.status || '',
      sku: skuRows.map(function(s) { return s.sku; }).filter(Boolean).join(', '),
      fnsku: skuRows.map(function(s) { return s.fnsku; }).filter(Boolean).join(', '),
      fba_stock: p.fba_stock || '',
      fba_alert: p.fba_alert || ''
    });
  });

  data.skuMaster.forEach(function(s) {
    var hay = [s.sku, s.asin, s.fnsku, s.product_name].join(' ');
    if (!normalizeKey_(hay).includes(q)) return;

    var exists = results.some(function(r) {
      return r.asin && r.asin === s.asin;
    });

    if (exists) return;

    results.push({
      queryValue: s.asin || s.sku || '',
      asin: s.asin || '',
      parent_asin: '',
      title: s.product_name || '',
      subtitle: '',
      status: '',
      sku: s.sku || '',
      fnsku: s.fnsku || '',
      fba_stock: '',
      fba_alert: ''
    });
  });

  return results.slice(0, 30);
}


/****************************************************
 * HAKSAI Central
 * ProductAiExport.gs リファクタリング版
 *
 * 変更点（v2）：
 * Step 1: 原価逆引きをインデックス化（O(N×M) → O(N)）
 * Step 2: 期間フィルタをloadHaksaiAiExportData_の最上流に移動
 * Step 3: getDisplayValues → getValues
 *
 * 変更していない関数はそのまま維持。
 * 差し替え対象の関数にのみ // [CHANGED] コメントを付ける。
 ****************************************************/


/**
 * [CHANGED] Step 2：cutoffDateを受け取り、ロード時点でトランザクションを絞る。
 * 他シートは行数が少ないのでそのままロード。
 */
function loadHaksaiAiExportData_(ss, cutoffDate) {
  var products = getSheetObjectsForAiExport_(ss, 'product_lifecycle').map(normalizeProductRow_);
  var reorders = getSheetObjectsForAiExport_(ss, 'reorder_history').map(normalizeReorderRow_);

  // [CHANGED] Step 2：ロード時点で期間フィルタを適用
  var transactions = getSheetObjectsForAiExport_(ss, 'transaction_history')
    .map(normalizeTransactionRow_)
    .filter(function(t) {
      if (!cutoffDate) return true;
      var d = parseDateLoose_(t.date);
      return !d || d >= cutoffDate;
    });

  var periodCosts = getSheetObjectsForAiExport_(ss, 'period_costs').map(normalizePeriodCostRow_);
  var skuMaster = getSheetObjectsForAiExport_(ss, 'sku_master').map(normalizeSkuMasterRow_);
  var homeInventoryItems = getSheetObjectsForAiExport_(ss, 'home_inventory_items').map(normalizeHomeItemRow_);
  var homeInventoryLog = getSheetObjectsForAiExport_(ss, 'home_inventory_log').map(normalizeHomeLogRow_);

  var adPerformance = [];
  var adSheet = ss.getSheetByName('ad_performance_history');
  if (adSheet) {
    adPerformance = getSheetObjectsForAiExport_(ss, 'ad_performance_history').map(normalizeAdRow_);
  }

  var asinBySku = {};
  skuMaster.forEach(function(s) {
    if (s.sku && s.asin) asinBySku[s.sku] = s.asin;
  });

  transactions.forEach(function(t) {
    if (!t.asin && t.sku && asinBySku[t.sku]) {
      t.asin = asinBySku[t.sku];
    }
  });

  // [CHANGED] Step 1：reorderIndexをここで一度だけ構築して持ち回る
  var reorderIndex = buildReorderIndex_(reorders);

  return {
    products: products,
    reorders: reorders,
    reorderIndex: reorderIndex,   // 追加
    transactions: transactions,
    periodCosts: periodCosts,
    skuMaster: skuMaster,
    homeInventoryItems: homeInventoryItems,
    homeInventoryLog: homeInventoryLog,
    adPerformance: adPerformance
  };
}


/**
 * 商品グループ解決。
 */
function resolveProductGroupForAiExport_(data, query, includeVariations) {
  var q = normalizeKey_(query);

  var productIdSet = {};
  var asinSet = {};
  var skuSet = {};
  var fnskuSet = {};
  var parentAsinSet = {};

  function addProduct(p) {
    if (!p) return;
    if (p.id) productIdSet[p.id] = true;
    if (p.asin) asinSet[p.asin] = true;
    if (p.parent_asin) parentAsinSet[p.parent_asin] = true;
  }

  function addSkuRow(s) {
    if (!s) return;
    if (s.sku) skuSet[s.sku] = true;
    if (s.asin) asinSet[s.asin] = true;
    if (s.fnsku) fnskuSet[s.fnsku] = true;
  }

  data.products.forEach(function(p) {
    var hay = [
      p.id,
      p.asin,
      p.parent_asin,
      p.title,
      p.subtitle,
      p.summary,
      p.amazon_url
    ].join(' ');

    if (normalizeKey_(hay).includes(q)) {
      addProduct(p);

      if (p.parent_asin) {
        parentAsinSet[p.parent_asin] = true;
      }

      if (p.asin && normalizeKey_(p.asin) === q) {
        parentAsinSet[p.parent_asin || p.asin] = true;
      }
    }
  });

  data.skuMaster.forEach(function(s) {
    var hay = [s.sku, s.asin, s.fnsku, s.product_name].join(' ');

    if (normalizeKey_(hay).includes(q)) {
      addSkuRow(s);
    }
  });

  data.transactions.forEach(function(t) {
    if (
      normalizeKey_(t.sku) === q ||
      normalizeKey_(t.asin) === q ||
      normalizeKey_(t.order_id) === q
    ) {
      if (t.sku) skuSet[t.sku] = true;
      if (t.asin) asinSet[t.asin] = true;
    }
  });

  // SKUからASIN、ASINからSKUへ展開
  data.skuMaster.forEach(function(s) {
    if ((s.sku && skuSet[s.sku]) || (s.asin && asinSet[s.asin]) || (s.fnsku && fnskuSet[s.fnsku])) {
      addSkuRow(s);
    }
  });

  data.products.forEach(function(p) {
    if (p.asin && asinSet[p.asin]) {
      addProduct(p);
      if (p.parent_asin) parentAsinSet[p.parent_asin] = true;
    }
  });

  if (includeVariations) {
    data.products.forEach(function(p) {
      if (!p.parent_asin) return;

      if (parentAsinSet[p.parent_asin]) {
        addProduct(p);
      }

      if (p.asin && parentAsinSet[p.asin]) {
        addProduct(p);
      }
    });

    // 代表ASINを親扱いしているケースも拾う
    data.products.forEach(function(p) {
      if (p.parent_asin && asinSet[p.parent_asin]) {
        addProduct(p);
      }
    });
  }

  // 再度SKU展開
  data.skuMaster.forEach(function(s) {
    if (s.asin && asinSet[s.asin]) {
      addSkuRow(s);
    }
  });

  var products = data.products.filter(function(p) {
    return (p.id && productIdSet[p.id]) || (p.asin && asinSet[p.asin]);
  });

  var skuRows = data.skuMaster.filter(function(s) {
    return (s.sku && skuSet[s.sku]) ||
      (s.asin && asinSet[s.asin]) ||
      (s.fnsku && fnskuSet[s.fnsku]);
  });

  return {
    query: query,
    products: products,
    skus: uniqueArray_(skuRows.map(function(s) { return s.sku; }).filter(Boolean)),
    skuRows: skuRows,
    asins: uniqueArray_(products.map(function(p) { return p.asin; }).concat(skuRows.map(function(s) { return s.asin; })).filter(Boolean)),
    fnskus: uniqueArray_(skuRows.map(function(s) { return s.fnsku; }).filter(Boolean)),
    productIds: uniqueArray_(products.map(function(p) { return p.id; }).filter(Boolean)),
    parentAsins: uniqueArray_(products.map(function(p) { return p.parent_asin; }).filter(Boolean))
  };
}


/**
 * [CHANGED] Step 2：cutoffDateをloadに渡す。
 */
function buildProductAiContext_(data, group, options) {
  var now = new Date();
  var cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - Number(options.periodMonths || 6));
 
  // data.transactions はロード時点で既にcutoff済み。
  // ここではASIN/SKUフィルタだけ行う。
  var asinSet = toSet_(group.asins);
  var skuSet = toSet_(group.skus);
  var fnskuSet = toSet_(group.fnskus);
  var productIdSet = toSet_(group.productIds);
 
  var skuRows = data.skuMaster.filter(function(s) {
    return (s.sku && skuSet[s.sku]) ||
      (s.asin && asinSet[s.asin]) ||
      (s.fnsku && fnskuSet[s.fnsku]);
  });
 
  var allSkuSet = {};
  var allAsinSet = {};
 
  group.asins.forEach(function(v) { if (v) allAsinSet[v] = true; });
  group.skus.forEach(function(v) { if (v) allSkuSet[v] = true; });
 
  skuRows.forEach(function(s) {
    if (s.sku) allSkuSet[s.sku] = true;
    if (s.asin) allAsinSet[s.asin] = true;
  });
 
  var transactions = data.transactions.filter(function(t) {
    return (t.sku && allSkuSet[t.sku]) ||
      (t.asin && allAsinSet[t.asin]);
  });
 
  var reorders = data.reorders.filter(function(r) {
    return (r.sku && allSkuSet[r.sku]) ||
      (r.product_id && productIdSet[r.product_id]);
  });
 
  var homeItems = data.homeInventoryItems.filter(function(i) {
    return (i.asin && allAsinSet[i.asin]) ||
      (i.fnsku && fnskuSet[i.fnsku]) ||
      (i.product_name && normalizeKey_(i.product_name).includes(normalizeKey_(options.query))) ||
      (i.free_label && normalizeKey_(i.free_label).includes(normalizeKey_(options.query)));
  });
 
  var homeLogs = data.homeInventoryLog.filter(function(l) {
    return (l.sku && allSkuSet[l.sku]) ||
      (l.asin && allAsinSet[l.asin]) ||
      (l.fnsku && fnskuSet[l.fnsku]);
  });
 
  var periodKeys = getPeriodKeysFromTransactions_(transactions);
 
  var periodCosts = data.periodCosts.filter(function(c) {
    return periodKeys.indexOf(String(c.period_key || '').trim()) >= 0;
  });
 
  var adPerformance = data.adPerformance.filter(function(a) {
    return (a.advertised_sku && allSkuSet[a.advertised_sku]) ||
      (a.sku && allSkuSet[a.sku]) ||
      (a.advertised_asin && allAsinSet[a.advertised_asin]) ||
      (a.asin && allAsinSet[a.asin]);
  });
 
  // [CHANGED] Step 1：reorderIndexをdataから取り出して渡す
  var monthly = aggregateTransactionsByMonthForAiExport_(
    transactions,
    data.reorderIndex,   // reorders配列の代わりにインデックスを渡す
    group,
    data.products,
    skuRows
  );
 
  var recentTransactions = transactions
    .slice()
    .sort(function(a, b) {
      var da = parseDateLoose_(a.date);
      var db = parseDateLoose_(b.date);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    })
    .slice(0, 30);
 
  var mainProduct = group.products[0] || {};
  var mainTitle = mainProduct.title || (skuRows[0] && skuRows[0].product_name) || options.query;
 
  var ctx = {
    generatedAt: new Date(),
    query: options.query,
    includeVariations: options.includeVariations,
    periodMonths: options.periodMonths,
    mainTitle: mainTitle,
    group: group,
    products: group.products,
    skuRows: skuRows,
    transactions: transactions,
    recentTransactions: recentTransactions,
    reorders: reorders,
    reorderIndex: data.reorderIndex,   // 追加
    monthly: monthly,
    homeItems: homeItems,
    homeLogs: homeLogs,
    periodCosts: periodCosts,
    adPerformance: adPerformance
  };
 
  ctx.variantAnalysis = buildVariantAnalysisForAiExport_(ctx, data);
  ctx.overallPosition = buildOverallPositionForAiExport_(data, ctx);
 
  return ctx;
}



/**
 * Markdown本体。
 */
function buildProductAiMarkdown_(ctx) {
  var lines = [];
  var total = summarizeMonthlyForAiExport_(ctx.monthly);

  lines.push('# HAKSAI 商品分析カルテ');
  lines.push('');
  lines.push('生成日時：' + formatDateTime_(ctx.generatedAt));
  lines.push('検索条件：' + escapeMd_(ctx.query));
  lines.push('対象期間：直近' + escapeMd_(String(ctx.periodMonths)) + 'か月');
  lines.push('バリエーション含む：' + (ctx.includeVariations ? 'はい' : 'いいえ'));
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## 1. 商品グループ概要');
  lines.push('');
  lines.push('- 主商品名：' + escapeMd_(ctx.mainTitle || ''));
  lines.push('- 対象商品数：' + fmtNum_(ctx.products.length));
  lines.push('- 対象ASIN数：' + fmtNum_(ctx.group.asins.length));
  lines.push('- 対象SKU数：' + fmtNum_(ctx.skuRows.length || ctx.group.skus.length));
  lines.push('- 親ASIN：' + escapeMd_(ctx.group.parentAsins.join(', ') || 'なし/未設定'));
  lines.push('');

  lines.push('### 商品一覧');
  lines.push('');
  lines.push('| 商品名 | subtitle | ASIN | parent_asin | ステータス | FBA在庫 | 実質残日数 | アラート |');
  lines.push('|---|---|---|---|---|---:|---:|---|');

  ctx.products.forEach(function(p) {
    lines.push(
      '|' + escapeMd_(p.title) +
      '|' + escapeMd_(p.subtitle) +
      '|' + escapeMd_(p.asin) +
      '|' + escapeMd_(p.parent_asin) +
      '|' + escapeMd_(p.status) +
      '|' + fmtNum_(p.fba_stock) +
      '|' + escapeMd_(p.fba_days_remain) +
      '|' + escapeMd_(p.fba_alert) +
      '|'
    );
  });

  if (!ctx.products.length) {
    lines.push('| 該当なし |  |  |  |  | 0 |  |  |');
  }

  lines.push('');
  lines.push('### SKU / FNSKU');
  lines.push('');
  lines.push('| SKU | ASIN | FNSKU | 商品名 |');
  lines.push('|---|---|---|---|');

  ctx.skuRows.forEach(function(s) {
    lines.push(
      '|' + escapeMd_(s.sku) +
      '|' + escapeMd_(s.asin) +
      '|' + escapeMd_(s.fnsku) +
      '|' + escapeMd_(s.product_name) +
      '|'
    );
  });

  if (!ctx.skuRows.length) {
    lines.push('| 該当なし |  |  |  |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  appendOverallPositionMarkdown_(lines, ctx);

  lines.push('## 3. 売上・利益サマリー');
  lines.push('');
  lines.push('| 指標 | 金額/数量 |');
  lines.push('|---|---:|');
  lines.push('| 販売数量 | ' + fmtNum_(total.qty) + ' 個 |');
  lines.push('| 売上税込 | ' + fmtYen_(total.sales_taxin) + ' |');
  lines.push('| Amazon手取 | ' + fmtYen_(total.net) + ' |');
  lines.push('| 着地原価合計 | ' + fmtYen_(total.cost_total) + ' |');
  lines.push('| 粗利 | ' + fmtYen_(total.gross_profit) + ' |');
  lines.push('| 粗利率 | ' + (total.sales_taxin ? (total.gross_profit / total.sales_taxin * 100).toFixed(1) : '0.0') + '% |');
  lines.push('| 原価未設定取引数 | ' + fmtNum_(total.no_cost_count) + ' 件 |');
  lines.push('| 原価未設定分の手取 | ' + fmtYen_(total.no_cost_net) + ' |');
  lines.push('');

  lines.push('### 月別実績');
  lines.push('');
  lines.push('| 月 | 数量 | 売上税込 | Amazon手取 | 着地原価 | 粗利 | 粗利率 | 原価未設定 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');

  ctx.monthly.forEach(function(m) {
    var rate = m.sales_taxin
      ? (m.gross_profit / m.sales_taxin * 100).toFixed(1) + '%'
      : '0.0%';

    lines.push(
      '|' + escapeMd_(m.period_key) +
      '|' + fmtNum_(m.qty) +
      '|' + fmtYen_(m.sales_taxin) +
      '|' + fmtYen_(m.net) +
      '|' + fmtYen_(m.cost_total) +
      '|' + fmtYen_(m.gross_profit) +
      '|' + rate +
      '|' + fmtNum_(m.no_cost_count) +
      '|'
    );
  });

  if (!ctx.monthly.length) {
    lines.push('| 該当なし | 0 | ¥0 | ¥0 | ¥0 | ¥0 | 0.0% | 0 |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  appendVariantAnalysisMarkdown_(lines, ctx);

  appendRecentTransactionsMarkdown_(lines, ctx);
  appendReorderMarkdown_(lines, ctx);
  appendInventoryMarkdown_(lines, ctx);
  appendPeriodCostsMarkdown_(lines, ctx);
  appendAdMarkdown_(lines, ctx);
  appendAiPromptMarkdown_(lines, ctx);

  return lines.join('\n');
}


/**
 * [CHANGED] Step 1：全体ポジション計算もインデックスを使う。
 */
function buildOverallPositionForAiExport_(data, ctx) {
  var now = new Date();
  var cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - Number(ctx.periodMonths || 6));
 
  var productByAsin = {};
  data.products.forEach(function(p) {
    if (p.asin) productByAsin[p.asin] = p;
  });
 
  // data.transactionsはロード時点で既にcutoff済みなので追加フィルタ不要
  var allTransactions = data.transactions.filter(function(t) {
    var type = String(t.transaction_type || '').trim();
    return type === '注文' || type === '返金';
  });
 
  // [CHANGED] インデックスで逆引き
  var allSummary = summarizeTransactionsForOverallPosition_(
    allTransactions,
    data.reorderIndex,
    productByAsin
  );
 
  var selectedSummary = summarizeMonthlyForAiExport_(ctx.monthly);
 
  var periodKeys = getPeriodKeysFromTransactions_(allTransactions);
  var periodKeySet = {};
  periodKeys.forEach(function(k) { periodKeySet[k] = true; });
 
  var relevantPeriodCosts = data.periodCosts.filter(function(c) {
    var key = String(c.period_key || '').trim();
    return key && periodKeySet[key];
  });
 
  var totalPeriodCosts = relevantPeriodCosts.reduce(function(sum, c) {
    return sum + toNumberLoose_(c.amount);
  }, 0);
 
  allSummary.total_period_costs = totalPeriodCosts;
  allSummary.operating_profit = allSummary.gross_profit + totalPeriodCosts;
 
  return {
    periodMonths: ctx.periodMonths,
    all: allSummary,
    selected: selectedSummary,
    shares: {
      qty: ratioForOverall_(selectedSummary.qty, allSummary.qty),
      sales_taxin: ratioForOverall_(selectedSummary.sales_taxin, allSummary.sales_taxin),
      net: ratioForOverall_(selectedSummary.net, allSummary.net),
      gross_profit: ratioForOverall_(selectedSummary.gross_profit, allSummary.gross_profit)
    },
    margins: {
      all_gross_margin: allSummary.sales_taxin
        ? allSummary.gross_profit / allSummary.sales_taxin * 100
        : 0,
      selected_gross_margin: selectedSummary.sales_taxin
        ? selectedSummary.gross_profit / selectedSummary.sales_taxin * 100
        : 0
    },
    relevantPeriodCosts: relevantPeriodCosts
  };
}



function appendOverallPositionMarkdown_(lines, ctx) {
  var op = ctx.overallPosition;
  if (!op) return;

  var all = op.all || {};
  var selected = op.selected || {};
  var shares = op.shares || {};
  var margins = op.margins || {};

  var marginDiff =
    Number(margins.selected_gross_margin || 0) -
    Number(margins.all_gross_margin || 0);

  lines.push('## 2. 全体売上の中での位置付け');
  lines.push('');
  lines.push('対象商品群が、HAKSAI全体の中でどの程度の売上・利益貢献を持つかを見るためのセクションです。');
  lines.push('');
  lines.push('対象期間：直近' + escapeMd_(String(op.periodMonths || ctx.periodMonths || '')) + 'か月');
  lines.push('');

  lines.push('| 指標 | HAKSAI全体 | 対象商品群 | 構成比 / 差分 |');
  lines.push('|---|---:|---:|---:|');
  lines.push('| 販売数量 | ' + fmtNum_(all.qty) + '個 | ' + fmtNum_(selected.qty) + '個 | ' + fmtPct_(shares.qty) + ' |');
  lines.push('| 売上税込 | ' + fmtYen_(all.sales_taxin) + ' | ' + fmtYen_(selected.sales_taxin) + ' | ' + fmtPct_(shares.sales_taxin) + ' |');
  lines.push('| Amazon手取 | ' + fmtYen_(all.net) + ' | ' + fmtYen_(selected.net) + ' | ' + fmtPct_(shares.net) + ' |');
  lines.push('| 着地原価合計 | ' + fmtYen_(all.cost_total) + ' | ' + fmtYen_(selected.cost_total) + ' | - |');
  lines.push('| 粗利 | ' + fmtYen_(all.gross_profit) + ' | ' + fmtYen_(selected.gross_profit) + ' | ' + fmtPct_(shares.gross_profit) + ' |');
  lines.push('| 粗利率 | ' + fmtPct_(margins.all_gross_margin) + ' | ' + fmtPct_(margins.selected_gross_margin) + ' | ' + fmtPtDiff_(marginDiff) + ' |');
  lines.push('| 原価未設定取引数 | ' + fmtNum_(all.no_cost_count) + '件 | ' + fmtNum_(selected.no_cost_count) + '件 | - |');
  lines.push('');

  lines.push('### 全社期間コストの参考');
  lines.push('');
  lines.push('| 指標 | 金額 |');
  lines.push('|---|---:|');
  lines.push('| 全社期間コスト合計 | ' + fmtYen_(all.total_period_costs) + ' |');
  lines.push('| 全社営業利益目安 | ' + fmtYen_(all.operating_profit) + ' |');
  lines.push('');
  lines.push('※ 期間コストは商品別に配賦していない全体費用です。商品単体の粗利とは分けて見てください。');
  lines.push('');

  lines.push('---');
  lines.push('');
}


/**
 * [CHANGED] Step 1：reorderIndexをctxから取り出して使う。
 */
function buildVariantAnalysisForAiExport_(ctx, data) {
  var productByAsin = {};
  var productBySku = {};
 
  ctx.products.forEach(function(p) {
    if (p.asin) productByAsin[p.asin] = p;
  });
 
  ctx.skuRows.forEach(function(s) {
    var asin = String(s.asin || '').trim();
    var sku = String(s.sku || '').trim();
    if (!sku) return;
 
    productBySku[sku] = {
      sku: sku,
      asin: asin,
      fnsku: s.fnsku || '',
      product_name: s.product_name || '',
      product: productByAsin[asin] || {}
    };
  });
 
  var rowsByKey = {};
 
  ctx.transactions.forEach(function(t) {
    var type = String(t.transaction_type || '').trim();
    if (type !== '注文' && type !== '返金') return;
 
    var sku = String(t.sku || '').trim();
    var asin = String(t.asin || '').trim();
 
    var skuInfo = productBySku[sku] || {};
    var product = productByAsin[asin] || skuInfo.product || {};
 
    var key = sku || asin;
    if (!key) return;
 
    var subtitle = String(product.subtitle || '').trim();
 
    var variantSource = [
      subtitle,
      product.title,
      skuInfo.product_name
    ].filter(Boolean).join(' ');
 
    var parsed = parseVariantParts_(variantSource);
 
    var variantColor = parsed.color || '';
    var patternCode = parsed.patternCode || parsed.pattern_code || '';
 
    if (!patternCode) {
      patternCode = extractPatternCodeForVariant_(variantSource);
    }
 
    if (!variantColor || variantColor === '未分類') {
      variantColor = patternCode || '未分類';
    }
 
    if (!rowsByKey[key]) {
      rowsByKey[key] = {
        sku: sku,
        asin: asin,
        fnsku: skuInfo.fnsku || '',
        title: product.title || skuInfo.product_name || '',
        subtitle: subtitle,
        color: variantColor,
        pattern_code: patternCode,
        size: parsed.size,
        qty: 0,
        sales_taxin: 0,
        net: 0,
        cost_total: 0,
        gross_profit: 0,
        gross_profit_per_unit: 0,
        gross_margin: 0,
        tx_count: 0,
        no_cost_count: 0,
        fba_stock: toNumberLoose_(product.fba_stock),
        fba_inbound: toNumberLoose_(product.fba_inbound),
        fba_days_remain: product.fba_days_remain || '',
        fba_alert: product.fba_alert || ''
      };
    }
 
    var row = rowsByKey[key];
 
    var rawQty = Math.abs(toNumberLoose_(t.qty));
    var sign = type === '返金' ? -1 : 1;
    var qty = rawQty * sign;
 
    var sales = toNumberLoose_(t.sales_taxin);
    var net = toNumberLoose_(t.net);
    var orderDate = parseDateLoose_(t.date);
 
    // [CHANGED] インデックスで逆引き
    var landedCost = findLandedCostByIndex_(ctx.reorderIndex, sku, product.id, orderDate);
 
    row.qty += qty;
    row.sales_taxin += sales;
    row.net += net;
    row.tx_count += 1;
 
    if (landedCost !== null && landedCost > 0) {
      var costTotal = landedCost * qty;
      row.cost_total += costTotal;
      row.gross_profit += net - costTotal;
    } else {
      row.no_cost_count += 1;
    }
  });
 
  var variantRows = Object.values(rowsByKey)
    .map(function(r) {
      r.gross_profit_per_unit = r.qty ? Math.round(r.gross_profit / r.qty) : 0;
      r.gross_margin = r.sales_taxin ? (r.gross_profit / r.sales_taxin * 100) : 0;
      return r;
    })
    .sort(function(a, b) {
      return b.qty - a.qty;
    });
 
  return {
    variants: variantRows,
    colors: aggregateVariantDimension_(variantRows, 'color'),
    sizes: aggregateVariantDimension_(variantRows, 'size')
  };
}



function appendVariantAnalysisMarkdown_(lines, ctx) {
  var va = ctx.variantAnalysis || {};
  var variants = va.variants || [];
  var colors = va.colors || [];
  var sizes = va.sizes || [];

  lines.push('## 4. バリエーション別実績');
  lines.push('');
  lines.push('| subtitle | 柄/カラー | サイズ | SKU | ASIN | 数量 | 売上税込 | 手取 | 着地原価 | 粗利 | 粗利/個 | 粗利率 | FBA在庫 | 実質残日数 | アラート |');
  lines.push('|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');

  variants.forEach(function(v) {
    lines.push(
      '|' + escapeMd_(v.subtitle || v.title) +
      '|' + escapeMd_(v.color) +
      '|' + escapeMd_(v.size) +
      '|' + escapeMd_(v.sku) +
      '|' + escapeMd_(v.asin) +
      '|' + fmtNum_(v.qty) +
      '|' + fmtYen_(v.sales_taxin) +
      '|' + fmtYen_(v.net) +
      '|' + fmtYen_(v.cost_total) +
      '|' + fmtYen_(v.gross_profit) +
      '|' + fmtYen_(v.gross_profit_per_unit) +
      '|' + v.gross_margin.toFixed(1) + '%' +
      '|' + fmtNum_(v.fba_stock) +
      '|' + escapeMd_(v.fba_days_remain) +
      '|' + escapeMd_(v.fba_alert) +
      '|'
    );
  });

  if (!variants.length) {
    lines.push('| 該当なし |  |  |  |  | 0 | ¥0 | ¥0 | ¥0 | ¥0 | ¥0 | 0.0% | 0 |  |  |');
  }

  lines.push('');
  lines.push('### 柄/カラーコード別実績');
  lines.push('');
  lines.push('| 柄/カラー | SKU数 | 数量 | 売上税込 | 手取 | 着地原価 | 粗利 | 粗利/個 | 粗利率 | FBA在庫 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');

  colors.forEach(function(c) {
    lines.push(
      '|' + escapeMd_(c.name) +
      '|' + fmtNum_(c.sku_count) +
      '|' + fmtNum_(c.qty) +
      '|' + fmtYen_(c.sales_taxin) +
      '|' + fmtYen_(c.net) +
      '|' + fmtYen_(c.cost_total) +
      '|' + fmtYen_(c.gross_profit) +
      '|' + fmtYen_(c.gross_profit_per_unit) +
      '|' + c.gross_margin.toFixed(1) + '%' +
      '|' + fmtNum_(c.fba_stock) +
      '|'
    );
  });

  if (!colors.length) {
    lines.push('| 該当なし | 0 | 0 | ¥0 | ¥0 | ¥0 | ¥0 | ¥0 | 0.0% | 0 |');
  }

  lines.push('');
  lines.push('### サイズ別実績');
  lines.push('');
  lines.push('| サイズ | SKU数 | 数量 | 売上税込 | 手取 | 着地原価 | 粗利 | 粗利/個 | 粗利率 | FBA在庫 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');

  sizes.forEach(function(s) {
    lines.push(
      '|' + escapeMd_(s.name) +
      '|' + fmtNum_(s.sku_count) +
      '|' + fmtNum_(s.qty) +
      '|' + fmtYen_(s.sales_taxin) +
      '|' + fmtYen_(s.net) +
      '|' + fmtYen_(s.cost_total) +
      '|' + fmtYen_(s.gross_profit) +
      '|' + fmtYen_(s.gross_profit_per_unit) +
      '|' + s.gross_margin.toFixed(1) + '%' +
      '|' + fmtNum_(s.fba_stock) +
      '|'
    );
  });

  if (!sizes.length) {
    lines.push('| 該当なし | 0 | 0 | ¥0 | ¥0 | ¥0 | ¥0 | ¥0 | 0.0% | 0 |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}


/**
 * 後続Markdownセクション。
 */
function appendRecentTransactionsMarkdown_(lines, ctx) {
  lines.push('## 5. 直近トランザクション');
  lines.push('');
  lines.push('| 日付 | 種類 | SKU | ASIN | 数量 | 売上税込 | 手数料 | FBA費用 | 手取 |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|');

  ctx.recentTransactions.forEach(function(t) {
    lines.push(
      '|' + escapeMd_(String(t.date || '').slice(0, 16)) +
      '|' + escapeMd_(t.transaction_type) +
      '|' + escapeMd_(t.sku) +
      '|' + escapeMd_(t.asin) +
      '|' + fmtNum_(t.qty) +
      '|' + fmtYen_(t.sales_taxin) +
      '|' + fmtYen_(t.fee) +
      '|' + fmtYen_(t.fba_fee) +
      '|' + fmtYen_(t.net) +
      '|'
    );
  });

  if (!ctx.recentTransactions.length) {
    lines.push('| 該当なし |  |  |  | 0 | ¥0 | ¥0 | ¥0 | ¥0 |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}


function appendReorderMarkdown_(lines, ctx) {
  lines.push('## 6. 発注・原価履歴');
  lines.push('');
  lines.push('| 発注日 | SKU | 数量 | 1688原価 | 着地原価 | LT | 到着予定 | メモ |');
  lines.push('|---|---|---:|---:|---:|---:|---|---|');

  ctx.reorders
    .slice()
    .sort(function(a, b) {
      var da = parseDateLoose_(a.order_date);
      var db = parseDateLoose_(b.order_date);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    })
    .forEach(function(r) {
      lines.push(
        '|' + escapeMd_(r.order_date) +
        '|' + escapeMd_(r.sku) +
        '|' + fmtNum_(r.quantity) +
        '|' + fmtYen_(r.unit_price_1688) +
        '|' + fmtYen_(r.landed_cost_actual) +
        '|' + fmtNum_(r.lead_time_days) +
        '|' + escapeMd_(r.expected_arrival_date) +
        '|' + escapeMd_(r.notes) +
        '|'
      );
    });

  if (!ctx.reorders.length) {
    lines.push('| 該当なし |  | 0 | ¥0 | ¥0 |  |  |  |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}


function appendInventoryMarkdown_(lines, ctx) {
  lines.push('## 7. 在庫状況');
  lines.push('');

  lines.push('### FBA在庫');
  lines.push('');
  lines.push('| 商品名 | ASIN | FBA在庫 | 入荷予定 | 判定日販 | 実質残日数 | アラート | 同期日 |');
  lines.push('|---|---|---:|---:|---:|---:|---|---|');

  ctx.products.forEach(function(p) {
    lines.push(
      '|' + escapeMd_(p.title) +
      '|' + escapeMd_(p.asin) +
      '|' + fmtNum_(p.fba_stock) +
      '|' + fmtNum_(p.fba_inbound) +
      '|' + fmtDaily_(p.fba_daily_t7) +
      '|' + escapeMd_(p.fba_days_remain) +
      '|' + escapeMd_(p.fba_alert) +
      '|' + escapeMd_(p.fba_synced_at) +
      '|'
    );
  });

  if (!ctx.products.length) {
    lines.push('| 該当なし |  | 0 | 0 | 0 |  |  |  |');
  }

  lines.push('');
  lines.push('### 手元在庫・折コン');
  lines.push('');
  lines.push('| 箱ID | FNSKU | ASIN | free_label | 商品名 | 数量 | 更新日 |');
  lines.push('|---|---|---|---|---|---:|---|');

  ctx.homeItems.forEach(function(i) {
    lines.push(
      '|' + escapeMd_(i.box_id) +
      '|' + escapeMd_(i.fnsku) +
      '|' + escapeMd_(i.asin) +
      '|' + escapeMd_(i.free_label) +
      '|' + escapeMd_(i.product_name) +
      '|' + fmtNum_(i.qty) +
      '|' + escapeMd_(i.updated_at) +
      '|'
    );
  });

  if (!ctx.homeItems.length) {
    lines.push('| 該当なし |  |  |  |  | 0 |  |');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}


function appendPeriodCostsMarkdown_(lines, ctx) {
  var costLabels = {
    ad: '広告費',
    monthly_fee: '月額登録料',
    storage: 'FBA保管手数料',
    long_storage: '長期保管手数料',
    carrier: 'FBA配送料',
    fc_lost: 'FC紛失補填',
    return_fee: '返送手数料',
    other: 'その他'
  };

  var totalCosts = ctx.periodCosts.reduce(function(sum, c) {
    return sum + toNumberLoose_(c.amount);
  }, 0);

  lines.push('## 8. 会計上の期間コスト');
  lines.push('');
  lines.push('※ 期間コストは商品別に配賦していない全体費用です。商品単体の粗利とは分けて見てください。');
  lines.push('');
  lines.push('| 月 | 種別 | 内容 | 金額 |');
  lines.push('|---|---|---|---:|');

  ctx.periodCosts.forEach(function(c) {
    lines.push(
      '|' + escapeMd_(c.period_key) +
      '|' + escapeMd_(costLabels[c.cost_type] || c.cost_type) +
      '|' + escapeMd_(c.description) +
      '|' + fmtYen_(c.amount) +
      '|'
    );
  });

  if (!ctx.periodCosts.length) {
    lines.push('| 該当なし |  |  | ¥0 |');
  }

  lines.push('| **合計** |  |  | **' + fmtYen_(totalCosts) + '** |');
  lines.push('');
  lines.push('---');
  lines.push('');
}


function appendAdMarkdown_(lines, ctx) {
  lines.push('## 9. 広告速報');
  lines.push('');
  lines.push('広告費速報は、利益計算には含めず、運用判断用の参考値として扱います。');
  lines.push('');

  if (ctx.adPerformance.length) {
    lines.push('| 日付/月 | SKU | ASIN | 広告費速報 | 広告売上 | クリック | 注文数 | ACoS |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|');

    ctx.adPerformance.forEach(function(a) {
      lines.push(
        '|' + escapeMd_(a.date || a.period_key) +
        '|' + escapeMd_(a.advertised_sku || a.sku) +
        '|' + escapeMd_(a.advertised_asin || a.asin) +
        '|' + fmtYen_(a.spend) +
        '|' + fmtYen_(a.ad_sales || a.sales) +
        '|' + fmtNum_(a.clicks) +
        '|' + fmtNum_(a.orders) +
        '|' + escapeMd_(a.acos) +
        '|'
      );
    });
  } else {
    lines.push('- 広告速報データ：未取込');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}


function appendAiPromptMarkdown_(lines, ctx) {
  lines.push('## 10. AIへの相談文');
  lines.push('');
  lines.push('以下の商品について、売上・粗利・在庫・発注履歴・全体売上における位置付けを踏まえて分析してください。');
  lines.push('');
  lines.push('特に見てほしい観点：');
  lines.push('');
  lines.push('1. 継続販売すべきか、撤退候補か');
  lines.push('2. 値上げ・値下げ余地があるか');
  lines.push('3. 在庫補充の優先度');
  lines.push('4. 原価・FBA費用・手数料に対して利益が十分か');
  lines.push('5. バリエーション間で強弱があるか');
  lines.push('6. サイズ別・柄/カラーコード別の実績から、次回発注配分をどうすべきか');
  lines.push('7. 商品ページ改善・広告改善の余地');
  lines.push('8. 次に取るべき具体的アクション');
  lines.push('');
  lines.push('注意：');
  lines.push('');
  lines.push('- 営業利益は会計ベースの請求済み費用で見る方針です。');
  lines.push('- 広告レポート由来の広告費速報は、利益計算には含めず、運用判断用の参考値として扱います。');
  lines.push('- 原価は reorder_history の注文日以前最新の landed_cost_actual を優先しています。');
  lines.push('- 期間コストは商品別に配賦していない全体費用です。商品単体の粗利とは分けて見てください。');
  lines.push('- 対象商品群の重要度は、全体売上・全体粗利に対する構成比も踏まえて判断してください。');
}


/**
 * [CHANGED] Step 1：reorders配列の代わりにreorderIndexを受け取る。
 * findLandedCostForTransaction_ → findLandedCostByIndex_ に差し替え。
 */
function aggregateTransactionsByMonthForAiExport_(transactions, reorderIndex, group, products, skuRows) {
  var productByAsin = {};
  products.forEach(function(p) {
    if (p.asin) productByAsin[p.asin] = p;
  });
 
  var map = {};
 
  transactions.forEach(function(t) {
    var type = String(t.transaction_type || '').trim();
    if (type !== '注文' && type !== '返金') return;
 
    var d = parseDateLoose_(t.date);
    var periodKey = t.period_key || (d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM') : '不明');
 
    if (!map[periodKey]) {
      map[periodKey] = {
        period_key: periodKey,
        qty: 0,
        sales_taxin: 0,
        net: 0,
        cost_total: 0,
        gross_profit: 0,
        no_cost_count: 0,
        no_cost_net: 0
      };
    }
 
    var row = map[periodKey];
    var isRefund = type === '返金';
    var qtyRaw = Math.abs(toNumberLoose_(t.qty));
    var qty = isRefund ? -qtyRaw : qtyRaw;
    var net = toNumberLoose_(t.net);
 
    // [CHANGED] インデックスで逆引き
    var product = productByAsin[t.asin] || {};
    var landedCost = findLandedCostByIndex_(reorderIndex, t.sku, product.id, d);
 
    row.qty += qty;
    row.sales_taxin += toNumberLoose_(t.sales_taxin);
    row.net += net;
 
    if (landedCost !== null && landedCost > 0) {
      var costTotal = landedCost * qty;
      row.cost_total += costTotal;
      row.gross_profit += net - costTotal;
    } else {
      row.no_cost_count += 1;
      row.no_cost_net += net;
    }
  });
 
  return Object.values(map).sort(function(a, b) {
    return String(a.period_key).localeCompare(String(b.period_key));
  });
}



function summarizeMonthlyForAiExport_(monthly) {
  var s = {
    qty: 0,
    sales_taxin: 0,
    net: 0,
    cost_total: 0,
    gross_profit: 0,
    no_cost_count: 0,
    no_cost_net: 0
  };

  (monthly || []).forEach(function(m) {
    s.qty += toNumberLoose_(m.qty);
    s.sales_taxin += toNumberLoose_(m.sales_taxin);
    s.net += toNumberLoose_(m.net);
    s.cost_total += toNumberLoose_(m.cost_total);
    s.gross_profit += toNumberLoose_(m.gross_profit);
    s.no_cost_count += toNumberLoose_(m.no_cost_count);
    s.no_cost_net += toNumberLoose_(m.no_cost_net);
  });

  return s;
}


/**
 * [CHANGED] Step 1：reorderIndexを受け取る形に変更。
 */
function summarizeTransactionsForOverallPosition_(transactions, reorderIndex, productByAsin) {
  var summary = {
    qty: 0,
    sales_taxin: 0,
    net: 0,
    cost_total: 0,
    gross_profit: 0,
    no_cost_net: 0,
    no_cost_count: 0,
    tx_count: 0
  };
 
  transactions.forEach(function(t) {
    var type = String(t.transaction_type || '').trim();
    var isRefund = type === '返金';
 
    var qtyRaw = Math.abs(toNumberLoose_(t.qty));
    var qty = isRefund ? -qtyRaw : qtyRaw;
 
    var sales = toNumberLoose_(t.sales_taxin);
    var net = toNumberLoose_(t.net);
 
    var orderDate = parseDateLoose_(t.date);
    var product = productByAsin[t.asin] || {};
 
    // [CHANGED] インデックスで逆引き
    var landedCost = findLandedCostByIndex_(reorderIndex, t.sku, product.id, orderDate);
 
    summary.qty += qty;
    summary.sales_taxin += sales;
    summary.net += net;
    summary.tx_count += 1;
 
    if (landedCost !== null && landedCost > 0) {
      var costTotal = landedCost * qty;
      summary.cost_total += costTotal;
      summary.gross_profit += net - costTotal;
    } else {
      summary.no_cost_net += net;
      summary.no_cost_count += 1;
    }
  });
 
  return summary;
}






/**
 * バリエーション解析。
 */
function parseVariantParts_(text) {
  var raw = String(text || '').trim();
  var normalizedRaw = normalizeAsciiForVariant_(raw).toUpperCase();

  var colors = [
    'ブラック', '黒',
    'シルバー', '銀',
    'ホワイト', '白',
    'グレー', '灰',
    'ブルー', '青',
    'レッド', '赤',
    'カーキ', 'ベージュ', 'ピンク', 'ブラウン',
    'ネイビー', '紺'
  ];

  var sizes = [
    '5XL', '4XL', '3XL', '2XL', 'XL',
    'XXXL', 'XXL',
    'XS', 'S', 'M', 'L',
    'SMALL', 'MEDIUM', 'LARGE'
  ];

  var color = '';
  var size = '';

  var patternCode = extractPatternCodeForVariant_(normalizedRaw);

  colors.forEach(function(c) {
    if (!color && raw.indexOf(c) >= 0) color = c;
  });

  sizes
    .slice()
    .sort(function(a, b) { return b.length - a.length; })
    .forEach(function(s) {
      var re = new RegExp('(^|[^A-Z0-9])' + escapeRegExpForVariant_(s) + '([^A-Z0-9]|$)', 'i');
      if (!size && re.test(normalizedRaw)) size = s;
    });

  var normalizedColor = normalizeVariantColor_(color || '');

  return {
    color: normalizedColor || patternCode || '未分類',
    patternCode: patternCode || '',
    size: normalizeVariantSize_(size || '未分類')
  };
}


function extractPatternCodeForVariant_(text) {
  var s = normalizeAsciiForVariant_(String(text || '')).toUpperCase();

  var m = s.match(/A[\s\-_]*([0-9]{1,3})/);
  if (!m) return '';

  return 'A' + String(m[1]).padStart(2, '0');
}


function normalizeAsciiForVariant_(value) {
  return String(value || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
}


function normalizeVariantColor_(color) {
  var c = String(color || '').trim();

  if (c === '黒') return 'ブラック';
  if (c === '銀') return 'シルバー';
  if (c === '白') return 'ホワイト';
  if (c === '灰') return 'グレー';
  if (c === '青') return 'ブルー';
  if (c === '赤') return 'レッド';
  if (c === '紺') return 'ネイビー';

  return c || '';
}


function normalizeVariantSize_(size) {
  var s = String(size || '').trim().toUpperCase();

  if (s === 'XXL') return '2XL';
  if (s === 'XXXL') return '3XL';
  if (s === 'SMALL') return 'S';
  if (s === 'MEDIUM') return 'M';
  if (s === 'LARGE') return 'L';

  return s || '未分類';
}


function aggregateVariantDimension_(variantRows, key) {
  var map = {};

  variantRows.forEach(function(v) {
    var name = v[key] || '未分類';

    if (!map[name]) {
      map[name] = {
        name: name,
        qty: 0,
        sales_taxin: 0,
        net: 0,
        cost_total: 0,
        gross_profit: 0,
        fba_stock: 0,
        fba_inbound: 0,
        sku_count: 0
      };
    }

    map[name].qty += v.qty;
    map[name].sales_taxin += v.sales_taxin;
    map[name].net += v.net;
    map[name].cost_total += v.cost_total;
    map[name].gross_profit += v.gross_profit;
    map[name].fba_stock += toNumberLoose_(v.fba_stock);
    map[name].fba_inbound += toNumberLoose_(v.fba_inbound);
    map[name].sku_count += 1;
  });

  return Object.values(map)
    .map(function(r) {
      r.gross_profit_per_unit = r.qty ? Math.round(r.gross_profit / r.qty) : 0;
      r.gross_margin = r.sales_taxin ? (r.gross_profit / r.sales_taxin * 100) : 0;
      return r;
    })
    .sort(function(a, b) {
      return b.qty - a.qty;
    });
}


/**
 * 行正規化。
 */
function normalizeProductRow_(r) {
  return {
    id: pick_(r, ['id', 'product_id']),
    title: pick_(r, ['title', '商品名', 'product_name']),
    subtitle: pick_(r, ['subtitle', 'バリエーション名']),
    asin: pick_(r, ['asin', 'ASIN']),
    parent_asin: pick_(r, ['parent_asin', '親ASIN']),
    status: pick_(r, ['status']),
    emoji: pick_(r, ['emoji']),
    summary: pick_(r, ['summary']),
    amazon_url: pick_(r, ['amazon_url']),
    current_landed_cost: pick_(r, ['current_landed_cost', 'landed_cost_actual']),
    fba_stock: pick_(r, ['fba_stock', 'available']),
    fba_inbound: pick_(r, ['fba_inbound', 'inbound']),
    fba_daily_t7: pick_(r, ['fba_daily_t7', 'alert_daily_used']),
    fba_days_remain: pick_(r, ['fba_days_remain', 'alert_days_remain']),
    fba_alert: pick_(r, ['fba_alert']),
    fba_synced_at: pick_(r, ['fba_synced_at'])
  };
}


function normalizeSkuMasterRow_(r) {
  return {
    sku: pick_(r, ['sku', 'SKU']),
    asin: pick_(r, ['asin', 'ASIN']),
    fnsku: pick_(r, ['fnsku', 'FNSKU']),
    product_name: pick_(r, ['product_name', 'title', '商品名'])
  };
}


function normalizeReorderRow_(r) {
  return {
    id: pick_(r, ['id']),
    product_id: pick_(r, ['product_id']),
    sku: pick_(r, ['sku', 'SKU']),
    order_date: pick_(r, ['order_date', '発注日']),
    quantity: pick_(r, ['quantity', 'qty', 'ロット数']),
    unit_price_1688: pick_(r, ['unit_price_1688', '1688原価']),
    landed_cost_actual: pick_(r, ['landed_cost_actual', '着地原価']),
    lead_time_days: pick_(r, ['lead_time_days', 'LT']),
    expected_arrival_date: pick_(r, ['expected_arrival_date', '到着予定日']),
    fba_fee_at_order: pick_(r, ['fba_fee_at_order']),
    selling_price_at_order: pick_(r, ['selling_price_at_order']),
    notes: pick_(r, ['notes', 'memo', 'メモ'])
  };
}


function normalizeTransactionRow_(r) {
  var type = pick_(r, ['transaction_type', 'type', 'トランザクションの種類']);

  return {
    date: pick_(r, ['date', '日付/時間', 'order_date']),
    period_key: pick_(r, ['period_key']),
    order_id: pick_(r, ['order_id', 'orderId', '注文番号']),
    transaction_type: type,
    sku: pick_(r, ['sku', 'SKU']),
    asin: pick_(r, ['asin', 'ASIN']),
    description: pick_(r, ['description', 'desc', '説明']),
    qty: pick_(r, ['qty', 'quantity', '数量']),
    sales_taxin: pick_(r, ['sales_taxin', 'salesTaxin', '商品売上税込']),
    fee: pick_(r, ['fee', '手数料']),
    fba_fee: pick_(r, ['fba_fee', 'fbaFee', 'FBA 手数料']),
    discount: pick_(r, ['discount', 'プロモーション割引額']),
    points: pick_(r, ['points', 'Amazonポイントの費用']),
    net: pick_(r, ['net', 'total', '合計'])
  };
}


function normalizePeriodCostRow_(r) {
  return {
    period_key: pick_(r, ['period_key', 'period']),
    cost_type: pick_(r, ['cost_type', 'costType', 'type']),
    description: pick_(r, ['description', 'desc', '内容']),
    amount: pick_(r, ['amount', '金額'])
  };
}


function normalizeHomeItemRow_(r) {
  return {
    box_id: pick_(r, ['box_id']),
    fnsku: pick_(r, ['fnsku']),
    asin: pick_(r, ['asin']),
    free_label: pick_(r, ['free_label']),
    product_name: pick_(r, ['product_name']),
    qty: pick_(r, ['qty', 'quantity']),
    updated_at: pick_(r, ['updated_at'])
  };
}


function normalizeHomeLogRow_(r) {
  return {
    timestamp: pick_(r, ['timestamp', 'date']),
    box_id: pick_(r, ['box_id']),
    sku: pick_(r, ['sku']),
    asin: pick_(r, ['asin']),
    fnsku: pick_(r, ['fnsku']),
    type: pick_(r, ['type']),
    qty: pick_(r, ['qty']),
    memo: pick_(r, ['memo'])
  };
}


function normalizeAdRow_(r) {
  return {
    date: pick_(r, ['date']),
    period_key: pick_(r, ['period_key']),
    advertised_sku: pick_(r, ['advertised_sku', 'sku']),
    advertised_asin: pick_(r, ['advertised_asin', 'asin']),
    sku: pick_(r, ['sku']),
    asin: pick_(r, ['asin']),
    spend: pick_(r, ['spend', 'cost', '広告費']),
    ad_sales: pick_(r, ['ad_sales', 'sales', '広告売上']),
    clicks: pick_(r, ['clicks']),
    orders: pick_(r, ['orders']),
    acos: pick_(r, ['acos', 'ACoS'])
  };
}


/**
 * [CHANGED] Step 3：getDisplayValues → getValues に変更。
 * parseDateLoose_ と toNumberLoose_ が生データを処理できるので問題なし。
 */
function getSheetObjectsForAiExport_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
 
  var values = sheet.getDataRange().getValues(); // [CHANGED] getDisplayValues → getValues
 
  if (values.length < 2) return [];
 
  var headers = values[0].map(function(h) {
    return String(h || '').trim();
  });
 
  return values.slice(1)
    .filter(function(row) {
      return row.some(function(v) {
        return String(v || '').trim() !== '';
      });
    })
    .map(function(row, i) {
      var obj = { __rowNumber: i + 2 };
 
      headers.forEach(function(h, col) {
        if (!h) return;
        // [CHANGED] Dateオブジェクトはそのまま保持、他はString変換
        var val = row[col];
        obj[h] = (val instanceof Date) ? val : String(val === null || val === undefined ? '' : val).trim();
      });
 
      return obj;
    });
}



/**
 * 汎用helper。
 */
function pick_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return String(obj[k]).trim();
    }
  }
  return '';
}


function toNumberLoose_(value) {
  if (typeof value === 'number') return value;

  var s = String(value || '')
    .replace(/[,\s¥￥]/g, '')
    .replace(/%$/, '');

  if (!s) return 0;

  var n = Number(s);
  return isNaN(n) ? 0 : n;
}


function parseDateLoose_(value) {
  if (!value) return null;

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value;
  }

  var s = String(value).trim();
  if (!s) return null;

  var iso = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  var monthMap = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };

  var eng = s.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (eng && monthMap[eng[1]] !== undefined) {
    return new Date(Number(eng[3]), monthMap[eng[1]], Number(eng[2]));
  }

  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  return null;
}


function getPeriodKeysFromTransactions_(transactions) {
  var set = {};

  transactions.forEach(function(t) {
    var key = String(t.period_key || '').trim();

    if (!key) {
      var d = parseDateLoose_(t.date);
      if (d) {
        key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
      }
    }

    if (key) set[key] = true;
  });

  return Object.keys(set).sort();
}


function toSet_(arr) {
  var set = {};
  (arr || []).forEach(function(v) {
    if (v) set[String(v)] = true;
  });
  return set;
}


function uniqueArray_(arr) {
  var set = {};
  var result = [];

  (arr || []).forEach(function(v) {
    var s = String(v || '').trim();
    if (!s || set[s]) return;
    set[s] = true;
    result.push(s);
  });

  return result;
}


function normalizeKey_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[ 　\t\r\n]/g, '')
    .replace(/[【】「」『』"'“”]/g, '')
    .trim();
}


function escapeMd_(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}


function escapeRegExpForVariant_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function fmtYen_(value) {
  var n = Math.round(toNumberLoose_(value));
  var sign = n < 0 ? '-' : '';
  return sign + '¥' + Math.abs(n).toLocaleString('ja-JP');
}


function fmtNum_(value) {
  var n = toNumberLoose_(value);
  return Math.round(n).toLocaleString('ja-JP');
}


function fmtDaily_(value) {
  if (value === null || value === undefined || value === '') return '';

  var n = Number(value);
  if (!isFinite(n)) return String(value);

  if (n === 0) return '0';

  return n.toFixed(1).replace(/\.0$/, '');
}


function fmtPct_(value) {
  var n = Number(value || 0);
  return n.toFixed(1) + '%';
}


function fmtPtDiff_(value) {
  var n = Number(value || 0);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + 'pt';
}


function ratioForOverall_(part, total) {
  var p = Number(part || 0);
  var t = Number(total || 0);
  if (!t) return 0;
  return p / t * 100;
}


function formatDateTime_(date) {
  if (!date) return '';

  return Utilities.formatDate(
    new Date(date),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}


function sanitizeFilename_(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 120);
}