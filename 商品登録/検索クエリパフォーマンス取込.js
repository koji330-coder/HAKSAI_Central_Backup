// ============================================================
// Amazon Brand Analytics: 検索クエリパフォーマンス（ASINビュー）
// PR2: 差分プレビュー、scope局所置換、Drive原本、import log
// ============================================================

const SHEET_SEARCH_QUERY_PERFORMANCE = 'search_query_performance_period';
const SHEET_SEARCH_QUERY_IMPORT_LOG = 'search_query_import_log';
const SHEET_SEARCH_QUERY_SCOPE_BACKUP = 'search_query_scope_backup';

const REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE = [
  'id', 'scope_key', 'marketplace', 'period_type', 'date_from', 'date_to', 'period_key', 'asin',
  'search_query_raw', 'search_query_normalized', 'normalization_version', 'normalization_collision',
  'search_query_score', 'search_query_rank', 'search_query_volume',
  'impression_total', 'impression_asin', 'impression_asin_share_reported',
  'click_total', 'click_rate_reported', 'click_asin', 'click_asin_share_reported',
  'click_price_median', 'click_asin_price_median', 'click_same_day', 'click_one_day', 'click_two_day',
  'cart_total', 'cart_rate_reported', 'cart_asin', 'cart_asin_share_reported',
  'cart_price_median', 'cart_asin_price_median', 'cart_same_day', 'cart_one_day', 'cart_two_day',
  'purchase_total', 'purchase_rate_reported', 'purchase_asin', 'purchase_asin_share_reported',
  'purchase_price_median', 'purchase_asin_price_median',
  'purchase_same_day', 'purchase_one_day', 'purchase_two_day',
  'import_batch_id', 'source_row_hash'
];

const REQUIRED_HEADERS_SEARCH_QUERY_IMPORT_LOG = [
  'import_batch_id', 'imported_at', 'completed_at', 'status', 'actor',
  'source_type', 'filename', 'file_sha256', 'raw_drive_file_id',
  'scope_key', 'marketplace', 'period_type', 'date_from', 'date_to', 'period_key', 'asin',
  'report_scope', 'query_limit', 'page_number', 'returned_query_count', 'report_date',
  'input_rows', 'stored_rows', 'added', 'replaced', 'removed', 'unchanged',
  'normalization_version', 'warnings_json', 'backup_id', 'backup_rows', 'error'
];

const REQUIRED_HEADERS_SEARCH_QUERY_SCOPE_BACKUP = [
  'backup_id', 'backed_up_at', 'replaced_by_import_batch_id'
].concat(REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE);

const SQP_COMPARE_FIELDS_ = [
  'search_query_raw', 'search_query_normalized', 'normalization_version', 'normalization_collision',
  'search_query_score', 'search_query_rank', 'search_query_volume',
  'impression_total', 'impression_asin', 'impression_asin_share_reported',
  'click_total', 'click_rate_reported', 'click_asin', 'click_asin_share_reported',
  'click_price_median', 'click_asin_price_median', 'click_same_day', 'click_one_day', 'click_two_day',
  'cart_total', 'cart_rate_reported', 'cart_asin', 'cart_asin_share_reported',
  'cart_price_median', 'cart_asin_price_median', 'cart_same_day', 'cart_one_day', 'cart_two_day',
  'purchase_total', 'purchase_rate_reported', 'purchase_asin', 'purchase_asin_share_reported',
  'purchase_price_median', 'purchase_asin_price_median',
  'purchase_same_day', 'purchase_one_day', 'purchase_two_day'
];

const SQP_STRING_COLUMNS_ = [
  'id', 'scope_key', 'marketplace', 'period_type', 'date_from', 'date_to', 'period_key', 'asin',
  'search_query_raw', 'search_query_normalized', 'normalization_version',
  'import_batch_id', 'source_row_hash'
];

const SQP_IMPORT_LOG_STRING_COLUMNS_ = [
  'import_batch_id', 'imported_at', 'completed_at', 'status', 'actor',
  'source_type', 'filename', 'file_sha256', 'raw_drive_file_id',
  'scope_key', 'marketplace', 'period_type', 'date_from', 'date_to', 'period_key', 'asin',
  'report_scope', 'report_date', 'normalization_version', 'warnings_json',
  'backup_id', 'error'
];

const SQP_RATIO_TOLERANCE_ = 0.00015;

function sqpSha256BytesHex_(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map(function(value) {
    return ('0' + ((Number(value) + 256) % 256).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

function sqpSha256Hex_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ('0' + ((Number(byte) + 256) % 256).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

function sqpNormalizeQueryV1_(value) {
  let normalized = String(value == null ? '' : value);
  if (typeof normalized.normalize === 'function') normalized = normalized.normalize('NFKC');
  return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sqpIsoDate_(value, label) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(label + ' はYYYY-MM-DD形式で指定してください: ' + text);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(label + ' が実在する日付ではありません: ' + text);
  }
  return text;
}

function sqpInteger_(value, label, nullable) {
  if ((value === '' || value === null || value === undefined) && nullable) return null;
  const number = Number(value);
  if (!isFinite(number) || number < 0 || Math.floor(number) !== number) {
    throw new Error(label + ' に不正な非負整数があります: ' + value);
  }
  return number;
}

function sqpNumber_(value, label, nullable) {
  if ((value === '' || value === null || value === undefined) && nullable) return null;
  const number = Number(value);
  if (!isFinite(number) || number < 0) {
    throw new Error(label + ' に不正な非負数があります: ' + value);
  }
  return number;
}

function sqpBoolean_(value) {
  return value === true || value === 1 || value === '1'
    || String(value).toLowerCase() === 'true';
}

function sqpAssertPart_(total, asin, label, rowNumber) {
  if (asin > total) {
    throw new Error(rowNumber + '行目の' + label + 'でASIN数が合計を超えています。');
  }
}

function sqpAssertRatio_(numerator, denominator, reported, label, rowNumber) {
  if (denominator === 0) {
    if (reported !== null && reported !== 0) {
      throw new Error(rowNumber + '行目の' + label + 'は分母0のためnullまたは0である必要があります。');
    }
    return;
  }
  if (reported === null) throw new Error(rowNumber + '行目の' + label + 'が空です。');
  if (Math.abs((numerator / denominator) - reported) > SQP_RATIO_TOLERANCE_) {
    throw new Error(rowNumber + '行目の' + label + 'が件数からの計算値と一致しません。');
  }
}

function sqpCanonicalComparableValue_(field, value) {
  if (field === 'normalization_collision') return sqpBoolean_(value);
  if (
    field === 'search_query_raw'
    || field === 'search_query_normalized'
    || field === 'normalization_version'
  ) {
    return String(value == null ? '' : value);
  }
  if (value === '' || value === null || value === undefined) return null;
  return Number(value);
}

function sqpRowHash_(row) {
  const comparable = SQP_COMPARE_FIELDS_.map(function(field) {
    return sqpCanonicalComparableValue_(field, row[field]);
  });
  return sqpSha256Hex_(JSON.stringify(comparable));
}

function sqpNormalizeReport_(report) {
  if (!report || typeof report !== 'object') throw new Error('検索クエリレポートDTOが必要です。');
  const metadata = report.metadata || {};
  const sourceRows = report.rows;
  if (!Array.isArray(sourceRows) || !sourceRows.length) throw new Error('取込対象の検索クエリ行がありません。');
  if (sourceRows.length > 5000) throw new Error('一度に取り込める検索クエリは5,000行までです。');

  const marketplace = String(metadata.marketplace || '').trim().toUpperCase();
  const asin = String(metadata.asin || '').trim().toUpperCase();
  const periodType = String(metadata.period_type || '').trim().toUpperCase();
  const dateFrom = sqpIsoDate_(metadata.date_from, 'date_from');
  const dateTo = sqpIsoDate_(metadata.date_to, 'date_to');
  const periodKey = dateFrom.slice(0, 7);
  const reportDate = sqpIsoDate_(metadata.report_date, 'report_date');
  const reportScope = String(metadata.report_scope || '').trim().toUpperCase();
  const sourceType = String(metadata.source_type || '').trim().toUpperCase();
  const queryLimit = sqpInteger_(metadata.query_limit, 'query_limit', false);
  const pageNumber = sqpInteger_(metadata.page_number, 'page_number', false);
  const returnedCount = sqpInteger_(metadata.returned_query_count, 'returned_query_count', false);

  if (!/^[A-Z]{2}$/.test(marketplace)) throw new Error('marketplaceが不正です: ' + marketplace);
  if (!/^B[A-Z0-9]{9}$/.test(asin)) throw new Error('ASINが不正です: ' + asin);
  if (periodType !== 'MONTH') throw new Error('PR2で対応しているperiod_typeはMONTHのみです。');
  if (dateFrom.slice(0, 7) !== dateTo.slice(0, 7) || !/-01$/.test(dateFrom)) {
    throw new Error('月次レポートのdate_from/date_toが不正です。');
  }
  const parts = dateFrom.split('-').map(Number);
  const monthLastDay = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  const expectedTo = dateFrom.slice(0, 8) + String(monthLastDay).padStart(2, '0');
  if (dateTo !== expectedTo || reportDate !== dateTo) {
    throw new Error('月次レポートのdate_to/report_dateは対象月末と一致する必要があります。');
  }
  if (metadata.period_key && String(metadata.period_key).trim() !== periodKey) {
    throw new Error('period_keyがdate_fromと一致しません。');
  }
  if (reportScope !== 'TOP_QUERIES') throw new Error('report_scopeはTOP_QUERIESである必要があります。');
  if (sourceType !== 'SELLER_CENTRAL_CSV') {
    throw new Error('PR2で対応しているsource_typeはSELLER_CENTRAL_CSVのみです。');
  }
  if (queryLimit < 1 || pageNumber < 1) throw new Error('query_limit/page_numberは1以上である必要があります。');
  if (pageNumber !== 1) {
    throw new Error('PR2の保存処理はpage_number=1のみ対応します。複数ページは原子的な一括取込実装後に有効化してください。');
  }
  if (returnedCount !== sourceRows.length) {
    throw new Error('returned_query_countが実データ行数と一致しません。');
  }

  const scopeKey = sqpSha256Hex_([
    marketplace, periodType, dateFrom, dateTo, asin
  ].join('\n'));
  const rawQueries = Object.create(null);
  const ranks = Object.create(null);
  const normalizedGroups = Object.create(null);

  const rows = sourceRows.map(function(source, index) {
    const rowNumber = index + 1;
    const raw = typeof source.search_query_raw === 'string' ? source.search_query_raw : '';
    if (!raw.trim()) throw new Error(rowNumber + '行目の検索クエリ原文が空です。');
    if (rawQueries[raw]) throw new Error('検索クエリ原文が重複しています: ' + raw);
    rawQueries[raw] = true;

    const normalized = sqpNormalizeQueryV1_(raw);
    if (
      source.search_query_normalized !== undefined
      && String(source.search_query_normalized) !== normalized
    ) {
      throw new Error(rowNumber + '行目のsearch_query_normalizedがquery_norm_v1と一致しません。');
    }
    if (
      source.normalization_version !== undefined
      && String(source.normalization_version) !== 'query_norm_v1'
    ) {
      throw new Error(rowNumber + '行目のnormalization_versionが不正です。');
    }

    const score = sqpInteger_(source.search_query_score, '検索クエリスコア', false);
    const rank = sqpInteger_(
      source.search_query_rank === undefined ? score : source.search_query_rank,
      '検索クエリ順位',
      false
    );
    if (score < 1 || rank < 1 || score !== rank) {
      throw new Error(rowNumber + '行目の検索クエリスコア・順位が不正です。');
    }
    if (ranks[rank]) throw new Error('検索クエリ順位が重複しています: ' + rank);
    ranks[rank] = true;

    const row = {
      id: sqpSha256Hex_('row\n' + scopeKey + '\n' + raw),
      scope_key: scopeKey,
      marketplace: marketplace,
      period_type: periodType,
      date_from: dateFrom,
      date_to: dateTo,
      period_key: periodKey,
      asin: asin,
      search_query_raw: raw,
      search_query_normalized: normalized,
      normalization_version: 'query_norm_v1',
      normalization_collision: false,
      search_query_score: score,
      search_query_rank: rank,
      search_query_volume: sqpInteger_(source.search_query_volume, '検索キーワード数', false),
      impression_total: sqpInteger_(source.impression_total, 'Impression合計', false),
      impression_asin: sqpInteger_(source.impression_asin, 'ASIN Impression', false),
      impression_asin_share_reported: sqpNumber_(source.impression_asin_share_reported, 'Impression Share', true),
      click_total: sqpInteger_(source.click_total, 'Click合計', false),
      click_rate_reported: sqpNumber_(source.click_rate_reported, 'Click Rate', true),
      click_asin: sqpInteger_(source.click_asin, 'ASIN Click', false),
      click_asin_share_reported: sqpNumber_(source.click_asin_share_reported, 'Click Share', true),
      click_price_median: sqpNumber_(source.click_price_median, 'Click価格中央値', true),
      click_asin_price_median: sqpNumber_(source.click_asin_price_median, 'ASIN Click価格中央値', true),
      click_same_day: sqpInteger_(source.click_same_day, 'Click当日配送', true),
      click_one_day: sqpInteger_(source.click_one_day, 'Click 1D配送', true),
      click_two_day: sqpInteger_(source.click_two_day, 'Click 2D配送', true),
      cart_total: sqpInteger_(source.cart_total, 'Cart合計', false),
      cart_rate_reported: sqpNumber_(source.cart_rate_reported, 'Cart Rate', true),
      cart_asin: sqpInteger_(source.cart_asin, 'ASIN Cart', false),
      cart_asin_share_reported: sqpNumber_(source.cart_asin_share_reported, 'Cart Share', true),
      cart_price_median: sqpNumber_(source.cart_price_median, 'Cart価格中央値', true),
      cart_asin_price_median: sqpNumber_(source.cart_asin_price_median, 'ASIN Cart価格中央値', true),
      cart_same_day: sqpInteger_(source.cart_same_day, 'Cart当日配送', true),
      cart_one_day: sqpInteger_(source.cart_one_day, 'Cart 1D配送', true),
      cart_two_day: sqpInteger_(source.cart_two_day, 'Cart 2D配送', true),
      purchase_total: sqpInteger_(source.purchase_total, 'Purchase合計', false),
      purchase_rate_reported: sqpNumber_(source.purchase_rate_reported, 'Purchase Rate', true),
      purchase_asin: sqpInteger_(source.purchase_asin, 'ASIN Purchase', false),
      purchase_asin_share_reported: sqpNumber_(source.purchase_asin_share_reported, 'Purchase Share', true),
      purchase_price_median: sqpNumber_(source.purchase_price_median, 'Purchase価格中央値', true),
      purchase_asin_price_median: sqpNumber_(source.purchase_asin_price_median, 'ASIN Purchase価格中央値', true),
      purchase_same_day: sqpInteger_(source.purchase_same_day, 'Purchase当日配送', true),
      purchase_one_day: sqpInteger_(source.purchase_one_day, 'Purchase 1D配送', true),
      purchase_two_day: sqpInteger_(source.purchase_two_day, 'Purchase 2D配送', true),
      import_batch_id: '',
      source_row_hash: ''
    };

    if (row.search_query_volume < 1) {
      throw new Error(rowNumber + '行目の検索キーワード数は1以上である必要があります。');
    }
    sqpAssertPart_(row.impression_total, row.impression_asin, 'Impression', rowNumber);
    sqpAssertPart_(row.click_total, row.click_asin, 'Click', rowNumber);
    sqpAssertPart_(row.cart_total, row.cart_asin, 'Cart', rowNumber);
    sqpAssertPart_(row.purchase_total, row.purchase_asin, 'Purchase', rowNumber);
    sqpAssertRatio_(row.impression_asin, row.impression_total, row.impression_asin_share_reported, 'Impression Share', rowNumber);
    sqpAssertRatio_(row.click_total, row.search_query_volume, row.click_rate_reported, 'Click Rate', rowNumber);
    sqpAssertRatio_(row.click_asin, row.click_total, row.click_asin_share_reported, 'Click Share', rowNumber);
    sqpAssertRatio_(row.cart_total, row.search_query_volume, row.cart_rate_reported, 'Cart Rate', rowNumber);
    sqpAssertRatio_(row.cart_asin, row.cart_total, row.cart_asin_share_reported, 'Cart Share', rowNumber);
    sqpAssertRatio_(row.purchase_total, row.search_query_volume, row.purchase_rate_reported, 'Purchase Rate', rowNumber);
    sqpAssertRatio_(row.purchase_asin, row.purchase_total, row.purchase_asin_share_reported, 'Purchase Share', rowNumber);
    row.source_row_hash = sqpRowHash_(row);
    if (!normalizedGroups[normalized]) normalizedGroups[normalized] = [];
    normalizedGroups[normalized].push(row);
    return row;
  });

  let collisionCount = 0;
  Object.keys(normalizedGroups).forEach(function(key) {
    const group = normalizedGroups[key];
    if (group.length < 2) return;
    collisionCount++;
    group.forEach(function(row) {
      row.normalization_collision = true;
      row.source_row_hash = sqpRowHash_(row);
    });
  });

  const warnings = [];
  if (rows.length !== queryLimit) {
    warnings.push('取得件数' + rows.length + '件はquery limit ' + queryLimit + '件と異なります。完全性は断定しません。');
  }
  const sortedRanks = rows.map(function(row) { return row.search_query_rank; }).sort(function(a, b) { return a - b; });
  const expectedStart = (pageNumber - 1) * queryLimit + 1;
  const contiguous = sortedRanks.every(function(rank, index) { return rank === expectedStart + index; });
  if (!contiguous) warnings.push('検索クエリ順位がpage ' + pageNumber + 'の連続範囲ではありません。');
  if (collisionCount) warnings.push('query_norm_v1で' + collisionCount + '件の正規化衝突があります。');

  return {
    metadata: {
      marketplace: marketplace,
      asin: asin,
      period_type: periodType,
      date_from: dateFrom,
      date_to: dateTo,
      period_key: periodKey,
      report_date: reportDate,
      report_scope: reportScope,
      query_limit: queryLimit,
      page_number: pageNumber,
      returned_query_count: rows.length,
      source_type: sourceType
    },
    scope_key: scopeKey,
    rows: rows,
    warnings: warnings
  };
}

function sqpEnsureSheet_(sheetName, requiredHeaders, createIfMissing) {
  const ss = getReportSpreadsheet_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet && !createIfMissing) return null;
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
  }
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String).filter(String);
  if (!headers.length) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    headers = requiredHeaders.slice();
  }
  requiredHeaders.forEach(function(header) {
    if (headers.indexOf(header) >= 0) return;
    sheet.getRange(1, headers.length + 1).setValue(header);
    headers.push(header);
  });
  const index = {};
  headers.forEach(function(header, column) { index[header] = column; });
  return { sheet: sheet, headers: headers, index: index };
}

