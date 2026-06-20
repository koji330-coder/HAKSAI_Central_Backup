/****************************************************
 * HAKSAI Central
 * parent_asin メンテナンス関数
 *
 * 目的：
 * - 商品名からバリエーション候補を推定
 * - parent_asin_candidates シートを生成
 * - 手入力された parent_asin を product_lifecycle に反映
 ****************************************************/

const HAKSAI_PARENT_MAINT_SPREADSHEET_ID = '1w71T_U8dDRK9FKhAbFP7JqPKuHWxDkJe1Cu2ISjHBsw';

const PARENT_CANDIDATE_SHEET = 'parent_asin_candidates';
const PRODUCT_LIFECYCLE_SHEET = 'product_lifecycle';
const SKU_MASTER_SHEET = 'sku_master';

/**
 * メイン1：
 * 商品名から parent_asin 候補シートを作る。
 */
function exportParentAsinCandidates() {
  const ss = SpreadsheetApp.openById(HAKSAI_PARENT_MAINT_SPREADSHEET_ID);

  const products = getSheetObjectsWithRowNumber_(ss, PRODUCT_LIFECYCLE_SHEET);
  const skuRows = getSheetObjectsWithRowNumber_(ss, SKU_MASTER_SHEET);

  const skuByAsin = buildSkuByAsinMap_(skuRows);

  const grouped = buildParentCandidateGroups_(products, skuByAsin);

  writeParentCandidateSheet_(ss, grouped);

  Logger.log(`parent_asin候補を出力しました。候補グループ数: ${grouped.length}`);

  return {
    status: 'ok',
    sheetName: PARENT_CANDIDATE_SHEET,
    groupCount: grouped.length,
  };
}

/**
 * メイン2：
 * parent_asin_candidates シートの手入力内容を product_lifecycle に反映する。
 *
 * apply が TRUE / true / 1 / yes / はい / y の行だけ反映。
 */
function applyParentAsinCandidates() {
  const ss = SpreadsheetApp.openById(HAKSAI_PARENT_MAINT_SPREADSHEET_ID);

  const productSheet = ss.getSheetByName(PRODUCT_LIFECYCLE_SHEET);
  if (!productSheet) throw new Error(`${PRODUCT_LIFECYCLE_SHEET} シートが見つかりません。`);

  const candidateRows = getSheetObjectsWithRowNumber_(ss, PARENT_CANDIDATE_SHEET);
  if (!candidateRows.length) {
    throw new Error(`${PARENT_CANDIDATE_SHEET} に反映対象がありません。`);
  }

  // 念のためバックアップ。人間が手入力した直後は、バックアップが心の保険です。
  backupSheet_(ss, PRODUCT_LIFECYCLE_SHEET);

  const productValues = productSheet.getDataRange().getValues();
  const headers = productValues[0].map(h => String(h || '').trim());
  const headerMap = makeHeaderMap_(headers);

  const asinCol = mustGetCol_(headerMap, 'asin');
  const idCol = headerMap.id !== undefined ? headerMap.id : null;

  // parent_asin列がなければ作る
  let parentCol = headerMap.parent_asin;
  if (parentCol === undefined) {
    parentCol = headers.length;
    productSheet.getRange(1, parentCol + 1).setValue('parent_asin');
  }

  // product_lifecycle の asin / id から行番号を引けるようにする
  const rowByAsin = {};
  const rowById = {};

  for (let r = 1; r < productValues.length; r++) {
    const row = productValues[r];
    const asin = String(row[asinCol] || '').trim();
    const id = idCol !== null ? String(row[idCol] || '').trim() : '';

    if (asin) rowByAsin[asin] = r + 1; // sheet row number
    if (id) rowById[id] = r + 1;
  }

  const logs = [];
  let updated = 0;
  let skipped = 0;

  candidateRows.forEach(row => {
    const apply = isTruthy_(row.apply);
    if (!apply) {
      skipped++;
      return;
    }

    const parentAsin = String(row.parent_asin_to_apply || '').trim();
    if (!parentAsin) {
      skipped++;
      logs.push([
        new Date(),
        'skip',
        row.asin || '',
        '',
        'parent_asin_to_apply が空欄',
      ]);
      return;
    }

    const asin = String(row.asin || '').trim();
    const productId = String(row.product_id || '').trim();

    const targetRow = productId && rowById[productId]
      ? rowById[productId]
      : rowByAsin[asin];

    if (!targetRow) {
      skipped++;
      logs.push([
        new Date(),
        'skip',
        asin,
        parentAsin,
        'product_lifecycle 側に対象行が見つからない',
      ]);
      return;
    }

    const current = String(productSheet.getRange(targetRow, parentCol + 1).getValue() || '').trim();

    if (current === parentAsin) {
      skipped++;
      logs.push([
        new Date(),
        'skip',
        asin,
        parentAsin,
        '既に同じ parent_asin',
      ]);
      return;
    }

    productSheet.getRange(targetRow, parentCol + 1).setValue(parentAsin);

    updated++;
    logs.push([
      new Date(),
      'update',
      asin,
      parentAsin,
      `旧値: ${current || '(空欄)'}`,
    ]);
  });

  writeParentApplyLog_(ss, logs);

  Logger.log(`parent_asin反映完了。更新: ${updated}, スキップ: ${skipped}`);

  return {
    status: 'ok',
    updated,
    skipped,
  };
}

