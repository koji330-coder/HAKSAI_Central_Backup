function testKeepaProductDetail() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: KEEPA_API_KEY がスクリプトプロパティに未設定');
    return;
  }

  const testAsin = 'B0CP1JLYW3';

  // stats=30: 直近30日の価格統計
  // offers=20: 出品者情報（競合セラー数・FBA率）
  // rating=1: レビュー数・評価履歴
  // aplus=1: A+コンテンツ有無
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${testAsin}&stats=30&offers=20&rating=1&aplus=1`;

  const options = {
    method: 'get',
    muteHttpExceptions: true
  };

  Logger.log('=== Keepa 商品詳細テスト開始 ===');
  Logger.log('対象ASIN: ' + testAsin);

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  Logger.log('HTTPステータス: ' + statusCode);

  if (statusCode !== 200) {
    Logger.log('ERROR: ' + response.getContentText());
    return;
  }

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);

  const p = json.products[0];

  // ── 基本情報 ──
  Logger.log('--- 基本情報 ---');
  Logger.log('タイトル: '      + p.title);
  Logger.log('ブランド: '      + p.brand);
  Logger.log('メーカー: '      + p.manufacturer);
  Logger.log('出品開始日: '    + p.listedSince);
  Logger.log('月販数: '        + (p.monthlySold ?? 'なし'));

  // ── ページ強度判定 ──
  Logger.log('--- ページ強度 ---');
  // 修正後
  const imageCount = Array.isArray(p.images) ? p.images.length : 0;
  Logger.log('画像枚数: '      + imageCount);
  Logger.log('A+あり: '        + (p.aPlus ? 'YES' : 'NO'));
  Logger.log('動画あり: '      + (p.videos && p.videos.length > 0 ? 'YES(' + p.videos.length + '本)' : 'NO'));
  Logger.log('features数: '   + (p.features ? p.features.length : 0));
  Logger.log('features内容: ' + JSON.stringify(p.features));

  // ── 競合情報 ──
  Logger.log('--- 競合情報 ---');
  const liveOffers = p.liveOffersOrder ? p.liveOffersOrder.length : 0;
  Logger.log('出品者数（現在）: ' + liveOffers);
  if (p.offers && liveOffers > 0) {
    const fbaCount = p.liveOffersOrder
      .map(i => p.offers[i])
      .filter(o => o && o.isFBA).length;
    Logger.log('FBA出品者数: ' + fbaCount);
    Logger.log('FBA率: ' + Math.round(fbaCount / liveOffers * 100) + '%');
  }

  // ── 価格統計（直近30日）──
  Logger.log('--- 価格統計(30日) ---');
  if (p.stats) {
    const s = p.stats;
    Logger.log('現在価格（新品）: ' + s.current[0]);   // index 0 = NEW price
    Logger.log('30日最安値: '       + s.min[0]);
    Logger.log('30日最高値: '       + s.max[0]);
    Logger.log('30日平均: '         + s.avg[0]);
  }

  // ── サイズ・重量 ──
  Logger.log('--- サイズ・重量 ---');
  Logger.log('パッケージ(mm): ' + `${p.packageLength}×${p.packageWidth}×${p.packageHeight}`);
  Logger.log('パッケージ重量(g): ' + p.packageWeight);

  // ── FBA手数料 ──
  Logger.log('--- FBA手数料 ---');
  Logger.log('fbaFees: ' + JSON.stringify(p.fbaFees));

  // ── 生レスポンス確認用（先頭500文字）──
  Logger.log('--- rawレスポンス（先頭500文字）---');
  Logger.log(response.getContentText().substring(0, 500));

  Logger.log('=== テスト完了 ===');
}

/**
 * 任意条件でProduct Finderをテスト実行する関数
 * selectionを直接編集して使う
 */
function testKeepaProductFinderCustom() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定');

  const keepaNow = Math.floor((Date.now() - 1293840000000) / 60000);
  const threeMonthsAgo = keepaNow - 129600;

  // ここを自由に編集して試す
  const selection = {
    productType: [0],
    current_BUY_BOX_SHIPPING_gte: 500,
    current_BUY_BOX_SHIPPING_lte: 750,
    monthlySold_gte: 300,              // 正しいフィールド名
    current_COUNT_REVIEWS_lte: 100,
    imageCount_lte: 3,
    hasAPlus: false,                   // A+なしの商品のみ
    buyBoxIsFBA: true,                 // FBA出品者がBuyBox保持
    rootCategory: [2016929051],        // DIY・工具（rootCategoryは親でOK）
    sort: [['current_SALES', 'asc']], // デフォルトと同じだが明示
    perPage: 100,
    page: 0
  };

  const url = 'https://api.keepa.com/query?domain=5&key=' + apiKey;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(selection),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  Logger.log('HTTPステータス: ' + statusCode);

  if (statusCode !== 200) {
    Logger.log('ERROR: ' + response.getContentText());
    return;
  }

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);
  Logger.log('totalResults: ' + json.totalResults);
  Logger.log('取得件数: ' + (json.asinList || []).length);

  // 先頭5件をAmazon URLで出力
  (json.asinList || []).slice(0, 5).forEach((asin, i) => {
    Logger.log((i + 1) + ': https://www.amazon.co.jp/dp/' + asin);
  });
}

function testMinimalQuery() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const url = 'https://api.keepa.com/query?domain=5&key=' + apiKey;

  // まず categories_include なしで試す
  const selection = {
    monthlySold_gte: 300,
    current_BUY_BOX_SHIPPING_gte: 600,
    current_BUY_BOX_SHIPPING_lte: 1500,
    perPage: 50,
    page: 0
  };

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
}function testCompetitorResearch() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const asin = 'B0FXTQPGSB'; // ChimePro

  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&offers=20&history=0`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);

  const p = json.products[0];

  // 一緒に買われた商品
  Logger.log('--- frequentlyBoughtTogether ---');
  Logger.log(JSON.stringify(p.frequentlyBoughtTogether || []));

  // 競合セラーID一覧
  Logger.log('--- 競合セラーID ---');
  if (p.liveOffersOrder && p.offers) {
    p.liveOffersOrder.forEach(i => {
      const o = p.offers[i];
      if (o) Logger.log(`sellerId: ${o.sellerId} | FBA: ${o.isFBA} | 価格: ¥${o.price}`);
    });
  }

  // similarProducts（類似商品）
  Logger.log('--- similarProducts ---');
  Logger.log(JSON.stringify(p.similarProducts || []));
}

