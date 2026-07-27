// ============================================================
// Sponsored Products 画面エクスポート: 広告キーワード分析
// PR-AK2: server再parse / preview / raw Drive保存 / session index
// Candidate Engine・Gemini・UI接続は後続PRで実装する。
// ============================================================

const AKA_SESSION_SHEET_ = 'advertising_analysis_sessions';
const AKA_SESSION_HEADERS_ = [
  'session_id', 'asin', 'period_from', 'period_to', 'marketplace', 'status',
  'file_presence', 'target_file_id', 'target_file_sha256',
  'search_term_file_id', 'search_term_file_sha256',
  'target_row_count', 'search_term_row_count', 'selected_candidate_count',
  'policy_version', 'parser_version', 'result_drive_file_id',
  'created_by', 'created_at', 'updated_at'
];
const AKA_PARSER_VERSION_ = 'advertising_console_csv_v1';
const AKA_PREVIEW_SCHEMA_VERSION_ = 'advertising_keyword_analysis_preview_v1';
const AKA_SESSION_SCHEMA_VERSION_ = 'advertising_keyword_analysis_session_v1';
const AKA_MAX_FILE_BYTES_ = 5 * 1024 * 1024;
const AKA_ROAS_TOLERANCE_ = 0.000001;

const AKA_TARGET_COLUMNS_ = [
  ['state', '状態', ['状態', 'State']],
  ['keyword', 'キーワード', ['キーワード', 'Keyword']],
  ['match_type', 'ターゲットマッチタイプ', ['ターゲットマッチタイプ', 'Target match type']],
  ['status_code', 'ステータスコード', ['ステータスコード', 'Status code']],
  ['status', 'ステータス', ['ステータス', 'Status']],
  ['suggested_bid_low', '推奨入札額 (低)(JPY)', ['推奨入札額 (低)(JPY)', 'Suggested bid (low)(JPY)']],
  ['suggested_bid_mid', '推奨入札額 (中央値)(JPY)', ['推奨入札額 (中央値)(JPY)', 'Suggested bid (median)(JPY)']],
  ['suggested_bid_high', '推奨入札額 (高)(JPY)', ['推奨入札額 (高)(JPY)', 'Suggested bid (high)(JPY)']],
  ['current_bid', '入札額 (JPY)', ['入札額 (JPY)', 'Bid (JPY)']],
  ['impressions', 'インプレッション', ['インプレッション', 'Impressions']],
  ['top_of_search_share', '検索結果上部のインプレッションシェア', [
    '検索結果上部のインプレッションシェア', 'Top-of-search impression share'
  ]],
  ['spend', '合計費用 (JPY)', ['合計費用 (JPY)', 'Spend (JPY)']],
  ['orders', '商品購入数', ['商品購入数', 'Orders']],
  ['sales', '売上 (JPY)', ['売上 (JPY)', 'Sales (JPY)']],
  ['roas', 'ROAS', ['ROAS']]
];

const AKA_SEARCH_TERM_COLUMNS_ = [
  ['added_as', '次として追加：', ['次として追加：', '次として追加', 'Added as']],
  ['customer_search_term', 'お客様の検索用語', ['お客様の検索用語', 'Customer search term']],
  ['target_keyword', 'キーワード', ['キーワード', 'Keyword']],
  ['target_bid', 'ターゲットの入札額 (JPY)', ['ターゲットの入札額 (JPY)', 'Target bid (JPY)']],
  ['spend', '合計費用 (JPY)', ['合計費用 (JPY)', 'Spend (JPY)']],
  ['orders', '商品購入数', ['商品購入数', 'Orders']],
  ['sales', '売上 (JPY)', ['売上 (JPY)', 'Sales (JPY)']],
  ['roas', 'ROAS', ['ROAS']]
];

function akaIssue_(code, message, details) {
  return Object.assign({ severity: 'WARNING', code: code, message: message }, details || {});
}

function akaNormalizeHeader_(value) {
  let text = String(value == null ? '' : value).replace(/^\uFEFF/, '');
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.toLowerCase().replace(/[\s:：()（）_\-–—¥￥]/g, '');
}