/**
 * 商品名からグループ候補を作る。
 */
function buildParentCandidateGroups_(products, skuByAsin) {
  const groupMap = {};

  products.forEach(p => {
    const asin = String(p.asin || '').trim();
    const title = String(p.title || '').trim();

    if (!asin || !title) return;

    const subtitle = String(p.subtitle || '').trim();
    const parentAsin = String(p.parent_asin || '').trim();

    const base = makeBaseProductTitle_(title, subtitle);
    const groupKey = normalizeGroupKey_(base);

    // 短すぎるキーは危険。雑な網で全商品をすくう妖怪になる。
    if (!groupKey || groupKey.length < 12) return;

    if (!groupMap[groupKey]) {
      groupMap[groupKey] = {
        groupKey,
        baseTitle: base,
        products: [],
      };
    }

    const skuInfo = skuByAsin[asin] || [];

    groupMap[groupKey].products.push({
      product_id: p.id || '',
      asin,
      sku: skuInfo.map(s => s.sku).filter(Boolean).join(', '),
      fnsku: skuInfo.map(s => s.fnsku).filter(Boolean).join(', '),
      title,
      subtitle,
      current_parent_asin: parentAsin,
      status: p.status || '',
      fba_stock: p.fba_stock || '',
      fba_inbound: p.fba_inbound || '',
      fba_alert: p.fba_alert || '',
      rowNumber: p.__rowNumber,
    });
  });

  const groups = Object.values(groupMap)
    .filter(g => g.products.length >= 2)
    .map((g, index) => {
      const existingParents = unique_(
        g.products
          .map(p => p.current_parent_asin)
          .filter(Boolean)
      );

      const proposedParent = existingParents.length === 1
        ? existingParents[0]
        : chooseProposedParentAsin_(g.products);

      return {
        groupNo: index + 1,
        groupKey: g.groupKey,
        baseTitle: g.baseTitle,
        confidence: estimateGroupConfidence_(g),
        proposedParent,
        existingParents,
        products: g.products,
      };
    })
    .sort((a, b) => {
      if (b.products.length !== a.products.length) return b.products.length - a.products.length;
      return b.confidence - a.confidence;
    });

  // groupNoを並び替え後に振り直す
  groups.forEach((g, i) => {
    g.groupNo = i + 1;
  });

  return groups;
}

/**
 * 商品名からベースタイトルを作る。
 *
 * 例：
 * バイクカバー ...（シルバー・XL）
 * → バイクカバー ...
 */
