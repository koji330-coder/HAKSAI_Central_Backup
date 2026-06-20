function testKeepaProductFinder() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: KEEPA_API_KEY がスクリプトプロパティに未設定');
    return;
  }

  // Keepa時刻（現在から3ヶ月前）
  const keepaNow = Math.floor((Date.now() - 1293840000000) / 60000);
  const threeMonthsAgo = keepaNow - 129600;

  // ブラウザ版SHOW API QUERYで確認済みのフィールド名を優先
  const selection = {
    productType: [0],
    current_BUY_BOX_SHIPPING_gte: 500,        // ¥500以上（FBA運用で勝ち目あり）
    current_BUY_BOX_SHIPPING_lte: 750,
    monthlySoldLastKnown_gte: 50,
    monthlySoldLastKnownDate_gte: threeMonthsAgo,
    current_COUNT_REVIEWS_lte: 100,
    imageCount_lte: 3,
    sort: [["monthlySoldLastKnown", "desc"]],
    perPage: 50,
    page: 0
  };

  // selection定義の後、urlの前に追加
  const ngIds = getKeepaNgCategoryIds_();
  if (ngIds.length > 0) selection.categories_exclude = ngIds;

  const url = 'https://api.keepa.com/query?domain=5&key=' + apiKey;

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(selection),  // selectionで包まず直接送る
    muteHttpExceptions: true
  };

  Logger.log('送信クエリ: ' + JSON.stringify(selection, null, 2));

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  Logger.log('HTTPステータス: ' + statusCode);

  if (statusCode !== 200) {
    Logger.log('ERROR: ' + response.getContentText());
    return;
  }

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);
  Logger.log('totalResults: ' + json.totalResults);

  const asinList = json.asinList || [];
  Logger.log('取得ASIN数: ' + asinList.length);
  asinList.slice(0, 5).forEach((asin, i) => {
    Logger.log((i+1) + ': https://www.amazon.co.jp/dp/' + asin);
  });
}



// ============================================
// バッチスケジュール管理
// ============================================

/**
 * keepa_batch_schedule シートを作成して初期データを書き込む
 * 初回1回だけ実行する
 */
function setupKeepaBatchSchedule() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let sheet = ss.getSheetByName('keepa_batch_schedule');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('keepa_batch_schedule');

  sheet.getRange(1, 1, 1, 3).setValues([['hour', 'selection_json', 'memo']]);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');

  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 600);
  sheet.setColumnWidth(3, 200);

  Logger.log('keepa_batch_schedule シート再作成完了');
}

/**
 * 現在の時間に対応するスケジュールを返す
 */
function getCurrentSchedule_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_batch_schedule');
  if (!sheet) throw new Error('keepa_batch_schedule シートが存在しません');

  const hour = new Date().getHours();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][0]) === hour) {
      return {
        hour:          Number(data[i][0]),
        selectionJson: data[i][1].toString(),
        memo:          data[i][2]
      };
    }
  }
  return null;
}

// ============================================
// 取得済みASIN管理
// ============================================

/**
 * keepa_research_candidates シートを作成する
 * 初回1回だけ実行する
 */
function setupKeepaResearchCandidates() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let sheet = ss.getSheetByName('keepa_research_candidates');
  if (sheet) {
    Logger.log('keepa_research_candidates は既に存在します');
    return;
  }
  sheet = ss.insertSheet('keepa_research_candidates');

  sheet.getRange(1, 1, 1, 7).setValues([[
  'asin', 'fetched_at', 'category_name', 'price_min', 'price_max', 'amazon_url', 'keepa_url'
]]);
  sheet.getRange(1, 1, 1, 7).setFontWeight('bold');

  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 80);
  sheet.setColumnWidth(6, 280);
  sheet.setColumnWidth(7, 300);

  Logger.log('keepa_research_candidates シート作成完了');
}

/**
 * 取得済みASINのセットを返す（重複チェック用）
 */
function getExistingAsins_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet || sheet.getLastRow() < 2) return new Set();

  return new Set(
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues()
      .map(r => r[0])
      .filter(Boolean)
  );
}

/**
 * 新規ASINをkeepa_research_candidatesに追記する
 */
