// ============================================
// sku_master 文字化け修正ツール
//
// 使い方：
// 1. Google DriveのDRIVE_FOLDER_IDフォルダに
//    新しいFBA在庫レポート（TXT）を置く
// 2. GASエディタから fixSkuMasterFromDrive() を実行
// 3. ログで更新件数を確認
// ============================================

/**
 * Driveに置いたFBA在庫レポートを読んでsku_masterの
 * product_name を正しい文字で上書きする
 */
function fixSkuMasterFromDrive() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const TARGET_FILENAME = '161474020603.txt'; // 発注推奨レポート

  const files = folder.getFilesByName(TARGET_FILENAME);
  if (!files.hasNext()) { Logger.log('❌ ファイルが見つかりません'); return; }
  const targetFile = files.next();

  // Shift_JIS で読む
  const content = targetFile.getBlob().getDataAsString('Shift_JIS');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split('\t').map(h => h.trim());

  // 発注推奨レポートは Merchant SKU = 列3 を基準に
  const merchantSkuIdx = headers.findIndex(h => h.includes('Merchant SKU'));
  const base = merchantSkuIdx - 3;
  const COL_SKU   = base + 3;
  const COL_FNSKU = base + 2;
  const COL_ASIN  = base + 4;
  const COL_NAME  = base + 1; // 商品名

  // SKU → { asin, fnsku, title } のマップを作成
  const skuMap = {};
  for (let i = 1; i < lines.length; i++) {
    const row   = lines[i].split('\t');
    const sku   = (row[COL_SKU]   || '').trim();
    const asin  = (row[COL_ASIN]  || '').trim();
    const fnsku = (row[COL_FNSKU] || '').trim();
    const title = (row[COL_NAME]  || '').trim();
    if (!sku || !asin) continue;
    if (!skuMap[sku]) skuMap[sku] = { asin, fnsku, title };
  }

  Logger.log('📦 レポートのSKU件数: ' + Object.keys(skuMap).length);

  // sku_master を更新（以降は既存ロジックと同じ）
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const skuIdx   = h.indexOf('sku');
  const asinIdx  = h.indexOf('asin');
  const fnskuIdx = h.indexOf('fnsku');
  const nameIdx  = h.indexOf('product_name');
  const dateIdx  = h.indexOf('updated_at');
  const now = new Date().toISOString();
  let updated = 0;

  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][skuIdx] || '').trim();
    if (!sku) continue;
    const match = skuMap[sku];
    if (!match) continue;
    if (match.asin)  sheet.getRange(i+1, asinIdx  + 1).setValue(match.asin);
    if (match.fnsku) sheet.getRange(i+1, fnskuIdx + 1).setValue(match.fnsku);
    if (match.title) sheet.getRange(i+1, nameIdx  + 1).setValue(match.title);
    sheet.getRange(i+1, dateIdx + 1).setValue(now);
    updated++;
  }

  Logger.log('🎉 完了: ' + updated + '件を更新しました。');
}


// ============================================
// デバッグ用：sku_masterの現状を確認する
// ============================================
function debugSkuMaster() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!sheet) { Logger.log('sku_master シートなし'); return; }
  
  const data = sheet.getDataRange().getValues();
  Logger.log('sku_master 総行数: ' + (data.length - 1));
  Logger.log('ヘッダー: ' + data[0].join(' | '));
  
  // 文字化けしていそうな行を抽出
  const nameIdx = data[0].indexOf('product_name');
  let garbledCount = 0;
  
  for (let i = 1; i < Math.min(data.length, 200); i++) {
    const name = String(data[i][nameIdx] || '');
    // 文字化けの特徴：\uFFFD（?）が含まれるか、非ASCII文字が多い
    const hasReplChar = name.includes('\ufffd');
    const nonAsciiRatio = (name.match(/[^\x00-\x7F]/g) || []).length / (name.length || 1);
    
    if (hasReplChar || nonAsciiRatio > 0.3) {
      garbledCount++;
      if (garbledCount <= 10) {
        Logger.log(`行${i+1} [文字化け疑い]: ${data[i][0]} | ${name.slice(0, 40)}`);
      }
    }
  }
  Logger.log(`文字化け疑い行: ${garbledCount}件（先頭200行中）`);
}

function checkDriveFile() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFilesByType('text/plain');
  while (files.hasNext()) {
    const f = files.next();
    Logger.log(f.getName() + ' | ' + f.getDateCreated());
  }
}