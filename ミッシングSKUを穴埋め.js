function fillMissingSkusFromInventoryReport() {
  const ss = getSpreadsheet_();

  // inventory-report シートを読む
  const invSheet = ss.getSheetByName('inventory-report');
  if (!invSheet) { Logger.log('inventory-report シートが見つかりません'); return; }
  const invData = invSheet.getDataRange().getValues();
  const invHdrs = invData[0];

  // 列インデックスを名前で取得（順番が変わっても対応）
  const iSku  = invHdrs.findIndex(h => String(h).includes('SKU'));
  const iAsin = invHdrs.findIndex(h => String(h).toLowerCase() === 'asin');
  const iName = invHdrs.findIndex(h => String(h).includes('Product Name'));
  Logger.log(`inventory-report: SKU=${iSku} ASIN=${iAsin} 商品名=${iName}`);

  // SKU → {asin, name} マップを作成
  const invMap = {};
  for (let i = 1; i < invData.length; i++) {
    const sku  = String(invData[i][iSku]  || '').trim();
    const asin = String(invData[i][iAsin] || '').trim();
    const name = String(invData[i][iName] || '').trim();
    if (sku) invMap[sku] = { asin, name };
  }
  Logger.log(`inventory-report SKU数: ${Object.keys(invMap).length}`);

  // missing_skus シートを読む
  const msSheet = ss.getSheetByName('missing_skus');
  if (!msSheet) { Logger.log('missing_skus シートが見つかりません'); return; }
  const msData = msSheet.getDataRange().getValues();
  const msHdrs = msData[0];
  const msSku  = msHdrs.indexOf('sku');
  const msAsin = msHdrs.indexOf('asin');
  const msName = msHdrs.indexOf('商品名');

  let updated = 0;
  for (let i = 1; i < msData.length; i++) {
    const sku  = String(msData[i][msSku] || '').trim();
    if (!sku) continue;
    const inv = invMap[sku];
    if (!inv) continue;

    let changed = false;
    // ASINが空なら補完
    if (!msData[i][msAsin] && inv.asin) {
      msSheet.getRange(i + 1, msAsin + 1).setValue(inv.asin);
      changed = true;
    }
    // 商品名が空なら補完
    if (!msData[i][msName] && inv.name) {
      msSheet.getRange(i + 1, msName + 1).setValue(inv.name);
      changed = true;
    }
    if (changed) updated++;
  }

  Logger.log(`missing_skus 補完完了: ${updated}件`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `missing_skusを${updated}件補完しました。`,
    '✅ 完了', 5
  );
}


function fillSkuMasterFromMissingSkus() {
  const ss = getSpreadsheet_();

  // missing_skus を読む
  const msSheet = ss.getSheetByName('missing_skus');
  if (!msSheet) { Logger.log('missing_skus シートが見つかりません'); return; }
  const msData = msSheet.getDataRange().getValues();
  const msHdrs = msData[0];
  const msSku  = msHdrs.indexOf('sku');
  const msAsin = msHdrs.indexOf('asin');
  const msName = msHdrs.indexOf('商品名');

  // SKU → {asin, name} マップ
  const msMap = {};
  for (let i = 1; i < msData.length; i++) {
    const sku  = String(msData[i][msSku]  || '').trim();
    const asin = String(msData[i][msAsin] || '').trim();
    const name = String(msData[i][msName] || '').trim();
    if (sku) msMap[sku] = { asin, name };
  }
  Logger.log(`missing_skus SKU数: ${Object.keys(msMap).length}`);

  // sku_master を読む
  const smSheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!smSheet) { Logger.log('sku_master シートが見つかりません'); return; }
  const smData = smSheet.getDataRange().getValues();
  const smHdrs = smData[0];
  const smSku  = smHdrs.indexOf('sku');
  const smAsin = smHdrs.indexOf('asin');
  const smName = smHdrs.indexOf('product_name');
  const smDate = smHdrs.indexOf('updated_at');
  const now    = new Date().toISOString();

  // 既存SKUの行番号マップ
  const existingRows = {};
  for (let i = 1; i < smData.length; i++) {
    const sku = String(smData[i][smSku] || '').trim();
    if (sku) existingRows[sku] = i + 1;
  }

  let updated = 0;
  const newRows = [];

  Object.entries(msMap).forEach(([sku, d]) => {
    if (existingRows[sku]) {
      // 既存行：ASINと商品名が空なら補完（FNSKUは触らない）
      const rowNum = existingRows[sku];
      let changed = false;
      if (!smData[existingRows[sku] - 1][smAsin] && d.asin) {
        smSheet.getRange(rowNum, smAsin + 1).setValue(d.asin);
        changed = true;
      }
      if (!smData[existingRows[sku] - 1][smName] && d.name) {
        smSheet.getRange(rowNum, smName + 1).setValue(d.name);
        changed = true;
      }
      if (changed) {
        smSheet.getRange(rowNum, smDate + 1).setValue(now);
        updated++;
      }
    } else {
      // 新規行：SKU・ASIN・商品名だけ追加（FNSKUは空）
      newRows.push([sku, d.asin || '', '', d.name || '', now]);
    }
  });

  if (newRows.length) {
    smSheet.getRange(smSheet.getLastRow() + 1, 1, newRows.length, 5)
      .setValues(newRows);
  }

  Logger.log(`sku_master: 更新=${updated}件 新規追加=${newRows.length}件`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `sku_master: 更新${updated}件 / 新規追加${newRows.length}件`,
    '✅ 完了', 5
  );
}