function appendNewAsins_(asinList, schedule) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('keepa_research_candidates');

  // シートがなければ自動作成
  if (!sheet) {
    setupKeepaResearchCandidates();
    sheet = ss.getSheetByName('keepa_research_candidates');
  }

  const existing = getExistingAsins_();
  const now = new Date().toISOString();

  const newAsins = asinList
    .filter(asin => !existing.has(asin));

  if (newAsins.length === 0) return 0;

  // データ行を一括書き込み
  const startRow = sheet.getLastRow() + 1;
  const rows = newAsins.map(asin => [
    asin, now,
    schedule.categoryName,
    schedule.priceMin,
    schedule.priceMax,
    `https://www.amazon.co.jp/dp/${asin}`,
    `https://keepa.com/#!product/5-${asin}`,
    '',        // title（数式で後から入れる）
    '',        // brand
    '未確認'   // status
  ]);
  sheet.getRange(startRow, 1, rows.length, 10).setValues(rows);

  // status列にドロップダウンを一括設定
  const statusRange = sheet.getRange(startRow, 10, rows.length, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['未確認', 'GO', 'NG'], true)
    .setAllowInvalid(false)
    .build();
  statusRange.setDataValidation(rule);

  // IMPORTXML数式を一括書き込み（setFormulas で一発）
  const formulas = newAsins.map(asin =>
    [`=IMPORTXML("https://www.amazon.co.jp/dp/${asin}","//span[@id='productTitle']")`]
  );
  sheet.getRange(startRow, 8, formulas.length, 1).setFormulas(formulas);

  return newAsins.length;
}


// ============================================
// メインバッチ関数（トリガーで実行）
// ============================================

/**
 * 毎時トリガーで実行するメインバッチ
 * 現在時刻のスケジュールに従いStage1を実行してシートに蓄積する
 */
function runKeepaBatch() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定');

  // スケジュール取得
  const schedule = getCurrentSchedule_();
  if (!schedule) {
    Logger.log('この時間のスケジュールなし、スキップ');
    return;
  }

  Logger.log(`=== Keepaバッチ開始 [${schedule.hour}時] ${schedule.memo} ===`);

  // JSONをそのまま使う
  let selection;
  try {
    selection = JSON.parse(schedule.selectionJson);
  } catch(e) {
    Logger.log('ERROR: selection_jsonのパースに失敗: ' + e.message);
    return;
  }

  // perPageを100に上書き、pageをランダムに
  selection.perPage = 100;
  selection.page = Math.floor(Math.random() * 10);

  // NGカテゴリを追加
  const ngIds = getKeepaNgCategoryIds_();
  if (ngIds.length > 0) {
    selection.categories_exclude = [
      ...(selection.categories_exclude || []),
      ...ngIds
    ];
  }

  Logger.log('送信selection: ' + JSON.stringify(selection));

  // API実行
  const url = 'https://api.keepa.com/query?domain=5&key=' + apiKey;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(selection),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR: ' + response.getContentText());
    return;
  }

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);
  Logger.log('totalResults: ' + json.totalResults);

  // API実行後、asinListの前に追加
  Logger.log('rawレスポンス（先頭2000文字）: ' + response.getContentText().substring(0, 2000));

  const asinList = json.asinList || [];
  Logger.log('取得件数: ' + asinList.length);

  // ここに追加
  Logger.log('レスポンス全体（先頭1000文字）: ' + response.getContentText().substring(0, 1000));

  // シートに追記（重複除外）
  const added = appendNewAsins_(asinList, schedule);
  Logger.log(`新規追加: ${added}件 / 重複スキップ: ${asinList.length - added}件`);

  // タイトル取得数式を書き込む
  fillTitlesWithImportXml();

  Logger.log('=== バッチ完了 ===');
}

// ============================================
// Stage1.5：タイトル・ブランド軽量取得
// ============================================

/**
 * 未処理ASINのタイトル・ブランドを取得してシートに書き込む
 * 20件×5回 = 最大100件を1トリガーで処理
 */