function testCompetitorResearch() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const asin = 'B0C4K7CBWS'; // ChimePro

  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&offers=20&history=0`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);

  const p = json.products[0];

  // 一緒に買われた商品
  Logger.log('--- frequentlyBoughtTogether ---');
  Logger.log(JSON.stringify(p.frequentlyBoughtTogether || []));

  // 競合セラーID一覧
  Logger.log('--- 競合セラーID ---');
  if (p.liveOffersOrder && p.offers) {
    p.liveOffersOrder.forEach(i => {
      const o = p.offers[i];
      if (o) Logger.log(`sellerId: ${o.sellerId} | FBA: ${o.isFBA} | 価格: ¥${o.price}`);
    });
  }

  // similarProducts（類似商品）
  Logger.log('--- similarProducts ---');
  Logger.log(JSON.stringify(p.similarProducts || []));
}

function testGetProductContent() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const asin = 'B0FSZLQP76'; // ゴルフベルト

  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&history=0`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());
  Logger.log('残トークン: ' + json.tokensLeft);

  const p = json.products[0];

  Logger.log('--- タイトル ---');
  Logger.log(p.title);

  Logger.log('--- ブランド ---');
  Logger.log(p.brand);

  Logger.log('--- features（bullet points）---');
  (p.features || []).forEach((f, i) => Logger.log(`${i+1}: ${f}`));

  Logger.log('--- description ---');
  Logger.log(p.description);

  Logger.log('--- 画像枚数 ---');
  Logger.log(p.imagesCSV ? p.imagesCSV.split(',').length + '枚' : '0枚');
}