function sqpScopeRowGroups_(opened, scopeKey) {
  if (!opened || opened.sheet.getLastRow() <= 1) return [];
  const scopeColumn = opened.index.scope_key;
  const finderRange = opened.sheet.getRange(
    2,
    scopeColumn + 1,
    opened.sheet.getLastRow() - 1,
    1
  );
  const matches = finderRange.createTextFinder(scopeKey).matchEntireCell(true).findAll();
  const rows = matches
    .filter(function(cell) { return cell.getColumn() === scopeColumn + 1; })
    .map(function(cell) { return cell.getRow(); })
    .sort(function(a, b) { return a - b; });
  const groups = [];
  rows.forEach(function(rowNumber) {
    const last = groups[groups.length - 1];
    if (last && last.start + last.count === rowNumber) last.count++;
    else groups.push({ start: rowNumber, count: 1 });
  });
  return groups;
}

function sqpRowObject_(headers, values) {
  const object = {};
  headers.forEach(function(header, index) { object[header] = values[index]; });
  return object;
}

function sqpReadScopeState_(opened, scopeKey) {
  if (!opened) return { groups: [], rows: [] };
  const groups = sqpScopeRowGroups_(opened, scopeKey);
  const rows = [];
  groups.forEach(function(group) {
    const values = opened.sheet.getRange(
      group.start,
      1,
      group.count,
      opened.headers.length
    ).getValues();
    values.forEach(function(row) { rows.push(sqpRowObject_(opened.headers, row)); });
  });
  return { groups: groups, rows: rows };
}

function sqpComparableHashFromStored_(row) {
  return sqpRowHash_(row);
}

function sqpBuildDiff_(existingRows, incomingRows) {
  const existing = Object.create(null);
  const incoming = Object.create(null);
  existingRows.forEach(function(row) {
    const raw = String(row.search_query_raw == null ? '' : row.search_query_raw);
    if (!raw) throw new Error('保存済みscopeに検索クエリ原文が空の行があります。');
    if (existing[raw]) throw new Error('保存済みscopeで検索クエリ原文が重複しています: ' + raw);
    existing[raw] = row;
  });
  incomingRows.forEach(function(row) {
    const raw = row.search_query_raw;
    if (incoming[raw]) throw new Error('取込データで検索クエリ原文が重複しています: ' + raw);
    incoming[raw] = row;
  });

  let added = 0;
  let replaced = 0;
  let unchanged = 0;
  Object.keys(incoming).forEach(function(raw) {
    if (!existing[raw]) {
      added++;
      return;
    }
    if (sqpComparableHashFromStored_(existing[raw]) === incoming[raw].source_row_hash) unchanged++;
    else replaced++;
  });
  let removed = 0;
  Object.keys(existing).forEach(function(raw) {
    if (!incoming[raw]) removed++;
  });
  return {
    added: added,
    replaced: replaced,
    removed: removed,
    unchanged: unchanged,
    has_changes: added + replaced + removed > 0,
    final_saved_rows: incomingRows.length
  };
}

function sqpPreviewFromNormalized_(normalized, createSheet) {
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_PERFORMANCE,
    REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE,
    !!createSheet
  );
  const state = sqpReadScopeState_(opened, normalized.scope_key);
  const diff = sqpBuildDiff_(state.rows, normalized.rows);
  return {
    normalized: normalized,
    opened: opened,
    state: state,
    diff: diff
  };
}

function previewSearchQueryPerformance(report) {
  const normalized = sqpNormalizeReport_(report);
  const preview = sqpPreviewFromNormalized_(normalized, false);
  return {
    scopeKey: normalized.scope_key,
    metadata: normalized.metadata,
    inputRows: report.rows.length,
    normalizedRows: normalized.rows.length,
    added: preview.diff.added,
    replaced: preview.diff.replaced,
    removed: preview.diff.removed,
    unchanged: preview.diff.unchanged,
    currentStoredRows: preview.state.rows.length,
    finalSavedRows: preview.diff.final_saved_rows,
    warnings: normalized.warnings
  };
}

function sqpAppendScopeBackup_(existingRows, importBatchId) {
  if (!existingRows.length) return { backupId: null, backupRows: 0 };
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_SCOPE_BACKUP,
    REQUIRED_HEADERS_SEARCH_QUERY_SCOPE_BACKUP,
    true
  );
  const backupId = 'SQPB-' + Utilities.getUuid();
  const timestamp = new Date().toISOString();
  const arrays = existingRows.map(function(row) {
    const backup = Object.assign({}, row, {
      backup_id: backupId,
      backed_up_at: timestamp,
      replaced_by_import_batch_id: importBatchId
    });
    return opened.headers.map(function(header) {
      return backup[header] !== undefined && backup[header] !== null ? backup[header] : '';
    });
  });
  const startRow = opened.sheet.getLastRow() + 1;
  opened.sheet.getRange(startRow, 1, arrays.length, opened.headers.length).setValues(arrays);
  return { backupId: backupId, backupRows: arrays.length };
}

function sqpFormatTextColumns_(opened, startRow, rowCount, fields) {
  if (!rowCount) return;
  fields.forEach(function(field) {
    const column = opened.index[field];
    if (column !== undefined) {
      opened.sheet.getRange(startRow, column + 1, rowCount, 1).setNumberFormat('@');
    }
  });
}

function sqpReplaceScopeRows_(opened, state, normalizedRows, importBatchId) {
  state.groups.slice().sort(function(a, b) { return b.start - a.start; }).forEach(function(group) {
    opened.sheet.deleteRows(group.start, group.count);
  });
  const arrays = normalizedRows.map(function(source) {
    const row = Object.assign({}, source, { import_batch_id: importBatchId });
    return opened.headers.map(function(header) {
      return row[header] !== undefined && row[header] !== null ? row[header] : '';
    });
  });
  if (arrays.length) {
    const startRow = opened.sheet.getLastRow() + 1;
    sqpFormatTextColumns_(opened, startRow, arrays.length, SQP_STRING_COLUMNS_);
    opened.sheet.getRange(startRow, 1, arrays.length, opened.headers.length).setValues(arrays);
  }
  return {
    finalSavedRows: arrays.length,
    sheetTotalRows: Math.max(0, opened.sheet.getLastRow() - 1)
  };
}

function sqpArchiveRaw_(rawBase64, filename, suppliedSha256) {
  if (!rawBase64) throw new Error('Drive原本保存用のrawBase64が必要です。');
  if (!String(filename || '').trim()) throw new Error('Drive原本保存用のfilenameが必要です。');
  const bytes = Utilities.base64Decode(rawBase64);
  if (!bytes.length) throw new Error('原本CSVが空です。');
  const actualSha256 = sqpSha256BytesHex_(bytes);
  if (suppliedSha256 && String(suppliedSha256).trim().toUpperCase() !== actualSha256) {
    throw new Error('fileSha256が原本CSVと一致しません。');
  }
  const driveFileId = archiveRawToDrive_(rawBase64, filename, 'text/csv');
  if (!driveFileId) throw new Error('原本CSVをDriveへ保存できませんでした。');
  return { driveFileId: driveFileId, fileSha256: actualSha256 };
}

function sqpActor_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (error) {
    return '';
  }
}

function sqpAppendImportLog_(record) {
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_IMPORT_LOG,
    REQUIRED_HEADERS_SEARCH_QUERY_IMPORT_LOG,
    true
  );
  const values = opened.headers.map(function(header) {
    return record[header] !== undefined && record[header] !== null ? record[header] : '';
  });
  const row = opened.sheet.getLastRow() + 1;
  sqpFormatTextColumns_(opened, row, 1, SQP_IMPORT_LOG_STRING_COLUMNS_);
  opened.sheet.getRange(row, 1, 1, opened.headers.length).setValues([values]);
  return { opened: opened, row: row };
}

function sqpUpdateImportLog_(reference, updates) {
  Object.keys(updates).forEach(function(field) {
    const column = reference.opened.index[field];
    if (column === undefined) return;
    reference.opened.sheet.getRange(reference.row, column + 1).setValue(
      updates[field] !== undefined && updates[field] !== null ? updates[field] : ''
    );
  });
}

function syncSearchQueryPerformance(report, rawBase64, filename, fileSha256) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let logReference = null;
  try {
    const normalized = sqpNormalizeReport_(report);
    const preview = sqpPreviewFromNormalized_(normalized, true);
    const archive = sqpArchiveRaw_(rawBase64, filename, fileSha256);
    const importBatchId = 'SQPI-' + Utilities.getUuid();
    const startedAt = new Date().toISOString();
    const metadata = normalized.metadata;

    logReference = sqpAppendImportLog_({
      import_batch_id: importBatchId,
      imported_at: startedAt,
      status: 'started',
      actor: sqpActor_(),
      source_type: metadata.source_type,
      filename: filename,
      file_sha256: archive.fileSha256,
      raw_drive_file_id: archive.driveFileId,
      scope_key: normalized.scope_key,
      marketplace: metadata.marketplace,
      period_type: metadata.period_type,
      date_from: metadata.date_from,
      date_to: metadata.date_to,
      period_key: metadata.period_key,
      asin: metadata.asin,
      report_scope: metadata.report_scope,
      query_limit: metadata.query_limit,
      page_number: metadata.page_number,
      returned_query_count: metadata.returned_query_count,
      report_date: metadata.report_date,
      input_rows: report.rows.length,
      stored_rows: preview.diff.final_saved_rows,
      added: preview.diff.added,
      replaced: preview.diff.replaced,
      removed: preview.diff.removed,
      unchanged: preview.diff.unchanged,
      normalization_version: 'query_norm_v1',
      warnings_json: JSON.stringify(normalized.warnings)
    });

    let backup = { backupId: null, backupRows: 0 };
    let replacement = {
      finalSavedRows: preview.diff.final_saved_rows,
      sheetTotalRows: Math.max(0, preview.opened.sheet.getLastRow() - 1)
    };
    if (preview.diff.has_changes) {
      backup = sqpAppendScopeBackup_(preview.state.rows, importBatchId);
      replacement = sqpReplaceScopeRows_(
        preview.opened,
        preview.state,
        normalized.rows,
        importBatchId
      );
    }

    sqpUpdateImportLog_(logReference, {
      completed_at: new Date().toISOString(),
      status: 'success',
      stored_rows: replacement.finalSavedRows,
      backup_id: backup.backupId || '',
      backup_rows: backup.backupRows,
      error: ''
    });

    return {
      scopeKey: normalized.scope_key,
      importBatchId: importBatchId,
      driveFileId: archive.driveFileId,
      fileSha256: archive.fileSha256,
      backupId: backup.backupId,
      backupRows: backup.backupRows,
      inputRows: report.rows.length,
      normalizedRows: normalized.rows.length,
      added: preview.diff.added,
      replaced: preview.diff.replaced,
      removed: preview.diff.removed,
      unchanged: preview.diff.unchanged,
      currentStoredRows: preview.state.rows.length,
      finalSavedRows: replacement.finalSavedRows,
      sheetTotalRows: replacement.sheetTotalRows,
      warnings: normalized.warnings
    };
  } catch (error) {
    if (logReference) {
      sqpUpdateImportLog_(logReference, {
        completed_at: new Date().toISOString(),
        status: 'error',
        error: String(error && error.message ? error.message : error)
      });
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// PR4: 検索市場 read API
// 高容量のデータシートはscope_keyのTextFinderで局所取得し、
// 取得済みscope一覧だけを小さいimport logから解決する。
// ============================================================

function sqpStoredPeriodKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('保存済みperiod_keyの日付が不正です。');
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  const text = String(value == null ? '' : value).trim();
  const direct = text.match(/^(\d{4})-(\d{2})$/);
  if (direct && Number(direct[2]) >= 1 && Number(direct[2]) <= 12) return text;
  const isoDate = text.match(/^(\d{4})-(\d{2})-\d{2}(?:T|\s|$)/);
  if (isoDate && Number(isoDate[2]) >= 1 && Number(isoDate[2]) <= 12) {
    return isoDate[1] + '-' + isoDate[2];
  }
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };
  const gasDate = text.match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4})\b/);
  if (gasDate) return gasDate[2] + '-' + months[gasDate[1]];
  throw new Error('保存済みperiod_keyをYYYY-MMへ変換できません: ' + text);
}

