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
const AKA_ANALYSIS_SCHEMA_VERSION_ = 'advertising_keyword_analysis_v1';
const AKA_POLICY_VERSION_ = 'advertising_keyword_decision_v0';
const AKA_MAX_FILE_BYTES_ = 5 * 1024 * 1024;
const AKA_ROAS_TOLERANCE_ = 0.000001;
const AKA_POLICY_ = {
  policy_version: AKA_POLICY_VERSION_,
  bid_raise_step_ratio: 0.10,
  bid_lower_step_ratio: 0.10,
  family_selection_limits: {
    EXISTING_BID: 5,
    NEW_EXACT: 3,
    NEGATIVE_REVIEW: 0,
    MAINTAIN: 3,
    DATA_QUALITY: 5
  },
  selection_scope: 'WITHIN_EACH_CANDIDATE_FAMILY',
  cross_family_ranking: false,
  recommendation_primary: 'DIRECTION_AND_REASON',
  numeric_bid_is_test_value: true,
  numeric_bid_role: 'USER_ADJUSTABLE_REFERENCE',
  inventory_caution_suppresses_direction: false,
  search_market_reference_rule: 'LATEST_AVAILABLE_ON_OR_BEFORE_AD_PERIOD',
  click_metrics_required_for_negative: true
};

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

function akaNullableNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

function akaFact_(code, value, source, scope, unit) {
  return {
    code: code,
    value: value === undefined ? null : value,
    source: source,
    scope: scope,
    unit: unit || null
  };
}