function makeBaseProductTitle_(title, subtitle) {
  let t = String(title || '').trim();
  const sub = String(subtitle || '').trim();

  if (sub) {
    const escapedSub = escapeRegExp_(sub);

    // 末尾の（subtitle）を削る
    t = t.replace(new RegExp(`\\s*[（(]\\s*${escapedSub}\\s*[）)]\\s*$`, 'i'), '');

    // 末尾に subtitle が裸で付いているケースも削る
    t = t.replace(new RegExp(`\\s+${escapedSub}\\s*$`, 'i'), '');
  }

  // 末尾の括弧内が色・サイズっぽい場合は削る
  t = t.replace(/\s*[（(][^）)]*(ブラック|黒|シルバー|銀|ホワイト|白|グレー|灰|ブルー|青|レッド|赤|XL|2XL|3XL|4XL|L|M|S|サイズ|カラー)[^）)]*[）)]\s*$/i, '');

  // よくある末尾の色・サイズ表記を削る
  t = t.replace(/\s+(ブラック|黒|シルバー|銀|ホワイト|白|グレー|灰|ブルー|青|レッド|赤)\s*[・\/\-]?\s*(XL|2XL|3XL|4XL|L|M|S)\s*$/i, '');

  return t.trim();
}

/**
 * グルーピング用に正規化。
 */
function normalizeGroupKey_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[ 　\t\r\n]/g, '')
    .replace(/[【】「」『』"'“”]/g, '')
    .replace(/[・･\/／\-－ー_＿]/g, '')
    .replace(/[（）()]/g, '')
    .trim();
}

/**
 * parent_asin候補を選ぶ。
 * 既存parentがない場合は、ひとまず最初のASINを代表として出す。
 * 本番反映は人間が parent_asin_to_apply に入れた値だけ。
 */
function chooseProposedParentAsin_(products) {
  const withCurrent = products.find(p => p.current_parent_asin);
  if (withCurrent) return withCurrent.current_parent_asin;

  // 在庫や売上情報はここでは見ない。変に賢ぶると事故るので、代表ASINはあくまで仮。
  return products[0]?.asin || '';
}

/**
 * 信頼度をざっくり出す。
 */
function estimateGroupConfidence_(group) {
  let score = 60;

  const count = group.products.length;
  if (count >= 3) score += 10;
  if (count >= 5) score += 10;

  const subtitles = group.products.map(p => p.subtitle).filter(Boolean);
  if (subtitles.length >= Math.max(2, count - 1)) score += 10;

  const parents = unique_(group.products.map(p => p.current_parent_asin).filter(Boolean));
  if (parents.length === 1) score += 10;
  if (parents.length > 1) score -= 20;

  return Math.max(0, Math.min(100, score));
}

/**
 * 候補シートを書き出す。
 */
function writeParentCandidateSheet_(ss, groups) {
  let sheet = ss.getSheetByName(PARENT_CANDIDATE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PARENT_CANDIDATE_SHEET);
  }

  sheet.clear();

  const headers = [
    'apply',
    'parent_asin_to_apply',
    'group_no',
    'confidence',
    'proposed_parent_asin',
    'existing_parent_asins',
    'base_title',
    'product_count',
    'product_id',
    'asin',
    'sku',
    'fnsku',
    'title',
    'subtitle',
    'current_parent_asin',
    'status',
    'fba_stock',
    'fba_inbound',
    'fba_alert',
    'product_lifecycle_row',
    'memo',
  ];

  const rows = [headers];

  groups.forEach(g => {
    g.products.forEach(p => {
      rows.push([
        '',
        '',
        g.groupNo,
        g.confidence,
        g.proposedParent,
        g.existingParents.join(', '),
        g.baseTitle,
        g.products.length,
        p.product_id,
        p.asin,
        p.sku,
        p.fnsku,
        p.title,
        p.subtitle,
        p.current_parent_asin,
        p.status,
        p.fba_stock,
        p.fba_inbound,
        p.fba_alert,
        p.rowNumber,
        '',
      ]);
    });
  });

  if (rows.length === 1) {
    rows.push([
      '',
      '',
      '',
      '',
      '',
      '',
      '候補なし',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '商品名から推定できる複数候補はありませんでした。',
    ]);
  }

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  // 見やすさ。人間は色がないとすぐ森で迷う。
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#222222');
  headerRange.setFontColor('#ffffff');

  const applyCol = headers.indexOf('apply') + 1;
  const parentCol = headers.indexOf('parent_asin_to_apply') + 1;
  const confidenceCol = headers.indexOf('confidence') + 1;

  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(7, 420);
  sheet.setColumnWidth(13, 520);
  sheet.setColumnWidth(21, 260);

  if (rows.length > 1) {
    sheet.getRange(2, applyCol, rows.length - 1, 1).insertCheckboxes();

    // 手入力列を薄黄色
    sheet.getRange(2, parentCol, rows.length - 1, 1).setBackground('#fff2cc');

    // confidence列
    sheet.getRange(2, confidenceCol, rows.length - 1, 1).setBackground('#eaf2f8');
  }

  // フィルタ
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, rows.length, headers.length).createFilter();
}

