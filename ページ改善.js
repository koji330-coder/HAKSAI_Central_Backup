/**
 * PageImprovementPdf.gs
 * Amazon商品ページPDF → 商品ページ改善Markdown生成
 *
 * v0.2
 * - ハンドベル固有記述を排除
 * - PDFから確認できた事実 / AIの解釈 / 改善提案 / 要確認事項を分離
 * - HAKSAI Centralフォルダ配下にPDFコピーとMarkdownを保存
 *
 * 前提：
 * - Script Properties に GEMINI_API_KEY を設定済み
 * - Google Drive上のPDF fileIdを指定して実行
 */

const PI_CONFIG = {
  CENTRAL_FOLDER_ID: '1HwUZ1eYLLviTlXrvHJRlQUe1eyDcMtc7',
  ROOT_FOLDER_NAME: 'ページ改善レポート',
  INPUT_PDF_FOLDER_NAME: '01_input_pdf',
  OUTPUT_MD_FOLDER_NAME: '02_output_markdown',
  RAW_RESPONSE_FOLDER_NAME: '03_raw_response',
  DEFAULT_MODEL: 'gemini-3.1-flash-lite',
  MAX_PDF_MB: 30
};


/**
 * 手動テスト用。
 * まずは TEST_PDF_FILE_ID を差し替えて実行。
 */
function test_piGeneratePageImprovementFromPdf() {
  const TEST_PDF_FILE_ID = '1GEySPXRRSGgvTCW2nIItr1JJcaB5BWZ8';

  const context = {
    productName: '',
    asin: '',
    sku: '',
    currentPrice: '',
    targetPrice: '',
    improvementPurposes: [
      '商品ページの改善点を見つけたい',
      '競合と比較して弱い点を確認したい',
      '値上げに耐える訴求を整理したい',
      '画像・A+・タイトル・箇条書きを改善したい'
    ],
    humanHypothesis: '',
    notes: ''
  };

  const result = piGeneratePageImprovementFromPdf(TEST_PDF_FILE_ID, context);

  Logger.log('ページ改善Markdown生成完了');
  Logger.log('レポートフォルダ: ' + result.reportFolderUrl);
  Logger.log('PDFコピー: ' + result.pdfCopyUrl);
  Logger.log('Markdown: ' + result.markdownFileUrl);
  Logger.log('Raw response: ' + result.rawResponseFileUrl);
  Logger.log('--- Markdown preview ---');
  Logger.log(result.markdown.slice(0, 3000));
}


/**
 * PDFからページ改善Markdownを生成し、HAKSAI Central配下に保存する。
 *
 * @param {string} pdfFileId Drive上のPDFファイルID
 * @param {Object} context 商品情報・改善目的・人間の仮説など
 * @return {Object} 保存先URLなど
 */
function piGeneratePageImprovementFromPdf(pdfFileId, context) {
  if (!pdfFileId) {
    throw new Error('pdfFileId が指定されていません。');
  }

  const sourceFile = DriveApp.getFileById(pdfFileId);
  const pdfBlob = sourceFile.getBlob();

  piValidatePdfBlob_(pdfBlob);

  const prompt = piBuildPageImprovementPrompt_(sourceFile.getName(), context || {});
  const geminiResult = piCallGeminiWithPdf_(pdfBlob, prompt);

  const markdown = piExtractGeminiText_(geminiResult.responseJson);
  if (!markdown) {
    throw new Error('Gemini応答からMarkdown本文を取得できませんでした。');
  }

  const timestamp = piFormatTimestamp_(new Date());
  const folders = piCreateReportFolders_(sourceFile, context || {}, timestamp);

  const baseFileName = piBuildBaseFileName_(sourceFile, context || {}, timestamp);

  const pdfCopy = sourceFile.makeCopy(
    baseFileName + '.pdf',
    folders.inputPdfFolder
  );

  const markdownFile = piCreateTextFile_(
    folders.outputMdFolder,
    baseFileName + '.md',
    markdown
  );

  const rawResponseFile = piCreateTextFile_(
    folders.rawResponseFolder,
    baseFileName + '_raw_response.json',
    JSON.stringify(geminiResult.responseJson, null, 2)
  );

  return {
    markdown: markdown,
    usageMetadata: geminiResult.responseJson.usageMetadata || null,
    reportFolderUrl: folders.reportFolder.getUrl(),
    pdfCopyUrl: pdfCopy.getUrl(),
    markdownFileUrl: markdownFile.getUrl(),
    rawResponseFileUrl: rawResponseFile.getUrl()
  };
}