function testStage2Lightweight() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  
  // まず1件だけで試す
  const testAsin = 'B0FXTQPGSB';
  
  const before = '確認のため実行前にtokensLeftをログで確認';
  Logger.log('=== 実行前トークン確認 ===');
  
  // トークン確認用の軽量リクエスト
  const checkUrl = `https://api.keepa.com/token?key=${apiKey}`;
  const checkRes = UrlFetchApp.fetch(checkUrl, { muteHttpExceptions: true });
  const checkJson = JSON.parse(checkRes.getContentText());
  Logger.log('実行前トークン: ' + checkJson.tokensLeft);
  
  // 本番リクエスト（1件・history=0・stats=90のみ）
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${testAsin}&history=0&stats=90`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());
  
  Logger.log('実行後トークン: ' + json.tokensLeft);
  Logger.log('消費トークン: ' + (checkJson.tokensLeft - json.tokensLeft));
  Logger.log('tokensConsumed: ' + json.tokensConsumed);
}

function testStage2Batch20() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');

  // tokensLeft確認
  const checkRes = UrlFetchApp.fetch(`https://api.keepa.com/token?key=${apiKey}`, { muteHttpExceptions: true });
  const before = JSON.parse(checkRes.getContentText()).tokensLeft;
  Logger.log('実行前トークン: ' + before);

  // keepa_research_candidatesから20件取得
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  const asins = sheet.getRange(2, 1, 20, 1).getValues()
    .map(r => r[0]).filter(Boolean).join(',');

  Logger.log('対象ASIN数: ' + asins.split(',').length);

  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asins}&history=0&stats=90`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());

  Logger.log('実行後トークン: ' + json.tokensLeft);
  Logger.log('消費トークン: ' + (before - json.tokensLeft));
  Logger.log('tokensConsumed: ' + json.tokensConsumed);
  Logger.log('取得商品数: ' + (json.products || []).length);
}

function testSellerStorefront() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');

  // まず1セラーだけで試す
  const testSeller = 'AVPVDBYI0JK';

  const checkRes = UrlFetchApp.fetch(`https://api.keepa.com/token?key=${apiKey}`, { muteHttpExceptions: true });
  const before = JSON.parse(checkRes.getContentText()).tokensLeft;
  Logger.log('実行前トークン: ' + before);

  const url = `https://api.keepa.com/seller?key=${apiKey}&domain=5&seller=${testSeller}&storefront=1`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());

  Logger.log('実行後トークン: ' + json.tokensLeft);
  Logger.log('消費トークン: ' + (before - json.tokensLeft));
  Logger.log('tokensConsumed: ' + json.tokensConsumed);

  const seller = json.sellers ? json.sellers[testSeller] : null;
  if (seller) {
    Logger.log('セラー名: ' + seller.sellerName);
    Logger.log('国: ' + seller.country);
    Logger.log('ASIN数: ' + (seller.asinList ? seller.asinList.length : 0));
    Logger.log('先頭5件: ' + JSON.stringify((seller.asinList || []).slice(0, 5)));
  } else {
    Logger.log('セラーデータ: ' + JSON.stringify(json).substring(0, 500));
  }
}