function akaSha256TextHex_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset ? Utilities.Charset.UTF_8 : undefined
  ).map(function(byte) {
    return ('0' + ((Number(byte) + 256) % 256).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

function akaCandidateId_(family, decision, raw, matchType, sourceRow) {
  return 'AKC-' + akaSha256TextHex_([
    AKA_POLICY_VERSION_, family, decision, raw || '', matchType || '', sourceRow || ''
  ].join('\n')).slice(0, 20);
}

function akaBidDirection_(decision) {
  if (decision === 'RAISE_TEST') return 'RAISE';
  if (decision === 'LOWER_TEST') return 'LOWER';
  if (decision === 'ADD_EXACT') return 'ADD';
  if (decision === 'HOLD') return 'HOLD';
  if (decision === 'PAUSE_REVIEW') return 'REVIEW';
  return 'NONE';
}

function akaCandidate_(input) {
  const candidate = {
    candidate_id: akaCandidateId_(
      input.family,
      input.decision,
      input.keyword_raw || input.search_term_raw,
      input.match_type,
      input.source_row_number
    ),
    family: input.family,
    decision: input.decision,
    bid_direction: akaBidDirection_(input.decision),
    direction_reason_codes: input.direction_reason_codes || [],
    keyword_raw: input.keyword_raw || '',
    search_term_raw: input.search_term_raw || null,
    match_type: input.match_type || 'UNKNOWN',
    current_bid_yen: input.current_bid_yen === undefined ? null : input.current_bid_yen,
    proposed_bid_yen: input.proposed_bid_yen === undefined ? null : input.proposed_bid_yen,
    proposed_bid_range_yen: input.proposed_bid_range_yen || null,
    bid_basis: input.bid_basis || null,
    numeric_bid_role: input.proposed_bid_yen === undefined || input.proposed_bid_yen === null
      ? 'NONE'
      : 'USER_ADJUSTABLE_REFERENCE',
    operational_cautions: input.operational_cautions || [],
    data_usability: input.data_usability || 'LIMITED',
    evidence_status: input.data_usability === 'VALID' ? 'USABLE' : (
      input.data_usability === 'INVALID' ? 'UNUSABLE' : 'LIMITED'
    ),
    facts: input.facts || [],
    missing_information: input.missing_information || [],
    suppression_reason: input.suppression_reason || null,
    priority_basis: input.priority_basis || [],
    policy_version: AKA_POLICY_VERSION_,
    source: {
      target_row_number: input.target_row_number || null,
      search_term_row_number: input.search_term_row_number || null,
      search_market_query_raw: input.search_market_query_raw || null
    },
    join: input.join || null,
    execution_status: input.execution_status || 'NOT_APPLIED',
    previous_candidate_id: input.previous_candidate_id || null,
    selected: false,
    selection_reason: null,
    _priority: input.priority || []
  };
  return candidate;
}

function akaMonthDistance_(fromPeriod, toPeriod) {
  const from = String(fromPeriod || '').match(/^(\d{4})-(\d{2})$/);
  const to = String(toPeriod || '').match(/^(\d{4})-(\d{2})$/);
  if (!from || !to) return null;
  return (Number(to[1]) * 12 + Number(to[2])) - (Number(from[1]) * 12 + Number(from[2]));
}

function akaLatestSearchMarketReference_(asinValue, marketplaceValue, advertisingPeriod) {
  const index = getSearchMarketPeriods_();
  const asin = String(asinValue || '').trim().toUpperCase();
  const marketplace = String(marketplaceValue || '').trim().toUpperCase();
  const items = index && Array.isArray(index.asins) ? index.asins : [];
  const item = items.filter(function(candidate) {
    return String(candidate.asin || '').trim().toUpperCase() === asin
      && (!marketplace || String(candidate.marketplace || '').trim().toUpperCase() === marketplace);
  })[0] || null;
  if (!item || !Array.isArray(item.periods)) return null;
  const eligible = item.periods.map(function(period) {
    return String(period || '').trim();
  }).filter(function(period) {
    return /^\d{4}-\d{2}$/.test(period) && period <= advertisingPeriod;
  }).sort();
  if (!eligible.length) return null;
  const referencePeriod = eligible[eligible.length - 1];
  return {
    rule: AKA_POLICY_.search_market_reference_rule,
    advertising_period: advertisingPeriod,
    reference_period: referencePeriod,
    lag_months: akaMonthDistance_(referencePeriod, advertisingPeriod),
    is_same_period: referencePeriod === advertisingPeriod
  };
}

function akaOperationalCautions_(central) {
  const inventory = central && central.monthly && central.monthly.inventory;
  if (!inventory || !String(inventory.alert || '').trim()) return [];
  const alert = String(inventory.alert);
  if (/適正/.test(alert) && !/至急|注意|警告|欠品/.test(alert)) return [];
  return [{
    code: 'INVENTORY_ATTENTION',
    severity: 'WARNING',
    message: alert,
    suppresses_bid_direction: false,
    facts: {
      available: akaNullableNumber_(inventory.available),
      inbound: akaNullableNumber_(inventory.inbound),
      days_remain: akaNullableNumber_(inventory.days_remain),
      snapshot_date: inventory.snapshot_date || null
    }
  }];
}

function akaLoadCentralContext_(metadata) {
  const periodKey = String(metadata.period_to || '').slice(0, 7);
  const warnings = [];
  let monthly = null;
  let searchMarket = null;
  let searchMarketReference = null;
  try {
    const monthlyResponse = getProductMonthlyData_(metadata.asin, 1, periodKey);
    monthly = monthlyResponse && Array.isArray(monthlyResponse.points)
      ? monthlyResponse.points.filter(function(point) { return String(point.period) === periodKey; })[0] || null
      : null;
    if (!monthly) warnings.push(akaIssue_(
      'CENTRAL_MONTHLY_NOT_AVAILABLE',
      '対象ASIN・月の商品月次データが見つかりません。商品採算guardrailはLIMITEDです。'
    ));
  } catch (error) {
    warnings.push(akaIssue_(
      'CENTRAL_MONTHLY_NOT_AVAILABLE',
      '商品月次データを取得できません: ' + String(error && error.message ? error.message : error)
    ));
  }
  try {
    searchMarketReference = akaLatestSearchMarketReference_(
      metadata.asin,
      metadata.marketplace,
      periodKey
    );
    if (!searchMarketReference) throw new Error('広告対象月以前の検索市場データがありません。');
    searchMarket = getSearchMarketSummary_(
      metadata.asin,
      searchMarketReference.reference_period,
      metadata.marketplace
    );
  } catch (error) {
    warnings.push(akaIssue_(
      'SEARCH_MARKET_NOT_AVAILABLE',
      '対象ASINで利用可能な最新検索市場データを取得できません: '
        + String(error && error.message ? error.message : error)
    ));
  }
  return {
    period_key: periodKey,
    monthly: monthly,
    monthly_scope: 'ASIN_PERIOD_GUARDRAIL_NOT_QUERY_ALLOCATION',
    search_market: searchMarket,
    search_market_reference: searchMarketReference,
    warnings: warnings
  };
}

function akaBuildTargetSearchTermJoins_(targetRows, searchRows) {
  const keywordTargets = targetRows.filter(function(row) {
    return row.entity_type === 'KEYWORD_TARGET';
  });
  const byRaw = {};
  keywordTargets.forEach(function(row) {
    if (!byRaw[row.keyword_raw]) byRaw[row.keyword_raw] = [];
    byRaw[row.keyword_raw].push(row);
  });
  return searchRows.map(function(searchRow) {
    const rawCandidates = byRaw[searchRow.target_keyword_raw] || [];
    let candidates = rawCandidates.slice();
    let method = 'UNJOINED';
    let usability = 'LIMITED';
    let reason = null;
    if (searchRow.added_match_type && searchRow.added_match_type !== 'UNKNOWN') {
      candidates = rawCandidates.filter(function(target) {
        return target.match_type === searchRow.added_match_type;
      });
      if (candidates.length === 1) {
        method = 'RAW_AND_DECLARED_MATCH_TYPE';
        usability = 'VALID';
      } else if (candidates.length > 1) {
        method = 'AMBIGUOUS';
        reason = 'DUPLICATE_LOGICAL_TARGET';
      } else {
        reason = 'DECLARED_MATCH_TARGET_NOT_FOUND';
      }
    } else if (rawCandidates.length === 1) {
      candidates = rawCandidates;
      method = 'RAW_UNIQUE_LIMITED';
      usability = 'LIMITED';
      reason = 'MATCH_TYPE_NOT_DECLARED';
    } else if (rawCandidates.length > 1) {
      candidates = rawCandidates;
      method = 'AMBIGUOUS';
      reason = 'MATCH_TYPE_NOT_DECLARED_AND_MULTIPLE_TARGETS';
    } else {
      reason = 'TARGET_NOT_FOUND';
    }
    const joined = candidates.length === 1 && method !== 'AMBIGUOUS' ? candidates[0] : null;
    return {
      search_term_row_number: searchRow.source_row_number,
      customer_search_term_raw: searchRow.customer_search_term_raw,
      target_keyword_raw: searchRow.target_keyword_raw,
      added_match_type: searchRow.added_match_type,
      method: method,
      data_usability: joined ? usability : 'LIMITED',
      target_row_number: joined ? joined.source_row_number : null,
      target_match_type: joined ? joined.match_type : null,
      candidate_target_rows: candidates.map(function(row) { return row.source_row_number; }),
      ambiguity_reason: reason
    };
  });
}

function akaCurrentMarketRows_(searchMarket, periodKey) {
  if (!searchMarket || !Array.isArray(searchMarket.rows)) return [];
  return searchMarket.rows.filter(function(row) {
    return row && row.snapshot
      && String(row.data_period || row.snapshot.period_key || '') === periodKey
      && row.comparison_status !== 'LEFT_TOP100';
  }).map(function(row) {
    return Object.assign({
      comparison_status: row.comparison_status,
      current_rank: row.current_rank,
      previous_rank: row.previous_rank,
      rank_change: row.rank_change
    }, row.snapshot);
  });
}

function akaBuildSearchMarketJoins_(searchRows, marketRows) {
  const byRaw = {};
  const byNorm = {};
  marketRows.forEach(function(row) {
    if (!byRaw[row.search_query_raw]) byRaw[row.search_query_raw] = [];
    byRaw[row.search_query_raw].push(row);
    if (!byNorm[row.search_query_normalized]) byNorm[row.search_query_normalized] = [];
    byNorm[row.search_query_normalized].push(row);
  });
  return searchRows.map(function(searchRow) {
    const rawMatches = byRaw[searchRow.customer_search_term_raw] || [];
    if (rawMatches.length === 1) {
      return {
        search_term_row_number: searchRow.source_row_number,
        customer_search_term_raw: searchRow.customer_search_term_raw,
        method: 'RAW_EXACT',
        data_usability: 'VALID',
        search_query_raw: rawMatches[0].search_query_raw,
        market_snapshot: rawMatches[0],
        ambiguity_reason: null
      };
    }
    if (rawMatches.length > 1) {
      return {
        search_term_row_number: searchRow.source_row_number,
        customer_search_term_raw: searchRow.customer_search_term_raw,
        method: 'AMBIGUOUS',
        data_usability: 'LIMITED',
        search_query_raw: null,
        market_snapshot: null,
        ambiguity_reason: 'DUPLICATE_RAW_SEARCH_MARKET_QUERY'
      };
    }
    const normalizedMatches = byNorm[searchRow.customer_search_term_normalized] || [];
    const collision = normalizedMatches.some(function(row) { return row.normalization_collision; });
    if (normalizedMatches.length === 1 && !collision) {
      return {
        search_term_row_number: searchRow.source_row_number,
        customer_search_term_raw: searchRow.customer_search_term_raw,
        method: 'NORMALIZED_UNIQUE',
        data_usability: 'LIMITED',
        search_query_raw: normalizedMatches[0].search_query_raw,
        market_snapshot: normalizedMatches[0],
        ambiguity_reason: null
      };
    }
    return {
      search_term_row_number: searchRow.source_row_number,
      customer_search_term_raw: searchRow.customer_search_term_raw,
      method: normalizedMatches.length ? 'AMBIGUOUS' : 'UNJOINED',
      data_usability: 'LIMITED',
      search_query_raw: null,
      market_snapshot: null,
      ambiguity_reason: normalizedMatches.length
        ? 'NORMALIZED_SEARCH_MARKET_COLLISION'
        : 'SEARCH_MARKET_QUERY_NOT_FOUND'
    };
  });
}

function akaPriorSelectedCandidates_(previousSession) {
  const analysis = previousSession && previousSession.analysis;
  if (!analysis || !Array.isArray(analysis.families)) return [];
  return [].concat.apply([], analysis.families.map(function(family) {
    return Array.isArray(family.selected_candidates) ? family.selected_candidates : [];
  }));
}

function akaFindAppliedPriorCandidate_(priorCandidates, target) {
  return priorCandidates.filter(function(candidate) {
    if (String(candidate.keyword_raw || candidate.search_term_raw || '') !== target.keyword_raw) return false;
    if (candidate.family === 'NEW_EXACT') {
      return target.match_type === 'EXACT';
    }
    return candidate.proposed_bid_yen !== null
      && Number(candidate.proposed_bid_yen) === Number(target.current_bid_yen)
      && String(candidate.match_type || '') === String(target.match_type || '');
  })[0] || null;
}

function akaSuggestedRange_(target) {
  const low = akaNullableNumber_(target.suggested_bid_low_yen);
  const high = akaNullableNumber_(target.suggested_bid_high_yen);
  return low !== null && high !== null ? { low: low, high: high } : null;
}

function akaRaisedBid_(target) {
  const current = akaNullableNumber_(target.current_bid_yen);
  if (current === null) return null;
  let proposed = Math.max(current + 1, Math.round(current * (1 + AKA_POLICY_.bid_raise_step_ratio)));
  const high = akaNullableNumber_(target.suggested_bid_high_yen);
  if (high !== null) proposed = Math.min(proposed, high);
  return proposed > current ? proposed : current;
}

function akaLoweredBid_(target) {
  const current = akaNullableNumber_(target.current_bid_yen);
  if (current === null) return null;
  let proposed = Math.max(1, Math.round(current * (1 - AKA_POLICY_.bid_lower_step_ratio)));
  const low = akaNullableNumber_(target.suggested_bid_low_yen);
  if (low !== null && current >= low) proposed = Math.max(proposed, low);
  return proposed < current ? proposed : current;
}

function akaTargetCandidate_(target, central, priorCandidates) {
  if (target.entity_type !== 'KEYWORD_TARGET') {
    return akaCandidate_({
      family: 'DATA_QUALITY',
      decision: 'NEED_MORE_DATA',
      keyword_raw: target.keyword_raw,
      match_type: target.match_type,
      data_usability: 'INVALID',
      suppression_reason: 'PRODUCT_OR_UNKNOWN_TARGET_EXCLUDED',
      facts: [akaFact_('ENTITY_TYPE', target.entity_type, 'TARGET_CSV', 'TARGET_ROW')],
      missing_information: ['キーワードtargetではないため入札判断対象外'],
      priority_basis: ['entity_type', 'source_row_number'],
      priority: [target.entity_type === 'UNKNOWN' ? 0 : 1, target.source_row_number],
      target_row_number: target.source_row_number,
      source_row_number: target.source_row_number
    });
  }
  const prior = akaFindAppliedPriorCandidate_(priorCandidates, target);
  const currentBid = akaNullableNumber_(target.current_bid_yen);
  const spend = akaNullableNumber_(target.spend_yen);
  const orders = akaNullableNumber_(target.orders);
  const sales = akaNullableNumber_(target.sales_yen);
  const acos = sales !== null && sales > 0 && spend !== null ? spend / sales : null;
  const baseFacts = [
    akaFact_('TARGET_STATE', target.state, 'TARGET_CSV', 'TARGET_ROW'),
    akaFact_('CURRENT_BID_YEN', currentBid, 'TARGET_CSV', 'TARGET_ROW', 'JPY'),
    akaFact_('SUGGESTED_BID_LOW_YEN', target.suggested_bid_low_yen, 'TARGET_CSV', 'TARGET_ROW', 'JPY'),
    akaFact_('SUGGESTED_BID_MID_YEN', target.suggested_bid_mid_yen, 'TARGET_CSV', 'TARGET_ROW', 'JPY'),
    akaFact_('SUGGESTED_BID_HIGH_YEN', target.suggested_bid_high_yen, 'TARGET_CSV', 'TARGET_ROW', 'JPY'),
    akaFact_('IMPRESSIONS', target.impressions, 'TARGET_CSV', 'TARGET_ROW', 'COUNT'),
    akaFact_('SPEND_YEN', spend, 'TARGET_CSV', 'TARGET_ROW', 'JPY'),
    akaFact_('ORDERS', orders, 'TARGET_CSV', 'TARGET_ROW', 'COUNT'),
    akaFact_('SALES_YEN', sales, 'TARGET_CSV', 'TARGET_ROW', 'JPY'),
    akaFact_('ACOS', acos, 'CALCULATED', 'TARGET_ROW', 'RATIO'),
    akaFact_(
      'PRODUCT_PROFIT_AFTER_AD_YEN',
      central.monthly ? akaNullableNumber_(central.monthly.profit_after_ad) : null,
      'CENTRAL_MONTHLY',
      'ASIN_PERIOD_GUARDRAIL_NOT_QUERY_ALLOCATION',
      'JPY'
    )
  ];
  if (prior) {
    baseFacts.push(akaFact_('PREVIOUS_CANDIDATE_ID', prior.candidate_id, 'PRIOR_ANALYSIS_SESSION', 'TARGET_ROW'));
    return akaCandidate_({
      family: 'MAINTAIN',
      decision: 'HOLD',
      keyword_raw: target.keyword_raw,
      match_type: target.match_type,
      current_bid_yen: currentBid,
      data_usability: 'VALID',
      execution_status: 'ALREADY_APPLIED',
      previous_candidate_id: prior.candidate_id,
      facts: baseFacts,
      priority_basis: ['already_applied', 'orders_desc', 'sales_desc', 'source_row_number'],
      priority: [0, -(orders || 0), -(sales || 0), target.source_row_number],
      target_row_number: target.source_row_number,
      source_row_number: target.source_row_number
    });
  }
  if (target.state === 'PAUSED') {
    return akaCandidate_({
      family: 'MAINTAIN',
      decision: 'HOLD',
      keyword_raw: target.keyword_raw,
      match_type: target.match_type,
      current_bid_yen: currentBid,
      data_usability: spend === null || orders === null ? 'LIMITED' : 'VALID',
      facts: baseFacts,
      missing_information: ['Clickがないため停止解除・除外の強い判断はしない'],
      priority_basis: ['paused_state', 'historical_impressions_desc', 'source_row_number'],
      priority: [0, -(target.impressions || 0), target.source_row_number],
      target_row_number: target.source_row_number,
      source_row_number: target.source_row_number
    });
  }
  if (currentBid === null || spend === null || orders === null || sales === null) {
    return akaCandidate_({
      family: 'EXISTING_BID',
      decision: 'NEED_MORE_DATA',
      keyword_raw: target.keyword_raw,
      match_type: target.match_type,
      current_bid_yen: currentBid,
      data_usability: 'LIMITED',
      suppression_reason: currentBid === null ? 'CURRENT_BID_MISSING' : null,
      bid_basis: 'INSUFFICIENT_FOR_NUMERIC_BID',
      facts: baseFacts,
      missing_information: ['未報告の広告実績または入札額'],
      priority_basis: ['missing_information_count', 'source_row_number'],
      priority: [1, target.source_row_number],
      target_row_number: target.source_row_number,
      source_row_number: target.source_row_number
    });
  }
  if (orders <= 0) {
    if (spend > 0) {
      return akaCandidate_({
        family: 'EXISTING_BID',
        decision: 'NEED_MORE_DATA',
        keyword_raw: target.keyword_raw,
        match_type: target.match_type,
        current_bid_yen: currentBid,
        data_usability: 'LIMITED',
        bid_basis: 'INSUFFICIENT_FOR_NUMERIC_BID',
        facts: baseFacts,
        missing_information: ['Click', 'CPC', 'CTR', '広告CVR'],
        priority_basis: ['spend_desc', 'impressions_desc', 'source_row_number'],
        priority: [1, -spend, -(target.impressions || 0), target.source_row_number],
        target_row_number: target.source_row_number,
        source_row_number: target.source_row_number
      });
    }
    return akaCandidate_({
      family: 'MAINTAIN',
      decision: 'HOLD',
      keyword_raw: target.keyword_raw,
      match_type: target.match_type,
      current_bid_yen: currentBid,
      data_usability: 'LIMITED',
      facts: baseFacts,
      missing_information: ['費用・注文実績がないため入札変更の効果を判断できない'],
      priority_basis: ['impressions_desc', 'source_row_number'],
      priority: [1, -(target.impressions || 0), target.source_row_number],
      target_row_number: target.source_row_number,
      source_row_number: target.source_row_number
    });
  }

  const profitAfterAd = central.monthly ? akaNullableNumber_(central.monthly.profit_after_ad) : null;
  const targetAcos = akaNullableNumber_(central.target_acos);
  const shouldLower = (targetAcos !== null && acos !== null && acos > targetAcos)
    || (profitAfterAd !== null && profitAfterAd <= 0);
  const proposed = shouldLower ? akaLoweredBid_(target) : akaRaisedBid_(target);
  const decision = proposed === currentBid ? 'HOLD' : (shouldLower ? 'LOWER_TEST' : 'RAISE_TEST');
  const directionReasons = [];
  if (targetAcos !== null && acos !== null) {
    directionReasons.push(acos > targetAcos
      ? 'ACOS_ABOVE_USER_TARGET'
      : 'ACOS_AT_OR_BELOW_USER_TARGET');
  }
  if (orders > 0) directionReasons.push('ORDERS_OBSERVED');
  if (profitAfterAd !== null) {
    directionReasons.push(profitAfterAd > 0
      ? 'PRODUCT_PROFIT_AFTER_AD_POSITIVE'
      : 'PRODUCT_PROFIT_AFTER_AD_NON_POSITIVE');
  }
  if (decision === 'HOLD') directionReasons.push('REFERENCE_BID_BOUNDARY_REACHED');
  return akaCandidate_({
    family: 'EXISTING_BID',
    decision: decision,
    direction_reason_codes: directionReasons,
    keyword_raw: target.keyword_raw,
    match_type: target.match_type,
    current_bid_yen: currentBid,
    proposed_bid_yen: decision === 'HOLD' ? null : proposed,
    proposed_bid_range_yen: akaSuggestedRange_(target),
    bid_basis: 'CURRENT_BID_SMALL_STEP',
    data_usability: 'VALID',
    facts: baseFacts.concat([
      akaFact_('USER_TARGET_ACOS', targetAcos, 'USER_CONFIRMED_METADATA', 'ASIN_PERIOD', 'RATIO')
    ]),
    priority_basis: ['decision_class', 'orders_desc', 'sales_desc', 'spend_desc', 'source_row_number'],
    priority: [decision === 'HOLD' ? 2 : 0, -orders, -sales, -spend, target.source_row_number],
    target_row_number: target.source_row_number,
    source_row_number: target.source_row_number
  });
}

function akaNewExactCandidate_(
  searchRow,
  targetJoin,
  marketJoin,
  exactByRaw,
  exactByNorm,
  priorCandidates
) {
  const raw = searchRow.customer_search_term_raw;
  const existingExact = exactByRaw[raw] || [];
  const previousNew = priorCandidates.filter(function(candidate) {
    return candidate.family === 'NEW_EXACT'
      && String(candidate.search_term_raw || candidate.keyword_raw || '') === raw;
  })[0] || null;
  if (existingExact.length) {
    if (previousNew) {
      return akaCandidate_({
        family: 'MAINTAIN',
        decision: 'HOLD',
        keyword_raw: raw,
        search_term_raw: raw,
        match_type: 'EXACT',
        current_bid_yen: existingExact[0].current_bid_yen,
        data_usability: 'VALID',
        execution_status: 'ALREADY_APPLIED',
        previous_candidate_id: previousNew.candidate_id,
        facts: [akaFact_('EXACT_TARGET_PRESENT', true, 'TARGET_CSV', 'SESSION')],
        priority_basis: ['already_applied', 'orders_desc', 'source_row_number'],
        priority: [0, -(searchRow.orders || 0), searchRow.source_row_number],
        target_row_number: existingExact[0].source_row_number,
        search_term_row_number: searchRow.source_row_number,
        source_row_number: searchRow.source_row_number,
        join: targetJoin
      });
    }
    return akaCandidate_({
      family: 'NEW_EXACT',
      decision: 'ADD_EXACT',
      keyword_raw: raw,
      search_term_raw: raw,
      match_type: 'EXACT',
      data_usability: 'INVALID',
      suppression_reason: 'EXACT_TARGET_ALREADY_EXISTS',
      facts: [akaFact_('EXACT_TARGET_PRESENT', true, 'TARGET_CSV', 'SESSION')],
      priority_basis: ['existing_exact_guard', 'source_row_number'],
      priority: [9, searchRow.source_row_number],
      target_row_number: existingExact[0].source_row_number,
      search_term_row_number: searchRow.source_row_number,
      source_row_number: searchRow.source_row_number,
      join: targetJoin
    });
  }
  const normalizedMatches = exactByNorm[searchRow.customer_search_term_normalized] || [];
  if (normalizedMatches.length) {
    return akaCandidate_({
      family: 'NEW_EXACT',
      decision: 'NEED_MORE_DATA',
      keyword_raw: raw,
      search_term_raw: raw,
      match_type: 'EXACT',
      data_usability: 'LIMITED',
      suppression_reason: 'NORMALIZED_EXACT_TARGET_COLLISION_REVIEW',
      facts: [akaFact_(
        'NORMALIZED_EXISTING_EXACT_RAW_VALUES',
        normalizedMatches.map(function(row) { return row.keyword_raw; }),
        'TARGET_CSV',
        'SESSION'
      )],
      missing_information: ['原文差を維持したまま既存targetとの意図差を確認'],
      priority_basis: ['normalization_guard', 'orders_desc', 'source_row_number'],
      priority: [8, -(searchRow.orders || 0), searchRow.source_row_number],
      search_term_row_number: searchRow.source_row_number,
      source_row_number: searchRow.source_row_number,
      join: targetJoin
    });
  }
  const spend = akaNullableNumber_(searchRow.spend_yen);
  const orders = akaNullableNumber_(searchRow.orders);
  const sales = akaNullableNumber_(searchRow.sales_yen);
  const relatedBid = akaNullableNumber_(searchRow.target_bid_yen);
  const market = marketJoin && marketJoin.market_snapshot;
  const facts = [
    akaFact_('SEARCH_TERM_SPEND_YEN', spend, 'SEARCH_TERM_CSV', 'SEARCH_TERM_ROW', 'JPY'),
    akaFact_('SEARCH_TERM_ORDERS', orders, 'SEARCH_TERM_CSV', 'SEARCH_TERM_ROW', 'COUNT'),
    akaFact_('SEARCH_TERM_SALES_YEN', sales, 'SEARCH_TERM_CSV', 'SEARCH_TERM_ROW', 'JPY'),
    akaFact_('RELATED_TARGET_BID_YEN', relatedBid, 'SEARCH_TERM_CSV', 'SEARCH_TERM_ROW', 'JPY'),
    akaFact_(
      'SEARCH_MARKET_REFERENCE_PERIOD',
      market ? market.period_key : null,
      'SEARCH_MARKET',
      'SEARCH_QUERY'
    ),
    akaFact_('MARKET_PURCHASE', market ? market.purchase_total : null, 'SEARCH_MARKET', 'SEARCH_QUERY', 'COUNT'),
    akaFact_('ASIN_PURCHASE', market ? market.purchase_asin : null, 'SEARCH_MARKET', 'SEARCH_QUERY', 'COUNT')
  ];
  if (orders === null || spend === null || sales === null) {
    return akaCandidate_({
      family: 'NEW_EXACT',
      decision: 'NEED_MORE_DATA',
      keyword_raw: raw,
      search_term_raw: raw,
      match_type: 'EXACT',
      data_usability: 'LIMITED',
      suppression_reason: 'SEARCH_TERM_PERFORMANCE_MISSING',
      bid_basis: 'INSUFFICIENT_FOR_NUMERIC_BID',
      facts: facts,
      missing_information: ['検索用語の費用・注文・売上'],
      priority_basis: ['orders_desc', 'sales_desc', 'source_row_number'],
      priority: [2, 0, 0, searchRow.source_row_number],
      search_term_row_number: searchRow.source_row_number,
      source_row_number: searchRow.source_row_number,
      join: targetJoin
    });
  }
  if (orders <= 0) {
    return akaCandidate_({
      family: 'NEW_EXACT',
      decision: 'NEED_MORE_DATA',
      keyword_raw: raw,
      search_term_raw: raw,
      match_type: 'EXACT',
      data_usability: 'LIMITED',
      suppression_reason: 'NO_ORDER_EVIDENCE',
      bid_basis: 'INSUFFICIENT_FOR_NUMERIC_BID',
      facts: facts,
      missing_information: ['注文実績または検索意図の確認'],
      priority_basis: ['spend_desc', 'source_row_number'],
      priority: [3, -spend, searchRow.source_row_number],
      search_term_row_number: searchRow.source_row_number,
      source_row_number: searchRow.source_row_number,
      join: targetJoin
    });
  }
  const proposed = relatedBid === null ? null : Math.max(1, Math.round(relatedBid * 0.9));
  return akaCandidate_({
    family: 'NEW_EXACT',
    decision: proposed === null ? 'NEED_MORE_DATA' : 'ADD_EXACT',
    direction_reason_codes: proposed === null ? [] : [
      'SEARCH_TERM_ORDERS_OBSERVED',
      'SEARCH_TERM_SALES_OBSERVED',
      'RELATED_TARGET_BID_AVAILABLE'
    ],
    keyword_raw: raw,
    search_term_raw: raw,
    match_type: 'EXACT',
    proposed_bid_yen: proposed,
    bid_basis: proposed === null ? 'INSUFFICIENT_FOR_NUMERIC_BID' : 'PROVEN_RELATED_TARGET',
    data_usability: marketJoin && marketJoin.data_usability === 'VALID' ? 'VALID' : 'LIMITED',
    facts: facts,
    missing_information: proposed === null ? ['数値入札の参照値'] : [],
    suppression_reason: proposed === null ? 'NUMERIC_BID_REFERENCE_MISSING' : null,
    priority_basis: ['orders_desc', 'sales_desc', 'market_purchase_desc', 'source_row_number'],
    priority: [0, -orders, -sales, -(market ? market.purchase_total || 0 : 0), searchRow.source_row_number],
    search_term_row_number: searchRow.source_row_number,
    source_row_number: searchRow.source_row_number,
    join: targetJoin
  });
}

function akaNegativeCandidate_(searchRow, targetJoin, marketJoin) {
  const spend = akaNullableNumber_(searchRow.spend_yen);
  const orders = akaNullableNumber_(searchRow.orders);
  if (spend === null || spend <= 0 || orders === null || orders > 0) return null;
  return akaCandidate_({
    family: 'NEGATIVE_REVIEW',
    decision: 'PAUSE_REVIEW',
    keyword_raw: searchRow.target_keyword_raw,
    search_term_raw: searchRow.customer_search_term_raw,
    match_type: searchRow.added_match_type || 'UNKNOWN',
    current_bid_yen: searchRow.target_bid_yen,
    data_usability: 'LIMITED',
    suppression_reason: 'MISSING_CLICK_METRICS_AND_INTENT_EVIDENCE',
    bid_basis: 'INSUFFICIENT_FOR_NUMERIC_BID',
    facts: [
      akaFact_('SEARCH_TERM_SPEND_YEN', spend, 'SEARCH_TERM_CSV', 'SEARCH_TERM_ROW', 'JPY'),
      akaFact_('SEARCH_TERM_ORDERS', orders, 'SEARCH_TERM_CSV', 'SEARCH_TERM_ROW', 'COUNT'),
      akaFact_(
        'ASIN_PURCHASE',
        marketJoin && marketJoin.market_snapshot ? marketJoin.market_snapshot.purchase_asin : null,
        'SEARCH_MARKET',
        'SEARCH_QUERY',
        'COUNT'
      )
    ],
    missing_information: ['Click', 'CPC', '検索意図不一致の確認'],
    priority_basis: ['spend_desc', 'market_purchase_asc', 'source_row_number'],
    priority: [-spend, marketJoin && marketJoin.market_snapshot
      ? marketJoin.market_snapshot.purchase_asin || 0 : 0, searchRow.source_row_number],
    search_term_row_number: searchRow.source_row_number,
    source_row_number: searchRow.source_row_number,
    join: targetJoin
  });
}

function akaMarketOnlyNewExactCandidates_(marketRows, searchRows, exactByRaw, exactByNorm) {
  const observed = {};
  searchRows.forEach(function(row) { observed[row.customer_search_term_raw] = true; });
  return marketRows.filter(function(row) {
    return !observed[row.search_query_raw] && Number(row.purchase_asin || 0) > 0;
  }).map(function(row) {
    const exact = exactByRaw[row.search_query_raw] || [];
    const normalized = exactByNorm[row.search_query_normalized] || [];
    let reason = 'SEARCH_TERM_PERFORMANCE_NOT_OBSERVED';
    if (exact.length) reason = 'EXACT_TARGET_ALREADY_EXISTS';
    else if (normalized.length || row.normalization_collision) reason = 'NORMALIZED_EXACT_TARGET_COLLISION_REVIEW';
    return akaCandidate_({
      family: 'NEW_EXACT',
      decision: 'NEED_MORE_DATA',
      keyword_raw: row.search_query_raw,
      search_term_raw: row.search_query_raw,
      match_type: 'EXACT',
      data_usability: 'LIMITED',
      suppression_reason: reason,
      bid_basis: 'INSUFFICIENT_FOR_NUMERIC_BID',
      facts: [
        akaFact_('SEARCH_MARKET_REFERENCE_PERIOD', row.period_key, 'SEARCH_MARKET', 'SEARCH_QUERY'),
        akaFact_('SEARCH_QUERY_RANK', row.search_query_rank, 'SEARCH_MARKET', 'SEARCH_QUERY', 'RANK'),
        akaFact_('SEARCH_QUERY_VOLUME', row.search_query_volume, 'SEARCH_MARKET', 'SEARCH_QUERY', 'COUNT'),
        akaFact_('MARKET_PURCHASE', row.purchase_total, 'SEARCH_MARKET', 'SEARCH_QUERY', 'COUNT'),
        akaFact_('ASIN_PURCHASE', row.purchase_asin, 'SEARCH_MARKET', 'SEARCH_QUERY', 'COUNT'),
        akaFact_('PURCHASE_SHARE', row.purchase_share, 'SEARCH_MARKET', 'SEARCH_QUERY', 'RATIO')
      ],
      missing_information: ['広告検索用語の費用・注文・売上', '検索意図の確認'],
      priority_basis: ['asin_purchase_desc', 'market_purchase_desc', 'rank_asc', 'query_raw'],
      priority: [-(row.purchase_asin || 0), -(row.purchase_total || 0), row.search_query_rank || 999999, row.search_query_raw],
      search_market_query_raw: row.search_query_raw,
      source_row_number: row.search_query_rank || row.search_query_raw
    });
  });
}

function akaDataQualityCandidates_(prepared, targetJoins, marketJoins, central) {
  const candidates = [
    akaCandidate_({
      family: 'DATA_QUALITY',
      decision: 'NEED_MORE_DATA',
      keyword_raw: '',
      match_type: 'UNKNOWN',
      data_usability: 'LIMITED',
      facts: [
        akaFact_('FILE_SCOPE_STATUS', prepared.preview.metadata.file_scope_status, 'IMPORT_METADATA', 'SESSION'),
        akaFact_('UNIVERSE_COVERAGE', prepared.preview.metadata.universe_coverage, 'IMPORT_METADATA', 'SESSION')
      ],
      missing_information: ['広告アカウント・キャンペーン全体に対するcoverage'],
      priority_basis: ['coverage_unknown'],
      priority: [4],
      source_row_number: 'coverage'
    })
  ];
  targetJoins.filter(function(join) {
    return join.method === 'AMBIGUOUS' || join.method === 'UNJOINED';
  }).forEach(function(join) {
    candidates.push(akaCandidate_({
      family: 'DATA_QUALITY',
      decision: 'NEED_MORE_DATA',
      keyword_raw: join.target_keyword_raw,
      search_term_raw: join.customer_search_term_raw,
      match_type: join.added_match_type || 'UNKNOWN',
      data_usability: 'LIMITED',
      facts: [akaFact_('TARGET_JOIN_METHOD', join.method, 'DETERMINISTIC_JOIN', 'SEARCH_TERM_ROW')],
      missing_information: ['campaign / ad group / target IDまたは一意なmatch type'],
      suppression_reason: join.ambiguity_reason,
      priority_basis: ['ambiguous_join', 'source_row_number'],
      priority: [0, join.search_term_row_number],
      search_term_row_number: join.search_term_row_number,
      source_row_number: 'target-join-' + join.search_term_row_number,
      join: join
    }));
  });
  marketJoins.filter(function(join) {
    return join.method === 'AMBIGUOUS';
  }).forEach(function(join) {
    candidates.push(akaCandidate_({
      family: 'DATA_QUALITY',
      decision: 'NEED_MORE_DATA',
      keyword_raw: join.customer_search_term_raw,
      search_term_raw: join.customer_search_term_raw,
      match_type: 'UNKNOWN',
      data_usability: 'LIMITED',
      facts: [akaFact_('SEARCH_MARKET_JOIN_METHOD', join.method, 'DETERMINISTIC_JOIN', 'SEARCH_TERM_ROW')],
      missing_information: ['raw完全一致する検索市場query'],
      suppression_reason: join.ambiguity_reason,
      priority_basis: ['normalization_collision', 'source_row_number'],
      priority: [1, join.search_term_row_number],
      search_term_row_number: join.search_term_row_number,
      source_row_number: 'market-join-' + join.search_term_row_number,
      join: join
    }));
  });
  central.warnings.forEach(function(warning, index) {
    candidates.push(akaCandidate_({
      family: 'DATA_QUALITY',
      decision: 'NEED_MORE_DATA',
      keyword_raw: '',
      match_type: 'UNKNOWN',
      data_usability: 'LIMITED',
      facts: [akaFact_(warning.code, warning.message, 'CENTRAL_JOIN', 'ASIN_PERIOD')],
      missing_information: [warning.message],
      priority_basis: ['central_join_warning', 'warning_index'],
      priority: [2, index],
      source_row_number: 'central-' + index
    }));
  });
  return candidates;
}

function akaComparePriority_(left, right) {
  const a = left._priority || [];
  const b = right._priority || [];
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const av = a[index] === undefined ? '' : a[index];
    const bv = b[index] === undefined ? '' : b[index];
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), 'ja');
  }
  return left.candidate_id.localeCompare(right.candidate_id);
}