function sqpPreviousPeriodKey_(periodKey) {
  const match = String(periodKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('period はYYYY-MM形式で指定してください: ' + periodKey);
  let year = Number(match[1]);
  let month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('period の月が不正です: ' + periodKey);
  month--;
  if (month === 0) {
    year--;
    month = 12;
  }
  return year + '-' + ('0' + month).slice(-2);
}

function sqpValidateReadAsin_(asin) {
  const normalized = String(asin || '').trim().toUpperCase();
  if (!/^B[A-Z0-9]{9}$/.test(normalized)) throw new Error('ASINが不正です: ' + normalized);
  return normalized;
}

function sqpSuccessfulScopeLogs_() {
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_IMPORT_LOG,
    REQUIRED_HEADERS_SEARCH_QUERY_IMPORT_LOG,
    false
  );
  if (!opened || opened.sheet.getLastRow() <= 1) return [];
  // import logはscopeデータ本体とは分離された小さい索引兼監査表。
  // 1回のRange読取で往復回数を抑え、scopeごとの最新successだけを残す。
  const values = opened.sheet.getRange(
    2,
    1,
    opened.sheet.getLastRow() - 1,
    opened.headers.length
  ).getValues();
  const latest = Object.create(null);
  values.forEach(function(valuesRow) {
    const row = sqpRowObject_(opened.headers, valuesRow);
    if (String(row.status) !== 'success' || !String(row.scope_key || '')) return;
    row.period_key = sqpStoredPeriodKey_(row.period_key);
    const key = String(row.scope_key);
    const timestamp = String(row.completed_at || row.imported_at || '');
    const existingTimestamp = latest[key]
      ? String(latest[key].completed_at || latest[key].imported_at || '')
      : '';
    if (!latest[key] || timestamp >= existingTimestamp) latest[key] = row;
  });
  return Object.keys(latest).map(function(key) { return latest[key]; });
}

function sqpFindScopeLog_(logs, asin, periodKey, marketplace) {
  const candidates = logs.filter(function(log) {
    return String(log.asin).toUpperCase() === asin
      && String(log.period_key) === periodKey
      && (!marketplace || String(log.marketplace).toUpperCase() === marketplace);
  });
  if (!candidates.length) return null;
  candidates.sort(function(a, b) {
    return String(b.completed_at || b.imported_at || '')
      .localeCompare(String(a.completed_at || a.imported_at || ''));
  });
  return candidates[0];
}

function sqpNullableStoredNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

function sqpStoredNumber_(value) {
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

function sqpComputedShare_(asinValue, totalValue) {
  const numerator = sqpStoredNumber_(asinValue);
  const denominator = sqpStoredNumber_(totalValue);
  return denominator > 0 ? numerator / denominator : null;
}

function sqpSnapshotFromStored_(row, scopeLog, detailed) {
  const snapshot = {
    period_key: sqpStoredPeriodKey_(row.period_key || scopeLog.period_key || ''),
    search_query_raw: String(row.search_query_raw || ''),
    search_query_normalized: String(row.search_query_normalized || ''),
    normalization_version: String(row.normalization_version || 'query_norm_v1'),
    normalization_collision: sqpBoolean_(row.normalization_collision),
    search_query_score: sqpStoredNumber_(row.search_query_score),
    search_query_rank: sqpStoredNumber_(row.search_query_rank),
    search_query_volume: sqpStoredNumber_(row.search_query_volume),
    impression_total: sqpStoredNumber_(row.impression_total),
    impression_asin: sqpStoredNumber_(row.impression_asin),
    impression_share: sqpComputedShare_(row.impression_asin, row.impression_total),
    click_total: sqpStoredNumber_(row.click_total),
    click_asin: sqpStoredNumber_(row.click_asin),
    click_share: sqpComputedShare_(row.click_asin, row.click_total),
    cart_total: sqpStoredNumber_(row.cart_total),
    cart_asin: sqpStoredNumber_(row.cart_asin),
    cart_share: sqpComputedShare_(row.cart_asin, row.cart_total),
    purchase_total: sqpStoredNumber_(row.purchase_total),
    purchase_asin: sqpStoredNumber_(row.purchase_asin),
    purchase_share: sqpComputedShare_(row.purchase_asin, row.purchase_total),
    import_batch_id: String(row.import_batch_id || scopeLog.import_batch_id || ''),
    source_type: String(scopeLog.source_type || ''),
    report_scope: String(scopeLog.report_scope || ''),
    query_limit: sqpStoredNumber_(scopeLog.query_limit),
    page_number: sqpStoredNumber_(scopeLog.page_number)
  };
  if (!detailed) return snapshot;
  snapshot.reported = {
    impression_asin_share: sqpNullableStoredNumber_(row.impression_asin_share_reported),
    click_rate: sqpNullableStoredNumber_(row.click_rate_reported),
    click_asin_share: sqpNullableStoredNumber_(row.click_asin_share_reported),
    cart_rate: sqpNullableStoredNumber_(row.cart_rate_reported),
    cart_asin_share: sqpNullableStoredNumber_(row.cart_asin_share_reported),
    purchase_rate: sqpNullableStoredNumber_(row.purchase_rate_reported),
    purchase_asin_share: sqpNullableStoredNumber_(row.purchase_asin_share_reported)
  };
  snapshot.price_medians = {
    click_market: sqpNullableStoredNumber_(row.click_price_median),
    click_asin: sqpNullableStoredNumber_(row.click_asin_price_median),
    cart_market: sqpNullableStoredNumber_(row.cart_price_median),
    cart_asin: sqpNullableStoredNumber_(row.cart_asin_price_median),
    purchase_market: sqpNullableStoredNumber_(row.purchase_price_median),
    purchase_asin: sqpNullableStoredNumber_(row.purchase_asin_price_median)
  };
  snapshot.delivery = {
    click: {
      same_day: sqpNullableStoredNumber_(row.click_same_day),
      one_day: sqpNullableStoredNumber_(row.click_one_day),
      two_day: sqpNullableStoredNumber_(row.click_two_day)
    },
    cart: {
      same_day: sqpNullableStoredNumber_(row.cart_same_day),
      one_day: sqpNullableStoredNumber_(row.cart_one_day),
      two_day: sqpNullableStoredNumber_(row.cart_two_day)
    },
    purchase: {
      same_day: sqpNullableStoredNumber_(row.purchase_same_day),
      one_day: sqpNullableStoredNumber_(row.purchase_one_day),
      two_day: sqpNullableStoredNumber_(row.purchase_two_day)
    }
  };
  return snapshot;
}

function sqpUniqueNormalizedHint_(candidateSnapshots, normalizedQuery, periodKey) {
  if (!normalizedQuery) return null;
  const candidates = candidateSnapshots.filter(function(snapshot) {
    return snapshot.search_query_normalized === normalizedQuery;
  });
  if (candidates.length !== 1) return null;
  return {
    candidate_query_raw: candidates[0].search_query_raw,
    candidate_rank: candidates[0].search_query_rank,
    candidate_period: periodKey
  };
}

function sqpBuildMonthlyComparison_(currentSnapshots, previousSnapshots, previousPeriodAvailable, currentPeriod, previousPeriod) {
  const currentByRaw = Object.create(null);
  const previousByRaw = Object.create(null);
  currentSnapshots.forEach(function(snapshot) { currentByRaw[snapshot.search_query_raw] = snapshot; });
  previousSnapshots.forEach(function(snapshot) { previousByRaw[snapshot.search_query_raw] = snapshot; });

  if (!previousPeriodAvailable) {
    return currentSnapshots.map(function(current) {
      return {
        search_query_raw: current.search_query_raw,
        comparison_status: 'PREVIOUS_PERIOD_MISSING',
        previous_rank: null,
        current_rank: current.search_query_rank,
        rank_change: null,
        normalized_continuity_hint: null,
        data_period: currentPeriod,
        snapshot: current
      };
    });
  }

  const result = currentSnapshots.map(function(current) {
    const previous = previousByRaw[current.search_query_raw] || null;
    return {
      search_query_raw: current.search_query_raw,
      comparison_status: previous ? 'CONTINUED' : 'ENTERED_TOP100',
      previous_rank: previous ? previous.search_query_rank : null,
      current_rank: current.search_query_rank,
      rank_change: previous ? previous.search_query_rank - current.search_query_rank : null,
      normalized_continuity_hint: previous
        ? null
        : sqpUniqueNormalizedHint_(previousSnapshots, current.search_query_normalized, previousPeriod),
      data_period: currentPeriod,
      snapshot: current
    };
  });

  previousSnapshots.forEach(function(previous) {
    if (currentByRaw[previous.search_query_raw]) return;
    result.push({
      search_query_raw: previous.search_query_raw,
      comparison_status: 'LEFT_TOP100',
      previous_rank: previous.search_query_rank,
      current_rank: null,
      rank_change: null,
      normalized_continuity_hint: sqpUniqueNormalizedHint_(
        currentSnapshots,
        previous.search_query_normalized,
        currentPeriod
      ),
      data_period: previousPeriod,
      snapshot: previous
    });
  });
  return result;
}

function sqpReadSnapshotsForLog_(opened, scopeLog, detailed) {
  if (!scopeLog) return [];
  const state = sqpReadScopeState_(opened, String(scopeLog.scope_key));
  return state.rows.map(function(row) {
    return sqpSnapshotFromStored_(row, scopeLog, detailed);
  }).sort(function(a, b) {
    return a.search_query_rank - b.search_query_rank;
  });
}

function getSearchMarketPeriods_() {
  const logs = sqpSuccessfulScopeLogs_();
  const groups = Object.create(null);
  logs.forEach(function(log) {
    const asin = String(log.asin || '').toUpperCase();
    const marketplace = String(log.marketplace || '').toUpperCase();
    const period = sqpStoredPeriodKey_(log.period_key);
    if (!asin || !period) return;
    const key = marketplace + '|' + asin;
    if (!groups[key]) groups[key] = {
      marketplace: marketplace,
      asin: asin,
      periods: []
    };
    if (groups[key].periods.indexOf(period) < 0) groups[key].periods.push(period);
  });
  const asins = Object.keys(groups).map(function(key) {
    const item = groups[key];
    item.periods.sort();
    item.latest_period = item.periods[item.periods.length - 1] || '';
    return item;
  }).sort(function(a, b) {
    return a.asin.localeCompare(b.asin);
  });
  return {
    asins: asins,
    available_periods: Array.from(new Set([].concat.apply([], asins.map(function(item) {
      return item.periods;
    })))).sort(),
    source_of_truth: 'SHEETS',
    index_source: SHEET_SEARCH_QUERY_IMPORT_LOG
  };
}

function getSearchMarketSummary_(asinInput, periodKey, marketplaceInput) {
  const asin = sqpValidateReadAsin_(asinInput);
  const previousPeriod = sqpPreviousPeriodKey_(periodKey);
  const marketplace = String(marketplaceInput || '').trim().toUpperCase();
  const logs = sqpSuccessfulScopeLogs_();
  const currentLog = sqpFindScopeLog_(logs, asin, periodKey, marketplace);
  if (!currentLog) throw new Error('対象ASIN・月の検索市場データがありません。');
  const resolvedMarketplace = String(currentLog.marketplace || marketplace).toUpperCase();
  const previousLog = sqpFindScopeLog_(logs, asin, previousPeriod, resolvedMarketplace);
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_PERFORMANCE,
    REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE,
    false
  );
  const currentSnapshots = sqpReadSnapshotsForLog_(opened, currentLog, false);
  const previousSnapshots = sqpReadSnapshotsForLog_(opened, previousLog, false);
  if (!currentSnapshots.length) {
    throw new Error('当月import logは存在しますが、scopeデータ行がありません。');
  }
  if (previousLog && !previousSnapshots.length) {
    throw new Error('前月import logは存在しますが、scopeデータ行がありません。NEW / OUT判定を中止します。');
  }
  const rows = sqpBuildMonthlyComparison_(
    currentSnapshots,
    previousSnapshots,
    !!previousLog,
    periodKey,
    previousPeriod
  );
  return {
    marketplace: resolvedMarketplace,
    asin: asin,
    period_key: periodKey,
    previous_period_key: previousPeriod,
    previous_period_available: !!previousLog,
    comparison_status: previousLog ? 'COMPARABLE' : 'PREVIOUS_PERIOD_MISSING',
    current_query_count: currentSnapshots.length,
    previous_query_count: previousSnapshots.length,
    union_query_count: rows.length,
    report_scope: String(currentLog.report_scope || ''),
    query_limit: sqpStoredNumber_(currentLog.query_limit),
    page_number: sqpStoredNumber_(currentLog.page_number),
    returned_query_count: sqpStoredNumber_(currentLog.returned_query_count),
    import_batch_id: String(currentLog.import_batch_id || ''),
    source_type: String(currentLog.source_type || ''),
    read_strategy: 'IMPORT_LOG_INDEX_AND_SCOPE_TEXT_FINDER',
    rows: rows
  };
}

function getSearchMarketQueryDetail_(asinInput, periodKey, searchQueryRaw, marketplaceInput) {
  const query = String(searchQueryRaw == null ? '' : searchQueryRaw);
  if (!query) throw new Error('searchQueryRaw が必要です。');
  const summary = getSearchMarketSummary_(asinInput, periodKey, marketplaceInput);
  const comparison = summary.rows.filter(function(row) {
    return row.search_query_raw === query;
  })[0];
  if (!comparison) throw new Error('対象検索クエリが当月・前月unionにありません。');

  const logs = sqpSuccessfulScopeLogs_();
  const scopeLog = sqpFindScopeLog_(
    logs,
    summary.asin,
    comparison.data_period,
    summary.marketplace
  );
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_PERFORMANCE,
    REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE,
    false
  );
  const detailed = sqpReadSnapshotsForLog_(opened, scopeLog, true).filter(function(snapshot) {
    return snapshot.search_query_raw === query;
  })[0];
  if (!detailed) throw new Error('検索クエリ詳細行を取得できません。');
  return {
    marketplace: summary.marketplace,
    asin: summary.asin,
    selected_period: periodKey,
    data_period: comparison.data_period,
    is_previous_snapshot: comparison.data_period !== periodKey,
    comparison_status: comparison.comparison_status,
    previous_rank: comparison.previous_rank,
    current_rank: comparison.current_rank,
    rank_change: comparison.rank_change,
    normalized_continuity_hint: comparison.normalized_continuity_hint,
    snapshot: detailed
  };
}

