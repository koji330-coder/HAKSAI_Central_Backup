// ============================================
// 横断診断 V1
// 既存の期間集計を横断し、AIへ相談する価値が高い論点を抽出する。
// 原因や施策は断定せず、数値上の事実・比較・母数だけを返す。
// ============================================

function getCrossDiagnostics(periodKey) {
  periodKey = String(periodKey || '').trim() || getLatestDiagnosticPeriod_();
  if (!periodKey) throw new Error('診断可能な期間がありません。');

  const periodData = getPeriodSummary(periodKey);
  const products = (periodData.products || []).filter(p => p.asin && !p.isUnlinked);
  const metaByAsin = getDiagnosticProductMeta_();

  products.forEach(p => {
    const meta = metaByAsin[p.asin] || {};
    p.title = meta.title || p.title || p.asin;
    p.subtitle = meta.subtitle || p.subtitle || '';
    p.parent_asin = meta.parent_asin || '';
    p.fba_stock = diagnosticNumber_(meta.fba_stock);
    p.fba_inbound = diagnosticNumber_(meta.fba_inbound);
    p.fba_daily_t7 = diagnosticNumber_(meta.fba_daily_t7);
    p.fba_days_remain = diagnosticNullableNumber_(meta.fba_days_remain);
    p.fba_alert = meta.fba_alert || '';
  });

  const businessProducts = products.filter(p => p.has_business && diagnosticNumber_(p.sessions) > 0);
  const totalSessions = businessProducts.reduce((s, p) => s + diagnosticNumber_(p.sessions), 0);
  const totalOrders = businessProducts.reduce((s, p) => s + diagnosticNumber_(p.session_orders), 0);
  const portfolioCvr = totalSessions > 0 ? totalOrders / totalSessions : 0;
  const sessions = businessProducts.map(p => diagnosticNumber_(p.sessions)).sort((a, b) => a - b);
  const sessionMedian = diagnosticQuantile_(sessions, 0.5);
  const sessionQ3 = diagnosticQuantile_(sessions, 0.75);

  const diagnostics = [];
  businessProducts.forEach(p => {
    const productSessions = diagnosticNumber_(p.sessions);
    const orders = diagnosticNumber_(p.session_orders);
    const cvr = diagnosticNumber_(p.cvr);
    const highTrafficFloor = Math.max(100, sessionQ3);

    if (productSessions >= highTrafficFloor && portfolioCvr > 0 && cvr < portfolioCvr * 0.7) {
      const missedUnitsAtBenchmark = Math.max(0, Math.round(productSessions * (portfolioCvr - cvr)));
      diagnostics.push(makeDiagnostic_({
        rule_id: 'HIGH_TRAFFIC_LOW_CVR',
        category: 'sales_opportunity',
        severity: cvr < portfolioCvr * 0.4 ? 'high' : 'medium',
        confidence: diagnosticConfidence_(productSessions, orders),
        product: p,
        score: missedUnitsAtBenchmark * 10 + productSessions,
        message: '流入は上位ですが、CVRが全体基準を下回っています。',
        facts: {
          sessions: productSessions,
          orders: orders,
          cvr: cvr,
          portfolio_cvr: portfolioCvr,
          session_threshold: highTrafficFloor,
          benchmark_gap_units: missedUnitsAtBenchmark
        },
        warnings: orders < 10 ? ['注文数が少ないため、CVRは変動しやすいです。'] : []
      }));
    }

    if (productSessions >= 20 && productSessions <= sessionMedian && orders >= 3 && portfolioCvr > 0 && cvr > portfolioCvr * 1.3) {
      diagnostics.push(makeDiagnostic_({
        rule_id: 'HIGH_CVR_LOW_TRAFFIC',
        category: 'sales_opportunity',
        severity: 'medium',
        confidence: diagnosticConfidence_(productSessions, orders),
        product: p,
        score: Math.round(cvr * 10000) + orders,
        message: 'CVRは全体基準を上回りますが、流入は中央値以下です。',
        facts: {
          sessions: productSessions,
          orders: orders,
          cvr: cvr,
          portfolio_cvr: portfolioCvr,
          median_sessions: sessionMedian
        },
        warnings: orders < 10 ? ['注文数が少ないため、拡大余地は仮説として扱ってください。'] : []
      }));
    }
  });

  products.forEach(p => {
    const spend = diagnosticNumber_(p.ad_spend);
    const clicks = diagnosticNumber_(p.ad_clicks);
    const afterAd = diagnosticNullableNumber_(p.gross_profit_after_ad);
    const acos = diagnosticNullableNumber_(p.acos);

    if (spend >= 1000 && afterAd !== null && afterAd < 0) {
      diagnostics.push(makeDiagnostic_({
        rule_id: 'NEGATIVE_PROFIT_AFTER_AD',
        category: 'profit_ads',
        severity: 'high',
        confidence: clicks >= 30 ? 'high' : (clicks >= 10 ? 'medium' : 'low'),
        product: p,
        score: Math.abs(afterAd) + spend,
        message: '期間粗利から広告費を差し引くとマイナスです。',
        facts: {
          sales: diagnosticNumber_(p.sales_taxin),
          gross_profit: diagnosticNumber_(p.gross_profit),
          ad_spend: spend,
          profit_after_ad: afterAd,
          ad_sales: diagnosticNumber_(p.ad_sales),
          acos: acos,
          clicks: clicks
        },
        warnings: clicks < 30 ? ['広告クリック数が少なく、広告効率は変動しやすいです。'] : []
      }));
    } else if (spend >= 1000 && clicks >= 20 && (acos === null || acos >= 0.5)) {
      diagnostics.push(makeDiagnostic_({
        rule_id: 'HIGH_AD_COST',
        category: 'profit_ads',
        severity: 'medium',
        confidence: clicks >= 30 ? 'high' : 'medium',
        product: p,
        score: spend,
        message: '広告費が大きく、広告売上に対するACoSも高い状態です。',
        facts: {
          ad_spend: spend,
          ad_sales: diagnosticNumber_(p.ad_sales),
          acos: acos,
          clicks: clicks,
          ad_orders: diagnosticNumber_(p.ad_orders),
          profit_after_ad: afterAd
        },
        warnings: ['ACoSだけでは採算を断定できないため、広告控除後利益も併記しています。']
      }));
    }

    const daily = diagnosticNumber_(p.fba_daily_t7);
    const stock = diagnosticNumber_(p.fba_stock) + diagnosticNumber_(p.fba_inbound);
    const days = daily > 0 ? stock / daily : p.fba_days_remain;
    if (diagnosticNumber_(p.qty) > 0 && ((stock <= 0) || (days !== null && days < 21))) {
      diagnostics.push(makeDiagnostic_({
        rule_id: stock <= 0 ? 'OUT_OF_STOCK_WITH_SALES' : 'LOW_STOCK_DAYS',
        category: 'inventory',
        severity: stock <= 0 || days < 10 ? 'high' : 'medium',
        confidence: daily > 0 ? 'high' : 'medium',
        product: p,
        score: diagnosticNumber_(p.sales_taxin) + (stock <= 0 ? 1000000 : 0),
        message: stock <= 0
          ? '期間中に販売実績がありますが、FBA在庫と入荷予定がありません。'
          : '直近日販に対する在庫日数が21日未満です。',
        facts: {
          period_qty: diagnosticNumber_(p.qty),
          period_sales: diagnosticNumber_(p.sales_taxin),
          fba_stock: diagnosticNumber_(p.fba_stock),
          fba_inbound: diagnosticNumber_(p.fba_inbound),
          daily_t7: daily,
          stock_days: days
        },
        warnings: daily <= 0 ? ['直近日販がないため、在庫日数の精度は限定的です。'] : []
      }));
    }
  });

  const variantDiagnostics = buildVariantGapDiagnostics_(products);
  variantDiagnostics.forEach(d => diagnostics.push(d));

  diagnostics.sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    return (severityOrder[b.severity] - severityOrder[a.severity]) || (b.score - a.score);
  });

  const categoryCounts = {};
  diagnostics.forEach(d => categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1);
  const diagnosticGroups = buildDiagnosticGroups_(products, diagnostics);

  return {
    period_key: periodKey,
    generated_at: new Date().toISOString(),
    benchmarks: {
      portfolio_cvr: portfolioCvr,
      median_sessions: sessionMedian,
      top_quartile_sessions: sessionQ3,
      business_product_count: businessProducts.length,
      product_count: products.length
    },
    counts: categoryCounts,
    groups: diagnosticGroups,
    diagnostics: diagnostics.slice(0, 60),
    methodology: {
      version: 'v1',
      note: '原因や施策は断定せず、数値上の差と確認候補だけを表示します。'
    }
  };
}

