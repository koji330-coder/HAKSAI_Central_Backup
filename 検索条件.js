function parseSelectionSummary(json) {
  const labels = [];

  // 価格
  if (json.current_BUY_BOX_SHIPPING_gte != null || json.current_BUY_BOX_SHIPPING_lte != null) {
    labels.push(`価格 ¥${json.current_BUY_BOX_SHIPPING_gte ?? 0}〜¥${json.current_BUY_BOX_SHIPPING_lte ?? '∞'}`);
  }

  // 月販
  if (json.monthlySold_gte != null) labels.push(`月販 ${json.monthlySold_gte}+`);
  if (json.monthlySold_lte != null) labels.push(`月販 〜${json.monthlySold_lte}`);

  // レビュー
  if (json.current_COUNT_REVIEWS_lte != null) labels.push(`レビュー ≤${json.current_COUNT_REVIEWS_lte}`);
  if (json.current_COUNT_REVIEWS_gte != null) labels.push(`レビュー ≥${json.current_COUNT_REVIEWS_gte}`);

  // 画像
  if (json.imageCount_lte != null) labels.push(`画像 ≤${json.imageCount_lte}枚`);

  // A+・動画・電池
  if (json.hasAPlus === false) labels.push('A+なし');
  if (json.hasAPlus === true)  labels.push('A+あり');
  if (json.hasMainVideo === false) labels.push('動画なし');
  if (json.hasMainVideo === true)  labels.push('動画あり');
  if (json.batteriesRequired === false) labels.push('電池不要');
  if (json.isHazMat === false) labels.push('危険物除外');
  if (json.buyBoxIsFBA === true) labels.push('FBAのみ');

  // カテゴリ
  if (json.categories_include?.length) labels.push(`カテゴリ指定 ${json.categories_include.length}件`);
  if (json.rootCategory?.length) labels.push(`ルートカテゴリ ${json.rootCategory.length}件`);

  // ソート
  if (json.sort?.length) {
    const sortMap = {
      'current_SALES': 'セールスランク',
      'monthlySold':   '月販数',
      'current_BUY_BOX_SHIPPING': 'BuyBox価格',
      'current_COUNT_REVIEWS': 'レビュー数',
    };
    const sortStr = json.sort.map(([f, o]) => `${sortMap[f] || f} ${o === 'asc' ? '↑' : '↓'}`).join('・');
    labels.push(`ソート: ${sortStr}`);
  }

  return labels;
}