function getSearchMarketQueryHistory_(asinInput, searchQueryRaw, marketplaceInput) {
  const asin = sqpValidateReadAsin_(asinInput);
  const query = String(searchQueryRaw == null ? '' : searchQueryRaw);
  if (!query) throw new Error('searchQueryRaw が必要です。');
  const marketplace = String(marketplaceInput || '').trim().toUpperCase();
  const logs = sqpSuccessfulScopeLogs_().filter(function(log) {
    return String(log.asin).toUpperCase() === asin
      && (!marketplace || String(log.marketplace).toUpperCase() === marketplace);
  }).sort(function(a, b) {
    return String(a.period_key).localeCompare(String(b.period_key));
  });
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_PERFORMANCE,
    REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE,
    false
  );
  const points = [];
  logs.forEach(function(log) {
    const snapshots = sqpReadSnapshotsForLog_(opened, log, false);
    const exact = snapshots.filter(function(snapshot) {
      return snapshot.search_query_raw === query;
    })[0];
    if (exact) points.push(exact);
  });
  return {
    marketplace: marketplace || (logs[0] ? String(logs[0].marketplace) : ''),
    asin: asin,
    search_query_raw: query,
    identity_rule: 'RAW_EXACT',
    from_period: points[0] ? points[0].period_key : '',
    to_period: points.length ? points[points.length - 1].period_key : '',
    available_period_count: logs.length,
    matched_period_count: points.length,
    missing_periods: logs.map(function(log) { return String(log.period_key); }).filter(function(period) {
      return !points.some(function(point) { return point.period_key === period; });
    }),
    read_strategy: 'IMPORT_LOG_INDEX_THEN_SCOPE_TEXT_FINDER',
    points: points
  };
}

// ============================================================
// PR4.5-1: 検索市場 facts / data usability
// ============================================================

function sqpDiagnosticLookbackMonths_(value) {
  const months = value === '' || value === null || value === undefined ? 4 : Number(value);
  if (!isFinite(months) || Math.floor(months) !== months || months < 1 || months > 24) {
    throw new Error('lookbackMonths は1〜24の整数で指定してください。');
  }
  return months;
}

function sqpPeriodSequenceEnding_(periodKey, count) {
  const result = [String(periodKey)];
  while (result.length < count) {
    result.unshift(sqpPreviousPeriodKey_(result[0]));
  }
  return result;
}

function sqpAggregateSnapshots_(snapshots) {
  const aggregate = {
    query_count: snapshots.length,
    search_query_volume: 0,
    impression: { market_denominator: 0, asin_numerator: 0, share: null },
    click: { market_denominator: 0, asin_numerator: 0, share: null },
    cart: { market_denominator: 0, asin_numerator: 0, share: null },
    purchase: { market_denominator: 0, asin_numerator: 0, share: null }
  };
  snapshots.forEach(function(snapshot) {
    aggregate.search_query_volume += sqpStoredNumber_(snapshot.search_query_volume);
    [
      ['impression', 'impression_total', 'impression_asin'],
      ['click', 'click_total', 'click_asin'],
      ['cart', 'cart_total', 'cart_asin'],
      ['purchase', 'purchase_total', 'purchase_asin']
    ].forEach(function(fields) {
      aggregate[fields[0]].market_denominator += sqpStoredNumber_(snapshot[fields[1]]);
      aggregate[fields[0]].asin_numerator += sqpStoredNumber_(snapshot[fields[2]]);
    });
  });
  ['impression', 'click', 'cart', 'purchase'].forEach(function(stage) {
    aggregate[stage].share = sqpComputedShare_(
      aggregate[stage].asin_numerator,
      aggregate[stage].market_denominator
    );
  });
  return aggregate;
}

function sqpNumericChange_(current, previous) {
  const absolute = current - previous;
  return {
    absolute: absolute,
    relative: previous === 0 ? null : absolute / previous
  };
}

function sqpAggregateChanges_(current, previous) {
  if (!previous) return null;
  const changes = {
    query_count: sqpNumericChange_(current.query_count, previous.query_count),
    search_query_volume: sqpNumericChange_(
      current.search_query_volume,
      previous.search_query_volume
    )
  };
  ['impression', 'click', 'cart', 'purchase'].forEach(function(stage) {
    const currentStage = current[stage];
    const previousStage = previous[stage];
    changes[stage] = {
      market_denominator: sqpNumericChange_(
        currentStage.market_denominator,
        previousStage.market_denominator
      ),
      asin_numerator: sqpNumericChange_(
        currentStage.asin_numerator,
        previousStage.asin_numerator
      ),
      share_points: currentStage.share === null || previousStage.share === null
        ? null
        : currentStage.share - previousStage.share
    };
  });
  return changes;
}

function sqpScopeCoverage_(scopeLog, snapshots) {
  if (!scopeLog) {
    return {
      report_scope: '',
      scope_status: 'INVALID',
      universe_coverage: 'PARTIAL_UNKNOWN',
      query_limit: 0,
      page_number: 0,
      returned_query_count: 0,
      stored_query_count: 0,
      reasons: ['SCOPE_NOT_AVAILABLE']
    };
  }
  const reportScope = String(scopeLog.report_scope || '');
  const queryLimit = sqpStoredNumber_(scopeLog.query_limit);
  const pageNumber = sqpStoredNumber_(scopeLog.page_number);
  const returnedQueryCount = sqpStoredNumber_(scopeLog.returned_query_count);
  const storedQueryCount = snapshots.length;
  const ranks = snapshots.map(function(snapshot) {
    return snapshot.search_query_rank;
  }).sort(function(a, b) { return a - b; });
  const expectedRankStart = (pageNumber - 1) * queryLimit + 1;
  const completeRankRange = ranks.length === queryLimit && ranks.every(function(rank, index) {
    return rank === expectedRankStart + index;
  });
  const reasons = [];
  let scopeStatus = 'COMPLETE';
  if (returnedQueryCount !== storedQueryCount || storedQueryCount === 0) {
    scopeStatus = 'INVALID';
    reasons.push('IMPORT_LOG_STORED_COUNT_MISMATCH');
  } else if (
    reportScope !== 'TOP_QUERIES'
    || pageNumber !== 1
    || queryLimit < 1
    || returnedQueryCount !== queryLimit
    || !completeRankRange
  ) {
    scopeStatus = 'PARTIAL_UNKNOWN';
    reasons.push('TOP_QUERY_SCOPE_COMPLETENESS_UNKNOWN');
  }
  return {
    report_scope: reportScope,
    scope_status: scopeStatus,
    universe_coverage: 'PARTIAL_UNKNOWN',
    query_limit: queryLimit,
    page_number: pageNumber,
    returned_query_count: returnedQueryCount,
    stored_query_count: storedQueryCount,
    reasons: reasons
  };
}

function sqpShareUsability_(aggregate) {
  const result = {};
  ['impression', 'click', 'cart', 'purchase'].forEach(function(stage) {
    result[stage] = aggregate[stage].market_denominator > 0 ? 'VALID' : 'INVALID';
  });
  return result;
}

function sqpEvidenceInputs_(aggregate, periodsRequested, periodsAvailable, rawContinuityMonths) {
  return {
    market_denominators: {
      impression: aggregate.impression.market_denominator,
      click: aggregate.click.market_denominator,
      cart: aggregate.cart.market_denominator,
      purchase: aggregate.purchase.market_denominator
    },
    asin_numerators: {
      impression: aggregate.impression.asin_numerator,
      click: aggregate.click.asin_numerator,
      cart: aggregate.cart.asin_numerator,
      purchase: aggregate.purchase.asin_numerator
    },
    periods_requested: periodsRequested,
    periods_available: periodsAvailable,
    raw_continuity_months: rawContinuityMonths
  };
}

function sqpRawContinuityMonths_(points, requestedPeriods) {
  let continuity = 0;
  for (let index = requestedPeriods.length - 1; index >= 0; index--) {
    const period = requestedPeriods[index];
    const exists = points.some(function(point) {
      return point.period_key === period;
    });
    if (!exists) break;
    continuity++;
  }
  return continuity;
}

function sqpQueryFacts_(periodScopes, requestedPeriods, currentPeriod, previousPeriod) {
  const timelines = Object.create(null);
  periodScopes.forEach(function(scope) {
    scope.snapshots.forEach(function(snapshot) {
      if (!timelines[snapshot.search_query_raw]) {
        timelines[snapshot.search_query_raw] = [];
      }
      timelines[snapshot.search_query_raw].push(snapshot);
    });
  });
  return Object.keys(timelines).sort().map(function(rawQuery) {
    const points = timelines[rawQuery].sort(function(a, b) {
      return a.period_key.localeCompare(b.period_key);
    });
    const current = points.filter(function(point) {
      return point.period_key === currentPeriod;
    })[0] || null;
    const previous = points.filter(function(point) {
      return point.period_key === previousPeriod;
    })[0] || null;
    const currentAggregate = sqpAggregateSnapshots_(current ? [current] : []);
    const previousAggregate = previous ? sqpAggregateSnapshots_([previous]) : null;
    const normalizedValues = Array.from(new Set(points.map(function(point) {
      return point.search_query_normalized;
    })));
    const normalizationCollision = points.some(function(point) {
      return point.normalization_collision;
    });
    return {
      search_query_raw: rawQuery,
      identity_rule: 'RAW_EXACT',
      search_query_normalized_values: normalizedValues,
      normalization_collision: normalizationCollision,
      current_status: current
        ? (previous ? 'CONTINUED' : 'ENTERED_TOP100')
        : (previous ? 'LEFT_TOP100' : 'HISTORICAL_ONLY'),
      current_snapshot: current,
      previous_snapshot: previous,
      trend: previous && current ? {
        rank_change: previous.search_query_rank - current.search_query_rank,
        aggregate_changes: sqpAggregateChanges_(currentAggregate, previousAggregate)
      } : null,
      period_count_requested: requestedPeriods.length,
      period_count_available: points.length,
      missing_periods: requestedPeriods.filter(function(period) {
        return !points.some(function(point) { return point.period_key === period; });
      }),
      evidence_inputs: sqpEvidenceInputs_(
        currentAggregate,
        requestedPeriods.length,
        points.length,
        sqpRawContinuityMonths_(points, requestedPeriods)
      ),
      data_usability: {
        current_state: current ? 'VALID' : 'INVALID',
        month_over_month: current && previous ? 'VALID' : 'INVALID',
        multi_period_trend: points.length >= 2 ? 'VALID' : 'LIMITED',
        normalized_join: 'LIMITED',
        share: sqpShareUsability_(currentAggregate)
      },
      points: points
    };
  });
}

function getSearchMarketDiagnostics_(asinInput, periodKey, marketplaceInput, lookbackMonthsInput) {
  const asin = sqpValidateReadAsin_(asinInput);
  const lookbackMonths = sqpDiagnosticLookbackMonths_(lookbackMonthsInput);
  const requestedPeriods = sqpPeriodSequenceEnding_(periodKey, lookbackMonths);
  const previousPeriod = sqpPreviousPeriodKey_(periodKey);
  const marketplace = String(marketplaceInput || '').trim().toUpperCase();
  const logs = sqpSuccessfulScopeLogs_();
  const currentLog = sqpFindScopeLog_(logs, asin, periodKey, marketplace);
  if (!currentLog) throw new Error('対象ASIN・月の検索市場データがありません。');
  const resolvedMarketplace = String(currentLog.marketplace || marketplace).toUpperCase();
  const opened = sqpEnsureSheet_(
    SHEET_SEARCH_QUERY_PERFORMANCE,
    REQUIRED_HEADERS_SEARCH_QUERY_PERFORMANCE,
    false
  );
  const periodScopes = [];
  requestedPeriods.forEach(function(period) {
    const scopeLog = sqpFindScopeLog_(logs, asin, period, resolvedMarketplace);
    if (!scopeLog) return;
    const snapshots = sqpReadSnapshotsForLog_(opened, scopeLog, false);
    periodScopes.push({
      period_key: period,
      log: scopeLog,
      snapshots: snapshots,
      coverage: sqpScopeCoverage_(scopeLog, snapshots)
    });
  });
  const currentScope = periodScopes.filter(function(scope) {
    return scope.period_key === periodKey;
  })[0];
  if (!currentScope || !currentScope.snapshots.length) {
    throw new Error('当月import logは存在しますが、scopeデータ行がありません。');
  }
  const previousScope = periodScopes.filter(function(scope) {
    return scope.period_key === previousPeriod;
  })[0] || null;
  if (previousScope && !previousScope.snapshots.length) {
    throw new Error('前月import logは存在しますが、scopeデータ行がありません。');
  }

  const currentByRaw = Object.create(null);
  const previousByRaw = Object.create(null);
  currentScope.snapshots.forEach(function(snapshot) {
    currentByRaw[snapshot.search_query_raw] = snapshot;
  });
  (previousScope ? previousScope.snapshots : []).forEach(function(snapshot) {
    previousByRaw[snapshot.search_query_raw] = snapshot;
  });
  const matchedRawQueries = previousScope
    ? Object.keys(currentByRaw).filter(function(rawQuery) {
      return !!previousByRaw[rawQuery];
    }).sort()
    : [];
  const currentMatched = matchedRawQueries.map(function(rawQuery) {
    return currentByRaw[rawQuery];
  });
  const previousMatched = matchedRawQueries.map(function(rawQuery) {
    return previousByRaw[rawQuery];
  });

  const currentAggregate = sqpAggregateSnapshots_(currentScope.snapshots);
  const previousAggregate = previousScope
    ? sqpAggregateSnapshots_(previousScope.snapshots)
    : null;
  const currentMatchedAggregate = sqpAggregateSnapshots_(currentMatched);
  const previousMatchedAggregate = previousScope
    ? sqpAggregateSnapshots_(previousMatched)
    : null;
  const enteredCount = previousScope
    ? Object.keys(currentByRaw).filter(function(rawQuery) { return !previousByRaw[rawQuery]; }).length
    : 0;
  const leftCount = previousScope
    ? Object.keys(previousByRaw).filter(function(rawQuery) { return !currentByRaw[rawQuery]; }).length
    : 0;
  const invalidScopeCount = periodScopes.filter(function(scope) {
    return scope.coverage.scope_status === 'INVALID';
  }).length;
  const limitedScopeCount = periodScopes.filter(function(scope) {
    return scope.coverage.scope_status === 'PARTIAL_UNKNOWN';
  }).length;
  const normalizationCollisionCount = periodScopes.reduce(function(total, scope) {
    return total + scope.snapshots.filter(function(snapshot) {
      return snapshot.normalization_collision;
    }).length;
  }, 0);
  const availablePeriods = periodScopes.map(function(scope) {
    return scope.period_key;
  });

  return {
    schema_version: 'search_market_diagnostic_v1',
    observation_version: 'facts_v1',
    marketplace: resolvedMarketplace,
    asin: asin,
    period_key: periodKey,
    previous_period_key: previousPeriod,
    lookback_months: lookbackMonths,
    identity_rule: 'RAW_EXACT',
    requested_periods: requestedPeriods,
    available_periods: availablePeriods,
    missing_periods: requestedPeriods.filter(function(period) {
      return availablePeriods.indexOf(period) < 0;
    }),
    coverage: currentScope.coverage,
    period_coverage: periodScopes.map(function(scope) {
      return {
        period_key: scope.period_key,
        coverage: scope.coverage
      };
    }),
    snapshot_comparison: {
      comparison_status: previousScope ? 'COMPARABLE' : 'PREVIOUS_PERIOD_MISSING',
      current: currentAggregate,
      previous: previousAggregate,
      changes: sqpAggregateChanges_(currentAggregate, previousAggregate),
      continued_query_count: matchedRawQueries.length,
      entered_query_count: enteredCount,
      left_query_count: leftCount
    },
    matched_cohort_comparison: {
      comparison_status: !previousScope
        ? 'PREVIOUS_PERIOD_MISSING'
        : (matchedRawQueries.length ? 'COMPARABLE' : 'NO_RAW_EXACT_MATCH'),
      identity_rule: 'RAW_EXACT',
      matched_query_count: matchedRawQueries.length,
      excluded_entered_query_count: enteredCount,
      excluded_left_query_count: leftCount,
      current: currentMatchedAggregate,
      previous: previousMatchedAggregate,
      changes: matchedRawQueries.length
        ? sqpAggregateChanges_(currentMatchedAggregate, previousMatchedAggregate)
        : null
    },
    data_usability: {
      current_state: currentScope.coverage.scope_status === 'INVALID'
        ? 'INVALID'
        : (currentScope.coverage.scope_status === 'COMPLETE' ? 'VALID' : 'LIMITED'),
      month_over_month: !previousScope
        ? 'INVALID'
        : (currentScope.coverage.scope_status === 'INVALID'
          || previousScope.coverage.scope_status === 'INVALID'
          ? 'INVALID'
          : (currentScope.coverage.scope_status === 'COMPLETE'
            && previousScope.coverage.scope_status === 'COMPLETE' ? 'VALID' : 'LIMITED')),
      matched_cohort: !previousScope || !matchedRawQueries.length
        ? 'INVALID'
        : (currentScope.coverage.scope_status === 'COMPLETE'
          && previousScope.coverage.scope_status === 'COMPLETE' ? 'VALID' : 'LIMITED'),
      multi_period_trend: invalidScopeCount
        ? 'INVALID'
        : (periodScopes.length === requestedPeriods.length && !limitedScopeCount
          ? 'VALID'
          : 'LIMITED'),
      market_universe_inference: 'LIMITED',
      normalized_join: 'LIMITED',
      share: sqpShareUsability_(currentAggregate)
    },
    evidence_inputs: sqpEvidenceInputs_(
      currentAggregate,
      requestedPeriods.length,
      periodScopes.length,
      null
    ),
    data_quality: {
      invalid_scope_count: invalidScopeCount,
      normalization_collision_row_count: normalizationCollisionCount,
      period_count_requested: requestedPeriods.length,
      period_count_available: periodScopes.length,
      reasons: currentScope.coverage.reasons.concat(
        ['UNIVERSE_COVERAGE_PARTIAL_UNKNOWN'],
        requestedPeriods.length !== periodScopes.length ? ['REQUESTED_PERIODS_MISSING'] : [],
        normalizationCollisionCount ? ['NORMALIZATION_COLLISION'] : []
      )
    },
    query_facts: sqpQueryFacts_(
      periodScopes,
      requestedPeriods,
      periodKey,
      previousPeriod
    ),
    read_strategy: 'IMPORT_LOG_INDEX_THEN_ONE_SCOPE_TEXT_FINDER_PER_PERIOD'
  };
}