function akaSelectWithinFamilies_(candidates) {
  const familyOrder = ['EXISTING_BID', 'NEW_EXACT', 'NEGATIVE_REVIEW', 'MAINTAIN', 'DATA_QUALITY'];
  return familyOrder.map(function(familyName) {
    const familyCandidates = candidates.filter(function(candidate) {
      return candidate.family === familyName;
    }).sort(akaComparePriority_);
    const limit = AKA_POLICY_.family_selection_limits[familyName] || 0;
    let selectedCount = 0;
    familyCandidates.forEach(function(candidate) {
      if (!candidate.suppression_reason && candidate.data_usability !== 'INVALID' && selectedCount < limit) {
        selectedCount++;
        candidate.selected = true;
        candidate.selection_reason = {
          code: 'LEXICOGRAPHIC_WITHIN_FAMILY',
          family_rank: selectedCount,
          basis: candidate.priority_basis
        };
      } else if (!candidate.suppression_reason) {
        candidate.suppression_reason = limit === 0 ? 'FAMILY_DISABLED_IN_POLICY_V0' : 'FAMILY_SELECTION_LIMIT';
      }
      delete candidate._priority;
    });
    return {
      family: familyName,
      selection_limit: limit,
      selected_candidates: familyCandidates.filter(function(candidate) { return candidate.selected; }),
      suppressed_candidates: familyCandidates.filter(function(candidate) { return !candidate.selected; })
    };
  });
}

