function getKeepaCategories() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  
  // rootId=0で最上位カテゴリ一覧を取得
  const url = `https://api.keepa.com/category?key=${apiKey}&domain=5&category=0&parents=1`;
  
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());
  
  Logger.log('残トークン: ' + json.tokensLeft);
  
  // カテゴリ一覧をログ出力
  const categories = json.categories;
  Object.keys(categories).forEach(id => {
    const cat = categories[id];
    Logger.log(`ID: ${id} | 名前: ${cat.name}`);
  });
}

// ============================================
// NGカテゴリ管理
// ============================================

/**
 * keepa_ng_categories シートを作成して初期データを書き込む
 * 初回1回だけ実行する
 */
function setupKeepaNgCategories() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // シートが既にあれば削除して作り直す
  let sheet = ss.getSheetByName('keepa_ng_categories');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('keepa_ng_categories');

  // ヘッダー
  sheet.getRange(1, 1, 1, 3).setValues([['category_id', 'name', 'reason']]);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');

  // 初期NGリスト
  const ngList = [
    [465392,      '本',                   'コンテンツ商品'],
    [561956,      'ミュージック',          'コンテンツ商品'],
    [561958,      'DVD',                  'コンテンツ商品'],
    [637392,      'PCソフト',             'コンテンツ商品'],
    [52033011,    '洋書',                 'コンテンツ商品'],
    [57239051,    '食品・飲料・お酒',      '食品規制'],
    [160384011,   'ドラッグストア',        '薬事法リスク'],
    [2128134051,  'デジタルミュージック',  'コンテンツ商品'],
    [2250738051,  'Kindleストア',         'コンテンツ商品'],
    [2351649051,  'Prime Video',          'コンテンツ商品'],
    [2381130051,  'アプリ＆ゲーム',       'コンテンツ商品'],
    [4788676051,  'Alexaスキル',          'コンテンツ商品'],
    [2320455051,  'ファイナンス',         '非物販'],
  ];

  sheet.getRange(2, 1, ngList.length, 3).setValues(ngList);

  // 列幅調整
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 200);

  Logger.log('keepa_ng_categories シート作成完了: ' + ngList.length + '件');
}

/**
 * keepa_ng_categories シートからNGカテゴリIDを配列で返す
 */
function getKeepaNgCategoryIds_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_ng_categories');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .map(row => Number(row[0]))
    .filter(id => id > 0);
}

function getKeepaCategoryChildren() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');

  // 調べたい親カテゴリIDをここに入れる
  const parentCategoryId = 2016929051; // ホーム＆キッチン

  const url = `https://api.keepa.com/category?key=${apiKey}&domain=5&category=${parentCategoryId}&parents=1`;

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());

  Logger.log('残トークン: ' + json.tokensLeft);

  const categories = json.categories;
  Object.keys(categories).forEach(id => {
    const cat = categories[id];
    Logger.log(`ID: ${id} | 名前: ${cat.name} | 親: ${cat.parent}`);
  });
}