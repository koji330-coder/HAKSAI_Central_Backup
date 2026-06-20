// ============================================
// タイトル取得（IMPORTXML方式）
// ============================================

/**
 * 未取得ASINのtitle列にIMPORTXML数式を書き込む
 */
function fillTitlesWithImportXml() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet || sheet.getLastRow() < 2) return;

  const lastRow = sheet.getLastRow();
  const allData = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  let count = 0;
  allData.forEach((row, i) => {
    if (row[7]) return; // 既に値あり
    const asin = row[0];
    if (!asin) return;

    sheet.getRange(i + 2, 8).setFormula(
      `=IMPORTXML("https://www.amazon.co.jp/dp/${asin}","//span[@id='productTitle']")`
    );
    count++;
  });

  Logger.log(`数式書き込み完了: ${count}件`);
}

/**
 * 取得完了済みの行だけ数式→値に変換する
 * 5分おきのトリガーで実行
 */
function convertCompletedTitlesToValues() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet || sheet.getLastRow() < 2) return;

  const lastRow = sheet.getLastRow();

  // H列（title）の数式と表示値を一括取得
  const range = sheet.getRange(2, 8, lastRow - 1, 1);
  const formulas = range.getFormulas();
  const displayValues = range.getDisplayValues();

  const updates = [];
  formulas.forEach((row, i) => {
    if (!row[0]) return; // 数式なし → スキップ
    const val = displayValues[i][0];
    if (!val || val === '読み込んでいます...' || val.startsWith('#')) return;
    updates.push({ row: i + 2, value: val });
  });

  if (updates.length === 0) return;

  // 変換対象が少なければ個別書き込み
  // 連続範囲があればまとめて書き込む方が速いが、
  // 行がバラバラなので個別書き込みで対応
  updates.forEach(({ row, value }) => {
    sheet.getRange(row, 8).setValue(value);
  });

  Logger.log(`値変換完了: ${updates.length}件`);
}

/**
 * convertCompletedTitlesToValues のトリガーを設置（5分おき）
 */
function setupTitleConvertTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'convertCompletedTitlesToValues')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('convertCompletedTitlesToValues')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('タイトル変換トリガー設置完了: 5分おき');
}

/**
 * keepa_research_candidates にstatus列を追加してドロップダウンを設定
 */
function setupStatusColumn() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet) return;

  // ヘッダー更新
  const headers = [
    'asin', 'fetched_at', 'category_name', 'price_min', 'price_max',
    'amazon_url', 'keepa_url', 'title', 'brand', 'status'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // status列（J列=10列目）にドロップダウンを設定
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const statusRange = sheet.getRange(2, 10, lastRow - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['未確認', 'GO', 'NG'], true)
    .setAllowInvalid(false)
    .build();
  statusRange.setDataValidation(rule);

  // 既存データのstatus列が空なら「未確認」を設定
  const values = statusRange.getValues();
  const updated = values.map(row => [row[0] || '未確認']);
  statusRange.setValues(updated);

  // 列幅調整
  sheet.setColumnWidth(10, 100); // status

  // 条件付き書式（GOは緑、NGは赤）
  const range = sheet.getRange(2, 10, lastRow - 1, 1);

  const goRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('GO')
    .setBackground('#b7e1cd')
    .setRanges([range])
    .build();

  const ngRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('NG')
    .setBackground('#f4c7c3')
    .setRanges([range])
    .build();

  const rules = sheet.getConditionalFormatRules();
  rules.push(goRule);
  rules.push(ngRule);
  sheet.setConditionalFormatRules(rules);

  Logger.log('status列セットアップ完了');
}