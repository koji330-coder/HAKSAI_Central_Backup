/**
 * リサーチ候補・仕入候補向けの概算利益計算・コストシミュレーション
 */

/**
 * プロジェクト（ライフサイクル行）と中国元単価から、セーフガードおよび自社実績フィードバック付きで概算の着地原価・利益を計算する
 * @param {Object} project product_lifecycle または page_projects の行データ
 * @param {number|string} unitPriceCny 中国元の仕入単価
 * @return {Object} コストシミュレーション結果のJSONオブジェクト
 */
function calculateRoughProfit_(project, unitPriceCny) {
  project = project || {};
  
  // 1. 中国元単価の決定（バリエーション最安値パース処理を含む）
  let cny = Number(String(unitPriceCny || 0).replace(/[^\d\.]/g, ''));
  
  if (cny <= 0 && project.supplier_selection && project.supplier_selection.extracted) {
    // 採用候補のバリエーション配列から最安値を自動で抽出
    const vars = project.supplier_selection.extracted.variations || [];
    let minVarPrice = Infinity;
    vars.forEach(function(v) {
      if (v && typeof v === 'object') {
        const p = Number(v.price || v.unit_price || v.price_cny || 0);
        if (p > 0 && p < minVarPrice) minVarPrice = p;
      } else if (v && (typeof v === 'number' || typeof v === 'string')) {
        const p = Number(String(v).replace(/[^\d\.]/g, ''));
        if (p > 0 && p < minVarPrice) minVarPrice = p;
      }
    });
    if (minVarPrice !== Infinity) {
      cny = minVarPrice;
      Logger.log('Adopt: バリエーション最安値 ' + cny + '元 を自動利益計算に採用しました。');
    }
  }

  // 競合価格
  const price = Number(project.price || 0);

  // 単価もバリエーションも取れない場合は、競合価格の30%を目標元単価(JPY)とし、
  // デフォルトレート32で割った概算元単価を逆算して仮設定する
  if (cny <= 0) {
    cny = Math.round((price * 0.3) / 32.0);
    Logger.log('Adopt: 単価・バリエーションが未取得のため、競合価格から目標単価 ' + cny + '元 を仮設定しました。');
  }

  // 2. 自社実績（トランザクション履歴）からのレート・手数料の自動取得
  let yenPerCny = 32.0;    // デフォルト値
  let fbaFee = 450;        // 実績がない場合の標準サイズデフォルト
  let amazonFeeRate = 0.15; // 実績がない場合の標準販売手数料率デフォルト

  try {
    // sourcing_decision_pack の buildDecisionPack を呼び出して自社実績を取得
    const pack = buildDecisionPack('');
    
    // 実質為替レートの中央値
    const medianRate = pack.yen_per_cny_composite_median;
    if (medianRate != null && medianRate >= 20 && medianRate <= 50) {
      yenPerCny = Number(medianRate);
    }
    
    // 自社のFBA手数料実績の中央値
    if (pack.fee_table && pack.fee_table.length > 0) {
      const fbaFees = pack.fee_table.map(function(item) { return item.fba_fee_unit; }).filter(function(v) { return v > 0; });
      if (fbaFees.length > 0) {
        fbaFee = Math.round(roughMedian_(fbaFees));
        Logger.log('Adopt: 自社FBA手数料実績から中央値 ' + fbaFee + '円 をデフォルト値として採用しました。');
      }
      
      const amzRates = pack.fee_table.map(function(item) { return item.fee_rate_taxin; }).filter(function(v) { return v > 0; });
      if (amzRates.length > 0) {
        amazonFeeRate = roughMedian_(amzRates);
        Logger.log('Adopt: 自社販売手数料実績から中央値 ' + (amazonFeeRate * 100).toFixed(1) + '% を採用しました。');
      }
    }
  } catch (err) {
    Logger.log('Adopt: 自社実績の取得に失敗したため、安全寄りのデフォルト値を使用します: ' + err);
  }

  // 3. 概算着地原価（日本到着原価）
  const landedCost = Math.round(cny * yenPerCny);

  // 4. Amazon販売手数料の計算
  const amazonFee = Math.round(price * amazonFeeRate);

  // 5. FBA配送代行手数料（大型キーワードセーフガード付き）
  const title = String(project.title || '').toLowerCase();
  const category = String(project.category || '').toLowerCase();
  const heavyKeywords = ['大型', 'セット', '折りたたみ', '折り畳み', 'ケース付き', 'まとめ買い', '重量', '鉄', '木製', 'box', '収納ボックス', 'ラック'];
  const isHeavy = heavyKeywords.some(function(kw) {
    return title.indexOf(kw) !== -1 || category.indexOf(kw) !== -1;
  });

  if (isHeavy) {
    // 大型の場合は、自社実績の中央値に依存せず安全に900円をセット
    fbaFee = 900;
    Logger.log('Adopt: 大型・重量物の疑いがあるため、FBA手数料を 900円 に設定しました。');
  }

  // 6. 堅実な販売予測（競合月販の10%シェア）
  const monthlySales = Number(project.monthly_sales || project.monthly_sold || 0);
  const plannedSales = Math.max(1, Math.round(monthlySales * 0.1)); // 最低1個

  // 7. 利益額・利益率の算出
  const netProfitUnit = price - landedCost - amazonFee - fbaFee;
  const profitRate = price > 0 ? (netProfitUnit / price) : 0;
  const expectedMonthlyProfit = netProfitUnit * plannedSales;

  const costSimulation = {
    price: price,
    cost: landedCost,     // 日本到着原価
    rakumart: 0,
    shipping: 0,
    amazon: amazonFee,
    fba: fbaFee,
    ad: 0,
    other: 0,
    // 堅実なAI予測・シミュレーション用の結果
    planned_monthly_sales: plannedSales,
    net_profit_unit: netProfitUnit,
    profit_rate: Number((profitRate * 100).toFixed(1)),
    expected_monthly_profit: expectedMonthlyProfit,
    is_rough_simulated: true, // 自動概算フラグ
    simulated_at: new Date().toISOString()
  };

  Logger.log('概算シミュレーション完了: ' + JSON.stringify(costSimulation));
  return costSimulation;
}

/**
 * 簡易中央値（メディアン）算出関数
 */
function roughMedian_(arr) {
  if (!arr || !arr.length) return 0;
  const s = arr.slice().sort(function(a, b) { return a - b; });
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