// ============================================================
// PR4.5-2: Candidate Signal Engine v0 (shadow)
// ============================================================

const SQP_SIGNAL_POLICY_V0_ = {
  policy_version: 'search_market_signal_v0',
  observation_version: 'facts_v1',
  mode: 'SHADOW',
  action_classes: ['CHECK', 'WATCH'],
  evidence_policy_version: null,
  evidence_thresholds: 'NOT_CONFIGURED',
  selection_mode: 'FAMILY_LEXICOGRAPHIC',
  family_limits: {
    DEMAND_TREND: 3,
    IMPRESSION_SHARE_TREND: 3,
    CLICK_SHARE_TREND: 3,
    CART_SHARE_TREND: 3,
    PURCHASE_SHARE_TREND: 3,
    EXPOSURE_LEVERAGE: 3,
    SEARCH_RESULT_GAP: 3,
    DETAIL_PAGE_GAP: 3,
    PURCHASE_COMPLETION_GAP: 3,
    RANK_MOVEMENT: 3,
    SNAPSHOT_MEMBERSHIP: 3,
    NORMALIZATION_QUALITY: 3
  }
};

function sqpSignalPolicyV0_() {
  return JSON.parse(JSON.stringify(SQP_SIGNAL_POLICY_V0_));
}

function sqpUsabilityOrder_(status) {
  if (status === 'VALID') return 0;
  if (status === 'LIMITED') return 1;
  return 2;
}

function sqpActionClassOrder_(actionClass) {
  return actionClass === 'CHECK' ? 0 : 1;
}

function sqpCombineUsability_() {
  const statuses = Array.prototype.slice.call(arguments);
  return statuses.reduce(function(result, status) {
    return sqpUsabilityOrder_(status) > sqpUsabilityOrder_(result) ? status : result;
  }, 'VALID');
}

function sqpRankBand_(rank) {
  if (rank === null || rank === undefined || rank === '') {
    return { code: 'NOT_CURRENT', order: 4 };
  }
  const value = Number(rank);
  if (value <= 10) return { code: 'TOP10', order: 0 };
  if (value <= 30) return { code: 'TOP30', order: 1 };
  if (value <= 100) return { code: 'TOP100', order: 2 };
  return { code: 'OUTSIDE_TOP100', order: 3 };
}

function sqpSignalIdentity_(queryFact) {
  const snapshot = queryFact.current_snapshot || queryFact.previous_snapshot;
  return {
    raw: queryFact.search_query_raw,
    normalized: snapshot ? snapshot.search_query_normalized : '',
    normalization_version: snapshot ? snapshot.normalization_version : 'query_norm_v1',
    identity_rule: 'RAW_EXACT'
  };
}

function sqpSignalCommonFacts_(queryFact) {
  const current = queryFact.current_snapshot;
  const previous = queryFact.previous_snapshot;
  return {
    current_status: queryFact.current_status,
    current_rank: current ? current.search_query_rank : null,
    previous_rank: previous ? previous.search_query_rank : null,
    rank_change: queryFact.trend ? queryFact.trend.rank_change : null,
    current_query_volume: current ? current.search_query_volume : null,
    previous_query_volume: previous ? previous.search_query_volume : null,
    current_market_purchase: current ? current.purchase_total : null,
    current_asin_purchase: current ? current.purchase_asin : null,
    previous_market_purchase: previous ? previous.purchase_total : null,
    previous_asin_purchase: previous ? previous.purchase_asin : null,
    current_purchase_share: current ? current.purchase_share : null,
    previous_purchase_share: previous ? previous.purchase_share : null,
    period_count_available: queryFact.period_count_available,
    raw_continuity_months: queryFact.evidence_inputs.raw_continuity_months
  };
}

function sqpSignalPriorityBasis_(queryFact, usability, actionClass, primaryChangeAbs) {
  const current = queryFact.current_snapshot;
  const previous = queryFact.previous_snapshot;
  const snapshot = current || previous;
  const rank = current ? current.search_query_rank : (previous ? previous.search_query_rank : null);
  const rankBand = sqpRankBand_(rank);
  const purchaseShareChange = queryFact.trend
    && queryFact.trend.aggregate_changes
    && queryFact.trend.aggregate_changes.purchase
    ? queryFact.trend.aggregate_changes.purchase.share_points
    : null;
  const rankChange = queryFact.trend ? queryFact.trend.rank_change : null;
  return {
    data_usability: usability,
    data_usability_order: sqpUsabilityOrder_(usability),
    action_class: actionClass,
    action_class_order: sqpActionClassOrder_(actionClass),
    amazon_query_rank: rank,
    amazon_query_rank_band: rankBand.code,
    amazon_query_rank_band_order: rankBand.order,
    market_purchase: snapshot ? snapshot.purchase_total : 0,
    asin_purchase: snapshot ? snapshot.purchase_asin : 0,
    primary_change_abs: primaryChangeAbs === null || primaryChangeAbs === undefined
      ? 0
      : Math.abs(primaryChangeAbs),
    purchase_share_change_abs: purchaseShareChange === null
      ? 0
      : Math.abs(purchaseShareChange),
    rank_change_abs: rankChange === null ? 0 : Math.abs(rankChange),
    stable_tiebreaker: queryFact.search_query_raw
  };
}

function sqpSignalId_(diagnostics, family, code, queryFact, stage) {
  const source = [
    SQP_SIGNAL_POLICY_V0_.policy_version,
    diagnostics.marketplace,
    diagnostics.asin,
    diagnostics.period_key,
    family,
    code,
    queryFact.search_query_raw,
    stage || ''
  ].join('\n');
  return 'SMV0-' + diagnostics.period_key.replace('-', '')
    + '-' + sqpSha256Hex_(source).slice(0, 16);
}

function sqpCandidateSignal_(
  diagnostics,
  queryFact,
  family,
  code,
  baseActionClass,
  usability,
  primaryChangeAbs,
  stage,
  facts
) {
  const actionClass = usability === 'LIMITED' && baseActionClass === 'CHECK'
    ? 'WATCH'
    : baseActionClass;
  const classificationReasons = [];
  if (usability === 'LIMITED' && baseActionClass === 'CHECK') {
    classificationReasons.push('LIMITED_DATA_DEMOTED_CHECK_TO_WATCH');
  }
  if (diagnostics.coverage.universe_coverage === 'PARTIAL_UNKNOWN') {
    classificationReasons.push('UNIVERSE_COVERAGE_PARTIAL_UNKNOWN');
  }
  return {
    signal_id: sqpSignalId_(diagnostics, family, code, queryFact, stage),
    family: family,
    code: code,
    stage: stage || null,
    action_class: actionClass,
    base_action_class: baseActionClass,
    data_usability: usability,
    gate_status: usability === 'INVALID'
      ? 'SUPPRESSED'
      : (usability === 'LIMITED' ? 'LIMITED' : 'PASS'),
    query_identity: sqpSignalIdentity_(queryFact),
    facts: Object.assign(sqpSignalCommonFacts_(queryFact), facts || {}),
    evidence_inputs: queryFact.evidence_inputs,
    classification_reasons: classificationReasons,
    priority_basis: sqpSignalPriorityBasis_(
      queryFact,
      usability,
      actionClass,
      primaryChangeAbs
    ),
    family_rank: null,
    selection_reason: null,
    suppression_reasons: []
  };
}

function sqpStageFacts_(snapshot, stage) {
  if (!snapshot) return null;
  return {
    market_denominator: snapshot[stage + '_total'],
    asin_numerator: snapshot[stage + '_asin'],
    share: snapshot[stage + '_share']
  };
}

function sqpBuildSignalCandidates_(diagnostics) {
  const candidates = [];
  diagnostics.query_facts.forEach(function(queryFact) {
    const current = queryFact.current_snapshot;
    const previous = queryFact.previous_snapshot;
    const trend = queryFact.trend;

    if (current && previous && trend) {
      const volumeChange = trend.aggregate_changes.search_query_volume;
      if (volumeChange.absolute !== 0) {
        candidates.push(sqpCandidateSignal_(
          diagnostics,
          queryFact,
          'DEMAND_TREND',
          volumeChange.absolute > 0 ? 'QUERY_DEMAND_UP' : 'QUERY_DEMAND_DOWN',
          'WATCH',
          sqpCombineUsability_(
            diagnostics.data_usability.month_over_month,
            queryFact.data_usability.month_over_month
          ),
          volumeChange.absolute,
          null,
          {
            query_volume_change_absolute: volumeChange.absolute,
            query_volume_change_relative: volumeChange.relative
          }
        ));
      }

      [
        ['impression', 'IMPRESSION_SHARE_TREND'],
        ['click', 'CLICK_SHARE_TREND'],
        ['cart', 'CART_SHARE_TREND'],
        ['purchase', 'PURCHASE_SHARE_TREND']
      ].forEach(function(definition) {
        const stage = definition[0];
        const shareChange = trend.aggregate_changes[stage].share_points;
        if (shareChange === null || shareChange === 0) return;
        const stageUsability = current[stage + '_total'] > 0 && previous[stage + '_total'] > 0
          ? 'VALID'
          : 'INVALID';
        candidates.push(sqpCandidateSignal_(
          diagnostics,
          queryFact,
          definition[1],
          shareChange > 0 ? 'SHARE_GAIN' : 'SHARE_LOSS',
          shareChange > 0 ? 'WATCH' : 'CHECK',
          sqpCombineUsability_(
            diagnostics.data_usability.month_over_month,
            queryFact.data_usability.month_over_month,
            stageUsability
          ),
          shareChange,
          stage,
          {
            previous_stage: sqpStageFacts_(previous, stage),
            current_stage: sqpStageFacts_(current, stage),
            share_change_points: shareChange
          }
        ));
      });

      if (trend.rank_change !== 0) {
        candidates.push(sqpCandidateSignal_(
          diagnostics,
          queryFact,
          'RANK_MOVEMENT',
          trend.rank_change > 0 ? 'RANK_SURGE' : 'RANK_DROP',
          trend.rank_change > 0 ? 'WATCH' : 'CHECK',
          sqpCombineUsability_(
            diagnostics.data_usability.month_over_month,
            queryFact.data_usability.month_over_month
          ),
          trend.rank_change,
          null,
          { rank_change: trend.rank_change }
        ));
      }
    }

    if (current) {
      const currentUsability = sqpCombineUsability_(
        diagnostics.data_usability.current_state,
        queryFact.data_usability.current_state
      );
      const funnelDefinitions = [
        {
          family: 'EXPOSURE_LEVERAGE',
          code: 'EXPOSURE_LEVERAGE_CANDIDATE',
          left: 'purchase',
          right: 'impression',
          matches: function(left, right) { return left > right; }
        },
        {
          family: 'SEARCH_RESULT_GAP',
          code: 'SEARCH_RESULT_GAP_CANDIDATE',
          left: 'click',
          right: 'impression',
          matches: function(left, right) { return left < right; }
        },
        {
          family: 'DETAIL_PAGE_GAP',
          code: 'DETAIL_PAGE_GAP_CANDIDATE',
          left: 'cart',
          right: 'click',
          matches: function(left, right) { return left < right; }
        },
        {
          family: 'PURCHASE_COMPLETION_GAP',
          code: 'PURCHASE_COMPLETION_GAP_CANDIDATE',
          left: 'purchase',
          right: 'cart',
          matches: function(left, right) { return left < right; }
        }
      ];
      funnelDefinitions.forEach(function(definition) {
        const leftShare = current[definition.left + '_share'];
        const rightShare = current[definition.right + '_share'];
        if (leftShare === null || rightShare === null || !definition.matches(leftShare, rightShare)) {
          return;
        }
        const usability = sqpCombineUsability_(
          currentUsability,
          queryFact.data_usability.share[definition.left],
          queryFact.data_usability.share[definition.right]
        );
        candidates.push(sqpCandidateSignal_(
          diagnostics,
          queryFact,
          definition.family,
          definition.code,
          'CHECK',
          usability,
          Math.abs(leftShare - rightShare),
          definition.left + '_vs_' + definition.right,
          {
            compared_share_left: {
              stage: definition.left,
              value: leftShare
            },
            compared_share_right: {
              stage: definition.right,
              value: rightShare
            },
            share_gap_points: leftShare - rightShare
          }
        ));
      });
    }

    if (queryFact.current_status === 'ENTERED_TOP100' || queryFact.current_status === 'LEFT_TOP100') {
      candidates.push(sqpCandidateSignal_(
        diagnostics,
        queryFact,
        'SNAPSHOT_MEMBERSHIP',
        queryFact.current_status,
        'WATCH',
        diagnostics.data_usability.month_over_month,
        0,
        null,
        {
          snapshot_membership_status: queryFact.current_status,
          meaning: queryFact.current_status === 'ENTERED_TOP100'
            ? 'CURRENT_SNAPSHOT_ONLY'
            : 'PREVIOUS_SNAPSHOT_ONLY'
        }
      ));
    }

    if (queryFact.normalization_collision) {
      candidates.push(sqpCandidateSignal_(
        diagnostics,
        queryFact,
        'NORMALIZATION_QUALITY',
        'NORMALIZATION_AMBIGUITY',
        'CHECK',
        'LIMITED',
        0,
        null,
        {
          normalized_values: queryFact.search_query_normalized_values,
          raw_queries_are_kept_separate: true
        }
      ));
    }
  });
  return candidates;
}