function analyzeAdvertisingKeywordSnapshot_(prepared, centralInput, previousSession) {
  const targetRows = prepared.preview.reports.target
    ? prepared.preview.reports.target.rows : [];
  const searchRows = prepared.preview.reports.search_term
    ? prepared.preview.reports.search_term.rows : [];
  const central = centralInput || akaLoadCentralContext_(prepared.preview.metadata);
  central.target_acos = prepared.preview.metadata.target_acos;
  const searchMarketReference = central.search_market_reference || (central.search_market ? {
    rule: AKA_POLICY_.search_market_reference_rule,
    advertising_period: central.period_key,
    reference_period: central.search_market.period_key,
    lag_months: akaMonthDistance_(central.search_market.period_key, central.period_key),
    is_same_period: String(central.search_market.period_key) === String(central.period_key)
  } : null);
  const marketRows = akaCurrentMarketRows_(
    central.search_market,
    searchMarketReference ? searchMarketReference.reference_period : central.period_key
  );
  const targetJoins = akaBuildTargetSearchTermJoins_(targetRows, searchRows);
  const marketJoins = akaBuildSearchMarketJoins_(searchRows, marketRows);
  const targetJoinByRow = {};
  const marketJoinByRow = {};
  targetJoins.forEach(function(join) { targetJoinByRow[join.search_term_row_number] = join; });
  marketJoins.forEach(function(join) { marketJoinByRow[join.search_term_row_number] = join; });
  const exactByRaw = {};
  const exactByNorm = {};
  targetRows.filter(function(row) {
    return row.entity_type === 'KEYWORD_TARGET' && row.match_type === 'EXACT';
  }).forEach(function(row) {
    if (!exactByRaw[row.keyword_raw]) exactByRaw[row.keyword_raw] = [];
    exactByRaw[row.keyword_raw].push(row);
    if (!exactByNorm[row.keyword_normalized]) exactByNorm[row.keyword_normalized] = [];
    exactByNorm[row.keyword_normalized].push(row);
  });
  const priorCandidates = akaPriorSelectedCandidates_(previousSession);
  let candidates = targetRows.map(function(target) {
    return akaTargetCandidate_(target, central, priorCandidates);
  });
  searchRows.forEach(function(searchRow) {
    const targetJoin = targetJoinByRow[searchRow.source_row_number] || null;
    const marketJoin = marketJoinByRow[searchRow.source_row_number] || null;
    candidates.push(akaNewExactCandidate_(
      searchRow,
      targetJoin,
      marketJoin,
      exactByRaw,
      exactByNorm,
      priorCandidates
    ));
    const negative = akaNegativeCandidate_(searchRow, targetJoin, marketJoin);
    if (negative) candidates.push(negative);
  });
  candidates = candidates.concat(
    akaMarketOnlyNewExactCandidates_(marketRows, searchRows, exactByRaw, exactByNorm)
  );
  candidates = candidates.concat(
    akaDataQualityCandidates_(prepared, targetJoins, marketJoins, central)
  );
  const operationalCautions = akaOperationalCautions_(central);
  candidates.forEach(function(candidate) {
    if (candidate.bid_direction === 'RAISE' || candidate.bid_direction === 'ADD') {
      candidate.operational_cautions = operationalCautions.slice();
    }
  });
  const families = akaSelectWithinFamilies_(candidates);
  const selectedCount = families.reduce(function(total, family) {
    return total + family.selected_candidates.length;
  }, 0);
  const suppressedCount = families.reduce(function(total, family) {
    return total + family.suppressed_candidates.length;
  }, 0);
  return {
    schema_version: AKA_ANALYSIS_SCHEMA_VERSION_,
    policy: JSON.parse(JSON.stringify(AKA_POLICY_)),
    selection_scope: AKA_POLICY_.selection_scope,
    cross_family_ranking: false,
    central_context: {
      period_key: central.period_key,
      monthly: central.monthly,
      monthly_scope: central.monthly_scope,
      operational_cautions: operationalCautions,
      search_market_reference: searchMarketReference,
      search_market: central.search_market ? {
        marketplace: central.search_market.marketplace,
        asin: central.search_market.asin,
        period_key: central.search_market.period_key,
        report_scope: central.search_market.report_scope,
        query_limit: central.search_market.query_limit,
        returned_query_count: central.search_market.returned_query_count,
        current_query_count: central.search_market.current_query_count
      } : null,
      warnings: central.warnings
    },
    data_usability: {
      target_search_term_join: targetRows.length && searchRows.length
        ? (targetJoins.some(function(join) { return join.data_usability !== 'VALID'; }) ? 'LIMITED' : 'VALID')
        : 'INVALID',
      search_market_join: searchRows.length && central.search_market ? (
        marketJoins.some(function(join) { return join.data_usability !== 'VALID'; }) ? 'LIMITED' : 'VALID'
      ) : (searchRows.length ? 'LIMITED' : 'INVALID'),
      central_monthly: central.monthly ? 'VALID' : 'LIMITED',
      negative_decision: 'LIMITED'
    },
    joins: {
      target_search_term: targetJoins,
      search_term_search_market: marketJoins,
      target_identity_rule: 'SESSION_ROW_AND_RAW_MATCH_TYPE',
      search_market_identity_rule: 'RAW_EXACT_THEN_NORMALIZED_UNIQUE',
      search_market_period_rule: AKA_POLICY_.search_market_reference_rule,
      monthly_allocation_rule: 'ASIN_PERIOD_GUARDRAIL_NOT_QUERY_ALLOCATION'
    },
    selected_count: selectedCount,
    suppressed_count: suppressedCount,
    families: families
  };
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
    selected_candidate_count: session.selected_candidate_count || 0,
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

function akaLatestPriorSession_(asinValue) {
  const asin = String(asinValue || '').trim().toUpperCase();
  const ref = akaEnsureSessionSheet_();
  const values = ref.sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  const index = {};
  ref.headers.forEach(function(header, column) { index[header] = column; });
  const candidates = values.slice(1).filter(function(row) {
    return String(row[index.asin] || '').trim().toUpperCase() === asin
      && String(row[index.result_drive_file_id] || '').trim();
  }).sort(function(left, right) {
    return String(right[index.updated_at] || '').localeCompare(String(left[index.updated_at] || ''));
  });
  if (!candidates.length) return null;
  try {
    const fileId = String(candidates[0][index.result_drive_file_id]);
    return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
  } catch (error) {
    Logger.log('akaLatestPriorSession_: ' + error.message);
    return null;
  }
}

function runAdvertisingKeywordAnalysis(request) {
  // 書込み前に全ファイルを再parse・SHA検証する。invalid入力はDrive/Sheetへ一切保存しない。
  const prepared = akaPrepare_(request);
  const central = akaLoadCentralContext_(prepared.preview.metadata);
  const previousSession = akaLatestPriorSession_(prepared.preview.metadata.asin);
  const analysis = analyzeAdvertisingKeywordSnapshot_(prepared, central, previousSession);
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
      status: 'ANALYZED',
      preview: prepared.preview,
      analysis: analysis,
      target_file_id: targetFileId,
      search_term_file_id: searchFileId,
      result_drive_file_id: '',
      selected_candidate_count: analysis.selected_count,
      policy_version: AKA_POLICY_VERSION_,
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
      'analysis_session.json'
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