function buildDiagnosticGroups_(products, diagnostics) {
  const severityOrder = { high: 3, medium: 2, low: 1 };
  const productGroups = {};

  products.forEach(p => {
    const key = p.parent_asin || p.asin;
    if (!key) return;
    if (!productGroups[key]) productGroups[key] = [];
    productGroups[key].push(p);
  });

  const diagnosticsByGroup = {};
  diagnostics.forEach(d => {
    const key = d.parent_asin || d.asin;
    if (!key) return;
    if (!diagnosticsByGroup[key]) diagnosticsByGroup[key] = [];
    diagnosticsByGroup[key].push(d);
  });

  return Object.keys(diagnosticsByGroup).map(key => {
    const groupProducts = productGroups[key] || [];
    const findings = diagnosticsByGroup[key];
    const lead = groupProducts.slice().sort((a, b) => diagnosticNumber_(b.sales_taxin) - diagnosticNumber_(a.sales_taxin))[0] || {};
    const childFindings = {};

    findings.forEach(d => {
      if (!d.asin || d.rule_id === 'VARIANT_PERFORMANCE_GAP') return;
      if (!childFindings[d.asin]) {
        const p = groupProducts.find(x => x.asin === d.asin) || {};
        childFindings[d.asin] = {
          asin: d.asin,
          title: p.title || d.title || d.asin,
          subtitle: p.subtitle || d.subtitle || '',
          severity: d.severity,
          score: d.score || 0,
          findings: []
        };
      }
      const c = childFindings[d.asin];
      c.findings.push({
        rule_id: d.rule_id,
        category: d.category,
        severity: d.severity,
        message: d.message,
        facts: d.facts || {}
      });
      if ((severityOrder[d.severity] || 0) > (severityOrder[c.severity] || 0)) c.severity = d.severity;
      c.score = Math.max(c.score, d.score || 0);
    });

    const highlights = Object.values(childFindings)
      .sort((a, b) => (severityOrder[b.severity] - severityOrder[a.severity]) || (b.score - a.score))
      .slice(0, 3);
    const maxSeverity = findings.reduce((best, d) =>
      (severityOrder[d.severity] || 0) > (severityOrder[best] || 0) ? d.severity : best, 'low');
    const variantFinding = findings.find(d => d.rule_id === 'VARIANT_PERFORMANCE_GAP');

    return {
      group_key: key,
      parent_asin: lead.parent_asin || '',
      is_parent_group: groupProducts.length > 1 || !!lead.parent_asin,
      title: lead.title || findings[0].title || key,
      emoji: lead.emoji || findings[0].emoji || '📦',
      severity: maxSeverity,
      score: findings.reduce((s, d) => s + (d.score || 0), 0),
      finding_count: findings.length,
      affected_child_count: Object.keys(childFindings).length,
      categories: Array.from(new Set(findings.map(d => d.category))),
      summary: {
        child_count: groupProducts.length,
        sessions: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.sessions), 0),
        orders: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.session_orders), 0),
        sales: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.sales_taxin), 0),
        gross_profit: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.gross_profit), 0),
        ad_spend: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.ad_spend), 0),
        profit_after_ad: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.gross_profit_after_ad), 0),
        fba_stock: groupProducts.reduce((s, p) => s + diagnosticNumber_(p.fba_stock), 0)
      },
      highlights: highlights,
      children: groupProducts.map(p => ({
        asin: p.asin,
        title: p.title,
        subtitle: p.subtitle,
        sessions: diagnosticNumber_(p.sessions),
        orders: diagnosticNumber_(p.session_orders),
        cvr: diagnosticNullableNumber_(p.cvr),
        ad_spend: diagnosticNumber_(p.ad_spend),
        roas: diagnosticNullableNumber_(p.roas),
        gross_profit_after_ad: diagnosticNullableNumber_(p.gross_profit_after_ad),
        fba_stock: diagnosticNumber_(p.fba_stock),
        finding_count: childFindings[p.asin] ? childFindings[p.asin].findings.length : 0
      })).sort((a, b) => b.sessions - a.sessions),
      variant_finding: variantFinding || null
    };
  }).sort((a, b) => (severityOrder[b.severity] - severityOrder[a.severity]) || (b.score - a.score));
}

