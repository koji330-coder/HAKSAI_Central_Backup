// ============================================
// Keepaスケジュール管理API
// ============================================

/**
 * カテゴリマスターを返す（検索対応）
 */
function getKeepaCategories(keyword) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_category_master');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  return rows
    .filter(row => {
      if (!keyword) return true;
      const path = (row[2] || '').toLowerCase();
      const name = (row[3] || '').toLowerCase();
      return path.includes(keyword.toLowerCase()) || name.includes(keyword.toLowerCase());
    })
    .map(row => ({
      node_id:        String(row[0]),
      category_group: row[1],
      node_path:      row[2],
      category_name:  row[3],
      depth:          row[4]
    }))
    .slice(0, 100); // 最大100件
}

/**
 * スケジュール一覧を返す
 */
function getKeepaSchedule() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_batch_schedule');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    row_index:      i + 2,
    hour:           row[0],
    selection_json: row[1],
    memo:           row[2]
  }));
}

/**
 * スケジュールを保存（追加・更新・削除）
 */
function saveKeepaSchedule(action, data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('keepa_batch_schedule');
  if (!sheet) return { ok: false, error: 'シートが存在しません' };

  if (action === 'add') {
    sheet.appendRow([data.hour, data.selection_json, data.memo || '']);
    return { ok: true };
  }
  if (action === 'update') {
    sheet.getRange(data.row_index, 1, 1, 3)
      .setValues([[data.hour, data.selection_json, data.memo || '']]);
    return { ok: true };
  }
  if (action === 'delete') {
    sheet.deleteRow(data.row_index);
    return { ok: true };
  }
  return { ok: false, error: '不明なaction' };
}

/**
 * WebアプリからのGETリクエストを処理
 */
function doGetKeepa(action, params) {
  if (action === 'getCategories') {
    return getKeepaCategories(params.keyword || '');
  }
  if (action === 'getSchedule') {
    return getKeepaSchedule();
  }
  return { error: '不明なaction' };
}