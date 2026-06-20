/**
 * HAKSAI Central / Spreadsheet schema debugger
 * 
 * 目的：
 * - 全シートの構造を把握する
 * - ヘッダー行を推定する
 * - 先頭数行をJSON化する
 * - AIに渡しやすいデバッグシートを生成する
 */

const HAKSAI_DEBUG_SPREADSHEET_ID = '1w71T_U8dDRK9FKhAbFP7JqPKuHWxDkJe1Cu2ISjHBsw';

const HAKSAI_DEBUG_CONFIG = {
  sampleRows: 5,
  scanHeaderRows: 10,
  maxCellLength: 300,
  schemaSheetName: '__debug_schema',
  sampleSheetName: '__debug_samples',
  includeEmptySheets: true,
};

/**
 * メイン実行関数
 * Apps Scriptエディタからこれを実行してください。
 */
function debugHaksaiSheetStructure() {
  const ss = SpreadsheetApp.openById(HAKSAI_DEBUG_SPREADSHEET_ID);
  const sheets = ss.getSheets();

  const schemaRows = [
    [
      'sheet_name',
      'last_row',
      'last_col',
      'max_rows',
      'max_cols',
      'header_row',
      'header_count',
      'headers_json',
      'inferred_types_json',
      'sample_object_count',
      'notes',
    ],
  ];

  const sampleRows = [
    [
      'sheet_name',
      'sample_no',
      'row_number',
      'row_json',
    ],
  ];

  const fullDebug = {
    spreadsheetName: ss.getName(),
    spreadsheetId: HAKSAI_DEBUG_SPREADSHEET_ID,
    generatedAt: new Date().toISOString(),
    sheets: [],
  };

  sheets.forEach(sheet => {
    const sheetName = sheet.getName();

    // デバッグ出力シート自身はスキップ
    if (
      sheetName === HAKSAI_DEBUG_CONFIG.schemaSheetName ||
      sheetName === HAKSAI_DEBUG_CONFIG.sampleSheetName
    ) {
      return;
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const maxRows = sheet.getMaxRows();
    const maxCols = sheet.getMaxColumns();

    if (!HAKSAI_DEBUG_CONFIG.includeEmptySheets && (lastRow === 0 || lastCol === 0)) {
      return;
    }

    let headerRow = null;
    let headers = [];
    let samples = [];
    let inferredTypes = {};
    let notes = '';

    if (lastRow > 0 && lastCol > 0) {
      const scanRows = Math.min(lastRow, HAKSAI_DEBUG_CONFIG.scanHeaderRows);
      const scanValues = sheet.getRange(1, 1, scanRows, lastCol).getDisplayValues();

      headerRow = guessHeaderRow_(scanValues);
      headers = headerRow
        ? normalizeHeaders_(scanValues[headerRow - 1])
        : [];

      if (headers.length === 0) {
        notes = 'ヘッダー行を推定できませんでした';
      }

      const sampleStartRow = headerRow ? headerRow + 1 : 1;
      const sampleCount = Math.max(
        0,
        Math.min(HAKSAI_DEBUG_CONFIG.sampleRows, lastRow - sampleStartRow + 1)
      );

      if (sampleCount > 0) {
        const rawSamples = sheet
          .getRange(sampleStartRow, 1, sampleCount, lastCol)
          .getDisplayValues();

        samples = rowsToObjects_(headers, rawSamples, sampleStartRow);
        inferredTypes = inferTypes_(headers, rawSamples);
      }
    } else {
      notes = '空シート';
    }

    schemaRows.push([
      sheetName,
      lastRow,
      lastCol,
      maxRows,
      maxCols,
      headerRow || '',
      headers.length,
      JSON.stringify(headers, null, 0),
      JSON.stringify(inferredTypes, null, 0),
      samples.length,
      notes,
    ]);

    samples.forEach((sample, index) => {
      sampleRows.push([
        sheetName,
        index + 1,
        sample.__rowNumber || '',
        JSON.stringify(sample, null, 0),
      ]);
    });

    fullDebug.sheets.push({
      sheetName,
      lastRow,
      lastCol,
      maxRows,
      maxCols,
      headerRow,
      headers,
      inferredTypes,
      samples,
      notes,
    });
  });

    writeDebugSheet_(ss, HAKSAI_DEBUG_CONFIG.schemaSheetName, schemaRows);
  writeDebugSheet_(ss, HAKSAI_DEBUG_CONFIG.sampleSheetName, sampleRows);

  Logger.log(JSON.stringify(fullDebug, null, 2));

  const message =
    'デバッグ出力が完了しました。\n\n' +
    HAKSAI_DEBUG_CONFIG.schemaSheetName + '\n' +
    HAKSAI_DEBUG_CONFIG.sampleSheetName + '\n\n' +
    'この2シートの内容をAIに渡すと、構造把握がかなり楽になります。';

  Logger.log(message);

  return {
    status: 'ok',
    message,
    schemaSheetName: HAKSAI_DEBUG_CONFIG.schemaSheetName,
    sampleSheetName: HAKSAI_DEBUG_CONFIG.sampleSheetName,
    spreadsheetName: ss.getName(),
    spreadsheetId: HAKSAI_DEBUG_SPREADSHEET_ID,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * JSONファイルとしてDriveにも出力したい場合はこちらを実行。
 * 大きくなりすぎる場合があるので、必要なときだけ。
 */
function debugHaksaiSheetStructureToDriveJson() {
  const ss = SpreadsheetApp.openById(HAKSAI_DEBUG_SPREADSHEET_ID);
  const sheets = ss.getSheets();

  const fullDebug = {
    spreadsheetName: ss.getName(),
    spreadsheetId: HAKSAI_DEBUG_SPREADSHEET_ID,
    generatedAt: new Date().toISOString(),
    sheets: [],
  };

  sheets.forEach(sheet => {
    const sheetName = sheet.getName();

    if (
      sheetName === HAKSAI_DEBUG_CONFIG.schemaSheetName ||
      sheetName === HAKSAI_DEBUG_CONFIG.sampleSheetName
    ) {
      return;
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    let headerRow = null;
    let headers = [];
    let samples = [];
    let inferredTypes = {};
    let notes = '';

    if (lastRow > 0 && lastCol > 0) {
      const scanRows = Math.min(lastRow, HAKSAI_DEBUG_CONFIG.scanHeaderRows);
      const scanValues = sheet.getRange(1, 1, scanRows, lastCol).getDisplayValues();

      headerRow = guessHeaderRow_(scanValues);
      headers = headerRow
        ? normalizeHeaders_(scanValues[headerRow - 1])
        : [];

      const sampleStartRow = headerRow ? headerRow + 1 : 1;
      const sampleCount = Math.max(
        0,
        Math.min(HAKSAI_DEBUG_CONFIG.sampleRows, lastRow - sampleStartRow + 1)
      );

      if (sampleCount > 0) {
        const rawSamples = sheet
          .getRange(sampleStartRow, 1, sampleCount, lastCol)
          .getDisplayValues();

        samples = rowsToObjects_(headers, rawSamples, sampleStartRow);
        inferredTypes = inferTypes_(headers, rawSamples);
      }
    } else {
      notes = '空シート';
    }

    fullDebug.sheets.push({
      sheetName,
      lastRow,
      lastCol,
      headerRow,
      headers,
      inferredTypes,
      samples,
      notes,
    });
  });

  const fileName = `HAKSAI_schema_debug_${Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  )}.json`;

  const blob = Utilities.newBlob(
    JSON.stringify(fullDebug, null, 2),
    'application/json',
    fileName
  );

  const file = DriveApp.createFile(blob);

  Logger.log('Debug JSON file created: ' + file.getUrl());

  SpreadsheetApp.getUi().alert(
    'JSONファイルをDriveに作成しました。\n\n' +
    file.getUrl()
  );
}

/**
 * ヘッダー行を推定。
 * 先頭数行のうち、非空セルが一番多い行をヘッダーとみなす。
 */
function guessHeaderRow_(rows) {
  let bestIndex = -1;
  let bestScore = 0;

  rows.forEach((row, index) => {
    const nonEmpty = row.filter(v => String(v || '').trim() !== '').length;

    // 1セルだけのタイトル行っぽいものは弱く見る
    const score = nonEmpty >= 2 ? nonEmpty : 0;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex >= 0 ? bestIndex + 1 : null;
}

/**
 * ヘッダー名を正規化。
 * 空欄ヘッダーは __col_番号 にする。
 * 重複ヘッダーは suffix を付ける。
 */
function normalizeHeaders_(headerRow) {
  const seen = {};
  return headerRow.map((raw, index) => {
    let name = String(raw || '').trim();

    if (!name) {
      name = `__col_${index + 1}`;
    }

    name = name
      .replace(/\s+/g, '_')
      .replace(/[　]/g, '_');

    if (seen[name] === undefined) {
      seen[name] = 0;
      return name;
    }

    seen[name]++;
    return `${name}_${seen[name] + 1}`;
  });
}

/**
 * 行データをオブジェクト配列に変換。
 */
function rowsToObjects_(headers, rows, startRowNumber) {
  return rows.map((row, rowIndex) => {
    const obj = {
      __rowNumber: startRowNumber + rowIndex,
    };

    row.forEach((value, colIndex) => {
      const key = headers[colIndex] || `__col_${colIndex + 1}`;
      obj[key] = shortenCell_(value);
    });

    return obj;
  });
}

/**
 * サンプル値から列の型をざっくり推定。
 */
function inferTypes_(headers, rows) {
  const result = {};

  headers.forEach((header, colIndex) => {
    const values = rows
      .map(row => String(row[colIndex] || '').trim())
      .filter(Boolean);

    if (!values.length) {
      result[header] = 'empty';
      return;
    }

    const typeCounts = {
      number: 0,
      date: 0,
      url: 0,
      json: 0,
      boolean: 0,
      text: 0,
    };

    values.forEach(value => {
      if (/^https?:\/\//i.test(value)) {
        typeCounts.url++;
      } else if (looksLikeJson_(value)) {
        typeCounts.json++;
      } else if (looksLikeDate_(value)) {
        typeCounts.date++;
      } else if (looksLikeNumber_(value)) {
        typeCounts.number++;
      } else if (/^(true|false|TRUE|FALSE|はい|いいえ)$/i.test(value)) {
        typeCounts.boolean++;
      } else {
        typeCounts.text++;
      }
    });

    result[header] = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
  });

  return result;
}

function looksLikeNumber_(value) {
  const cleaned = String(value)
    .replace(/[,\s¥￥]/g, '')
    .replace(/%$/, '');

  return cleaned !== '' && !isNaN(Number(cleaned));
}

function looksLikeDate_(value) {
  const s = String(value).trim();

  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(s)) return true;
  if (/^\d{4}[\/\-]\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return true;

  return false;
}

function looksLikeJson_(value) {
  const s = String(value).trim();
  if (!s) return false;

  if (
    !((s.startsWith('{') && s.endsWith('}')) ||
      (s.startsWith('[') && s.endsWith(']')))
  ) {
    return false;
  }

  try {
    JSON.parse(s);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * セル値が長すぎる場合に短縮。
 */
function shortenCell_(value) {
  const s = String(value ?? '');

  if (s.length <= HAKSAI_DEBUG_CONFIG.maxCellLength) {
    return s;
  }

  return s.slice(0, HAKSAI_DEBUG_CONFIG.maxCellLength) + '... [truncated]';
}

/**
 * デバッグシートを書き出す。
 */
function writeDebugSheet_(ss, sheetName, rows) {
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clear();

  if (!rows.length) return;

  sheet
    .getRange(1, 1, rows.length, rows[0].length)
    .setValues(rows);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, rows[0].length);

  // JSON列は横に広がりすぎるので少し制限
  for (let col = 1; col <= rows[0].length; col++) {
    const header = rows[0][col - 1];
    if (String(header).includes('json')) {
      sheet.setColumnWidth(col, 420);
    }
  }
}