/**
 * PDFファイルの妥当性チェック。
 */
function piValidatePdfBlob_(blob) {
  const contentType = blob.getContentType();
  if (contentType !== 'application/pdf') {
    throw new Error('PDFファイルを指定してください。現在のMIME type: ' + contentType);
  }

  const sizeMb = blob.getBytes().length / 1024 / 1024;
  if (sizeMb > PI_CONFIG.MAX_PDF_MB) {
    throw new Error(
      'PDFが大きすぎます。v0では ' +
      PI_CONFIG.MAX_PDF_MB +
      'MB 以下を推奨します。現在: ' +
      sizeMb.toFixed(1) +
      'MB'
    );
  }
}


/**
 * Gemini APIへPDFとプロンプトを渡す。
 */
function piCallGeminiWithPdf_(pdfBlob, prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('Script Properties に GEMINI_API_KEY が設定されていません。');
  }

  const model =
    PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_PAGE_IMPROVEMENT') ||
    PI_CONFIG.DEFAULT_MODEL;

  const base64Pdf = Utilities.base64Encode(pdfBlob.getBytes());

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Pdf
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'text/plain'
    }
  };

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) +
    ':generateContent?key=' +
    encodeURIComponent(apiKey);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('Gemini API エラー: HTTP ' + status + '\n' + body);
  }

  return {
    responseJson: JSON.parse(body)
  };
}


/**
 * 汎用ページ改善プロンプト。
 * 商品固有の仮説は context からのみ入れる。
 */
