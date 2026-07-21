// ============================================
// 広告ターゲット探索 Phase 1
// Step 1: 販売中ASIN起点で、商品ターゲティング候補を決定論で抽出する。
// UI/API/シート保存は検証後に追加する。
// ============================================

const AD_TARGET_FINDER_MIN_TOKENS = 35;
const AD_TARGET_FINDER_DOMAIN = 5; // Amazon.co.jp
const AD_TARGET_FINDER_DEFAULT_MONTHLY_SOLD_GTE = 30;
const AD_TARGET_FINDER_DETAIL_LIMIT = 20;
const AD_TARGET_FINDER_FINDER_PER_PAGE = 50;

function testAdTargetFinderPhase1_Saddle() {
  return findAdTargetsPhase1Step1_({
    asin: 'B0G7H5TNLH',
    monthlySoldGte: AD_TARGET_FINDER_DEFAULT_MONTHLY_SOLD_GTE
  });
}

function findAdTargetsPhase1Step1_(opts) {
  opts = opts || {};
  const ownAsin = adTargetNormalizeAsin_(opts.asin || opts.ownAsin);
  const apiKey = adTargetKeepaApiKey_();
  const tokensLeft = adTargetGetKeepaTokensLeft_(apiKey);
  if (tokensLeft < AD_TARGET_FINDER_MIN_TOKENS) {
    const skipped = {
      status: 'skipped',
      reason: 'token_shortage',
      message: 'Keepaトークン不足。約1時間後に再実行してください。',
      tokens_left: tokensLeft,
      required_tokens: AD_TARGET_FINDER_MIN_TOKENS
    };
    Logger.log(JSON.stringify(skipped, null, 2));
    return skipped;
  }

  Logger.log('=== Ad Target Finder Phase1 Step1 開始: ' + ownAsin + ' ===');
  Logger.log('実行前Keepaトークン: ' + tokensLeft);

  const ownProduct = adTargetFetchKeepaProducts_([ownAsin], { statsDays: 90, aplus: true })[0];
  if (!ownProduct) throw new Error('自社ASINのKeepa商品情報を取得できませんでした: ' + ownAsin);

  const ownFacts = adTargetBuildOwnFacts_(ownProduct);
  if (!ownFacts.category_id) throw new Error('カテゴリnodeを取得できませんでした: ' + ownAsin);
  if (!ownFacts.price) throw new Error('現在価格を取得できませんでした: ' + ownAsin);

  const monthlySoldGte = Number(opts.monthlySoldGte || opts.monthlySoldGteOverride) || AD_TARGET_FINDER_DEFAULT_MONTHLY_SOLD_GTE;
  const priceGte = Number(opts.priceGte || opts.priceGteOverride) || (ownFacts.price + 1);
  const ownAsins = adTargetGetOwnAsinSet_();
  ownAsins.add(ownAsin);

  let finder = adTargetRunFinderForCategory_(apiKey, {
    categoryId: ownFacts.category_id,
    priceGte: priceGte,
    ratingLte: ownFacts.rating_10x,
    monthlySoldGte: monthlySoldGte
  });
  let categoryUsed = ownFacts.category_id;
  let categoryNameUsed = ownFacts.category_name;
  let fallbackUsed = false;

  if ((finder.asinList || []).length < 5 && ownFacts.parent_category_id) {
    Logger.log('leafカテゴリの候補が5件未満のため、親カテゴリへフォールバックします: ' + ownFacts.parent_category_id);
    const fallback = adTargetRunFinderForCategory_(apiKey, {
      categoryId: ownFacts.parent_category_id,
      priceGte: priceGte,
      ratingLte: ownFacts.rating_10x,
      monthlySoldGte: monthlySoldGte
    });
    if ((fallback.asinList || []).length > (finder.asinList || []).length) {
      finder = fallback;
      categoryUsed = ownFacts.parent_category_id;
      categoryNameUsed = ownFacts.parent_category_name;
      fallbackUsed = true;
    }
  }

  const candidateAsins = (finder.asinList || [])
    .map(adTargetNormalizeAsin_)
    .filter(function(asin) { return asin && !ownAsins.has(asin); })
    .slice(0, AD_TARGET_FINDER_DETAIL_LIMIT);

  const detailProducts = candidateAsins.length
    ? adTargetFetchKeepaProducts_(candidateAsins, { statsDays: 90, aplus: true })
    : [];

  const candidates = detailProducts
    .filter(Boolean)
    .map(function(product) { return adTargetBuildCandidate_(product, ownFacts); })
    .filter(function(candidate) { return candidate.target_asin && !ownAsins.has(candidate.target_asin); })
    .sort(function(a, b) {
      return (b.score - a.score) || (b.monthly_sold - a.monthly_sold) || (b.price_gap - a.price_gap);
    });

  const afterTokens = adTargetGetKeepaTokensLeft_(apiKey);
  const result = {
    status: 'ok',
    mode: 'phase1_step1',
    own: ownFacts,
    query: {
      category_id: categoryUsed,
      category_name: categoryNameUsed,
      fallback_used: fallbackUsed,
      current_NEW_gte: priceGte,
      current_RATING_lte: ownFacts.rating_10x || null,
      monthlySold_gte: monthlySoldGte,
      perPage: AD_TARGET_FINDER_FINDER_PER_PAGE
    },
    finder: {
      total_results: finder.totalResults || 0,
      asin_count: (finder.asinList || []).length,
      detail_count: detailProducts.length
    },
    tokens: {
      before: tokensLeft,
      after: afterTokens,
      consumed_estimate: tokensLeft - afterTokens
    },
    candidates: candidates
  };

  adTargetLogPhase1Result_(result);
  return result;
}

