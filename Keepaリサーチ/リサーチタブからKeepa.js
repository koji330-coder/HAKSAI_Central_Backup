/**
 * KeepaからASINの商品詳細を取得する（失敗してもnullを返す）
 */
function tryGetKeepaData_(asin) {
  try {
    if (!asin || asin.trim() === '') return null;
    const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
    if (!apiKey) return null;

    const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&asin=${asin.trim()}&history=0`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (response.getResponseCode() !== 200) return null;

    const json = JSON.parse(response.getContentText());
    if (json.tokensLeft < 0) {
      Logger.log('Keepaトークン不足のためスキップ');
      return null;
    }

    const p = json.products?.[0];
    if (!p) return null;

    return {
      title:       p.title || null,
      brand:       p.brand || null,
      features:    p.features || [],
      description: p.description || null,
      // 修正後
      imageCount: Array.isArray(p.images) ? p.images.length : 0,
      hasAplus:    !!(p.aPlus && p.aPlus.length > 0),
      monthlySold: p.monthlySold ?? null,
    };
  } catch(e) {
    Logger.log('Keepaデータ取得スキップ: ' + e.message);
    return null;
  }
}