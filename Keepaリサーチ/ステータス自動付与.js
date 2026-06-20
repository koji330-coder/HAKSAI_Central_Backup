function autoSetKeepaStatus() {
  const SHEET_NAME = 'keepa_research_candidates';
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`シートが見つかりません: ${SHEET_NAME}`);

  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return;

  let headers = values[0].map(String);

  // 必須列
  const required = ['title', 'brand', 'category_name', 'status'];
  required.forEach(name => {
    if (!headers.includes(name)) {
      throw new Error(`必要な列がありません: ${name}`);
    }
  });

  // 理由列がなければ追加
  const reasonColName = 'status_reason';
  const themeColName = 'status_theme';

  if (!headers.includes(reasonColName)) {
    sheet.getRange(1, headers.length + 1).setValue(reasonColName);
    headers.push(reasonColName);
  }

  if (!headers.includes(themeColName)) {
    sheet.getRange(1, headers.length + 1).setValue(themeColName);
    headers.push(themeColName);
  }

  const col = name => headers.indexOf(name);

  const titleCol = col('title');
  const brandCol = col('brand');
  const categoryCol = col('category_name');
  const statusCol = col('status');
  const reasonCol = col(reasonColName);
  const themeCol = col(themeColName);

  const outputStatus = [];
  const outputReason = [];
  const outputTheme = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    const currentStatus = String(row[statusCol] || '').trim();

    // 手動でGO/NGにしたものは上書きしない
    if (currentStatus === 'GO' || currentStatus === 'NG') {
      outputStatus.push([currentStatus]);
      outputReason.push([row[reasonCol] || '手動判定を保持']);
      outputTheme.push([row[themeCol] || '']);
      continue;
    }

    const title = String(row[titleCol] || '').trim();
    const brand = String(row[brandCol] || '').trim();
    const category = String(row[categoryCol] || '').trim();

    const result = judgeKeepaCandidate_(title, brand, category);

    outputStatus.push([result.status]);
    outputReason.push([result.reason]);
    outputTheme.push([result.theme || '']);
  }

  sheet.getRange(2, statusCol + 1, outputStatus.length, 1).setValues(outputStatus);
  sheet.getRange(2, reasonCol + 1, outputReason.length, 1).setValues(outputReason);
  sheet.getRange(2, themeCol + 1, outputTheme.length, 1).setValues(outputTheme);
}