function sqpCompareCandidateSignals_(left, right) {
  const a = left.priority_basis;
  const b = right.priority_basis;
  const ascendingFields = [
    'data_usability_order',
    'action_class_order',
    'amazon_query_rank_band_order'
  ];
  for (let index = 0; index < ascendingFields.length; index++) {
    const field = ascendingFields[index];
    if (a[field] !== b[field]) return a[field] - b[field];
  }
  const descendingFields = [
    'market_purchase',
    'asin_purchase',
    'primary_change_abs',
    'purchase_share_change_abs',
    'rank_change_abs'
  ];
  for (let index = 0; index < descendingFields.length; index++) {
    const field = descendingFields[index];
    if (a[field] !== b[field]) return b[field] - a[field];
  }
  const rawComparison = String(a.stable_tiebreaker).localeCompare(String(b.stable_tiebreaker));
  if (rawComparison !== 0) return rawComparison;
  const codeComparison = String(left.code).localeCompare(String(right.code));
  if (codeComparison !== 0) return codeComparison;
  return String(left.stage || '').localeCompare(String(right.stage || ''));
}

function sqpSelectSignalsByFamily_(candidates, policy) {
  return Object.keys(policy.family_limits).map(function(family) {
    const familyCandidates = candidates.filter(function(candidate) {
      return candidate.family === family;
    });
    const gateSuppressed = familyCandidates.filter(function(candidate) {
      return candidate.data_usability === 'INVALID';
    }).map(function(candidate) {
      candidate.suppression_reasons = [{
        code: 'DATA_USABILITY_INVALID',
        detail: 'このsignalの計算・比較に必要なデータを利用できません。'
      }];
      return candidate;
    });
    const eligible = familyCandidates.filter(function(candidate) {
      return candidate.data_usability !== 'INVALID';
    }).sort(sqpCompareCandidateSignals_);
    const limit = policy.family_limits[family];
    const selected = [];
    const familyLimitSuppressed = [];
    eligible.forEach(function(candidate, index) {
      candidate.family_rank = index + 1;
      if (index < limit) {
        candidate.selection_reason = {
          code: 'SELECTED_BY_FAMILY_LEXICOGRAPHIC_PRIORITY',
          family_rank: index + 1,
          compared_candidate_count: eligible.length,
          ordered_by: [
            'data_usability',
            'action_class',
            'amazon_query_rank_band',
            'market_purchase',
            'asin_purchase',
            'primary_change_abs',
            'purchase_share_change_abs',
            'rank_change_abs',
            'search_query_raw'
          ]
        };
        selected.push(candidate);
      } else {
        candidate.suppression_reasons = [{
          code: 'FAMILY_SELECTION_LIMIT',
          detail: '同じsignal family内のlexicographic priorityで表示枠外です。'
        }];
        familyLimitSuppressed.push(candidate);
      }
    });
    return {
      family: family,
      selection_limit: limit,
      candidate_count: familyCandidates.length,
      selected_count: selected.length,
      suppressed_count: gateSuppressed.length + familyLimitSuppressed.length,
      selected_signals: selected,
      suppressed_candidates: gateSuppressed.concat(familyLimitSuppressed)
    };
  });
}

function sqpBuildCandidateSignalResponse_(diagnostics) {
  const policy = sqpSignalPolicyV0_();
  const candidates = sqpBuildSignalCandidates_(diagnostics);
  const families = sqpSelectSignalsByFamily_(candidates, policy);
  return {
    schema_version: 'search_market_signal_candidate_v1',
    policy: policy,
    diagnostics_ref: {
      schema_version: diagnostics.schema_version,
      observation_version: diagnostics.observation_version,
      marketplace: diagnostics.marketplace,
      asin: diagnostics.asin,
      period_key: diagnostics.period_key,
      lookback_months: diagnostics.lookback_months,
      identity_rule: diagnostics.identity_rule,
      coverage: diagnostics.coverage,
      data_usability: diagnostics.data_usability
    },
    selection_scope: 'WITHIN_EACH_SIGNAL_FAMILY',
    cross_family_ranking: false,
    candidate_count: candidates.length,
    selected_count: families.reduce(function(total, family) {
      return total + family.selected_count;
    }, 0),
    suppressed_count: families.reduce(function(total, family) {
      return total + family.suppressed_count;
    }, 0),
    families: families
  };
}

function getSearchMarketSignals_(asinInput, periodKey, marketplaceInput, lookbackMonthsInput) {
  return sqpBuildCandidateSignalResponse_(getSearchMarketDiagnostics_(
    asinInput,
    periodKey,
    marketplaceInput,
    lookbackMonthsInput
  ));
}

// ============================================================
// PR4.5-3: Query Synthesis / Narrative Builder v0
// ============================================================

const SQP_NARRATIVE_POLICY_V0_ = {
  policy_version: 'search_market_narrative_v0',
  mode: 'DETERMINISTIC_TEMPLATE',
  max_display_items: 8,
  matched_cohort_priority: true,
  cross_query_score: false,
  section_limits: {
    conclusion: 1,
    positive: 1,
    concern: 2,
    check: 2,
    watch: 1,
    data_quality: 1
  }
};

const SQP_DISPLAY_POLICY_V0_ = {
  policy_version: 'search_market_display_v0',
  mode: 'DETERMINISTIC_DECISION_PRESENTATION',
  max_do_now_items: 2,
  max_keep_items: 1,
  max_ad_check_queries: 2,
  business_relevance_gate: {
    minimum_market_purchase: 5,
    minimum_query_volume: 100,
    maximum_query_rank: 30,
    minimum_asin_purchase: 1,
    require_previous_period_for_primary: true,
    rule: 'PREVIOUS_PERIOD_AND_ANY_SCALE_CONDITION'
  },
  keep_relevance_gate: {
    minimum_market_purchase: 5,
    minimum_query_volume: 100,
    rule: 'ALL_CONDITIONS'
  },
  cross_query_score: false,
  statistical_significance_test: false
};

function sqpNarrativePolicyV0_() {
  return JSON.parse(JSON.stringify(SQP_NARRATIVE_POLICY_V0_));
}

function sqpDisplayPolicyV0_() {
  return JSON.parse(JSON.stringify(SQP_DISPLAY_POLICY_V0_));
}

function sqpAllUsableSignalCandidates_(signalResponse) {
  const seen = Object.create(null);
  const signals = [];
  signalResponse.families.forEach(function(family) {
    family.selected_signals.concat(family.suppressed_candidates).forEach(function(signal) {
      if (seen[signal.signal_id] || signal.data_usability === 'INVALID') return;
      seen[signal.signal_id] = true;
      signals.push(signal);
    });
  });
  return signals;
}

function sqpNarrativeSignalRef_(signal) {
  return {
    signal_id: signal.signal_id,
    family: signal.family,
    code: signal.code,
    stage: signal.stage,
    action_class: signal.action_class,
    data_usability: signal.data_usability,
    facts: signal.facts,
    evidence_inputs: signal.evidence_inputs,
    selection_reason: signal.selection_reason,
    suppression_reasons: signal.suppression_reasons,
    priority_basis: signal.priority_basis
  };
}

function sqpNarrativeId_(diagnostics, section, code, rawQuery) {
  return 'SMN0-' + diagnostics.period_key.replace('-', '') + '-'
    + sqpSha256Hex_([
      SQP_NARRATIVE_POLICY_V0_.policy_version,
      diagnostics.marketplace,
      diagnostics.asin,
      diagnostics.period_key,
      section,
      code,
      rawQuery || ''
    ].join('\n')).slice(0, 16);
}

function sqpSignalByCode_(signals, code, stage) {
  return signals.filter(function(signal) {
    return signal.code === code && (!stage || signal.stage === stage);
  })[0] || null;
}

function sqpSignalStages_(signals, code) {
  return signals.filter(function(signal) {
    return signal.code === code && !!signal.stage;
  }).map(function(signal) {
    return signal.stage;
  });
}

function sqpJapaneseStages_(stages) {
  const labels = {
    impression: 'Impression',
    click: 'Click',
    cart: 'Cart',
    purchase: 'Purchase'
  };
  return stages.map(function(stage) { return labels[stage] || stage; }).join('・');
}

function sqpQuerySynthesis_(diagnostics, rawQuery, signals) {
  const businessSignals = signals.filter(function(signal) {
    return signal.family !== 'NORMALIZATION_QUALITY'
      && signal.family !== 'SNAPSHOT_MEMBERSHIP';
  });
  if (!businessSignals.length) return null;

  const shareLossStages = sqpSignalStages_(businessSignals, 'SHARE_LOSS');
  const shareGainStages = sqpSignalStages_(businessSignals, 'SHARE_GAIN');
  const demandUp = sqpSignalByCode_(businessSignals, 'QUERY_DEMAND_UP');
  const demandDown = sqpSignalByCode_(businessSignals, 'QUERY_DEMAND_DOWN');
  const purchaseGain = sqpSignalByCode_(businessSignals, 'SHARE_GAIN', 'purchase');
  const purchaseLoss = sqpSignalByCode_(businessSignals, 'SHARE_LOSS', 'purchase');
  const impressionLoss = sqpSignalByCode_(businessSignals, 'SHARE_LOSS', 'impression');
  const exposureLeverage = sqpSignalByCode_(
    businessSignals,
    'EXPOSURE_LEVERAGE_CANDIDATE'
  );
  const rankDrop = sqpSignalByCode_(businessSignals, 'RANK_DROP');
  const rankSurge = sqpSignalByCode_(businessSignals, 'RANK_SURGE');
  const gapSignals = businessSignals.filter(function(signal) {
    return [
      'SEARCH_RESULT_GAP_CANDIDATE',
      'DETAIL_PAGE_GAP_CANDIDATE',
      'PURCHASE_COMPLETION_GAP_CANDIDATE'
    ].indexOf(signal.code) >= 0;
  });
  const synthesisCodes = [];
  const clauses = [];
  let positive = false;
  let concern = false;
  let mixed = false;

  if (shareLossStages.length >= 2) {
    synthesisCodes.push('MULTI_STAGE_SHARE_DECLINE');
    clauses.push(sqpJapaneseStages_(shareLossStages) + ' Shareが同時に低下しました');
    concern = true;
  } else if (shareLossStages.length === 1) {
    synthesisCodes.push('SINGLE_STAGE_SHARE_DECLINE');
    clauses.push(sqpJapaneseStages_(shareLossStages) + ' Shareが低下しました');
    concern = true;
  }
  if (shareGainStages.length >= 2) {
    synthesisCodes.push('MULTI_STAGE_SHARE_GAIN');
    clauses.push(sqpJapaneseStages_(shareGainStages) + ' Shareが同時に上昇しました');
    positive = true;
  } else if (shareGainStages.length === 1) {
    synthesisCodes.push('SINGLE_STAGE_SHARE_GAIN');
    clauses.push(sqpJapaneseStages_(shareGainStages) + ' Shareが上昇しました');
    positive = true;
  }
  if (impressionLoss && exposureLeverage) {
    synthesisCodes.push('IMPRESSION_DECLINE_WITH_EXPOSURE_LEVERAGE');
    clauses.push('表示Shareは低下しましたが、表示後の獲得Shareは相対的に高い状態です');
    mixed = true;
  }
  if (demandDown && purchaseGain) {
    synthesisCodes.push('DEMAND_DOWN_PURCHASE_SHARE_UP');
    clauses.push('検索需要観測値は縮小しましたが、Purchase Shareは改善しました');
    positive = true;
    mixed = true;
  } else if (demandUp && purchaseGain) {
    synthesisCodes.push('DEMAND_UP_PURCHASE_SHARE_UP');
    clauses.push('検索需要観測値とPurchase Shareがともに上昇しました');
    positive = true;
  } else if (demandUp && purchaseLoss) {
    synthesisCodes.push('DEMAND_UP_PURCHASE_SHARE_DOWN');
    clauses.push('検索需要観測値は増加しましたが、Purchase Shareは低下しました');
    concern = true;
    mixed = true;
  } else if (demandDown && purchaseLoss) {
    synthesisCodes.push('DEMAND_DOWN_PURCHASE_SHARE_DOWN');
    clauses.push('検索需要観測値とPurchase Shareがともに低下しました');
    concern = true;
  } else if (demandUp) {
    synthesisCodes.push('DEMAND_UP');
    clauses.push('検索需要観測値が増加しました');
    positive = true;
  } else if (demandDown) {
    synthesisCodes.push('DEMAND_DOWN');
    clauses.push('検索需要観測値が減少しました');
  }
  if (gapSignals.length) {
    const gapLabels = {
      SEARCH_RESULT_GAP_CANDIDATE: 'ImpressionからClick',
      DETAIL_PAGE_GAP_CANDIDATE: 'ClickからCart',
      PURCHASE_COMPLETION_GAP_CANDIDATE: 'CartからPurchase'
    };
    synthesisCodes.push('FUNNEL_GAP_CANDIDATE');
    clauses.push(gapSignals.map(function(signal) {
      return gapLabels[signal.code];
    }).join('・') + 'のShare獲得が相対的に弱い可能性があります');
    concern = true;
  }
  if (rankDrop) {
    synthesisCodes.push('RANK_DROP');
    clauses.push('Amazon検索クエリ順位が低下しました');
    concern = true;
  } else if (rankSurge) {
    synthesisCodes.push('RANK_SURGE');
    clauses.push('Amazon検索クエリ順位が上昇しました');
    positive = true;
  }
  if (exposureLeverage && !impressionLoss) {
    synthesisCodes.push('EXPOSURE_LEVERAGE');
    clauses.push('Impression段階より後段で獲得Shareが高い状態です');
    positive = true;
  }

  if (!synthesisCodes.length) return null;
  if (positive && concern) mixed = true;
  let section = 'watch';
  if (mixed) section = 'check';
  else if (concern) section = 'concern';
  else if (positive) section = 'positive';
  else if (businessSignals.some(function(signal) { return signal.action_class === 'CHECK'; })) {
    section = 'check';
  }
  const anchorSignal = businessSignals.slice().sort(sqpCompareCandidateSignals_)[0];
  const titleSuffix = section === 'positive'
    ? '改善を観測'
    : (section === 'concern'
      ? '注意したい変化'
      : (section === 'check' ? '強みと注意点が混在' : '継続観測'));
  const refs = businessSignals.map(sqpNarrativeSignalRef_);
  return {
    narrative_id: sqpNarrativeId_(
      diagnostics,
      section,
      synthesisCodes.join('+'),
      rawQuery
    ),
    section: section,
    action_class: section === 'concern' || section === 'check' ? 'CHECK' : 'WATCH',
    primary_code: synthesisCodes[0],
    synthesis_codes: synthesisCodes,
    title: '「' + rawQuery + '」：' + titleSuffix,
    body: clauses.slice(0, 4).join('。') + '。',
    query_identity: {
      raw: rawQuery,
      normalized: anchorSignal.query_identity.normalized,
      identity_rule: 'RAW_EXACT'
    },
    facts: {
      share_loss_stages: shareLossStages,
      share_gain_stages: shareGainStages,
      current_rank: anchorSignal.facts.current_rank,
      previous_rank: anchorSignal.facts.previous_rank,
      current_query_volume: anchorSignal.facts.current_query_volume,
      previous_query_volume: anchorSignal.facts.previous_query_volume,
      current_market_purchase: anchorSignal.facts.current_market_purchase,
      current_asin_purchase: anchorSignal.facts.current_asin_purchase,
      current_purchase_share: anchorSignal.facts.current_purchase_share,
      previous_purchase_share: anchorSignal.facts.previous_purchase_share
    },
    source_signal_ids: refs.map(function(ref) { return ref.signal_id; }),
    source_signal_refs: refs,
    selection_reason: {
      code: 'QUERY_SYNTHESIS_RULE_MATCH',
      matched_rules: synthesisCodes,
      uses_family_suppressed_candidates: refs.some(function(ref) {
        return ref.suppression_reasons.some(function(reason) {
          return reason.code === 'FAMILY_SELECTION_LIMIT';
        });
      })
    },
    priority_basis: anchorSignal.priority_basis
  };
}

