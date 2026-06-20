function exportUncalculatedProducts() {
  const ss = getSpreadsheet_();

  const skuToAsin = buildSkuToAsinMap_();

  const lcSheet    = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData     = lcSheet.getDataRange().getValues();
  const lcHdrs     = lcData[0];
  const lcAsinIdx  = lcHdrs.indexOf('asin');
  const lcTitleIdx = lcHdrs.indexOf('title');
  const registeredAsins = new Set();
  for (let i = 1; i < lcData.length; i++) {
    const asin = String(lcData[i][lcAsinIdx] || '').trim();
    if (asin) registeredAsins.add(asin);
  }

  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');
  const reorderSkus = new Set();
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx]  || '').trim();
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (sku && cost) reorderSkus.add(sku);
  }

  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tAsin   = txHdrs.indexOf('asin');
  const tType   = txHdrs.indexOf('transaction_type');
  const tTaxin  = txHdrs.indexOf('sales_taxin');
  const tNet    = txHdrs.indexOf('net');
  const tQty    = txHdrs.indexOf('qty');
  const tDate   = txHdrs.indexOf('date');

  const summary = {};
  for (let i = 1; i < txData.length; i++) {
    if (String(txData[i][tType]) !== '注文') continue;
    const sku   = String(txData[i][tSku]  || '').trim();
    const asin  = String(txData[i][tAsin] || '').trim() || skuToAsin[sku] || '';
    const taxin = Number(txData[i][tTaxin]) || 0;
    const net   = Number(txData[i][tNet])   || 0;
    const qty   = Number(txData[i][tQty])   || 0;
    const date  = String(txData[i][tDate]  || '').slice(0, 10);
    if (!sku) continue;

    const noAsin    = !asin;
    const noProduct = asin && !registeredAsins.has(asin);
    const noCost    = !reorderSkus.has(sku);
    if (!noAsin && !noProduct && !noCost) continue;

    const reason = [
      noAsin    ? 'ASIN変換不可' : '',
      noProduct ? '商品未登録'   : '',
      noCost    ? '原価未登録'   : '',
    ].filter(Boolean).join(' / ');

    let title = asin || sku;
    for (let j = 1; j < lcData.length; j++) {
      if (String(lcData[j][lcAsinIdx]).trim() === asin) {
        title = lcData[j][lcTitleIdx] || asin;
        break;
      }
    }

    if (!summary[sku]) {
      summary[sku] = {
        sku, asin, title, qty: 0, taxin: 0, net: 0,
        reason, firstDate: date, lastDate: date
      };
    }
    const s = summary[sku];
    s.qty   += qty;
    s.taxin += taxin;
    s.net   += net;
    if (date < s.firstDate) s.firstDate = date;
    if (date > s.lastDate)  s.lastDate  = date;
  }

  let outSheet = ss.getSheetByName('uncalculated');
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet('uncalculated');

  const headers = [
    'SKU', 'ASIN', '商品名', '販売数', '売上税込', '手取合計',
    '最初の注文日', '最後の注文日', '理由',
    '着地原価（手入力）', '適用開始日（手入力）'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');

  const rows = Object.values(summary)
    .sort((a, b) => b.net - a.net)
    .map(d => [
      d.sku, d.asin, d.title,
      d.qty,
      Math.round(d.taxin),
      Math.round(d.net),
      d.firstDate, d.lastDate,
      d.reason,
      '', // 着地原価（手入力）
      '', // 適用開始日（手入力）← 空なら最初の注文日を使う
    ]);

  if (rows.length) {
    outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    outSheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0');
    outSheet.getRange(2, 10, rows.length, 1).setNumberFormat('#,##0');
  }

  outSheet.setColumnWidth(3, 250);
  outSheet.setColumnWidth(9, 150);
  outSheet.setColumnWidth(10, 160);
  outSheet.setColumnWidth(11, 180);
  outSheet.setFrozenRows(1);

  Logger.log(`uncalculated: ${rows.length}件出力`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${rows.length}件を uncalculated シートに出力しました。J列に着地原価を入力後、importFromUncalculated() を実行してください。`,
    '✅ 出力完了', 8
  );
}


function importFromUncalculated() {
  const ss = getSpreadsheet_();
  const srcSheet = ss.getSheetByName('uncalculated');
  if (!srcSheet) {
    Logger.log('uncalculated シートが見つかりません。exportUncalculatedProducts() を先に実行してください。');
    return;
  }

  const data    = srcSheet.getDataRange().getValues();
  const headers = data[0];
  const skuIdx       = headers.indexOf('SKU');
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

    // 理由に「原価未登録」が含まれる行だけ処理
    // （ASIN変換不可・商品未登録は別途対処が必要）
    const reason = String(data[i][headers.indexOf('理由')] || '');
    if (!reason.includes('原価未登録')) { skipped++; continue; }

    const rawDate = data[i][applyDateIdx] || data[i][firstDateIdx] || '';
    let applyDate = '';
    if (rawDate instanceof Date) {
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
    row[col('notes')]              = 'uncalculated取込';
    row[col('created_at')]         = now;

    newRows.push(row);
  }

  if (newRows.length) {
    const startRow   = reorderSheet.getLastRow() + 1;
    const dateColNum = col('order_date') + 1;

    // 書き込み前に書式設定（日付型化を防止）
    reorderSheet.getRange(startRow, dateColNum, newRows.length, 1)
      .setNumberFormat('@STRING@');

    reorderSheet.getRange(startRow, 1, newRows.length, reorderHdrs.length)
      .setValues(newRows);
  }

  Logger.log(`importFromUncalculated: ${newRows.length}件登録 / ${skipped}件スキップ`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${newRows.length}件を reorder_history に登録しました。売上タブを確認してください。`,
    '✅ 取込完了', 5
  );
}