/**
 * sku_master を ASINで引けるようにする。
 */
function buildSkuByAsinMap_(skuRows) {
  const map = {};

  skuRows.forEach(s => {
    const asin = String(s.asin || '').trim();
    if (!asin) return;

    if (!map[asin]) map[asin] = [];

    map[asin].push({
      sku: s.sku || '',
      fnsku: s.fnsku || '',
      product_name: s.product_name || '',
    });
  });

  return map;
}

/**
 * シートをオブジェクト配列として取得。
 */
function getSheetObjectsWithRowNumber_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h || '').trim());

  return values.slice(1)
    .filter(row => row.some(v => String(v || '').trim() !== ''))
    .map((row, i) => {
      const obj = {
        __rowNumber: i + 2,
      };

      headers.forEach((h, col) => {
        if (!h) return;
        obj[h] = row[col];
      });

      return obj;
    });
}

/**
 * 反映ログを書く。
 */
function writeParentApplyLog_(ss, logs) {
  const sheetName = 'parent_asin_apply_log';
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 5).setValues([[
      'timestamp',
      'action',
      'asin',
      'parent_asin',
      'message',
    ]]);
    sheet.setFrozenRows(1);
  }

  if (!logs.length) return;

  sheet
    .getRange(sheet.getLastRow() + 1, 1, logs.length, 5)
    .setValues(logs);

  sheet.autoResizeColumns(1, 5);
}

/**
 * 反映前バックアップ。
 */
function backupSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`${sheetName} が見つかりません。`);

  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );

  const backupName = `${sheetName}_backup_${timestamp}`;

  const copied = sheet.copyTo(ss);
  copied.setName(backupName);

  // シートが増えすぎるとまたあなたが泣くので、必要なら後で古いbackup掃除関数を作る。
  return backupName;
}

function makeHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i;
  });
  return map;
}

function mustGetCol_(headerMap, name) {
  if (headerMap[name] === undefined) {
    throw new Error(`必要な列が見つかりません: ${name}`);
  }
  return headerMap[name];
}

function isTruthy_(value) {
  const s = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'はい', '反映', 'apply'].includes(s);
}

function unique_(arr) {
  const set = {};
  const result = [];

  (arr || []).forEach(v => {
    const s = String(v || '').trim();
    if (!s) return;
    if (set[s]) return;
    set[s] = true;
    result.push(s);
  });

  return result;
}