function runKeepaStage1_5() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('処理対象データなし');
    return;
  }

  const lastRow = sheet.getLastRow();
  const allData = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  // title列（8列目=index7）が空の行を未処理とみなす
  const unprocessed = allData
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => !row[7]);

  if (unprocessed.length === 0) {
    Logger.log('未処理ASINなし');
    return;
  }

  Logger.log(`=== Stage1.5開始 未処理${unprocessed.length}件 ===`);

  // 20件ずつ最大5回（100件）に分割
  const chunks = [];
  for (let i = 0; i < Math.min(unprocessed.length, 100); i += 20) {
    chunks.push(unprocessed.slice(i, i + 20));
  }

  let totalProcessed = 0;

  chunks.forEach((batch, chunkIndex) => {
    const asins = batch.map(({ row }) => row[0]).join(',');

    // history=0で軽量取得（タイトル・ブランドのみ）
    const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asins}&history=0`;

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`チャンク${chunkIndex + 1} ERROR: ` + response.getContentText());
      return;
    }

    const json = JSON.parse(response.getContentText());
    Logger.log(`チャンク${chunkIndex + 1}: 残トークン ${json.tokensLeft}`);

    const products = json.products || [];
    const productMap = {};
    products.forEach(p => { productMap[p.asin] = p; });

    // シートに書き込み
    batch.forEach(({ row, rowNum }) => {
      const asin = row[0];
      const p = productMap[asin];
      if (!p) return;

      const title = p.title || '';
      const brand = p.brand || '';

      sheet.getRange(rowNum, 8, 1, 2).setValues([[title, brand]]);
      totalProcessed++;
    });

    // API連続呼び出しの間隔を少し空ける
    if (chunkIndex < chunks.length - 1) {
      Utilities.sleep(500);
    }
  });

  Logger.log(`=== Stage1.5完了 ${totalProcessed}件処理 / 残り未処理${unprocessed.length - totalProcessed}件 ===`);
}

/**
 * Stage1.5のトリガーを設置（毎時15分）
 */
function setupStage1_5Triggers() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runKeepaStage1_5')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 毎時15分の1本
  ScriptApp.newTrigger('runKeepaStage1_5')
    .timeBased()
    .everyHours(1)
    .nearMinute(15)
    .create();

  Logger.log('Stage1.5トリガー設置完了: 毎時15分');
}

// ============================================
// Stage2：詳細取得・スコアリング
// ============================================

/**
 * status='GO'の未処理行の詳細を取得してシートに書き込む
 * 20件ずつ処理
 */
function runKeepaStage2() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('処理対象データなし');
    return;
  }

  // ヘッダー確認・更新
  const headers = [
    'asin', 'fetched_at', 'category_name', 'price_min', 'price_max',
    'amazon_url', 'keepa_url', 'title', 'brand', 'status',
    'image_count', 'has_aplus', 'monthly_sold', 'offer_count', 'fba_count', 'score'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setColumnWidth(11, 80);  // image_count
  sheet.setColumnWidth(12, 80);  // has_aplus
  sheet.setColumnWidth(13, 80);  // monthly_sold
  sheet.setColumnWidth(14, 80);  // offer_count
  sheet.setColumnWidth(15, 80);  // fba_count
  sheet.setColumnWidth(16, 80);  // score

  const lastRow = sheet.getLastRow();
  const allData = sheet.getRange(2, 1, lastRow - 1, 16).getValues();

  // status='GO' かつ score列（index15）が空の行を対象
  const targets = allData
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => row[9] === 'GO' && !row[15]);

  if (targets.length === 0) {
    Logger.log('GO判定済みで未処理の行なし');
    return;
  }

  // 20件だけ処理
  const batch = targets.slice(0, 20);
  const asins = batch.map(({ row }) => row[0]).join(',');

  Logger.log(`=== Stage2開始 ${batch.length}件 / 残り${targets.length - batch.length}件 ===`);

  // 修正後
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asins}&stats=30&aplus=1&history=0`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR: ' + response.getContentText());
    return;
  }

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);

  const products = json.products || [];
  const productMap = {};
  products.forEach(p => { productMap[p.asin] = p; });

  batch.forEach(({ row, rowNum }) => {
    const asin = row[0];
    const p = productMap[asin];
    if (!p) return;

    // 修正後
    const imageCount = Array.isArray(p.images) ? p.images.length : 0;
    const hasAplus    = !!(p.aPlus && p.aPlus.length > 0);
    const monthlySold = p.monthlySold ?? 0;
    const offerCount  = p.liveOffersOrder ? p.liveOffersOrder.length : 0;
    // 修正後
    const fbaCount = 0; // offers=20不使用のため取得しない
    const score = calcScore_(imageCount, hasAplus, monthlySold, offerCount);

    // 11列目〜16列目に書き込み
    sheet.getRange(rowNum, 11, 1, 6).setValues([[
      imageCount,
      hasAplus ? 'YES' : 'NO',
      monthlySold,
      offerCount,
      fbaCount,
      score
    ]]);
  });

  Logger.log(`=== Stage2完了 ${batch.length}件処理 / 残り${targets.length - batch.length}件 ===`);
}

function calcScore_(imageCount, hasAplus, monthlySold, offerCount) {
  let score = 0;
  if (imageCount <= 3)    score += 30;
  if (!hasAplus)          score += 25;
  if (monthlySold >= 100) score += 25;
  if (offerCount <= 3)    score += 20;
  return score;
}

/**
 * Stage2のトリガーを設置（毎時45分）
 */
function setupStage2Trigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runKeepaStage2')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('runKeepaStage2')
    .timeBased()
    .everyHours(1)
    .nearMinute(45)
    .create();

  Logger.log('Stage2トリガー設置完了: 毎時45分');
}