function piBuildPageImprovementPrompt_(pdfFileName, context) {
  const productName = context.productName || '';
  const asin = context.asin || '';
  const sku = context.sku || '';
  const currentPrice = context.currentPrice || '';
  const targetPrice = context.targetPrice || '';
  const improvementPurposes = context.improvementPurposes || [];
  const humanHypothesis = context.humanHypothesis || '';
  const notes = context.notes || '';

  return `
あなたはAmazon.co.jp専門のEC商品ページ改善コンサルタントです。
添付PDFは、Amazonの商品ページ、検索結果ページ、または競合ページをChrome等でPDF化したものです。

PDFの文字情報だけでなく、ページ構成、ファーストビュー、商品画像の見え方、価格、レビュー、関連商品、広告枠、A+コンテンツ、Q&A、レビュー表示など、視覚的な情報も含めて分析してください。

# 重要ルール

- 必ずMarkdownのみで出力してください。
- コードブロックで囲まないでください。
- PDFから確認できた事実、AIによる解釈・仮説、改善提案を必ず分けてください。
- PDFから確認できない情報は「PDFからは確認できない」と明記してください。
- 未確認情報を断定しないでください。
- 実測していない数値を作らないでください。
- 根拠不明の品質保証・効果保証・安全保証・No.1表現は避けてください。
- 商品ページにそのまま使える文案は、PDFまたは提供コンテキストから確認できる情報だけで作成してください。
- 「高品質」「熟練工」「人間工学」「長時間疲れにくい」「メンテナンスフリー」「圧倒的」「最強」「完全」「必ず」など、根拠確認が必要な表現は避けてください。
- 比較表現を使う場合は、PDF内で確認できた競合情報に基づき、断定しすぎない表現にしてください。
- 画像改善案は、実物確認が必要なものには「要確認」と明記してください。
- Amazonの商品画像・A+に使う前提で、過剰演出や実物と異なる表現は避けてください。

# HAKSAIの基本方針

- ノーブランド商品の中で、画像・A+・用途訴求・公式感で差別化する
- 実用性重視
- 画像で理解させ、文章は補助
- 初速は検証優先
- 売上・レビュー・競合状況を見ながら価格を調整する
- 未確認情報は記載しない

# 対象情報

- PDFファイル名：${pdfFileName}
- 商品名：${productName}
- ASIN：${asin}
- SKU：${sku}
- 現在価格：${currentPrice}
- 目標価格：${targetPrice}
- 改善目的：${improvementPurposes.join(' / ')}

# 出品者側の仮説・メモ

${humanHypothesis || '未入力'}

# 補足メモ

${notes || '未入力'}

# 出力形式

# HAKSAI 商品ページ改善レポート

## 0. 判定サマリー

| 項目 | 判定 |
|---|---|
| PDF種別 | 商品ページ / 検索結果 / 競合ページ / レビュー / 不明 |
| PDF解析の信頼度 | 高 / 中 / 低 |
| 商品ページ改善に使える度 | 高 / 中 / 低 |
| 追加で必要な資料 |  |
| そのまま採用できる改善案 |  |
| 要確認の改善案 |  |
| 採用注意の表現 |  |

## 1. PDFから確認できた事実

以下を、PDFから確認できる範囲で整理してください。

- 商品名
- ASIN
- ブランド
- 価格
- 評価
- レビュー数
- カテゴリ
- ランキング
- 販売元
- 配送
- 仕様情報
- 表示されているキャンペーン
- 関連商品・スポンサー表示
- A+コンテンツの有無
- レビュー本文の有無

不明な項目は「PDFからは確認できない」と記載してください。

## 2. ファーストビュー診断

以下を評価してください。

- メイン画像の印象
- タイトルの分かりやすさ
- 価格の見え方
- レビュー数の強さ/弱さ
- Buy Box周辺の安心感
- 配送・販売元の見え方
- 広告枠・関連商品との比較での見え方
- 購入者が一瞬で理解できること
- 購入者が一瞬では理解できないこと

## 3. 現在ページの強み

PDFから確認できる情報に基づいて、強みを整理してください。

## 4. 現在ページの弱み

PDFから確認できる情報に基づいて、弱みを整理してください。
特に以下を分けてください。

- 売上改善上の弱み
- CVR改善上の弱み
- 値上げに耐えるうえでの弱み
- 競合比較での弱み
- 情報不足による弱み

## 5. AIによる解釈・仮説

ここでは推測であることを明示したうえで、PDFから読み取れる仮説を整理してください。

- 想定される購入者
- 想定される使用シーン
- 価格帯の立ち位置
- 競合に対する勝ち筋
- 競合に対する負け筋

## 6. 競合・関連商品から読み取れること

PDFに表示されている関連商品・スポンサー商品・競合価格・レビュー数・画像の見え方から、競争環境を整理してください。

| 競合/関連商品の特徴 | 価格帯 | レビュー数 | 強そうな点 | 自社が勝てそうな点 |
|---|---:|---:|---|---|

PDFから確認できない項目は空欄または「不明」としてください。

## 7. レビューから拾える顧客表現

レビュー本文がPDF内にある場合、購入者が実際に使っている言葉を抽出してください。

### ポジティブ表現

### 注意点・低評価予防につながる表現

### 商品ページに反映すべき表現

レビュー本文がない場合は「PDFからはレビュー本文を確認できない」と記載してください。

## 8. 商品画像の改善方向

PDFから商品画像ギャラリー全体が確認できるかどうかを最初に明記してください。

そのうえで、以下を提案してください。

| 枚数 | 役割 | 改善案 | 根拠 | 要確認 |
|---:|---|---|---|---|
| 1枚目 | メイン画像 |  |  |  |
| 2枚目 | 使用シーン |  |  |  |
| 3枚目 | 課題→解決 |  |  |  |
| 4枚目 | 使い方 |  |  |  |
| 5枚目 | メリット |  |  |  |
| 6枚目 | 仕様・サイズ |  |  |  |
| 7枚目 | クロスセル/使用拡張 |  |  |  |

## 9. A+コンテンツ改善案

A+がPDF内に確認できる場合、以下を整理してください。

- 現在のA+の良い点
- 現在のA+の弱い点
- 追加すべきモジュール
- 削ってよい情報
- 強化すべき訴求
- 値上げに耐えるために必要な表現

A+が確認できない場合は「PDFからはA+を確認できない」と記載してください。

## 10. タイトル改善案

SEOと読みやすさの両方を考慮して3案出してください。
未確認情報は盛らないでください。

| 案 | タイトル案 | 狙い | 注意点 |
|---:|---|---|---|

## 11. 箇条書き5項目の改善案

Amazon商品ページに使える形式で5項目出してください。
ただし、未確認情報・根拠不明の品質保証・過剰表現は避けてください。

| 項目 | 見出し | 本文 | 根拠 | 要確認 |
|---:|---|---|---|---|

## 12. Q&A・注意書きに追加すべき内容

レビューやPDF内の情報から、低評価予防につながる説明を提案してください。

| 追加項目 | 目的 | 文案例 | 根拠 | 要確認 |
|---|---|---|---|---|

## 13. 値上げに耐えるための訴求強化

現在価格から目標価格に上げる場合、ページ上で補強すべき理由を整理してください。
目標価格が未入力の場合は、一般論として整理してください。

- 値上げ前に必要な情報
- 価格差を納得させる訴求
- 画像で補強すべき点
- A+で補強すべき点
- レビューが増えるまで待つべき点

## 14. 採用注意・要確認リスト

このセクションは必ず出してください。

| 表現・施策 | 理由 | 対応 |
|---|---|---|

例：
- 実測していない音量表現
- 根拠不明の耐久性表現
- 他社比較の断定
- 実物と異なる画像演出
- レビューに反する説明

## 15. 優先順位つき改善アクション

「すぐやる」「次にやる」「後でよい」に分けてください。

### すぐやる

### 次にやる

### 後でよい

## 16. 追加で取得すべき資料

このPDFだけでは不足する資料を挙げてください。

- 商品画像ギャラリースクショ
- 検索結果PDF
- 競合商品ページPDF
- 競合レビュー
- 自社レビュー
- 仕入れ元画像
- 実物写真
- その他
`;
}