function getLatestDiagnosticPeriod_() {
  const txPeriods = getAvailablePeriods();
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('business_report_period');
  if (!sheet || sheet.getLastRow() <= 1) return txPeriods[0] || '';
  const data = sheet.getDataRange().getValues();
  const idx = data[0].indexOf('period_key');
  const businessPeriods = new Set(data.slice(1).map(r => String(r[idx] || '').trim()).filter(Boolean));
  return txPeriods.find(p => businessPeriods.has(p)) || txPeriods[0] || '';
}

function getDiagnosticProductMeta_() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const value = (row, name) => h.indexOf(name) >= 0 ? row[h.indexOf(name)] : '';
  const map = {};
  data.slice(1).forEach(row => {
    const asin = String(value(row, 'asin') || '').trim();
    if (!asin) return;
    map[asin] = {
      title: String(value(row, 'title') || '').trim(),
      subtitle: String(value(row, 'subtitle') || '').trim(),
      parent_asin: String(value(row, 'parent_asin') || '').trim(),
      fba_stock: value(row, 'fba_stock'),
      fba_inbound: value(row, 'fba_inbound'),
      fba_daily_t7: value(row, 'fba_daily_t7'),
      fba_days_remain: value(row, 'fba_days_remain'),
      fba_alert: String(value(row, 'fba_alert') || '').trim()
    };
  });

  const variationSheet = getSpreadsheet_().getSheetByName('variation_map');
  if (variationSheet && variationSheet.getLastRow() > 1) {
    const rows = variationSheet.getDataRange().getValues();
    const vh = rows[0];
    const childIdx = vh.indexOf('child_asin');
    const parentIdx = vh.indexOf('parent_asin');
    rows.slice(1).forEach(row => {
      const child = String(row[childIdx] || '').trim();
      const parent = String(row[parentIdx] || '').trim();
      if (child && parent && map[child] && !map[child].parent_asin) map[child].parent_asin = parent;
    });
  }
  return map;
}