function judgeKeepaCandidate_(title, brand, category) {
  if (!title || title.length < 10) {
    return {
      status: '未確認',
      reason: 'タイトル不足',
      theme: ''
    };
  }

  const text = `${title} ${brand} ${category}`.toLowerCase();

  const excludeKeywords = [
    // キャラクター・IP
    'ちいかわ', 'サンリオ', 'ディズニー', 'ポケモン', 'アンパンマン',
    'すみっコ', 'ムーミン', 'ミッフィー', 'はらぺこあおむし',
    'カービィ', 'トイ・ストーリー', 'プラレール', 'ドラえもん',
    'スヌーピー', 'ミニオン', '鬼滅', '呪術', 'プリキュア',
    '仮面ライダー', 'ウルトラマン', 'ジブリ', 'リラックマ',
    'クレヨンしんちゃん', 'ハローキティ',

    // 有名ブランド・純正品系
    'nike', 'ナイキ', 'adidas', 'アディダス', 'yonex', 'ヨネックス',
    'mizuno', 'ミズノ', 'rawlings', 'ローリングス',
    'panasonic', 'パナソニック', '無印良品', 'thermos', 'サーモス',
    'coleman', 'コールマン', 'captain stag', 'キャプテンスタッグ',
    'skater', 'スケーター',

    // 互換・交換・専用品
    '純正', '正規品', '対応', '互換', '専用', '交換用',
    '替刃', '外刃', '内刃', '部品', 'パーツ', 'スリーブ',

    // 電気・危険物・規制リスク
    'led', '電球', '電池', 'バッテリー',
    '燃料', '固形燃料', '着火剤', '発熱剤', 'ヒートパック',
    'ワックス', 'オイル', 'シンナー', '洗剤', '除菌', '消臭',
    '殺菌', '虫よけ', '虫除け', '医薬', 'サプリ', '化粧',
    '香水', 'コンシーラー', 'ファンデーション', 'パウダー',
    'お香', 'ホワイトセージ', 'キャンドル', 'ローソク', '蝋燭',

    // スポーツ・釣りの細かい専用品
    '野球', 'ゴルフ', '釣り', 'テンヤ', 'ルアー', 'ラバー',
    '卓球', '水泳', 'スイミング', 'サーフィン', 'テニス',
    'バドミントン', '剣道', 'バット', 'グローブ', 'シューズ',
    'シンカー', 'スイベル', 'イカメタル',

    // 子供・玩具
    '子供用', 'キッズ', 'ベビー', '幼児', 'おもちゃ', '玩具',
    '3歳', '女の子', '男の子',

    // 食品・飲料
    '食品', 'ドリンク', '茶', 'コーヒー', '菓子',

    // HAKSAI的に優先度低めのホーム用品
    'タオル', 'ハンカチ', 'バスタオル', 'フェイスタオル',
    'ミニタオル', 'おしぼり', 'ナフキン',
    '食器', '皿', '茶碗', 'タンブラー', 'グラス', 'コップ',
    'カップ', 'スプーン', 'フォーク', '箸',
    'ケーキ型', '焼型', '製菓', 'フラワー', 'デコレーション'
  ];

  if (containsAny_(text, excludeKeywords)) {
    return {
      status: 'NG',
      reason: '除外キーワード該当',
      theme: ''
    };
  }

  const themeRules = [
    {
      theme: '掃除・汚れ防止',
      keywords: [
        'エアコン', 'レンジフード', '換気扇', '掃除', '清掃',
        'ブラシ', 'デッキブラシ', '目地', 'ぞうきん', 'クロス',
        'モップ', 'フィルター', '洗浄カバー', '配管テープ',
        '防汚', '汚れ防止', 'ほこり', '防塵'
      ]
    },
    {
      theme: 'カバー・ケース・収納',
      keywords: [
        'カバー', 'ケース', '収納', 'ポーチ', 'バッグ',
        'ホルダー', 'フック', 'クリップ', 'ベルト', 'バンド',
        'ネット', 'シートカバー', '保護マット', '防水',
        '撥水', '小物入れ', 'ティッシュケース', 'ペットボトルカバー'
      ]
    },
    {
      theme: '防災・アウトドア',
      keywords: [
        'アウトドア', 'キャンプ', 'レジャーシート',
        '保冷', '保冷剤', 'ウォータータンク', '水タンク',
        '防災', '非常用', 'エマージェンシーブランケット',
        '折りたたみ椅子', '折り畳みチェア'
      ]
    },
    {
      theme: '自転車・バイク小物',
      keywords: [
        '自転車', 'バイク', 'サイクル', 'バーテープ',
        'ドリンクホルダー', 'サドル', 'スマホホルダー',
        'チェーン用', 'バスケットブラケット'
      ]
    }
  ];

  const matchedThemes = [];

  themeRules.forEach(rule => {
    if (containsAny_(title.toLowerCase(), rule.keywords)) {
      matchedThemes.push(rule.theme);
    }
  });

  if (matchedThemes.length === 0) {
    return {
      status: 'NG',
      reason: 'HAKSAI向きテーマに該当なし',
      theme: ''
    };
  }

  return {
    status: 'GO',
    reason: '一次条件通過',
    theme: matchedThemes.join(' / ')
  };
}


function containsAny_(text, keywords) {
  return keywords.some(keyword => {
    return text.indexOf(String(keyword).toLowerCase()) !== -1;
  });
}