/**
 * Gemini応答から本文テキストを抽出。
 */
function piExtractGeminiText_(json) {
  if (!json || !json.candidates || !json.candidates.length) return '';

  const candidate = json.candidates[0];
  if (!candidate.content || !candidate.content.parts) return '';

  return candidate.content.parts
    .map(function(part) {
      return part.text || '';
    })
    .join('\n')
    .trim();
}


/**
 * HAKSAI Central配下にレポート用フォルダ一式を作成。
 */
function piCreateReportFolders_(sourceFile, context, timestamp) {
  const centralFolder = DriveApp.getFolderById(PI_CONFIG.CENTRAL_FOLDER_ID);
  const rootFolder = piGetOrCreateChildFolder_(centralFolder, PI_CONFIG.ROOT_FOLDER_NAME);

  const asin = context.asin || 'ASIN未設定';
  const shortName = piSafeFileName_(
    context.productName || sourceFile.getName().replace(/\.pdf$/i, '')
  ).slice(0, 60);

  const reportFolderName = timestamp + '_' + asin + '_' + shortName;
  const reportFolder = rootFolder.createFolder(reportFolderName);

  const inputPdfFolder = reportFolder.createFolder(PI_CONFIG.INPUT_PDF_FOLDER_NAME);
  const outputMdFolder = reportFolder.createFolder(PI_CONFIG.OUTPUT_MD_FOLDER_NAME);
  const rawResponseFolder = reportFolder.createFolder(PI_CONFIG.RAW_RESPONSE_FOLDER_NAME);

  return {
    reportFolder: reportFolder,
    inputPdfFolder: inputPdfFolder,
    outputMdFolder: outputMdFolder,
    rawResponseFolder: rawResponseFolder
  };
}


/**
 * 指定フォルダ直下に子フォルダがあれば取得、なければ作成。
 */
function piGetOrCreateChildFolder_(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(folderName);
}


/**
 * テキストファイルを作成。
 */
function piCreateTextFile_(folder, fileName, text) {
  return folder.createFile(fileName, text, MimeType.PLAIN_TEXT);
}


/**
 * 保存ファイル名のベースを作成。
 */
function piBuildBaseFileName_(sourceFile, context, timestamp) {
  const asin = context.asin || 'ASIN未設定';
  const productName = context.productName || sourceFile.getName().replace(/\.pdf$/i, '');

  const safeProductName = piSafeFileName_(productName).slice(0, 90);

  return timestamp + '_page_improvement_' + asin + '_' + safeProductName;
}


/**
 * ファイル名に使えない文字を除去。
 */
function piSafeFileName_(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * yyyyMMdd_HHmmss
 */
function piFormatTimestamp_(date) {
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );
}