function buildVariantGapDiagnostics_(products) {
  const groups = {};
  products.forEach(p => {
    if (!p.parent_asin) return;
    if (!groups[p.parent_asin]) groups[p.parent_asin] = [];
    groups[p.parent_asin].push(p);
  });

  const results = [];
  Object.keys(groups).forEach(parentAsin => {
    const children = groups[parentAsin].filter(p => p.has_business && diagnosticNumber_(p.sessions) > 0);
    if (children.length < 3) return;
    const sessions = children.reduce((s, p) => s + diagnosticNumber_(p.sessions), 0);
    const orders = children.reduce((s, p) => s + diagnosticNumber_(p.session_orders), 0);
    if (sessions < 150 || orders < 10) return;

    const comparable = children.filter(p => diagnosticNumber_(p.sessions) >= 20);
    if (comparable.length < 2) return;
    const byCvr = comparable.slice().sort((a, b) => diagnosticNumber_(b.cvr) - diagnosticNumber_(a.cvr));
    const best = byCvr[0];
    const worst = byCvr[byCvr.length - 1];
    const bestCvr = diagnosticNumber_(best.cvr);
    const worstCvr = diagnosticNumber_(worst.cvr);
    const ratio = worstCvr > 0 ? bestCvr / worstCvr : null;
    const gap = bestCvr - worstCvr;
    if (gap < 0.03 && (ratio === null || ratio < 1.8)) return;

    const confidence = sessions >= 500 && orders >= 30 ? 'high' : (sessions >= 300 && orders >= 20 ? 'medium' : 'low');
    results.push(makeDiagnostic_({
      rule_id: 'VARIANT_PERFORMANCE_GAP',
      category: 'variation',
      severity: gap >= 0.08 || (ratio !== null && ratio >= 3) ? 'high' : 'medium',
      confidence: confidence,
      product: {
        asin: parentAsin,
        parent_asin: parentAsin,
        title: (children[0] && children[0].title) || parentAsin,
        subtitle: '',
        emoji: '🔀'
      },
      score: Math.round(gap * 10000) + orders,
      message: '同一親ASIN内で、子ASINのCVRに大きな差があります。',
      facts: {
        child_count: children.length,
        comparable_child_count: comparable.length,
        sessions: sessions,
        orders: orders,
        best_cvr: bestCvr,
        worst_cvr: worstCvr,
        cvr_ratio: ratio,
        cvr_gap: gap
      },
      variants: children.map(p => ({
        asin: p.asin,
        title: p.title,
        subtitle: p.subtitle,
        sessions: diagnosticNumber_(p.sessions),
        orders: diagnosticNumber_(p.session_orders),
        cvr: diagnosticNumber_(p.cvr),
        ad_spend: diagnosticNumber_(p.ad_spend),
        ad_sales: diagnosticNumber_(p.ad_sales),
        roas: diagnosticNullableNumber_(p.roas),
        gross_profit_after_ad: diagnosticNullableNumber_(p.gross_profit_after_ad),
        fba_stock: diagnosticNumber_(p.fba_stock)
      })).sort((a, b) => b.sessions - a.sessions),
      warnings: confidence === 'low' ? ['親商品全体の注文数が少ないため、差は参考値です。'] : []
    }));
  });
  return results;
}

function makeDiagnostic_(o) {
  const p = o.product || {};
  return {
    rule_id: o.rule_id,
    category: o.category,
    severity: o.severity,
    confidence: o.confidence,
    score: o.score || 0,
    asin: p.asin || '',
    parent_asin: p.parent_asin || '',
    title: p.title || p.asin || '',
    subtitle: p.subtitle || '',
    emoji: p.emoji || '📦',
    message: o.message || '',
    facts: o.facts || {},
    variants: o.variants || [],
    warnings: o.warnings || []
  };
}

function diagnosticConfidence_(sessions, orders) {
  if (sessions >= 500 && orders >= 30) return 'high';
  if (sessions >= 150 && orders >= 10) return 'medium';
  return 'low';
}

function diagnosticQuantile_(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function diagnosticNumber_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function diagnosticNullableNumber_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