function testAndStoreSellerAsins() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');

  // 3セラーまとめて取得
  const sellerIds = [
    'AVPVDBYI0JK',
    'A1DDKVXWUO6XBP',
    'A1VOHGQROWBKMA'
  ];

  const checkRes = UrlFetchApp.fetch(`https://api.keepa.com/token?key=${apiKey}`, { muteHttpExceptions: true });
  const before = JSON.parse(checkRes.getContentText()).tokensLeft;
  Logger.log('実行前トークン: ' + before);

  const url = `https://api.keepa.com/seller?key=${apiKey}&domain=5&seller=${sellerIds.join(',')}&storefront=1`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());

  Logger.log('実行後トークン: ' + json.tokensLeft);
  Logger.log('消費トークン: ' + (before - json.tokensLeft));
  Logger.log('tokensConsumed: ' + json.tokensConsumed);

  if (!json.sellers) {
    Logger.log('セラーデータなし: ' + JSON.stringify(json).substring(0, 300));
    return;
  }

  // 既存ASINを取得（重複除外用）
  const existing = getExistingAsins_();
  const now = new Date().toISOString();
  let totalAdded = 0;

  Object.entries(json.sellers).forEach(([sellerId, seller]) => {
    const asinList = seller.asinList || [];
    Logger.log(`${sellerId}: ${seller.sellerName} / ASIN数: ${asinList.length}`);

    // 新規ASINだけ抽出
    const newAsins = asinList.filter(asin => !existing.has(asin));

    if (newAsins.length === 0) {
      Logger.log(`  → 全件重複スキップ`);
      return;
    }

    // シートに書き込み
    const rows = newAsins.map(asin => [
      asin,
      now,
      `セラー: ${seller.sellerName || sellerId}`,
      '',   // price_min
      '',   // price_max
      `https://www.amazon.co.jp/dp/${asin}`,
      `https://keepa.com/#!product/5-${asin}`,
      '',   // title
      '',   // brand
      '未確認', // status
    ]);

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 10).setValues(rows);

    // ドロップダウン設定
    const statusRange = sheet.getRange(startRow, 10, rows.length, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['未確認', 'GO', 'NG'], true)
      .setAllowInvalid(false)
      .build();
    statusRange.setDataValidation(rule);

    // 書き込んだASINをexistingに追加（同一実行内の重複防止）
    newAsins.forEach(asin => existing.add(asin));

    Logger.log(`  → ${newAsins.length}件追加 / ${asinList.length - newAsins.length}件重複スキップ`);
    totalAdded += newAsins.length;
  });

  // タイトル取得数式を書き込む
  fillTitlesWithImportXml();

  Logger.log(`=== 完了: 合計${totalAdded}件追加 ===`);
}

function testAndStoreSellerAsins() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');

  const sellerIds = [
    'AVPVDBYI0JK',
    'A1DDKVXWUO6XBP',
    'A1VOHGQROWBKMA'
  ];

  const checkRes = UrlFetchApp.fetch(`https://api.keepa.com/token?key=${apiKey}`, { muteHttpExceptions: true });
  const before = JSON.parse(checkRes.getContentText()).tokensLeft;
  Logger.log('実行前トークン: ' + before);

  // トークン確認（1セラー10トークン × セラー数）
  const required = sellerIds.length * 10;
  if (before < required) {
    Logger.log(`トークン不足: 必要${required} / 残り${before}`);
    return;
  }

  const existing = getExistingAsins_();
  const now = new Date().toISOString();
  let totalAdded = 0;

  sellerIds.forEach(sellerId => {
    const url = `https://api.keepa.com/seller?key=${apiKey}&domain=5&seller=${sellerId}&storefront=1`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(response.getContentText());

    Logger.log(`${sellerId}: 残トークン ${json.tokensLeft} / 消費 ${json.tokensConsumed}`);

    const seller = json.sellers ? json.sellers[sellerId] : null;
    if (!seller) { Logger.log('  → データなし'); return; }

    const asinList = seller.asinList || [];
    Logger.log(`  セラー名: ${seller.sellerName} / ASIN数: ${asinList.length}`);

    const newAsins = asinList.filter(asin => !existing.has(asin));
    if (newAsins.length === 0) { Logger.log('  → 全件重複スキップ'); return; }

    const rows = newAsins.map(asin => [
      asin, now,
      `セラー: ${seller.sellerName || sellerId}`,
      '', '',
      `https://www.amazon.co.jp/dp/${asin}`,
      `https://keepa.com/#!product/5-${asin}`,
      '', '', '未確認'
    ]);

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 10).setValues(rows);

    const statusRange = sheet.getRange(startRow, 10, rows.length, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['未確認', 'GO', 'NG'], true)
      .setAllowInvalid(false)
      .build();
    statusRange.setDataValidation(rule);

    newAsins.forEach(asin => existing.add(asin));
    Logger.log(`  → ${newAsins.length}件追加`);
    totalAdded += newAsins.length;

    Utilities.sleep(500);
  });

  fillTitlesWithImportXml();
  Logger.log(`=== 完了: 合計${totalAdded}件追加 ===`);
}

