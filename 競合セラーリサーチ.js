// ============================================
// 競合セラーリサーチ
// ============================================

/**
 * 起点ASINから関連商品を取得し、そのセラーIDを収集する
 */
function testGetRelatedSellerIds() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');

  // 起点ASIN（HAKSAIの商品）
  const seedAsins = [
    'B0FXTQPGSB', // ChimePro
  ];

  Logger.log('=== 関連セラーID収集 開始 ===');

  const allSellerIds = new Set();
  const relatedAsins = new Set();

  seedAsins.forEach(asin => {
    const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&offers=20&history=0`;
    const json = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    Logger.log('残トークン: ' + json.tokensLeft);

    const p = json.products[0];
    if (!p) return;

    // 一緒に買われた商品
    const fbt = p.frequentlyBoughtTogether || [];
    fbt.forEach(a => relatedAsins.add(a));
    Logger.log(`[${asin}] frequentlyBoughtTogether: ${JSON.stringify(fbt)}`);
  });

  // 関連ASINの出品セラーを取得
  Logger.log('--- 関連ASIN出品セラー ---');
  relatedAsins.forEach(asin => {
    const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&offers=20&history=0`;
    const json = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    Logger.log('残トークン: ' + json.tokensLeft);

    const p = json.products[0];
    if (!p) return;

    Logger.log(`[${asin}] タイトル: ${p.title}`);
    if (p.liveOffersOrder && p.offers) {
      p.liveOffersOrder.forEach(i => {
        const o = p.offers[i];
        if (o?.sellerId) {
          allSellerIds.add(o.sellerId);
          Logger.log(`  sellerId: ${o.sellerId} | FBA: ${o.isFBA}`);
        }
      });
    }
  });

  Logger.log('--- 収集セラーID一覧 ---');
  Logger.log(JSON.stringify([...allSellerIds]));
  Logger.log('=== 完了 ===');
}

/**
 * セラーIDから出品商品一覧を取得する
 */
function testGetSellerProducts() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');

  // 調べたいセラーID（testGetRelatedSellerIdsで取得したもの）
  const sellerId = 'A1BFW5ERVP4ZF7'; // ショーリティックス

  const selection = {
    sellerIds: [sellerId],
    perPage: 100,
    page: 0
  };

  Logger.log(`=== セラー商品取得 [${sellerId}] ===`);

  const url = 'https://api.keepa.com/query?domain=5&key=' + apiKey;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(selection),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);
  Logger.log('totalResults: ' + json.totalResults);
  Logger.log('取得件数: ' + (json.asinList || []).length);

  (json.asinList || []).slice(0, 10).forEach((asin, i) => {
    Logger.log(`${i+1}: https://www.amazon.co.jp/dp/${asin}`);
  });

  Logger.log('=== 完了 ===');
}

function addSourceColumnsToResearchCandidates() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet) { Logger.log('シートが見つかりません'); return; }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (!headers.includes('source')) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('source');
    Logger.log('source列を追加: ' + col + '列目');
  }

  if (!headers.includes('source_detail')) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('source_detail');
    Logger.log('source_detail列を追加: ' + col + '列目');
  }

  Logger.log('完了');
}

function setupKeepaSellerMaster() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 既存シートがあれば削除しない（データが消えるため）
  let sheet = ss.getSheetByName('keepa_seller_master');
  if (sheet) {
    Logger.log('既に存在します。ヘッダーのみ確認します。');
  } else {
    sheet = ss.insertSheet('keepa_seller_master');
    Logger.log('新規作成しました。');
  }

  // ヘッダーが未設定の場合のみ書き込む
  const firstCell = sheet.getRange(1, 1).getValue();
  if (firstCell !== 'seller_id') {
    const headers = ['seller_id', 'seller_name', 'memo', 'status', 'last_fetched_at', 'asin_count', 'registered_at'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 80);
    sheet.setColumnWidth(5, 160);
    sheet.setColumnWidth(6, 80);
    sheet.setColumnWidth(7, 160);
    Logger.log('ヘッダーを設定しました。');
  }

  Logger.log('セラーIDをシートに直接入力してください。statusは「未取得」で登録してください。');
}

/**
 * keepa_seller_master から未取得セラーを1件取り出し、
 * ストアフロントAPIでASINを取得して keepa_research_candidates に追記する。
 * トリガーで毎時実行する。
 */
