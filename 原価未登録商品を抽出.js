function exportMissingSkus() {
  // ── reorder_history のSKUキーセットを作成 ──
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rPidIdx  = reorderHdrs.indexOf('product_id');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  const reorderSkus = new Set();
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx]  || '').trim();
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (sku && cost) reorderSkus.add(sku);
  }

  // product_id で登録されているものも除外対象に
  const reorderPids = new Set();
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx]  || '').trim();
    const pid  = String(reorderData[i][rPidIdx]  || '').trim();
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (!sku && pid && cost) reorderPids.add(pid);
  }

  // ── sku_master・product_lifecycle のマップ ──
  const skuToAsin = buildSkuToAsinMap_();

  const lcSheet    = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData     = lcSheet.getDataRange().getValues();
  const lcHdrs     = lcData[0];
  const lcAsinIdx  = lcHdrs.indexOf('asin');
  const lcTitleIdx = lcHdrs.indexOf('title');
  const lcIdIdx    = lcHdrs.indexOf('id');

  const asinToMeta = {};
  for (let i = 1; i < lcData.length; i++) {
    const asin = String(lcData[i][lcAsinIdx] || '').trim();
    if (!asin) continue;
    asinToMeta[asin] = {
      title: lcData[i][lcTitleIdx] || '',
      pid:   String(lcData[i][lcIdIdx] || '').trim(),
    };
  }

  // ── transaction_history を集計 ──
  const txSheet  = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData   = txSheet.getDataRange().getValues();
  const txHdrs   = txData[0];
  const tSku     = txHdrs.indexOf('sku');
  const tAsin    = txHdrs.indexOf('asin');
  const tType    = txHdrs.indexOf('transaction_type');
  const tDate    = txHdrs.indexOf('date');
  const tTaxin   = txHdrs.indexOf('sales_taxin');
  const tNet     = txHdrs.indexOf('net');
  const tQty     = txHdrs.indexOf('qty');

  const missing = {};
  for (let i = 1; i < txData.length; i++) {
    const type = String(txData[i][tType] || '');
    if (type !== '注文') continue;

    const sku  = String(txData[i][tSku]  || '').trim();
    const asin = String(txData[i][tAsin] || '').trim() || skuToAsin[sku] || '';
    if (!sku) continue;

    // すでに原価登録済みならスキップ
    if (reorderSkus.has(sku)) continue;
    const pid = asinToMeta[asin] ? asinToMeta[asin].pid : '';
    if (pid && reorderPids.has(pid)) continue;

    const date  = String(txData[i][tDate]  || '').slice(0, 10);
    const taxin = Number(txData[i][tTaxin]) || 0;
    const net   = Number(txData[i][tNet])   || 0;
    const qty   = Number(txData[i][tQty])   || 0;

    if (!missing[sku]) {
      missing[sku] = {
        asin,
        title:    asinToMeta[asin] ? asinToMeta[asin].title : '',
        count:    0,
        taxin:    0,
        net:      0,
        firstDate: date,
        lastDate:  date,
      };
    }
    const m = missing[sku];
    m.count += qty;
    m.taxin += taxin;
    m.net   += net;
    if (date < m.firstDate) m.firstDate = date;
    if (date > m.lastDate)  m.lastDate  = date;
  }

  // ── missing_skus シートに出力 ──
  const ss = getSpreadsheet_();
  let outSheet = ss.getSheetByName('missing_skus');
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet('missing_skus');

  const headers = [
    'sku', 'asin', '商品名', '販売数', '売上税込', '手取合計',
    '最初の注文日', '最後の注文日', '着地原価（手入力）', '適用開始日（手入力）'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');

  const rows = Object.entries(missing)
    .sort((a, b) => b[1].net - a[1].net)
    .map(([sku, m]) => [
      sku, m.asin, m.title,
      m.count,
      Math.round(m.taxin),
      Math.round(m.net),
      m.firstDate, m.lastDate,
      '', // 着地原価（手入力）
      '', // 適用開始日（手入力）← 空欄なら最初の注文日を使う
    ]);

  if (rows.length) {
    outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    // 書式設定
    outSheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0');
    outSheet.getRange(2, 9, rows.length, 1).setNumberFormat('#,##0');
  }

  outSheet.setColumnWidth(3, 300); // 商品名列を広く
  outSheet.setFrozenRows(1);
  outSheet.setColumnWidth(9, 160);
  outSheet.setColumnWidth(10, 160);

  Logger.log(`missing_skus: ${rows.length}件出力`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${rows.length}件を missing_skus シートに出力しました。着地原価を入力後、importFromMissingSkus() を実行してください。`,
    '✅ 出力完了', 5
  );
}

function importFromMissingSkus() {
  const ss = getSpreadsheet_();
  const srcSheet = ss.getSheetByName('missing_skus');
  if (!srcSheet) { Logger.log('missing_skus シートが見つかりません。'); return; }

  const data    = srcSheet.getDataRange().getValues();
  const headers = data[0];
  const skuIdx       = headers.indexOf('sku');
  const firstDateIdx = headers.indexOf('最初の注文日');
  const costIdx      = headers.indexOf('着地原価（手入力）');
  const applyDateIdx = headers.indexOf('適用開始日（手入力）');

  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderHdrs  = reorderSheet.getRange(1, 1, 1, reorderSheet.getLastColumn())
                         .getValues()[0];
  function col(name) { return reorderHdrs.indexOf(name); }

  const now = new Date().toISOString();
  const newRows = [];
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const sku  = String(data[i][skuIdx]  || '').trim();
    const cost = Number(data[i][costIdx]) || 0;
    if (!sku || !cost) { skipped++; continue; }

    // 日付を文字列として確実に取得
    const rawDate = data[i][applyDateIdx] || data[i][firstDateIdx] || '';
    let applyDate = '';
    if (rawDate instanceof Date) {
      // Date型なら YYYY-MM-DD 形式に変換
      applyDate = Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      applyDate = String(rawDate).trim();
    }

    const row = new Array(reorderHdrs.length).fill('');
    row[col('id')]                 = Utilities.getUuid();
    row[col('product_id')]         = '';
    row[col('sku')]                = sku;
    row[col('order_date')]         = applyDate;
    row[col('landed_cost_actual')] = cost;
    row[col('notes')]              = 'missing_skus取込';
    row[col('created_at')]         = now;

    newRows.push(row);
  }

  if (newRows.length) {
    const startRow    = reorderSheet.getLastRow() + 1;
    const dateColNum  = col('order_date') + 1;

    // ★ 書き込み前に書式設定
    reorderSheet.getRange(startRow, dateColNum, newRows.length, 1)
      .setNumberFormat('@STRING@');

    reorderSheet.getRange(startRow, 1, newRows.length, reorderHdrs.length)
      .setValues(newRows);
  }

  Logger.log(`importFromMissingSkus: ${newRows.length}件登録 / ${skipped}件スキップ`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${newRows.length}件を reorder_history に登録しました。`,
    '✅ 取込完了', 5
  );
}