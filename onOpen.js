

// マニュアルのダイアログを表示する関数
function showManual() {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6; }
        h1 { color: #1a9e6e; font-size: 20px; border-bottom: 2px solid #e8d5a3; padding-bottom: 5px; }
        h2 { color: #4a8fd4; font-size: 16px; margin-top: 24px; border-left: 4px solid #4a8fd4; padding-left: 8px; }
        h3 { font-size: 14px; color: #555; }
        ul { padding-left: 20px; }
        li { margin-bottom: 6px; font-size: 13px; }
        .highlight { background-color: #f0f7ff; padding: 10px; border-radius: 5px; border: 1px solid #cce3f6; }
        .quote { background-color: #f9f9f9; padding: 10px; border-left: 4px solid #ccc; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <h1>HAKSAI Research Deck マニュアル</h1>
      
      <div class="highlight">
        このツールは、Amazon物販における「利益計算〜仕入れ先管理〜実績振り返り」までを一気通貫で行う、実務特化型プロフェッショナルWebアプリです。
      </div>

      <h2>1. 開発の目的</h2>
      <ul>
        <li>リサーチの摩擦を極限まで下げ、アイデア出しから販売までのプロセスをシームレスに管理する。</li>
        <li>HAKSAIの「生々しい実務ノウハウ（月100個以上の需要、図解が効く商品など）」をAI（Gemini）に学習させ、専用アシスタントとして活用する。</li>
        <li>ボツ案や成功体験を物理削除せず「アーカイブ」や「ポートフォリオ」として残し、ブランドのナレッジベースとして資産化する。</li>
      </ul>

      <h2>2. 大規模改修（v6）の経緯と理由</h2>
      <h3>① UIのリスト形式への移行</h3>
      <p class="quote">
        旧型の「スワイプ形式（Tinder形式）」は、操作のたびにGASの通信待ちが発生し、画面が固まるという致命的な課題がありました。これを「リスト一覧＋詳細モーダル」方式へ切り替え、安定性と実用性を極限まで高めました。
      </p>
      
      <h3>② データベース構造の統合（product_lifecycleの誕生）</h3>
      <p class="quote">
        旧システムでは「リサーチ（cards）」と「ページ制作（page_projects）」が分断されており、販売実績や発注履歴を追跡できない問題がありました。改修により、商品のライフサイクル（リサーチ→ページ案→販売中→撤退）を「1つのテーブル、1つの行」で追跡できるようにしました。
      </p>

      <h2>3. ツールの主な機能（5つのタブ）</h2>
      <ul>
        <li><b>🔍 リサーチ:</b> Amazon画像とメモから、AIが「冷静な仕入れ審査官（リスク・市場性）」と「編集プロデューサー（差別化・画像構成）」の二人格で分析。利益シミュレーター搭載。</li>
        <li><b>🎨 ページ案:</b> 競合の弱点や仕入れ元情報などの追加素材を元に、AIがAmazonタイトル案、箇条書き5項目、商品説明、画像7枚の構成（GPT向け指示書含む）を自動生成。</li>
        <li><b>💰 販売中:</b> ASIN、GTIN、1688仕入元URLを紐付け。販売後の実績（実売価格、月間販売数、広告依存度）を記録し、初期予測との答え合わせを行う。</li>
        <li><b>📦 発注管理:</b> 追加された「reorder_history」シートと連動。過去の着地原価の推移をグラフ化し、次回の発注ロット数に応じた利益シミュレーションを行う。</li>
        <li><b>📁 アーカイブ:</b> 不要になったカードを削除せず保管。将来のリサーチのヒントとして残す。</li>
      </ul>

      <h2>4. ステータスの流れ</h2>
      <div class="quote">
        research（リサーチ）<br>
        ↓ [ページ案生成]<br>
        page_planning（構成前〜ページ案完成）<br>
        ↓ [輸入判断OK, GTIN/ASIN取得]<br>
        selling（販売中）<br>
        ↓ [停止・撤退判定]<br>
        paused / discontinued（保留/撤退）
      </div>

    </body>
    </html>
  `;

  // モーダルダイアログとして表示
  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(600)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'HAKSAI Research Deck マニュアル');
}