function sqpDiscoveryNarratives_(diagnostics, signals, businessQueryMap) {
  return signals.filter(function(signal) {
    return signal.family === 'SNAPSHOT_MEMBERSHIP'
      && !businessQueryMap[signal.query_identity.raw];
  }).map(function(signal) {
    const entered = signal.code === 'ENTERED_TOP100';
    const ref = sqpNarrativeSignalRef_(signal);
    return {
      narrative_id: sqpNarrativeId_(
        diagnostics,
        'watch',
        signal.code,
        signal.query_identity.raw
      ),
      section: 'watch',
      action_class: 'WATCH',
      primary_code: signal.code,
      synthesis_codes: [signal.code],
      title: '「' + signal.query_identity.raw + '」：'
        + (entered ? '当月snapshotへ出現' : '当月snapshotでは不在'),
      body: entered
        ? '当月のTop query snapshotへ出現しました。1か月だけでは定着と判断せず監視します。'
        : '当月のTop query snapshotでは不在です。検索需要消失とは判断せず再出現を監視します。',
      query_identity: signal.query_identity,
      facts: signal.facts,
      source_signal_ids: [signal.signal_id],
      source_signal_refs: [ref],
      selection_reason: {
        code: 'DISCOVERY_WATCH_RULE',
        matched_rules: [signal.code],
        uses_family_suppressed_candidates: signal.suppression_reasons.some(function(reason) {
          return reason.code === 'FAMILY_SELECTION_LIMIT';
        })
      },
      priority_basis: signal.priority_basis
    };
  });
}

function sqpHeadlineNarrative_(diagnostics) {
  const matched = diagnostics.matched_cohort_comparison;
  const snapshot = diagnostics.snapshot_comparison;
  const useMatched = matched
    && matched.comparison_status === 'COMPARABLE'
    && diagnostics.data_usability.matched_cohort !== 'INVALID';
  const comparison = useMatched ? matched : snapshot;
  const purchaseChange = comparison.changes
    && comparison.changes.purchase
    ? comparison.changes.purchase.share_points
    : null;
  const volumeChange = comparison.changes
    ? comparison.changes.search_query_volume
    : null;
  const clauses = [];
  if (useMatched) {
    clauses.push('前月・当月でraw完全一致した継続'
      + matched.matched_query_count + 'queryを優先して比較しました');
  } else {
    clauses.push('Top query snapshot全体を比較しました');
  }
  if (volumeChange) {
    clauses.push('取得クエリ内のSearch Query Volumeは'
      + comparison.previous.search_query_volume + 'から'
      + comparison.current.search_query_volume + 'へ'
      + (volumeChange.absolute >= 0 ? '増加' : '減少') + 'しました');
  }
  if (purchaseChange !== null) {
    const previousShare = comparison.previous.purchase.share;
    const currentShare = comparison.current.purchase.share;
    clauses.push('Purchase Shareは'
      + (previousShare * 100).toFixed(2) + '%から'
      + (currentShare * 100).toFixed(2) + '%へ'
      + (purchaseChange >= 0 ? '上昇' : '低下') + 'しました');
  }
  return {
    narrative_id: sqpNarrativeId_(
      diagnostics,
      'conclusion',
      useMatched ? 'MATCHED_COHORT_HEADLINE' : 'SNAPSHOT_HEADLINE',
      ''
    ),
    section: 'conclusion',
    action_class: 'WATCH',
    primary_code: useMatched ? 'MATCHED_COHORT_HEADLINE' : 'SNAPSHOT_HEADLINE',
    synthesis_codes: [useMatched ? 'MATCHED_COHORT_HEADLINE' : 'SNAPSHOT_HEADLINE'],
    title: useMatched ? '継続queryを基準にした今月の結論' : 'snapshot全体による今月の結論',
    body: clauses.join('。') + '。',
    query_identity: null,
    facts: {
      comparison_source: useMatched ? 'MATCHED_COHORT' : 'SNAPSHOT',
      matched_cohort: matched,
      snapshot_comparison: snapshot
    },
    source_signal_ids: [],
    source_signal_refs: [],
    selection_reason: {
      code: useMatched
        ? 'MATCHED_COHORT_COMPARISON_PRIORITIZED'
        : 'SNAPSHOT_COMPARISON_FALLBACK',
      matched_rules: [],
      uses_family_suppressed_candidates: false
    },
    priority_basis: null
  };
}

function sqpDataQualityNarrative_(diagnostics, signals) {
  const normalizationSignals = signals.filter(function(signal) {
    return signal.family === 'NORMALIZATION_QUALITY';
  });
  const refs = normalizationSignals.map(sqpNarrativeSignalRef_);
  const clauses = [];
  if (diagnostics.coverage.universe_coverage === 'PARTIAL_UNKNOWN') {
    clauses.push('表示値は取得したTop query内であり、全関連query市場の完全coverageではありません');
  }
  if (diagnostics.coverage.scope_status !== 'COMPLETE') {
    clauses.push('当月Top query scopeの完全性は' + diagnostics.coverage.scope_status + 'です');
  }
  if (normalizationSignals.length) {
    clauses.push('query_norm_v1の表記衝突候補が'
      + normalizationSignals.length + 'queryあり、raw原文は別queryとして保持しています');
  }
  if (!clauses.length) clauses.push('現在の取込scopeで追加のdata quality注意はありません');
  return {
    narrative_id: sqpNarrativeId_(diagnostics, 'data_quality', 'DATA_QUALITY_NOTICE', ''),
    section: 'data_quality',
    action_class: 'WATCH',
    primary_code: 'DATA_QUALITY_NOTICE',
    synthesis_codes: ['DATA_QUALITY_NOTICE'],
    title: 'データの読み方に関する注意',
    body: clauses.join('。') + '。',
    query_identity: null,
    facts: {
      coverage: diagnostics.coverage,
      data_quality: diagnostics.data_quality,
      normalization_query_count: normalizationSignals.length
    },
    source_signal_ids: refs.map(function(ref) { return ref.signal_id; }),
    source_signal_refs: refs,
    selection_reason: {
      code: 'DATA_QUALITY_SEPARATED_FROM_BUSINESS_NARRATIVE',
      matched_rules: ['COVERAGE', 'NORMALIZATION_QUALITY'],
      uses_family_suppressed_candidates: refs.some(function(ref) {
        return ref.suppression_reasons.some(function(reason) {
          return reason.code === 'FAMILY_SELECTION_LIMIT';
        });
      })
    },
    priority_basis: null
  };
}

function sqpCompareNarratives_(left, right) {
  if (left.priority_basis && right.priority_basis) {
    return sqpCompareCandidateSignals_(
      { code: left.primary_code, stage: '', priority_basis: left.priority_basis },
      { code: right.primary_code, stage: '', priority_basis: right.priority_basis }
    );
  }
  if (left.priority_basis) return -1;
  if (right.priority_basis) return 1;
  return String(left.narrative_id).localeCompare(String(right.narrative_id));
}

function sqpSelectNarrativesBySection_(items, policy) {
  const sections = {
    conclusion: [],
    positive: [],
    concern: [],
    check: [],
    watch: [],
    data_quality: []
  };
  const suppressed = [];
  Object.keys(sections).forEach(function(section) {
    const candidates = items.filter(function(item) {
      return item.section === section;
    }).sort(sqpCompareNarratives_);
    const limit = policy.section_limits[section];
    sections[section] = candidates.slice(0, limit);
    candidates.slice(limit).forEach(function(item, index) {
      suppressed.push({
        narrative_id: item.narrative_id,
        section: section,
        query_identity: item.query_identity,
        section_rank: limit + index + 1,
        reason: 'SECTION_DISPLAY_LIMIT'
      });
    });
  });
  return { sections: sections, suppressed: suppressed };
}

function sqpDisplayPercent_(value) {
  return value === null || value === undefined || !isFinite(Number(value))
    ? null
    : (Number(value) * 100).toFixed(2) + '%';
}

function sqpDisplayNumber_(value) {
  return value === null || value === undefined || !isFinite(Number(value))
    ? null
    : Math.round(Number(value)).toLocaleString('ja-JP');
}

function sqpDisplayItemId_(diagnostics, kind, rawQueries) {
  return 'SMD0-' + diagnostics.period_key.replace('-', '') + '-'
    + sqpSha256Hex_([
      SQP_DISPLAY_POLICY_V0_.policy_version,
      diagnostics.marketplace,
      diagnostics.asin,
      diagnostics.period_key,
      kind,
      (rawQueries || []).join('\n')
    ].join('\n')).slice(0, 16);
}

function sqpBusinessRelevanceGate_(narrative, policy) {
  const facts = narrative.facts || {};
  const gate = policy.business_relevance_gate;
  const currentRank = Number(facts.current_rank);
  const marketPurchase = Number(facts.current_market_purchase);
  const asinPurchase = Number(facts.current_asin_purchase);
  const queryVolume = Number(facts.current_query_volume);
  const previousAvailable = facts.previous_rank !== null
    && facts.previous_rank !== undefined;
  const scaleConditions = {
    market_purchase: isFinite(marketPurchase)
      && marketPurchase >= gate.minimum_market_purchase,
    query_volume: isFinite(queryVolume)
      && queryVolume >= gate.minimum_query_volume,
    rank: isFinite(currentRank)
      && currentRank > 0
      && currentRank <= gate.maximum_query_rank,
    asin_purchase: isFinite(asinPurchase)
      && asinPurchase >= gate.minimum_asin_purchase
  };
  const hasScale = Object.keys(scaleConditions).some(function(key) {
    return scaleConditions[key];
  });
  const suppressionReasons = [];
  if (gate.require_previous_period_for_primary && !previousAvailable) {
    suppressionReasons.push('SINGLE_PERIOD_ONLY');
  }
  if (!hasScale) suppressionReasons.push('LOW_BUSINESS_RELEVANCE');
  return {
    eligible: suppressionReasons.length === 0,
    suppression_reasons: suppressionReasons,
    threshold_facts: {
      current_rank: isFinite(currentRank) ? currentRank : null,
      current_query_volume: isFinite(queryVolume) ? queryVolume : null,
      current_market_purchase: isFinite(marketPurchase) ? marketPurchase : null,
      current_asin_purchase: isFinite(asinPurchase) ? asinPurchase : null,
      previous_period_available: previousAvailable,
      matched_scale_conditions: scaleConditions
    }
  };
}

function sqpHumanEvaluation_(diagnostics, headline) {
  const matched = diagnostics.matched_cohort_comparison;
  const snapshot = diagnostics.snapshot_comparison;
  const useMatched = matched
    && matched.comparison_status === 'COMPARABLE'
    && diagnostics.data_usability.matched_cohort !== 'INVALID';
  const comparison = useMatched ? matched : snapshot;
  const purchaseChange = comparison.changes
    && comparison.changes.purchase
    ? comparison.changes.purchase.share_points
    : null;
  const volumeChange = comparison.changes
    ? comparison.changes.search_query_volume
    : null;
  let status = 'INSUFFICIENT';
  let icon = '⚪';
  let label = '今月はまだ判断材料が足りません';
  let decision = '大きな変更はせず、次の月のデータを待ちます。';
  if (purchaseChange !== null) {
    if (purchaseChange > 0) {
      status = 'GOOD';
      icon = '🟢';
      label = '今月は好調です';
      decision = '今すぐ大きなページ修正をする必要はなさそうです。';
    } else if (purchaseChange < 0) {
      status = 'NEEDS_ATTENTION';
      icon = '🟡';
      label = '今月は確認が必要です';
      decision = '広告や商品ページを変更する前に、主要な検索語の状況を確認します。';
    } else {
      status = 'STABLE';
      icon = '🟢';
      label = '今月は安定しています';
      decision = '大きな変更はせず、現在の状態を維持します。';
    }
  }
  const matchedCount = useMatched ? matched.matched_query_count : null;
  const previousShare = comparison.previous.purchase.share;
  const currentShare = comparison.current.purchase.share;
  let summary = useMatched
    ? '前月から継続している' + matchedCount + 'の検索語では、'
    : '取得できた検索語全体では、';
  if (previousShare !== null && currentShare !== null) {
    summary += 'HAKSAIが購入された割合が'
      + sqpDisplayPercent_(previousShare) + ' → '
      + sqpDisplayPercent_(currentShare)
      + (purchaseChange >= 0 ? 'へ改善しました。' : 'へ低下しました。');
  } else {
    summary += '購入された割合を比較できませんでした。';
  }
  let context = '';
  if (volumeChange) {
    const previousVolume = comparison.previous.search_query_volume;
    const currentVolume = comparison.current.search_query_volume;
    const ratio = previousVolume
      ? Math.abs(volumeChange.absolute / previousVolume)
      : null;
    const sizeWord = ratio !== null && ratio <= 0.1 ? '少し' : '';
    context = '検索数は'
      + sqpDisplayNumber_(previousVolume) + ' → '
      + sqpDisplayNumber_(currentVolume) + 'と'
      + sizeWord + (volumeChange.absolute >= 0 ? '増えています' : '減っています')
      + 'が、'
      + (purchaseChange !== null && purchaseChange >= 0
        ? '同じ検索市場の中でHAKSAIが選ばれる割合は伸びています。'
        : 'HAKSAIが選ばれる割合もあわせて確認が必要です。');
  }
  return {
    status: status,
    icon: icon,
    label: label,
    summary: summary,
    context: context,
    decision: decision,
    comparison_source: useMatched ? 'MATCHED_COHORT' : 'SNAPSHOT',
    facts: {
      matched_query_count: matchedCount,
      previous_purchase_share: previousShare,
      current_purchase_share: currentShare,
      purchase_share_change_points: purchaseChange,
      previous_query_volume: comparison.previous.search_query_volume,
      current_query_volume: comparison.current.search_query_volume,
      query_volume_change: volumeChange
    },
    source_narrative_id: headline.narrative_id
  };
}

