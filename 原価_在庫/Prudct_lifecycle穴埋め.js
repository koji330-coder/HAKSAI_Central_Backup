function registerUnregisteredAsins() {
  // sku_master から {sku: asin} マップ
  const skuToAsin = buildSkuToAsinMap_();

  // product_lifecycle の登録済みASINセット
  const lcSheet  = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData   = lcSheet.getDataRange().getValues();
  const lcHdrs   = lcData[0];
  const asinIdx  = lcHdrs.indexOf('asin');
  const registeredAsins = new Set();
  for (let i = 1; i < lcData.length; i++) {
    const asin = String(lcData[i][asinIdx] || '').trim();
    if (asin) registeredAsins.add(asin);
  }

  // transaction_history から売上のあるASINを収集
  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tAsin   = txHdrs.indexOf('asin');
  const tType   = txHdrs.indexOf('transaction_type');

  const unregistered = {}; // {asin: {title, skus}}
  for (let i = 1; i < txData.length; i++) {
    if (String(txData[i][tType]) !== '注文') continue;
    const sku  = String(txData[i][tSku]  || '').trim();
    const asin = String(txData[i][tAsin] || '').trim() || skuToAsin[sku] || '';
    if (!asin || registeredAsins.has(asin)) continue;
    if (!unregistered[asin]) unregistered[asin] = { asin, skus: [] };
    if (sku && !unregistered[asin].skus.includes(sku)) {
      unregistered[asin].skus.push(sku);
    }
  }

  // inventory-report シートから商品名を補完
  const invSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('inventory-report');
  const invMap   = {};
  if (invSheet) {
    const invData = invSheet.getDataRange().getValues();
    const invHdrs = invData[0];
    const iSku    = invHdrs.findIndex(h => String(h).includes('SKU'));
    const iAsin   = invHdrs.findIndex(h => String(h).toLowerCase() === 'asin');
    const iName   = invHdrs.findIndex(h => String(h).includes('Product Name'));
    for (let i = 1; i < invData.length; i++) {
      const a = String(invData[i][iAsin] || '').trim();
      const n = String(invData[i][iName] || '').trim();
      if (a && n) invMap[a] = n;
    }
  }

  const products = Object.values(unregistered).map(d => ({
    asin:  d.asin,
    title: invMap[d.asin] || d.asin,
  }));

  if (!products.length) {
    Logger.log('未登録ASINはありません。');
    SpreadsheetApp.getActiveSpreadsheet().toast('未登録ASINはありませんでした。', '✅ 確認完了', 5);
    return;
  }

  Logger.log(`未登録ASIN: ${products.length}件`);
  products.forEach(p => Logger.log(`  ${p.asin}: ${p.title}`));

  // product_lifecycle に一括登録
  bulkRegisterSellingProducts(products);

  Logger.log(`${products.length}件を product_lifecycle に登録しました。`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${products.length}件を販売中として登録しました。`,
    '✅ 登録完了', 5
  );
}