function escapeRegExp_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function debugMissingLandedCostForProduct() {
  const result = debugMissingLandedCostForQuery_({
    query: 'B0FS7M89XY',
    includeVariations: true,
    periodMonths: 6,
    writeSheet: true,
  });

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function debugMissingLandedCostForQuery_(options) {
  options = options || {};

  const query = String(options.query || '').trim();
  if (!query) throw new Error('query は必須です。');

  const ss = SpreadsheetApp.openById(HAKSAI_AI_EXPORT_SPREADSHEET_ID);
  const data = loadHaksaiAiExportData_(ss);
  const group = resolveProductGroupForAiExport_(data, query, options.includeVariations !== false);

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - Number(options.periodMonths || 6));

  const asinSet = {};
  const skuSet = {};

  group.asins.forEach(a => asinSet[a] = true);
  group.skus.forEach(s => skuSet[s] = true);

  data.skuMaster.forEach(s => {
    if (s.asin && asinSet[s.asin]) {
      if (s.sku) skuSet[s.sku] = true;
    }
  });

  const productByAsin = {};
  data.products.forEach(p => {
    if (p.asin) productByAsin[p.asin] = p;
  });

  const rows = [];

  data.transactions.forEach(t => {
    const sku = String(t.sku || '').trim();
    const asin = String(t.asin || '').trim();

    if (!skuSet[sku] && !asinSet[asin]) return;

    const orderDate = parseDateLoose_(t.date);
    if (orderDate && orderDate < cutoff) return;

    const landedCost = findLandedCostForTransaction_(
      t,
      orderDate,
      data.reorders,
      group,
      productByAsin
    );

    if (landedCost !== null && landedCost !== undefined && !isNaN(landedCost)) {
      return;
    }

    const skuReorders = data.reorders
      .filter(r => String(r.sku || '').trim() === sku)
      .map(r => ({
        order_date: String(r.order_date || '').trim(),
        landed_cost_actual: String(r.landed_cost_actual || '').trim(),
        quantity: String(r.quantity || '').trim(),
        notes: String(r.notes || '').trim(),
      }))
      .sort((a, b) => {
        const da = parseDateLoose_(a.order_date);
        const db = parseDateLoose_(b.order_date);
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
      });

    const before = skuReorders.filter(r => {
      const d = parseDateLoose_(r.order_date);
      return d && orderDate && d.getTime() <= orderDate.getTime();
    });

    const after = skuReorders.filter(r => {
      const d = parseDateLoose_(r.order_date);
      return d && orderDate && d.getTime() > orderDate.getTime();
    });

    let reason = '';

    if (!skuReorders.length) {
      reason = 'reorder_history に同一SKUの発注履歴なし';
    } else if (!before.length && after.length) {
      reason = '同一SKUの発注履歴はあるが、すべて注文日より後';
    } else if (before.length) {
      reason = '注文日以前の発注履歴はあるが landed_cost_actual が空欄または数値化不可';
    } else {
      reason = '原因不明';
    }

    rows.push({
      date: t.date || '',
      period_key: t.period_key || '',
      transaction_type: t.transaction_type || '',
      sku,
      asin,
      qty: t.qty || '',
      sales_taxin: t.sales_taxin || '',
      net: t.net || '',
      title: productByAsin[asin]?.title || '',
      subtitle: productByAsin[asin]?.subtitle || '',
      reason,
      previous_reorder_count: before.length,
      next_reorder_date: after[0]?.order_date || '',
      next_landed_cost: after[0]?.landed_cost_actual || '',
      all_reorders_for_sku: skuReorders.map(r => `${r.order_date}: ${r.landed_cost_actual}`).join(' / '),
    });
  });

  if (options.writeSheet) {
    writeMissingLandedCostDebugSheet_(ss, rows);
  }

  return {
    status: 'ok',
    query,
    missingCount: rows.length,
    rows,
  };
}

function writeMissingLandedCostDebugSheet_(ss, rows) {
  const sheetName = 'debug_missing_landed_cost';
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clear();

  const headers = [
    'date',
    'period_key',
    'transaction_type',
    'sku',
    'asin',
    'qty',
    'sales_taxin',
    'net',
    'title',
    'subtitle',
    'reason',
    'previous_reorder_count',
    'next_reorder_date',
    'next_landed_cost',
    'all_reorders_for_sku',
  ];

  const values = [headers];

  rows.forEach(r => {
    values.push(headers.map(h => r[h] ?? ''));
  });

  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#222222');
  headerRange.setFontColor('#ffffff');

  if (values.length > 1) {
    sheet.getRange(2, 11, values.length - 1, 1).setBackground('#fff2cc');
  }

  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, values.length, headers.length).createFilter();
}