function sqpHumanSourceTrace_(narratives) {
  const narrativeIds = [];
  const signalIds = [];
  const facts = [];
  narratives.forEach(function(narrative) {
    narrativeIds.push(narrative.narrative_id);
    facts.push({
      narrative_id: narrative.narrative_id,
      query: narrative.query_identity ? narrative.query_identity.raw : null,
      facts: narrative.facts,
      selection_reason: narrative.selection_reason
    });
    narrative.source_signal_ids.forEach(function(signalId) {
      if (signalIds.indexOf(signalId) < 0) signalIds.push(signalId);
    });
  });
  return {
    source_narrative_ids: narrativeIds,
    source_signal_ids: signalIds,
    source_facts: facts
  };
}

function sqpHumanDoNow_(diagnostics, eligibleNarratives, evaluation, policy) {
  const selectedQueries = Object.create(null);
  const items = [];
  const negativeCodes = [
    'MULTI_STAGE_SHARE_DECLINE',
    'SINGLE_STAGE_SHARE_DECLINE',
    'DEMAND_UP_PURCHASE_SHARE_DOWN',
    'DEMAND_DOWN_PURCHASE_SHARE_DOWN',
    'FUNNEL_GAP_CANDIDATE',
    'RANK_DROP'
  ];
  const concernCandidates = eligibleNarratives.filter(function(narrative) {
    return narrative.synthesis_codes.some(function(code) {
      return negativeCodes.indexOf(code) >= 0;
    });
  }).sort(sqpCompareNarratives_);
  if (evaluation.status === 'NEEDS_ATTENTION' && concernCandidates.length) {
    const target = concernCandidates[0];
    const raw = target.query_identity.raw;
    selectedQueries[raw] = true;
    items.push(Object.assign({
      display_id: sqpDisplayItemId_(diagnostics, 'CHECK_PRIMARY_QUERY', [raw]),
      decision: 'CHECK',
      title: '「' + raw + '」の広告と商品ページを確認',
      what: '広告の表示状況と、商品ページで購入まで進みにくい要因がないかを確認します。',
      why: '検索数や市場購入数がある一方で、購入された割合の低下または途中段階の弱さが見られます。',
      target_queries: [raw],
      cta: {
        type: 'OPEN_AD_COMMAND_CENTER',
        label: '広告司令室で確認'
      }
    }, sqpHumanSourceTrace_([target])));
  }
  const strongCodes = [
    'EXPOSURE_LEVERAGE',
    'IMPRESSION_DECLINE_WITH_EXPOSURE_LEVERAGE',
    'MULTI_STAGE_SHARE_GAIN',
    'DEMAND_UP_PURCHASE_SHARE_UP',
    'DEMAND_DOWN_PURCHASE_SHARE_UP'
  ];
  const strongCandidates = eligibleNarratives.filter(function(narrative) {
    return !selectedQueries[narrative.query_identity.raw]
      && narrative.synthesis_codes.some(function(code) {
        return strongCodes.indexOf(code) >= 0;
      })
      && Number(narrative.facts.current_asin_purchase) > 0;
  }).sort(sqpCompareNarratives_);
  if (strongCandidates.length && items.length < policy.max_do_now_items) {
    const targets = strongCandidates.slice(0, policy.max_ad_check_queries);
    const rawQueries = targets.map(function(narrative) {
      selectedQueries[narrative.query_identity.raw] = true;
      return narrative.query_identity.raw;
    });
    items.push(Object.assign({
      display_id: sqpDisplayItemId_(diagnostics, 'CHECK_AD_EXPOSURE', rawQueries),
      decision: 'CHECK',
      title: rawQueries.map(function(raw) { return '「' + raw + '」'; }).join('・')
        + 'の広告掲載状況を確認',
      what: '広告司令室で、広告が十分に表示されているかと採算を確認します。',
      why: '検索数と市場購入数が大きく、HAKSAIが購入される割合も強い検索語です。',
      target_queries: rawQueries,
      cta: {
        type: 'OPEN_AD_COMMAND_CENTER',
        label: '広告司令室で確認'
      }
    }, sqpHumanSourceTrace_(targets)));
  }
  return {
    items: items.slice(0, policy.max_do_now_items),
    selected_queries: selectedQueries
  };
}

function sqpCompareKeepNarratives_(left, right) {
  const leftRankGain = left.facts.previous_rank !== null
    && left.facts.current_rank !== null
    ? Number(left.facts.previous_rank) - Number(left.facts.current_rank)
    : 0;
  const rightRankGain = right.facts.previous_rank !== null
    && right.facts.current_rank !== null
    ? Number(right.facts.previous_rank) - Number(right.facts.current_rank)
    : 0;
  const leftSurge = left.synthesis_codes.indexOf('RANK_SURGE') >= 0 ? 1 : 0;
  const rightSurge = right.synthesis_codes.indexOf('RANK_SURGE') >= 0 ? 1 : 0;
  if (leftSurge !== rightSurge) return rightSurge - leftSurge;
  if (leftRankGain !== rightRankGain) return rightRankGain - leftRankGain;
  const leftShareGain = Number(left.facts.current_purchase_share || 0)
    - Number(left.facts.previous_purchase_share || 0);
  const rightShareGain = Number(right.facts.current_purchase_share || 0)
    - Number(right.facts.previous_purchase_share || 0);
  if (leftShareGain !== rightShareGain) return rightShareGain - leftShareGain;
  const leftMarketPurchase = Number(left.facts.current_market_purchase || 0);
  const rightMarketPurchase = Number(right.facts.current_market_purchase || 0);
  if (leftMarketPurchase !== rightMarketPurchase) {
    return rightMarketPurchase - leftMarketPurchase;
  }
  return String(left.query_identity.raw).localeCompare(
    String(right.query_identity.raw)
  );
}

function sqpHumanKeep_(diagnostics, eligibleNarratives, selectedQueries, policy) {
  const positiveCodes = [
    'MULTI_STAGE_SHARE_GAIN',
    'SINGLE_STAGE_SHARE_GAIN',
    'DEMAND_UP_PURCHASE_SHARE_UP',
    'DEMAND_DOWN_PURCHASE_SHARE_UP',
    'RANK_SURGE'
  ];
  return eligibleNarratives.filter(function(narrative) {
    return !selectedQueries[narrative.query_identity.raw]
      && Number(narrative.facts.current_market_purchase)
        >= policy.keep_relevance_gate.minimum_market_purchase
      && Number(narrative.facts.current_query_volume)
        >= policy.keep_relevance_gate.minimum_query_volume
      && narrative.synthesis_codes.some(function(code) {
        return positiveCodes.indexOf(code) >= 0;
      });
  }).sort(sqpCompareKeepNarratives_).slice(0, policy.max_keep_items).map(function(narrative) {
    const facts = narrative.facts;
    const raw = narrative.query_identity.raw;
    const rankText = facts.previous_rank !== null && facts.current_rank !== null
      ? facts.previous_rank + '位 → ' + facts.current_rank + '位'
      : '順位は継続確認中';
    const previousShare = sqpDisplayPercent_(facts.previous_purchase_share);
    const currentShare = sqpDisplayPercent_(facts.current_purchase_share);
    const shareText = previousShare && currentShare
      ? '購入された割合も' + previousShare + ' → ' + currentShare + 'へ改善しています。'
      : '購入される割合も改善しています。';
    return Object.assign({
      display_id: sqpDisplayItemId_(diagnostics, 'KEEP', [raw]),
      decision: 'KEEP',
      title: '「' + raw + '」は現状維持',
      what: '今は商品ページを大きく変更せず、翌月も伸びるか確認します。',
      why: rankText + '。' + shareText,
      target_queries: [raw],
      cta: null
    }, sqpHumanSourceTrace_([narrative]));
  });
}

function sqpHumanPresentation_(
  diagnostics,
  headline,
  businessSyntheses,
  discovery,
  dataQuality
) {
  const policy = sqpDisplayPolicyV0_();
  const evaluation = sqpHumanEvaluation_(diagnostics, headline);
  const gateResults = businessSyntheses.map(function(narrative) {
    return {
      narrative: narrative,
      gate: sqpBusinessRelevanceGate_(narrative, policy)
    };
  });
  const eligible = gateResults.filter(function(result) {
    return result.gate.eligible;
  }).map(function(result) {
    return result.narrative;
  });
  const doNow = sqpHumanDoNow_(diagnostics, eligible, evaluation, policy);
  const keep = sqpHumanKeep_(
    diagnostics,
    eligible,
    doNow.selected_queries,
    policy
  );
  const usedNarrativeIds = Object.create(null);
  doNow.items.concat(keep).forEach(function(item) {
    item.source_narrative_ids.forEach(function(narrativeId) {
      usedNarrativeIds[narrativeId] = true;
    });
  });
  const hidden = [];
  gateResults.forEach(function(result) {
    if (!result.gate.eligible) {
      hidden.push({
        narrative_id: result.narrative.narrative_id,
        query_identity: result.narrative.query_identity,
        reasons: result.gate.suppression_reasons,
        threshold_facts: result.gate.threshold_facts,
        source_signal_ids: result.narrative.source_signal_ids
      });
    } else if (!usedNarrativeIds[result.narrative.narrative_id]) {
      hidden.push({
        narrative_id: result.narrative.narrative_id,
        query_identity: result.narrative.query_identity,
        reasons: ['PRESENTATION_LIMIT_OR_LOWER_PRIORITY'],
        threshold_facts: result.gate.threshold_facts,
        source_signal_ids: result.narrative.source_signal_ids
      });
    }
  });
  discovery.forEach(function(narrative) {
    hidden.push({
      narrative_id: narrative.narrative_id,
      query_identity: narrative.query_identity,
      reasons: ['HIGH_CHURN_DISCOVERY'],
      threshold_facts: narrative.facts,
      source_signal_ids: narrative.source_signal_ids
    });
  });
  const reasonCounts = hidden.reduce(function(counts, item) {
    item.reasons.forEach(function(reason) {
      counts[reason] = (counts[reason] || 0) + 1;
    });
    return counts;
  }, {});
  const selectedItems = doNow.items.concat(keep);
  const selectedSignalIds = [];
  selectedItems.forEach(function(item) {
    item.source_signal_ids.forEach(function(signalId) {
      if (selectedSignalIds.indexOf(signalId) < 0) selectedSignalIds.push(signalId);
    });
  });
  return {
    schema_version: 'search_market_decision_presentation_v1',
    display_policy: policy,
    evaluation: evaluation,
    do_now: doNow.items,
    keep: keep,
    ignore_for_now: {
      title: '今月は無視してOK',
      summary: '市場規模が小さい検索語や、Top100の細かな出入りは、今月の主要な判断材料から外しました。',
      hidden_count: hidden.length,
      reason_counts: reasonCounts
    },
    hidden_narratives: hidden,
    details: {
      headline_narrative_id: headline.narrative_id,
      data_quality_narrative_id: dataQuality.narrative_id
    },
    consultation_context: {
      asin: diagnostics.asin,
      period_key: diagnostics.period_key,
      evaluation: evaluation,
      selected_display_ids: selectedItems.map(function(item) {
        return item.display_id;
      }),
      source_narrative_ids: selectedItems.reduce(function(ids, item) {
        item.source_narrative_ids.forEach(function(id) {
          if (ids.indexOf(id) < 0) ids.push(id);
        });
        return ids;
      }, [headline.narrative_id]),
      source_signal_ids: selectedSignalIds,
      headline_facts: evaluation.facts
    },
    contract: {
      internal_narratives_preserved: true,
      signal_trace_preserved: true,
      formal_action_generated: false,
      gemini_used: false,
      duplicate_query_display: false
    }
  };
}

function sqpBuildSearchMarketNarrative_(diagnostics, signalResponse) {
  const policy = sqpNarrativePolicyV0_();
  const signals = sqpAllUsableSignalCandidates_(signalResponse);
  const byRaw = Object.create(null);
  signals.forEach(function(signal) {
    const raw = signal.query_identity.raw;
    if (!byRaw[raw]) byRaw[raw] = [];
    byRaw[raw].push(signal);
  });
  const businessSyntheses = [];
  const businessQueryMap = Object.create(null);
  Object.keys(byRaw).sort().forEach(function(raw) {
    const synthesis = sqpQuerySynthesis_(diagnostics, raw, byRaw[raw]);
    if (!synthesis) return;
    businessSyntheses.push(synthesis);
    businessQueryMap[raw] = true;
  });
  const discovery = sqpDiscoveryNarratives_(diagnostics, signals, businessQueryMap);
  const headline = sqpHeadlineNarrative_(diagnostics);
  const dataQuality = sqpDataQualityNarrative_(diagnostics, signals);
  const allItems = [
    headline
  ].concat(
    businessSyntheses,
    discovery,
    [dataQuality]
  );
  const selected = sqpSelectNarrativesBySection_(allItems, policy);
  const displayCount = Object.keys(selected.sections).reduce(function(total, section) {
    return total + selected.sections[section].length;
  }, 0);
  return {
    schema_version: 'search_market_narrative_v1',
    policy: policy,
    signal_policy_version: signalResponse.policy.policy_version,
    marketplace: diagnostics.marketplace,
    asin: diagnostics.asin,
    period_key: diagnostics.period_key,
    source_candidate_count: signalResponse.candidate_count,
    source_selected_signal_count: signalResponse.selected_count,
    source_suppressed_signal_count: signalResponse.suppressed_count,
    query_synthesis_count: businessSyntheses.length,
    discovery_count: discovery.length,
    display_item_count: displayCount,
    sections: selected.sections,
    suppressed_narratives: selected.suppressed,
    presentation: sqpHumanPresentation_(
      diagnostics,
      headline,
      businessSyntheses,
      discovery,
      dataQuality
    ),
    builder_contract: {
      query_identity: 'RAW_EXACT',
      includes_family_suppressed_candidates: true,
      data_quality_separated: true,
      entered_left_are_discovery_watch: true,
      matched_cohort_headline_priority: true,
      cross_query_score: false,
      gemini_used: false,
      action_generated: false
    }
  };
}

function getSearchMarketNarrative_(asinInput, periodKey, marketplaceInput, lookbackMonthsInput) {
  const diagnostics = getSearchMarketDiagnostics_(
    asinInput,
    periodKey,
    marketplaceInput,
    lookbackMonthsInput
  );
  const signals = sqpBuildCandidateSignalResponse_(diagnostics);
  return sqpBuildSearchMarketNarrative_(diagnostics, signals);
}