function runSellerStorefrontBatch() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定');

  // トークン残量確認
  const checkRes = UrlFetchApp.fetch(`https://api.keepa.com/token?key=${apiKey}`, { muteHttpExceptions: true });
  const tokensLeft = JSON.parse(checkRes.getContentText()).tokensLeft;
  Logger.log('残トークン: ' + tokensLeft);

  if (tokensLeft < 15) {
    Logger.log('トークン不足のためスキップ（残: ' + tokensLeft + '）');
    return;
  }

  // seller_master から未取得セラーを1件取得
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const masterSheet = ss.getSheetByName('keepa_seller_master');
  if (!masterSheet) throw new Error('keepa_seller_master シートが存在しません');

  const data = masterSheet.getDataRange().getValues();
  const headers = data[0];
  const COL = {
    seller_id:      headers.indexOf('seller_id'),
    seller_name:    headers.indexOf('seller_name'),
    memo:           headers.indexOf('memo'),
    status:         headers.indexOf('status'),
    last_fetched_at:headers.indexOf('last_fetched_at'),
    asin_count:     headers.indexOf('asin_count'),
  };

  // status が「未取得」の最初の行を探す
  let targetRow = -1;
  let targetSellerId = '';
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.status] === '未取得') {
      targetRow = i + 1; // シートの行番号（1始まり）
      targetSellerId = data[i][COL.seller_id];
      break;
    }
  }

  if (targetRow === -1) {
    Logger.log('未取得セラーなし。全件取得済み。');
    return;
  }

  Logger.log(`=== セラーストアフロント取得開始: ${targetSellerId} ===`);

  // Keepa Seller API を叩く
  const url = `https://api.keepa.com/seller?key=${apiKey}&domain=5&seller=${targetSellerId}&storefront=1`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());

  Logger.log('残トークン: ' + json.tokensLeft);
  Logger.log('消費トークン: ' + json.tokensConsumed);

  if (response.getResponseCode() !== 200 || !json.sellers) {
    Logger.log('ERROR: ' + response.getContentText().substring(0, 300));
    // エラーの場合はスキップとしてマーク
    masterSheet.getRange(targetRow, COL.status + 1).setValue('エラー');
    return;
  }

  const seller = json.sellers[targetSellerId];
  if (!seller) {
    Logger.log('セラーデータなし');
    masterSheet.getRange(targetRow, COL.status + 1).setValue('エラー');
    return;
  }

  const sellerName = seller.sellerName || targetSellerId;
  const asinList = seller.asinList || [];
  Logger.log(`セラー名: ${sellerName} / ASIN数: ${asinList.length}`);

  // keepa_research_candidates に追記
  const candidateSheet = ss.getSheetByName('keepa_research_candidates');
  if (!candidateSheet) throw new Error('keepa_research_candidates シートが存在しません');

  const existing = getExistingAsins_();
  const now = new Date().toISOString();

  // 上限設定（1セラーあたり最大200件）
  const MAX_ASINS_PER_SELLER = 200;
  const allNewAsins = asinList.filter(asin => !existing.has(asin));  // ← 追加
  const newAsins = asinList
    .filter(asin => !existing.has(asin))
    .slice(0, MAX_ASINS_PER_SELLER);
  const cutCount = allNewAsins.length - newAsins.length;
  Logger.log(`新規: ${allNewAsins.length}件 / 採用: ${newAsins.length}件 / カット: ${cutCount}件 / 重複: ${asinList.length - allNewAsins.length}件`);

  if (newAsins.length > 0) {
    const startRow = candidateSheet.getLastRow() + 1;

    // データ行を一括書き込み
    const rows = newAsins.map(asin => [
      asin, now,
      '',    // C: category_name（セラー起点は空）
      '', '', // D: price_min, E: price_max
      `https://www.amazon.co.jp/dp/${asin}`,
      `https://keepa.com/#!product/5-${asin}`,
      '',    // H: title（数式で後から入れる）
      '',    // I: brand
      '未確認', // J: status
      '', '', '', '', '', '', // K〜P: Stage2フィールド
      'seller_storefront', // Q: source
      sellerName,          // R: source_detail
    ]);
    candidateSheet.getRange(startRow, 1, rows.length, 18).setValues(rows);

    // status列にドロップダウンを一括設定
    const statusRange = candidateSheet.getRange(startRow, 10, rows.length, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['未確認', 'GO', 'NG'], true)
      .setAllowInvalid(false)
      .build();
    statusRange.setDataValidation(rule);

    // IMPORTXML数式を一括書き込み（setFormulas で一発）
    const formulas = newAsins.map(asin =>
      [`=IMPORTXML("https://www.amazon.co.jp/dp/${asin}","//span[@id='productTitle']")`]
    );
    candidateSheet.getRange(startRow, 8, formulas.length, 1).setFormulas(formulas);

    Logger.log(`${newAsins.length}件追加 / ${asinList.length - newAsins.length}件重複スキップ`);
  } else {
    Logger.log('全件重複スキップ');
  }

  // seller_master のステータスを更新
  masterSheet.getRange(targetRow, COL.seller_name + 1).setValue(sellerName);
  masterSheet.getRange(targetRow, COL.status + 1).setValue('取得済');
  masterSheet.getRange(targetRow, COL.last_fetched_at + 1).setValue(now);
  masterSheet.getRange(targetRow, COL.asin_count + 1).setValue(newAsins.length);

  Logger.log(`=== 完了: ${sellerName} / 新規${newAsins.length}件追加 ===`);
}

/**
 * セラーストアフロントバッチのトリガーを設置する
 * 毎時45分に実行（Stage1の00分・Stage2の30分と競合しないタイミング）
 * 初回1回だけ実行する
 */
function setupSellerStorefrontTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runSellerStorefrontBatch')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('runSellerStorefrontBatch')
    .timeBased()
    .everyHours(1)
    .nearMinute(45)
    .create();

  Logger.log('セラーストアフロントトリガー設置完了: 毎時45分');
}