function adTargetRunFinderForCategory_(apiKey, params) {
  const selection = {
    productType: [0],
    categories_include: [Number(params.categoryId)],
    current_NEW_gte: Number(params.priceGte),
    monthlySold_gte: Number(params.monthlySoldGte),
    sort: [['monthlySold', 'desc']],
    perPage: AD_TARGET_FINDER_FINDER_PER_PAGE,
    page: 0
  };
  if (params.ratingLte) selection.current_RATING_lte = Number(params.ratingLte);

  const url = 'https://api.keepa.com/query?domain=' + AD_TARGET_FINDER_DOMAIN + '&key=' + encodeURIComponent(apiKey);
  Logger.log('Product Finder query: ' + JSON.stringify(selection));
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(selection),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) throw new Error('Keepa Product Finder failed HTTP ' + code + ': ' + text.substring(0, 500));
  const json = JSON.parse(text);
  Logger.log('Finder残トークン: ' + json.tokensLeft + ' / totalResults: ' + json.totalResults + ' / asinList: ' + ((json.asinList || []).length));
  return json;
}

function adTargetFetchKeepaProducts_(asins, options) {
  options = options || {};
  const apiKey = adTargetKeepaApiKey_();
  const cleanAsins = (asins || []).map(adTargetNormalizeAsin_).filter(Boolean);
  if (!cleanAsins.length) return [];
  const statsDays = Number(options.statsDays || 90);
  let url = 'https://api.keepa.com/product?key=' + encodeURIComponent(apiKey)
    + '&domain=' + AD_TARGET_FINDER_DOMAIN
    + '&asin=' + encodeURIComponent(cleanAsins.join(','))
    + '&history=0&stats=' + statsDays
    + '&rating=1';
  if (options.aplus) url += '&aplus=1';

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) throw new Error('Keepa product failed HTTP ' + code + ': ' + text.substring(0, 500));
  const json = JSON.parse(text);
  Logger.log('Product detail残トークン: ' + json.tokensLeft + ' / products: ' + ((json.products || []).length));
  return json.products || [];
}

function adTargetBuildOwnFacts_(product) {
  const categoryInfo = adTargetCategoryInfo_(product);
  const price = adTargetCurrentPrice_(product);
  const rating10x = adTargetCurrentKeepaValue_(product, 17);
  const reviewCount = adTargetCurrentKeepaValue_(product, 16) || 0;
  return {
    asin: adTargetNormalizeAsin_(product.asin),
    title: product.title || '',
    brand: product.brand || '',
    price: price,
    rating: rating10x ? rating10x / 10 : null,
    rating_10x: rating10x || null,
    review_count: reviewCount,
    category_id: categoryInfo.leafId,
    category_name: categoryInfo.leafName,
    parent_category_id: categoryInfo.parentId,
    parent_category_name: categoryInfo.parentName,
    category_path: categoryInfo.path
  };
}

function adTargetBuildCandidate_(product, ownFacts) {
  const price = adTargetCurrentPrice_(product) || 0;
  const rating10x = adTargetCurrentKeepaValue_(product, 17);
  const reviewCount = adTargetCurrentKeepaValue_(product, 16) || 0;
  const imageCount = Array.isArray(product.images) ? product.images.length : 0;
  const hasAplus = !!(product.aPlus && product.aPlus.length > 0);
  const monthlySold = Number(product.monthlySold || 0);
  const offerCount = product.liveOffersOrder ? product.liveOffersOrder.length : 0;
  const rating = rating10x ? rating10x / 10 : null;
  const priceGap = price && ownFacts.price ? price - ownFacts.price : 0;
  const score = adTargetScoreCandidate_({
    priceGap: priceGap,
    rating10x: rating10x,
    ownRating10x: ownFacts.rating_10x,
    imageCount: imageCount,
    hasAplus: hasAplus,
    reviewCount: reviewCount,
    ownReviewCount: ownFacts.review_count
  });

  return {
    target_asin: adTargetNormalizeAsin_(product.asin),
    title: product.title || '',
    brand: product.brand || '',
    price: price,
    price_gap: priceGap,
    rating: rating,
    review_count: reviewCount,
    monthly_sold: monthlySold,
    image_count: imageCount,
    has_aplus: hasAplus,
    offer_count: offerCount,
    score: score,
    amazon_url: 'https://www.amazon.co.jp/dp/' + adTargetNormalizeAsin_(product.asin)
  };
}