function testImagesCsvRaw() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const asin = 'B0FXTQPGSB';
  
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&history=0`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const raw = response.getContentText();
  const json = JSON.parse(raw);
  const p = json.products[0];

  // imagesCSVがレスポンスに存在するか
  Logger.log('imagesCSV in raw: ' + raw.includes('imagesCSV'));
  
  // productオブジェクトの全キーを確認
  Logger.log('全キー: ' + Object.keys(p).join(', '));
  
  // image系のキーを探す
  const imageKeys = Object.keys(p).filter(k => k.toLowerCase().includes('image'));
  Logger.log('imageを含むキー: ' + JSON.stringify(imageKeys));
  Logger.log('残トークン: ' + json.tokensLeft);
}

function testImagesField() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  const asin = 'B0FXTQPGSB';
  
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&history=0`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const p = JSON.parse(response.getContentText()).products[0];

  Logger.log('images: ' + JSON.stringify(p.images));
  Logger.log('images type: ' + typeof p.images);
  if (Array.isArray(p.images)) Logger.log('images length: ' + p.images.length);
}

function forceConvertAllTitles() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 8, lastRow - 1, 1);
  const formulas = range.getFormulas();
  const displayValues = range.getDisplayValues();

  // 全行の値を確定させる（数式を値に置き換え）
  const newValues = formulas.map((row, i) => {
    if (!row[0]) return [displayValues[i][0]]; // 数式なし → そのまま
    const val = displayValues[i][0];
    if (!val || val === '読み込んでいます...' || val.startsWith('#')) {
      return ['']; // 取得できていない → 空文字で数式を消す
    }
    return [val]; // 取得済み → 値に変換
  });

  range.setValues(newValues);
  Logger.log('全行の数式を値に変換完了: ' + lastRow + '件');
}

function testRoughProfitCalculation() {
  Logger.log('=== testRoughProfitCalculation 開始 ===');
  
  // 1. ダミーのプロジェクト行オブジェクトを用意する（競合価格・月販など）
  const project = {
    title: 'テスト用折りたたみ傘（大型キーワード含む）',
    category: '傘',
    price: 3000,
    monthly_sales: 500
  };
  
  // 2. 中国元単価が20元の場合で概算利益計算を実行
  const sim = calculateRoughProfit_(project, 20);
  
  if (!sim) {
    Logger.log('シミュレーション結果が null です。');
    return;
  }
  
  Logger.log('計算結果:');
  Logger.log('  着地原価 (JPY): ' + sim.cost);
  Logger.log('  Amazon手数料: ' + sim.amazon);
  Logger.log('  FBA配送代行手数料: ' + sim.fba);
  Logger.log('  予測販売数 (堅実値10%): ' + sim.planned_monthly_sales);
  Logger.log('  個あたり粗利益: ' + sim.net_profit_unit);
  Logger.log('  粗利益率 (%): ' + sim.profit_rate);
  Logger.log('  月間予測利益 (堅実値): ' + sim.expected_monthly_profit);
  
  // 検証アサーション
  if (sim.planned_monthly_sales !== 50) {
    throw new Error('予測販売数の計算が違います。期待値: 50, 結果: ' + sim.planned_monthly_sales);
  }
  
  // 折りたたみ傘（大型キーワード）なのでFBA手数料は900円のはず
  if (sim.fba !== 900) {
    throw new Error('FBA手数料の大型キーワード判定が違います。期待値: 900, 結果: ' + sim.fba);
  }
  
  Logger.log('=== testRoughProfitCalculation 成功 ===');
}

function testAnalyzeCompetitor() {
  const testData = {
    asin: 'B0FSD95K68',
    myPrice: 3000,
    cnyCost: 20
  };
  try {
    const result = analyzeCompetitorAsin_(testData);
    Logger.log('Test Success: ' + JSON.stringify(result, null, 2));
  } catch (e) {
    Logger.log('Test Failed: ' + e.toString() + '\n' + e.stack);
  }
}

function runTestKeepaForTargetAsin() {
  const asin = 'B0GVBMYTD7';
  Logger.log('=== Target ASIN Keepa Test ===');
  const res = tryGetKeepaData_(asin);
  Logger.log('Result: ' + JSON.stringify(res));
  if (!res) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
    Logger.log('API Key Status: ' + (apiKey ? '設定あり' : '未設定'));
    if (apiKey) {
      const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin}&history=0`;
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      Logger.log('HTTP Status: ' + response.getResponseCode());
      Logger.log('Response Content: ' + response.getContentText().slice(0, 1000));
    }
  }
}