function akaNormalizeQueryV1_(value) {
  let text = String(value == null ? '' : value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function akaParseCsv_(text) {
  const source = String(text == null ? '' : text);
  if (!source) throw new Error('CSVが空です。');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field) throw new Error('CSVの引用符形式が不正です。');
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      if (char === '\r' && source[index + 1] === '\n') index++;
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。');
  if (field || row.length) {
    row.push(field);
    records.push(row);
  }
  while (
    records.length
    && records[records.length - 1].every(function(value) { return !String(value).trim(); })
  ) {
    records.pop();
  }
  return records;
}

function akaResolveColumns_(headers, definitions, allowMissing) {
  const normalizedHeaders = headers.map(akaNormalizeHeader_);
  const columns = {};
  const used = {};
  const missing = [];
  definitions.forEach(function(definition) {
    const aliases = {};
    definition[2].forEach(function(alias) { aliases[akaNormalizeHeader_(alias)] = true; });
    const matches = [];
    normalizedHeaders.forEach(function(header, index) {
      if (aliases[header]) matches.push(index);
    });
    if (matches.length > 1) throw new Error('列「' + definition[1] + '」に一致するヘッダーが複数あります。');
    columns[definition[0]] = matches.length ? matches[0] : -1;
    if (!matches.length) missing.push(definition[1]);
    else used[matches[0]] = true;
  });
  if (missing.length && !allowMissing) throw new Error('必要な列がありません: ' + missing.join('、'));
  const unknown = headers.filter(function(value, index) {
    return !used[index] && String(value).trim();
  }).map(function(value) { return String(value).trim(); });
  return {
    columns: columns,
    recognized_count: Object.keys(used).length,
    missing: missing,
    issues: unknown.length
      ? [akaIssue_('UNKNOWN_COLUMNS', '未使用の列があります: ' + unknown.join('、'), { raw_values: unknown })]
      : []
  };
}

function akaDetectType_(headers) {
  const target = akaResolveColumns_(headers, AKA_TARGET_COLUMNS_, true);
  const search = akaResolveColumns_(headers, AKA_SEARCH_TERM_COLUMNS_, true);
  if (!target.missing.length) return 'sponsored_products_target';
  if (!search.missing.length) return 'sponsored_products_search_term';
  throw new Error('Sponsored ProductsのターゲットCSVまたは検索用語CSVとして列構造を認識できません。');
}

function akaAssertRows_(records) {
  if (records.length < 2) throw new Error('CSVにデータ行がありません。');
  const width = records[0].length;
  records.slice(1).forEach(function(row, index) {
    if (row.length !== width) throw new Error((index + 2) + '行目の列数がヘッダーと一致しません。');
  });
}

function akaIsNullToken_(raw) {
  const text = String(raw == null ? '' : raw).trim();
  return !text || /^[\-–—―−ー]+$/.test(text);
}

function akaNumber_(raw, label, rowNumber, integer) {
  if (akaIsNullToken_(raw)) return null;
  const normalized = String(raw).trim().replace(/[¥￥,%\s]/g, '');
  const value = Number(normalized);
  if (!isFinite(value) || value < 0 || (integer && Math.floor(value) !== value)) {
    throw new Error(rowNumber + '行目の「' + label + '」が不正です: ' + raw);
  }
  return value;
}

function akaMissingIssue_(value, label, rowNumber) {
  return value === null
    ? [akaIssue_('MISSING_VALUE', rowNumber + '行目の「' + label + '」は未報告です。0として扱いません。', {
      row_number: rowNumber, field: label
    })]
    : [];
}

function akaShare_(raw, label, rowNumber) {
  const text = String(raw == null ? '' : raw).trim();
  if (akaIsNullToken_(raw)) {
    return {
      value: null,
      issues: [akaIssue_('MISSING_SHARE', rowNumber + '行目の「' + label + '」は未報告です。0%として扱いません。', {
        row_number: rowNumber, field: label
      })]
    };
  }
  const match = text.match(/^(<=|>=|<|>)?\s*(\d+(?:\.\d+)?)\s*%?$/);
  if (!match) throw new Error(rowNumber + '行目の「' + label + '」が不正です: ' + raw);
  const value = Number(match[2]) / 100;
  if (!isFinite(value) || value < 0 || value > 1) {
    throw new Error(rowNumber + '行目の「' + label + '」が0〜100%の範囲外です: ' + raw);
  }
  const operator = match[1]
    ? ({ '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' })[match[1]]
    : 'EXACT';
  return {
    value: { raw: text, operator: operator, value: value },
    issues: operator === 'EXACT' ? [] : [
      akaIssue_('INTERVAL_SHARE', rowNumber + '行目の「' + label + '」は' + text + 'という範囲値です。境界値へ置き換えません。', {
        row_number: rowNumber, field: label, raw_values: [text]
      })
    ]
  };
}

function akaState_(raw, rowNumber) {
  const value = akaNormalizeHeader_(raw);
  if (value === '有効' || value === 'enabled') return { value: 'ENABLED', issues: [] };
  if (value === '一時停止' || value === 'paused') return { value: 'PAUSED', issues: [] };
  return {
    value: 'UNKNOWN',
    issues: [akaIssue_('UNKNOWN_STATE', rowNumber + '行目の状態「' + raw + '」を認識できません。', {
      row_number: rowNumber, field: '状態', raw_values: [String(raw)]
    })]
  };
}

function akaMatchType_(raw, rowNumber) {
  if (akaIsNullToken_(raw)) return { value: 'NOT_APPLICABLE', issues: [] };
  const value = akaNormalizeHeader_(raw);
  if (value === '完全一致' || value === 'exact') return { value: 'EXACT', issues: [] };
  if (value === 'フレーズ一致' || value === 'phrase') return { value: 'PHRASE', issues: [] };
  if (value === '部分一致' || value === 'broad') return { value: 'BROAD', issues: [] };
  return {
    value: 'UNKNOWN',
    issues: [akaIssue_('UNKNOWN_MATCH_TYPE', rowNumber + '行目のマッチタイプ「' + raw + '」を認識できません。', {
      row_number: rowNumber, field: 'ターゲットマッチタイプ', raw_values: [String(raw)]
    })]
  };
}

function akaAddedMatchType_(raw, rowNumber) {
  if (!String(raw == null ? '' : raw).trim()) {
    return {
      value: null,
      issues: [akaIssue_(
        'ADDED_AS_NOT_DECLARED',
        rowNumber + '行目の「次として追加」は空欄です。未追加とは断定しません。',
        { row_number: rowNumber, field: '次として追加：' }
      )]
    };
  }
  const value = akaNormalizeHeader_(raw);
  if (value === 'キーワード完全一致' || value === 'keywordexact') return { value: 'EXACT', issues: [] };
  if (value === 'キーワードフレーズ一致' || value === 'keywordphrase') return { value: 'PHRASE', issues: [] };
  if (value === 'キーワード部分一致' || value === 'keywordbroad') return { value: 'BROAD', issues: [] };
  return {
    value: 'UNKNOWN',
    issues: [akaIssue_('UNKNOWN_ADDED_AS', rowNumber + '行目の「次として追加」を認識できません: ' + raw, {
      row_number: rowNumber, field: '次として追加：', raw_values: [String(raw)]
    })]
  };
}

function akaPerformance_(spend, sales, roas, rowNumber) {
  const computedRoas = spend !== null && spend > 0 && sales !== null ? sales / spend : null;
  const computedAcos = sales !== null && sales > 0 && spend !== null ? spend / sales : null;
  const issues = [];
  if (roas !== null && computedRoas !== null && Math.abs(roas - computedRoas) > AKA_ROAS_TOLERANCE_) {
    issues.push(akaIssue_('ROAS_MISMATCH', rowNumber + '行目のROASが売上÷広告費と一致しません。', {
      row_number: rowNumber, field: 'ROAS', raw_values: [String(roas), String(computedRoas)]
    }));
  }
  return { roas: computedRoas, acos: computedAcos, issues: issues };
}

function akaTargetRow_(source, columns, rowNumber) {
  const stateRaw = source[columns.state] || '';
  const state = akaState_(stateRaw, rowNumber);
  const keywordRaw = source[columns.keyword] || '';
  if (!String(keywordRaw).trim()) throw new Error(rowNumber + '行目の「キーワード」が空です。');
  const matchRaw = source[columns.match_type] || '';
  const parsedMatch = akaMatchType_(matchRaw, rowNumber);
  const identity = String(keywordRaw).trim().toLowerCase();
  let entityType = /^(keyword-group|asin|category)=/.test(identity)
    ? 'PRODUCT_TARGET'
    : (['EXACT', 'PHRASE', 'BROAD'].indexOf(parsedMatch.value) >= 0 ? 'KEYWORD_TARGET' : 'UNKNOWN');
  const matchType = entityType === 'PRODUCT_TARGET' ? 'NOT_APPLICABLE' : parsedMatch.value;
  const low = akaNumber_(source[columns.suggested_bid_low], '推奨入札額 (低)(JPY)', rowNumber, false);
  const mid = akaNumber_(source[columns.suggested_bid_mid], '推奨入札額 (中央値)(JPY)', rowNumber, false);
  const high = akaNumber_(source[columns.suggested_bid_high], '推奨入札額 (高)(JPY)', rowNumber, false);
  if (low !== null && mid !== null && high !== null && (low > mid || mid > high)) {
    throw new Error(rowNumber + '行目の推奨入札額が低≤中央値≤高になっていません。');
  }
  const bid = akaNumber_(source[columns.current_bid], '入札額 (JPY)', rowNumber, false);
  const impressions = akaNumber_(source[columns.impressions], 'インプレッション', rowNumber, true);
  const share = akaShare_(source[columns.top_of_search_share], '検索結果上部のインプレッションシェア', rowNumber);
  const spend = akaNumber_(source[columns.spend], '合計費用 (JPY)', rowNumber, false);
  const orders = akaNumber_(source[columns.orders], '商品購入数', rowNumber, true);
  const sales = akaNumber_(source[columns.sales], '売上 (JPY)', rowNumber, false);
  const roas = akaNumber_(source[columns.roas], 'ROAS', rowNumber, false);
  const performance = akaPerformance_(spend, sales, roas, rowNumber);
  let issues = state.issues.concat(parsedMatch.issues)
    .concat(akaMissingIssue_(low, '推奨入札額 (低)(JPY)', rowNumber))
    .concat(akaMissingIssue_(mid, '推奨入札額 (中央値)(JPY)', rowNumber))
    .concat(akaMissingIssue_(high, '推奨入札額 (高)(JPY)', rowNumber))
    .concat(akaMissingIssue_(bid, '入札額 (JPY)', rowNumber))
    .concat(akaMissingIssue_(impressions, 'インプレッション', rowNumber))
    .concat(share.issues)
    .concat(akaMissingIssue_(spend, '合計費用 (JPY)', rowNumber))
    .concat(akaMissingIssue_(orders, '商品購入数', rowNumber))
    .concat(akaMissingIssue_(sales, '売上 (JPY)', rowNumber))
    .concat(akaMissingIssue_(roas, 'ROAS', rowNumber))
    .concat(performance.issues);
  if (entityType === 'UNKNOWN') {
    issues.push(akaIssue_('UNKNOWN_ENTITY_TYPE', rowNumber + '行目をキーワードtargetか商品targetか判定できません。', {
      row_number: rowNumber, field: 'キーワード', raw_values: [keywordRaw, matchRaw]
    }));
  }
  return {
    source_row_number: rowNumber,
    entity_type: entityType,
    state_raw: stateRaw,
    state: state.value,
    keyword_raw: keywordRaw,
    keyword_normalized: akaNormalizeQueryV1_(keywordRaw),
    normalization_version: 'query_norm_v1',
    match_type_raw: matchRaw,
    match_type: matchType,
    status_code_raw: source[columns.status_code] || '',
    status_raw: source[columns.status] || '',
    suggested_bid_low_yen: low,
    suggested_bid_mid_yen: mid,
    suggested_bid_high_yen: high,
    current_bid_yen: bid,
    impressions: impressions,
    top_of_search_impression_share: share.value,
    spend_yen: spend,
    orders: orders,
    sales_yen: sales,
    roas_reported: roas,
    roas_computed: performance.roas,
    acos_computed: performance.acos,
    issues: issues
  };
}

function akaSearchTermRow_(source, columns, rowNumber) {
  const addedRaw = source[columns.added_as] || '';
  const added = akaAddedMatchType_(addedRaw, rowNumber);
  const termRaw = source[columns.customer_search_term] || '';
  const keywordRaw = source[columns.target_keyword] || '';
  if (!String(termRaw).trim()) throw new Error(rowNumber + '行目の「お客様の検索用語」が空です。');
  if (!String(keywordRaw).trim()) throw new Error(rowNumber + '行目の「キーワード」が空です。');
  const bid = akaNumber_(source[columns.target_bid], 'ターゲットの入札額 (JPY)', rowNumber, false);
  const spend = akaNumber_(source[columns.spend], '合計費用 (JPY)', rowNumber, false);
  const orders = akaNumber_(source[columns.orders], '商品購入数', rowNumber, true);
  const sales = akaNumber_(source[columns.sales], '売上 (JPY)', rowNumber, false);
  const roas = akaNumber_(source[columns.roas], 'ROAS', rowNumber, false);
  const performance = akaPerformance_(spend, sales, roas, rowNumber);
  return {
    source_row_number: rowNumber,
    added_as_raw: addedRaw,
    added_match_type: added.value,
    customer_search_term_raw: termRaw,
    customer_search_term_normalized: akaNormalizeQueryV1_(termRaw),
    target_keyword_raw: keywordRaw,
    target_keyword_normalized: akaNormalizeQueryV1_(keywordRaw),
    normalization_version: 'query_norm_v1',
    target_bid_yen: bid,
    spend_yen: spend,
    orders: orders,
    sales_yen: sales,
    roas_reported: roas,
    roas_computed: performance.roas,
    acos_computed: performance.acos,
    issues: added.issues
      .concat(akaMissingIssue_(bid, 'ターゲットの入札額 (JPY)', rowNumber))
      .concat(akaMissingIssue_(spend, '合計費用 (JPY)', rowNumber))
      .concat(akaMissingIssue_(orders, '商品購入数', rowNumber))
      .concat(akaMissingIssue_(sales, '売上 (JPY)', rowNumber))
      .concat(akaMissingIssue_(roas, 'ROAS', rowNumber))
      .concat(performance.issues)
  };
}

function akaNormalizationStats_(values) {
  const groups = {};
  values.forEach(function(item) {
    if (!groups[item.normalized]) groups[item.normalized] = {};
    groups[item.normalized][item.raw] = true;
  });
  const collisions = Object.keys(groups).filter(function(normalized) {
    return Object.keys(groups[normalized]).length > 1;
  }).map(function(normalized) {
    return { normalized_value: normalized, raw_values: Object.keys(groups[normalized]) };
  });
  return { normalized_count: Object.keys(groups).length, collisions: collisions };
}

function akaBaseReportIssues_() {
  return [
    akaIssue_('PARTIAL_UNIVERSE_COVERAGE', '画面エクスポートが広告アカウント・キャンペーン内の全行を含む保証はありません。'),
    akaIssue_('MISSING_SCOPE_IDENTITY', 'CSVにASIN、対象期間、キャンペーン、広告グループ、target IDがないため、分析時に別途確認が必要です。'),
    akaIssue_('MISSING_CLICK_METRICS', 'Click、CPC、CTR、広告CVRがないため、停止・除外判断は限定されます。')
  ];
}

function akaParseTarget_(records, filename, encoding) {
  akaAssertRows_(records);
  const resolved = akaResolveColumns_(records[0], AKA_TARGET_COLUMNS_, false);
  const rows = records.slice(1).map(function(row, index) {
    return akaTargetRow_(row, resolved.columns, index + 2);
  });
  const normalization = akaNormalizationStats_(rows.map(function(row) {
    return { raw: row.keyword_raw, normalized: row.keyword_normalized };
  }));
  const logical = {};
  const rawMatchTypes = {};
  rows.forEach(function(row) {
    const key = row.entity_type + '\u0000' + row.keyword_raw + '\u0000' + row.match_type;
    logical[key] = (logical[key] || 0) + 1;
    if (row.entity_type === 'KEYWORD_TARGET') {
      if (!rawMatchTypes[row.keyword_raw]) rawMatchTypes[row.keyword_raw] = {};
      rawMatchTypes[row.keyword_raw][row.match_type] = true;
    }
  });
  const duplicateCount = Object.keys(logical).filter(function(key) { return logical[key] > 1; }).length;
  const multiMatch = Object.keys(rawMatchTypes).filter(function(raw) {
    return Object.keys(rawMatchTypes[raw]).length > 1;
  });
  let issues = resolved.issues.concat([].concat.apply([], rows.map(function(row) { return row.issues; })));
  normalization.collisions.forEach(function(collision) {
    issues.push(akaIssue_(
      'NORMALIZATION_COLLISION',
      '異なるキーワード原文が同じ正規化値「' + collision.normalized_value + '」になります。原文を統合しません。',
      { raw_values: collision.raw_values }
    ));
  });
  multiMatch.forEach(function(raw) {
    issues.push(akaIssue_(
      'MULTIPLE_MATCH_TYPES_FOR_KEYWORD',
      'キーワード「' + raw + '」に複数のマッチタイプがあります。キーワード文字列だけでJOINしません。',
      { raw_values: Object.keys(rawMatchTypes[raw]) }
    ));
  });
  if (duplicateCount) {
    issues.push(akaIssue_(
      'DUPLICATE_LOGICAL_TARGET_KEY',
      '同じキーワード原文・マッチタイプのtargetが複数あります。campaign等のidentityなしでは統合しません。'
    ));
  }
  issues = issues.concat(akaBaseReportIssues_());
  return {
    type: 'sponsored_products_target',
    file_name: filename,
    encoding: encoding,
    rows: rows,
    issues: issues,
    stats: {
      returned_row_count: rows.length,
      source_column_count: records[0].length,
      recognized_column_count: resolved.recognized_count,
      enabled_count: rows.filter(function(row) { return row.state === 'ENABLED'; }).length,
      paused_count: rows.filter(function(row) { return row.state === 'PAUSED'; }).length,
      keyword_target_count: rows.filter(function(row) { return row.entity_type === 'KEYWORD_TARGET'; }).length,
      product_target_count: rows.filter(function(row) { return row.entity_type === 'PRODUCT_TARGET'; }).length,
      unknown_entity_count: rows.filter(function(row) { return row.entity_type === 'UNKNOWN'; }).length,
      spend_row_count: rows.filter(function(row) { return (row.spend_yen || 0) > 0; }).length,
      order_row_count: rows.filter(function(row) { return (row.orders || 0) > 0; }).length,
      normalized_keyword_count: normalization.normalized_count,
      normalization_collision_count: normalization.collisions.length,
      normalization_collisions: normalization.collisions,
      duplicate_logical_key_count: duplicateCount,
      multiple_match_type_keyword_count: multiMatch.length
    }
  };
}

function akaParseSearchTerm_(records, filename, encoding) {
  akaAssertRows_(records);
  const resolved = akaResolveColumns_(records[0], AKA_SEARCH_TERM_COLUMNS_, false);
  const rows = records.slice(1).map(function(row, index) {
    return akaSearchTermRow_(row, resolved.columns, index + 2);
  });
  const normalization = akaNormalizationStats_(rows.map(function(row) {
    return { raw: row.customer_search_term_raw, normalized: row.customer_search_term_normalized };
  }));
  const rawCounts = {};
  rows.forEach(function(row) {
    rawCounts[row.customer_search_term_raw] = (rawCounts[row.customer_search_term_raw] || 0) + 1;
  });
  const duplicateCount = Object.keys(rawCounts).filter(function(raw) { return rawCounts[raw] > 1; }).length;
  let issues = resolved.issues.concat([].concat.apply([], rows.map(function(row) { return row.issues; })));
  normalization.collisions.forEach(function(collision) {
    issues.push(akaIssue_(
      'NORMALIZATION_COLLISION',
      '異なる検索用語原文が同じ正規化値「' + collision.normalized_value + '」になります。原文を統合しません。',
      { raw_values: collision.raw_values }
    ));
  });
  if (duplicateCount) {
    issues.push(akaIssue_(
      'DUPLICATE_SEARCH_TERM',
      '同じ検索用語原文が複数行あります。target identityなしでは統合しません。'
    ));
  }
  issues = issues.concat(akaBaseReportIssues_());
  return {
    type: 'sponsored_products_search_term',
    file_name: filename,
    encoding: encoding,
    rows: rows,
    issues: issues,
    stats: {
      returned_row_count: rows.length,
      source_column_count: records[0].length,
      recognized_column_count: resolved.recognized_count,
      declared_exact_count: rows.filter(function(row) { return row.added_match_type === 'EXACT'; }).length,
      declared_phrase_count: rows.filter(function(row) { return row.added_match_type === 'PHRASE'; }).length,
      declared_broad_count: rows.filter(function(row) { return row.added_match_type === 'BROAD'; }).length,
      undeclared_added_as_count: rows.filter(function(row) { return row.added_match_type === null; }).length,
      spend_row_count: rows.filter(function(row) { return (row.spend_yen || 0) > 0; }).length,
      order_row_count: rows.filter(function(row) { return (row.orders || 0) > 0; }).length,
      normalized_search_term_count: normalization.normalized_count,
      normalization_collision_count: normalization.collisions.length,
      normalization_collisions: normalization.collisions,
      duplicate_search_term_count: duplicateCount
    }
  };
}

function akaSha256BytesHex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(value) {
    return ('0' + ((Number(value) + 256) % 256).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

function akaFileValue_(input, camelName, snakeName) {
  return input && input[camelName] !== undefined ? input[camelName] : (input ? input[snakeName] : undefined);
}

function akaDecodeFile_(input, expectedType) {
  if (!input || typeof input !== 'object') throw new Error('分析対象CSVが必要です。');
  const filename = String(akaFileValue_(input, 'fileName', 'file_name') || '').trim();
  const rawBase64 = String(akaFileValue_(input, 'rawBase64', 'raw_base64') || '');
  const suppliedSha = String(akaFileValue_(input, 'fileSha256', 'file_sha256') || '').trim().toUpperCase();
  if (!filename || !/\.csv$/i.test(filename)) throw new Error('Sponsored Productsの画面エクスポートはCSV形式を選択してください。');
  if (!rawBase64) throw new Error(filename + ' のrawBase64が必要です。');
  if (!/^[A-F0-9]{64}$/.test(suppliedSha)) throw new Error(filename + ' のfileSha256が不正です。');
  let bytes;
  try {
    bytes = Utilities.base64Decode(rawBase64);
  } catch (error) {
    throw new Error(filename + ' のbase64を復号できません。');
  }
  if (!bytes.length) throw new Error(filename + ' は空です。');
  if (bytes.length > AKA_MAX_FILE_BYTES_) throw new Error(filename + ' は5MB以下にしてください。');
  const actualSha = akaSha256BytesHex_(bytes);
  if (actualSha !== suppliedSha) throw new Error(filename + ' のfileSha256が原本CSVと一致しません。');

  const blob = Utilities.newBlob(bytes);
  const attempts = [
    { encoding: 'UTF-8', text: blob.getDataAsString('UTF-8') },
    { encoding: 'Shift_JIS', text: blob.getDataAsString('Shift_JIS') }
  ];
  let parsed = null;
  let lastError = null;
  for (let index = 0; index < attempts.length; index++) {
    let records;
    let type;
    try {
      records = akaParseCsv_(attempts[index].text);
      if (!records.length) throw new Error('CSVが空です。');
      type = akaDetectType_(records[0]);
    } catch (error) {
      lastError = error;
      continue;
    }
    try {
      const report = type === 'sponsored_products_target'
        ? akaParseTarget_(records, filename, attempts[index].encoding)
        : akaParseSearchTerm_(records, filename, attempts[index].encoding);
      parsed = {
        report: report,
        bytes: bytes,
        raw_base64: rawBase64,
        file_name: filename,
        file_sha256: actualSha
      };
      break;
    } catch (error) {
      throw new Error(filename + ' の内容が不正です: ' + error.message);
    }
  }
  if (!parsed) {
    throw new Error(filename + ' をUTF-8またはShift_JISのSponsored Products CSVとして解析できません: '
      + String(lastError && lastError.message ? lastError.message : lastError));
  }
  if (parsed.report.type !== expectedType) {
    throw new Error(filename + ' は指定欄と異なる種類のCSVです。');
  }
  return parsed;
}

function akaIsoDate_(value, label) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(label + ' はYYYY-MM-DD形式で指定してください。');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(label + ' が実在する日付ではありません。');
  }
  return text;
}

function akaDeduplicateIssues_(issues) {
  const seen = {};
  return issues.filter(function(issue) {
    const key = [
      issue.code, issue.row_number || '', issue.field || '',
      JSON.stringify(issue.raw_values || [])
    ].join('\u0000');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function akaPrepare_(request) {
  if (!request || typeof request !== 'object') throw new Error('広告キーワード分析requestが必要です。');
  const asin = String(request.asin || '').trim().toUpperCase();
  const marketplace = String(request.marketplace || 'JP').trim().toUpperCase();
  const periodFrom = akaIsoDate_(request.periodFrom || request.period_from, 'periodFrom');
  const periodTo = akaIsoDate_(request.periodTo || request.period_to, 'periodTo');
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('ASINが不正です。');
  if (marketplace !== 'JP') throw new Error('PR-AK2で対応しているmarketplaceはJPのみです。');
  if (periodFrom > periodTo) throw new Error('periodFromはperiodTo以前にしてください。');
  let targetAcos = request.targetAcos !== undefined ? request.targetAcos : request.target_acos;
  if (targetAcos === '' || targetAcos === undefined || targetAcos === null) targetAcos = null;
  else {
    targetAcos = Number(targetAcos);
    if (!isFinite(targetAcos) || targetAcos < 0 || targetAcos > 1) {
      throw new Error('targetAcosは0〜1で指定してください。');
    }
  }

  const targetInput = request.targetFile || request.target_file || null;
  const searchInput = request.searchTermFile || request.search_term_file || null;
  if (!targetInput && !searchInput) throw new Error('ターゲットCSVまたは検索用語CSVを1つ以上指定してください。');
  const target = targetInput ? akaDecodeFile_(targetInput, 'sponsored_products_target') : null;
  const search = searchInput ? akaDecodeFile_(searchInput, 'sponsored_products_search_term') : null;
  const presence = target && search
    ? 'TARGET_AND_SEARCH_TERM'
    : (target ? 'TARGET_ONLY' : 'SEARCH_TERM_ONLY');
  let warnings = [];
  if (target) warnings = warnings.concat(target.report.issues);
  if (search) warnings = warnings.concat(search.report.issues);
  if (!target) warnings.push(akaIssue_('TARGET_FILE_NOT_PROVIDED', 'ターゲットCSVがないため、既存キーワードの入札判断はできません。'));
  if (!search) warnings.push(akaIssue_('SEARCH_TERM_FILE_NOT_PROVIDED', '検索用語CSVがないため、新規完全一致候補の判断はできません。'));
  warnings = akaDeduplicateIssues_(warnings);

  const metadata = {
    source_type: 'AMAZON_ADS_CONSOLE_EXPORT',
    marketplace: 'JP',
    currency: 'JPY',
    asin: asin,
    period_from: periodFrom,
    period_to: periodTo,
    exported_at: null,
    target_acos: targetAcos,
    target_filename: target ? target.file_name : null,
    target_file_sha256: target ? target.file_sha256 : null,
    search_term_filename: search ? search.file_name : null,
    search_term_file_sha256: search ? search.file_sha256 : null,
    file_scope_status: 'COMPLETE',
    universe_coverage: 'PARTIAL_UNKNOWN',
    returned_target_count: target ? target.report.rows.length : 0,
    returned_search_term_count: search ? search.report.rows.length : 0
  };
  const preview = {
    schema_version: AKA_PREVIEW_SCHEMA_VERSION_,
    parser_version: AKA_PARSER_VERSION_,
    is_valid: true,
    file_presence: presence,
    metadata: metadata,
    data_usability: {
      existing_bid_decision: target ? 'VALID' : 'INVALID',
      new_exact_decision: search ? 'VALID' : 'INVALID',
      negative_decision: search ? 'LIMITED' : 'INVALID',
      search_market_join: 'VALID',
      longitudinal_comparison: 'LIMITED'
    },
    reports: {
      target: target ? target.report : null,
      search_term: search ? search.report : null
    },
    file_audit: [target, search].filter(Boolean).map(function(file) {
      return {
        type: file.report.type,
        file_name: file.file_name,
        file_sha256: file.file_sha256,
        encoding: file.report.encoding,
        row_count: file.report.rows.length,
        source_column_count: file.report.stats.source_column_count
      };
    }),
    warnings: warnings
  };
  return { preview: preview, target: target, search: search };
}

function previewAdvertisingKeywordAnalysis(request) {
  return akaPrepare_(request).preview;
}

function akaSubfolder_(parent, name) {
  const iterator = parent.getFoldersByName(name);
  return iterator.hasNext() ? iterator.next() : parent.createFolder(name);
}

function akaSafeFilename_(value) {
  return String(value || 'report.csv').replace(/[\/\\:*?"<>|]/g, '_');
}

function akaActor_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (error) {
    return '';
  }
}

function akaEnsureSessionSheet_() {
  ensureHeaders_(AKA_SESSION_SHEET_, AKA_SESSION_HEADERS_);
  const sheet = getSheetByName_(AKA_SESSION_SHEET_, AKA_SESSION_HEADERS_);
  return { sheet: sheet, headers: getHeaders_(sheet, AKA_SESSION_HEADERS_) };
}

function akaAppendSessionIndex_(session) {
  const ref = akaEnsureSessionSheet_();
  const record = {
    session_id: session.session_id,
    asin: session.preview.metadata.asin,
    period_from: session.preview.metadata.period_from,
    period_to: session.preview.metadata.period_to,
    marketplace: session.preview.metadata.marketplace,
    status: session.status,
    file_presence: session.preview.file_presence,
    target_file_id: session.target_file_id || '',
    target_file_sha256: session.preview.metadata.target_file_sha256 || '',
    search_term_file_id: session.search_term_file_id || '',
    search_term_file_sha256: session.preview.metadata.search_term_file_sha256 || '',
    target_row_count: session.preview.metadata.returned_target_count,
    search_term_row_count: session.preview.metadata.returned_search_term_count,
    selected_candidate_count: 0,
    policy_version: session.policy_version,
    parser_version: session.preview.parser_version,
    result_drive_file_id: session.result_drive_file_id,
    created_by: session.audit.created_by,
    created_at: session.created_at,
    updated_at: session.updated_at
  };
  ref.sheet.appendRow(ref.headers.map(function(header) {
    return record[header] !== undefined && record[header] !== null ? record[header] : '';
  }));
}

function runAdvertisingKeywordAnalysis(request) {
  // 書込み前に全ファイルを再parse・SHA検証する。invalid入力はDrive/Sheetへ一切保存しない。
  const prepared = akaPrepare_(request);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let sessionFolder = null;
  try {
    if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID が未設定です。');
    const sessionId = 'AKA-' + Utilities.getUuid();
    const now = new Date().toISOString();
    const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const analysisRoot = akaSubfolder_(root, 'advertising_keyword_analysis');
    const sessionsRoot = akaSubfolder_(analysisRoot, 'sessions');
    sessionFolder = sessionsRoot.createFolder(sessionId);
    let targetFileId = null;
    let searchFileId = null;
    if (prepared.target) {
      targetFileId = sessionFolder.createFile(Utilities.newBlob(
        prepared.target.bytes,
        'text/csv',
        'raw_target__' + akaSafeFilename_(prepared.target.file_name)
      )).getId();
    }
    if (prepared.search) {
      searchFileId = sessionFolder.createFile(Utilities.newBlob(
        prepared.search.bytes,
        'text/csv',
        'raw_search_term__' + akaSafeFilename_(prepared.search.file_name)
      )).getId();
    }
    const session = {
      schema_version: AKA_SESSION_SCHEMA_VERSION_,
      session_id: sessionId,
      status: 'SNAPSHOT_SAVED',
      preview: prepared.preview,
      target_file_id: targetFileId,
      search_term_file_id: searchFileId,
      result_drive_file_id: '',
      selected_candidate_count: 0,
      policy_version: 'NOT_RUN_PR_AK2',
      created_at: now,
      updated_at: now,
      audit: {
        created_by: akaActor_(),
        raw_files_preserved: true,
        client_preview_trusted: false,
        server_reparsed_at: now
      }
    };
    const resultFile = sessionFolder.createFile(Utilities.newBlob(
      JSON.stringify(session),
      'application/json',
      'parsed_snapshot.json'
    ));
    session.result_drive_file_id = resultFile.getId();
    resultFile.setContent(JSON.stringify(session));
    akaAppendSessionIndex_(session);
    return session;
  } catch (error) {
    // このrunが作った未index化folderだけをゴミ箱へ移し、部分保存を残さない。
    if (sessionFolder && typeof sessionFolder.setTrashed === 'function') {
      try { sessionFolder.setTrashed(true); } catch (cleanupError) { Logger.log(cleanupError.message); }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function getAdvertisingKeywordAnalysis_(sessionIdValue) {
  const sessionId = String(sessionIdValue || '').trim();
  if (!/^AKA-[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('sessionIdが不正です。');
  const ref = akaEnsureSessionSheet_();
  const values = ref.sheet.getDataRange().getValues();
  const sessionIndex = ref.headers.indexOf('session_id');
  const fileIndex = ref.headers.indexOf('result_drive_file_id');
  const row = values.slice(1).find(function(value) {
    return String(value[sessionIndex]) === sessionId;
  });
  if (!row) throw new Error('広告キーワード分析sessionが見つかりません。');
  const fileId = String(row[fileIndex] || '');
  if (!fileId) throw new Error('広告キーワード分析sessionのDrive正本がありません。');
  try {
    return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
  } catch (error) {
    throw new Error('広告キーワード分析sessionを読み込めません: ' + error.message);
  }
}