function adTargetScoreCandidate_(facts) {
  let score = 0;
  if (facts.priceGap > 0) score += Math.min(30, Math.floor(facts.priceGap / 100) * 3);
  if (facts.ownRating10x && facts.rating10x && facts.rating10x <= facts.ownRating10x) score += 20;
  if (facts.imageCount <= 5) score += 15;
  if (!facts.hasAplus) score += 15;
  if (!facts.ownReviewCount || facts.reviewCount <= facts.ownReviewCount * 10) score += 20;
  return score;
}

function adTargetCurrentPrice_(product) {
  return adTargetCurrentKeepaValue_(product, 1);
}

function adTargetCurrentKeepaValue_(product, index) {
  const statsCurrent = product && product.stats && product.stats.current;
  let value = Array.isArray(statsCurrent) ? Number(statsCurrent[index]) : NaN;
  if (isFinite(value) && value > 0) return value;

  const series = product && product.csv && product.csv[index];
  if (Array.isArray(series)) {
    for (let i = series.length - 1; i >= 1; i -= 2) {
      value = Number(series[i]);
      if (isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function adTargetCategoryInfo_(product) {
  const tree = Array.isArray(product.categoryTree) ? product.categoryTree : [];
  const path = tree.map(function(node) { return node && node.name ? String(node.name) : ''; }).filter(Boolean);
  const leaf = tree.length ? tree[tree.length - 1] : null;
  const parent = tree.length >= 2 ? tree[tree.length - 2] : null;
  return {
    leafId: leaf ? Number(leaf.catId || leaf.id || leaf.categoryId) : null,
    leafName: leaf ? String(leaf.name || '') : '',
    parentId: parent ? Number(parent.catId || parent.id || parent.categoryId) : null,
    parentName: parent ? String(parent.name || '') : '',
    path: path
  };
}

function adTargetGetOwnAsinSet_() {
  const set = new Set();
  try {
    const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
    const data = sheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
      const asinIdx = headers.indexOf('asin');
      const launchedIdx = headers.indexOf('is_launched');
      const statusIdx = headers.indexOf('status');
      for (let i = 1; i < data.length; i++) {
        const asin = adTargetNormalizeAsin_(data[i][asinIdx]);
        if (!asin) continue;
        const launched = launchedIdx >= 0 && normalizeBool_(data[i][launchedIdx]);
        const status = statusIdx >= 0 ? String(data[i][statusIdx] || '').trim().toLowerCase() : '';
        if (launched || status === 'selling' || status === 'launched' || status === '販売中') set.add(asin);
      }
    }
  } catch (e) {
    Logger.log('自社ASIN除外 product_lifecycle skip: ' + e.message);
  }

  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('sku_master');
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(String);
      const asinIdx = headers.indexOf('asin');
      if (asinIdx >= 0) {
        for (let i = 1; i < data.length; i++) {
          const asin = adTargetNormalizeAsin_(data[i][asinIdx]);
          if (asin) set.add(asin);
        }
      }
    }
  } catch (e) {
    Logger.log('自社ASIN除外 sku_master skip: ' + e.message);
  }
  return set;
}

function adTargetGetKeepaTokensLeft_(apiKey) {
  const response = UrlFetchApp.fetch('https://api.keepa.com/token?key=' + encodeURIComponent(apiKey), { muteHttpExceptions: true });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) throw new Error('Keepa token check failed HTTP ' + code + ': ' + text.substring(0, 300));
  const json = JSON.parse(text);
  return Number(json.tokensLeft || 0);
}

function adTargetKeepaApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定');
  return apiKey;
}

function adTargetNormalizeAsin_(asin) {
  const value = String(asin || '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(value) ? value : '';
}

function adTargetLogPhase1Result_(result) {
  Logger.log('=== Ad Target Finder Phase1 Step1 結果 ===');
  Logger.log('自社: ' + result.own.asin + ' / ' + result.own.title);
  Logger.log('カテゴリ: ' + result.query.category_name + ' (' + result.query.category_id + ')' + (result.query.fallback_used ? ' fallback' : ''));
  Logger.log('条件: price>=' + result.query.current_NEW_gte + ' / rating<=' + result.query.current_RATING_lte + ' / monthlySold>=' + result.query.monthlySold_gte);
  Logger.log('Finder: total=' + result.finder.total_results + ' / asins=' + result.finder.asin_count + ' / details=' + result.finder.detail_count);
  Logger.log('Keepa tokens: before=' + result.tokens.before + ' / after=' + result.tokens.after + ' / consumed=' + result.tokens.consumed_estimate);
  result.candidates.slice(0, 20).forEach(function(c, i) {
    Logger.log([
      '#' + (i + 1),
      '[' + c.score + ']',
      c.target_asin,
      '¥' + c.price,
      '(+' + c.price_gap + ')',
      c.rating ? ('★' + c.rating.toFixed(1)) : '★-',
      c.review_count + '件',
      '月販' + c.monthly_sold,
      '画像' + c.image_count,
      c.has_aplus ? 'A+あり' : 'A+なし',
      c.title
    ].join(' '));
  });
}
