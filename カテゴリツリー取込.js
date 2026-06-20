// ============================================
// カテゴリマスター管理
// ============================================

/**
 * amazon_category_tree.csv の内容をGoogleシートに取り込む
 * CSVをGoogle DriveにアップロードしてファイルIDをここに貼る
 */
function setupKeepaCategoryMaster() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 既存シートを削除して再作成
  let sheet = ss.getSheetByName('keepa_category_master');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('keepa_category_master');

  // ヘッダー
  const headers = ['node_id', 'category_group', 'node_path', 'category_name', 'depth'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // CSVファイルIDをスクリプトプロパティから取得
  const csvFileId = PropertiesService.getScriptProperties()
    .getProperty('CATEGORY_TREE_CSV_ID');
  if (!csvFileId) {
    Logger.log('ERROR: CATEGORY_TREE_CSV_IDがスクリプトプロパティに未設定');
    Logger.log('CSVをDriveにアップロードしてファイルIDを設定してください');
    return;
  }

  // DriveからCSVを読み込む
  const file = DriveApp.getFileById(csvFileId);
  const content = file.getBlob().getDataAsString('UTF-8');
  const rows = Utilities.parseCsv(content);

  // ヘッダー行を除いたデータを書き込む
  const data = rows.slice(1).filter(row => row[0]); // node_idが空の行を除外
  if (data.length === 0) {
    Logger.log('データが空です');
    return;
  }

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  // 列幅調整
  sheet.setColumnWidth(1, 120); // node_id
  sheet.setColumnWidth(2, 120); // category_group
  sheet.setColumnWidth(3, 400); // node_path
  sheet.setColumnWidth(4, 180); // category_name
  sheet.setColumnWidth(5, 60);  // depth

  // フィルター設定
  sheet.getRange(1, 1, 1, headers.length).createFilter();

  Logger.log(`カテゴリマスター取り込み完了: ${data.length}件`);
}

/**
 * Excelファイル（xls）をGoogle DriveからCSV変換してシートに取り込む
 * 将来の更新用：DriveにExcelをアップロードしてファイルIDを指定して実行
 */
function importCategoryTreeFromExcel() {
  // アップロードしたExcelのファイルIDをここに貼る
  const excelFileIds = {
    'キッチン':   'YOUR_KITCHEN_FILE_ID',
    'DIY・工具':  'YOUR_TOOLS_FILE_ID',
    '車・バイク': 'YOUR_AUTO_FILE_ID',
    '家電':       'YOUR_CE_FILE_ID',
  };

  Logger.log('この関数は将来実装予定です');
  Logger.log('現在はsetupKeepaCategoryMasterでCSVから取り込んでください');
}