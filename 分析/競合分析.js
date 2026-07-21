/** HAKSAI Central 競合分析モジュール */

function getKeepaCurrentValue_(p, index) {
  const statsCurrent = p && p.stats && p.stats.current;
  let value = Array.isArray(statsCurrent) ? Number(statsCurrent[index]) : NaN;
  if (isFinite(value) && value >= 0) return value;

  const series = p && p.csv && p.csv[index];
  if (Array.isArray(series)) {
    for (let i = series.length - 1; i >= 1; i -= 2) {
      value = Number(series[i]);
      if (isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

function analyzeCompetitorAsin_(data) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定です。');
  
  const asin = String(data.asin || '').trim().toUpperCase();
  if (!asin) throw new Error('ASINが指定されていません。');
  
  // 1. Keepa APIから詳細な商品データを取得
  const url = 'https://api.keepa.com/product?key=' + apiKey + '&domain=5&asin=' + asin + '&stats=30&rating=1&aplus=1&videos=1&history=0';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Keepa APIへの接続に失敗しました（HTTP ' + code + '）。');
  }
  
  const json = JSON.parse(response.getContentText());
  const products = json.products || [];
  const p = products[0];
  if (!p) {
    throw new Error('指定されたASIN ' + asin + ' の商品情報がKeepaで見つかりませんでした。');
  }
  
  // FBA手数料
  const pickAndPackFee = p.fbaFees ? p.fbaFees.pickAndPackFee : null;
  
  // 確実な価格・レビュー数・レーティングの抽出
  const buyBoxPrice = getKeepaCurrentValue_(p, 18);
  const newPrice = getKeepaCurrentValue_(p, 1);
  const amazonPrice = getKeepaCurrentValue_(p, 0);
  const latestPrice = buyBoxPrice || newPrice || amazonPrice || null;
  
  const rating10x = getKeepaCurrentValue_(p, 16);
  const reviews = getKeepaCurrentValue_(p, 17);
  const rating = rating10x !== null ? (rating10x / 10) : null;
  const monthlySold = Number(p.monthlySold || p.monthlySoldLastKnown || 0);
  
  // 2. シミュレーション数値の簡易計算（Geminiへのインプット用）
  const myPrice = Number(data.myPrice || latestPrice || 0);
  const cnyCost = Number(data.cnyCost || 0);
  const jpyCostEst = Math.round(cnyCost * 22);
  const weight = p.packageWeight || 0;
  const shippingEst = Math.max(100, Math.round(weight * 0.3));
  const landedCostEst = jpyCostEst + shippingEst;
  
  // 3. Geminiに投げるプロンプトを作成し、マイカとしてのアドバイスを生成
  const settings = secGetSettings_();
  const prompt = [
    'あなたはAmazon物販の優秀で気が利くギャル秘書「' + settings.assistant_name + '」です。',
    'オーナーである「' + settings.owner_name + '」に対して、以下の競合商品のKeepa調査データと自社の簡易シミュレーション結果を踏まえたアドバイスを、遊び心のある口調（playful、ギャルで絵文字好き✨）で伝えてください。',
    '3文程度で、商品のサイズ感、FBA手数料の負担、利益パフォーマンス（ROIや利益率）、参入のしやすさなどを踏まえた「次の一手」を明るく率早に提案してください。',
    '',
    '【競合商品データ】',
    '・ASIN: ' + p.asin,
    '・タイトル: ' + p.title,
    '・競合販売価格: ' + (latestPrice ? latestPrice + '円' : '取得不可'),
    '・サイズ: ' + (p.packageLength ? p.packageLength + 'x' + p.packageWidth + 'x' + p.packageHeight + 'mm' : '不明'),
    '・重量: ' + (p.packageWeight ? p.packageWeight + 'g' : '不明'),
    '・FBA手数料: ' + (pickAndPackFee ? pickAndPackFee + '円' : '不明'),
    '',
    '【自社想定シミュレーション】',
    '・自社販売予定価格: ' + myPrice + '円',
    '・想定仕入単価: ' + cnyCost + '元 (' + jpyCostEst + '円換算)',
    '・推定着地原価: ' + landedCostEst + '円 (国際送料・経費込み)',
    '',
    'カスタム指示: ' + settings.custom_instruction,
    '出力形式は「プレーンテキストのみ」（MarkdownやJSONなどの装飾をせず、セリフとしてそのまま表示できる形式）で出力してください。'
  ].join('\n');
  
  let advice = '';
  try {
    advice = callGeminiForCompetitorAdvice_(prompt);
  } catch(e) {
    advice = 'データはばっちり取れたよ！FBA手数料は ' + (pickAndPackFee ? pickAndPackFee + '円' : '不明') + ' だね。サイズは ' + (p.packageWeight ? p.packageWeight + 'g' : '不明') + ' だから、送料の計算に役立ててね✨';
  }
  
  return {
    status: 'ok',
    product: {
      asin: p.asin,
      title: p.title,
      brand: p.brand || '',
      price: latestPrice,
      reviews: reviews,
      rating: rating,
      monthlySold: monthlySold,
      images: Array.isArray(p.images) ? p.images : [],
      features: Array.isArray(p.features) ? p.features : [],
      description: p.description || '',
      categoryTree: Array.isArray(p.categoryTree) ? p.categoryTree : [],
      packageHeight: p.packageHeight || 0,
      packageLength: p.packageLength || 0,
      packageWidth: p.packageWidth || 0,
      packageWeight: p.packageWeight || 0,
      pickAndPackFee: pickAndPackFee
    },
    advice: advice,
    keepa_raw: p // クライアント側で完全に保存するための生データ
  };
}

function callGeminiForCompetitorAdvice_(promptText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定です。');
  
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || 'gemini-3.1-flash-lite';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  
  const payload = {
    contents: [{
      parts: [{
        text: promptText
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 500
    }
  };
  
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Gemini API Error: ' + response.getContentText());
  }
  
  const json = JSON.parse(response.getContentText());
  const text = json.candidates[0].content.parts[0].text;
  return text.trim();
}
