/** 秘書カードを開いた瞬間の最新情報を返す。 */
function getSecretaryCardDetail_(asin, category) {
  asin = String(asin || '').trim().toUpperCase();
  category = String(category || '').trim();
  if (!asin) throw new Error('asin required');
  const out = { asin:asin, category:category, generated_at:new Date().toISOString() };

  const product = secRows_('product_lifecycle').find(function(row) {
    return String(row.asin || '').trim().toUpperCase() === asin;
  });
  if (product) out.product = {
    title:String(product.title || ''), subtitle:String(product.subtitle || ''),
    parent_asin:String(product.parent_asin || ''), status:String(product.status || ''),
    current_landed_cost:secNum_(product.current_landed_cost)
  };

  if (category === '在庫' || category === '売上' || category === '成果') {
    let latest = null;
    secRows_('inventory_snapshot').forEach(function(row) {
      if (String(row.asin || '').trim().toUpperCase() !== asin) return;
      const date = secDate_(row.snapshot_date);
      if (!date || isNaN(date.getTime())) return;
      if (!latest || date > latest._date) latest = { _date:date, available:secNum_(row.available), inbound:secNum_(row.inbound), daily_t7:secNum_(row.daily_t7), days_remain:secNum_(row.days_remain), alert:String(row.alert || '') };
    });
    if (latest) { delete latest._date; out.inventory = latest; }
    const since = new Date(Date.now() - 30*864e5), days = {};
    secRows_('transaction_history').forEach(function(row) {
      if (String(row.transaction_type || '').trim() !== '注文' || String(row.asin || '').trim().toUpperCase() !== asin) return;
      const date = secDate_(row.date); if (!date || isNaN(date.getTime()) || date < since) return;
      const key = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
      const item = days[key] || (days[key] = { units:0, sales:0 });
      item.units += secNum_(row.qty); item.sales += secNum_(row.sales_taxin);
    });
    out.daily_sales_30d = Object.keys(days).sort().map(function(key) { return { date:key, d:key.slice(5).replace('-','/'), units:days[key].units, sales:Math.round(days[key].sales) }; });
  }

  if (category === '広告' || category === '売上') {
    const since = new Date(Date.now() - 14*864e5), days = {};
    secRows_('ad_product_daily').forEach(function(row) {
      if (String(row.asin || '').trim().toUpperCase() !== asin) return;
      const date=secDate_(row.date); if (!date || isNaN(date.getTime()) || date < since) return;
      const key=Utilities.formatDate(date,'Asia/Tokyo','yyyy-MM-dd');
      const item=days[key] || (days[key]={spend:0,sales:0,impressions:0,clicks:0});
      item.spend+=secNum_(row.spend);item.sales+=secNum_(row.sales);item.impressions+=secNum_(row.impressions);item.clicks+=secNum_(row.clicks);
    });
    const series=Object.keys(days).sort().map(function(key){const x=days[key];return{date:key,d:key.slice(5).replace('-','/'),spend:Math.round(x.spend),sales:Math.round(x.sales),acos:x.sales?x.spend/x.sales:null,ctr:x.impressions?x.clicks/x.impressions:null};});
    const total=series.reduce(function(a,x){a.spend+=x.spend;a.sales+=x.sales;return a;},{spend:0,sales:0});
    out.ad_14d={series:series,total_spend:total.spend,total_sales:total.sales,acos:total.sales?total.spend/total.sales:null};
  }

  if (category === 'ページ') {
    const rows=secRows_('business_report_period').filter(function(row){return String(row.asin||'').trim().toUpperCase()===asin;});
    const keys=[...new Set(rows.map(function(row){return String(row.period_key||'');}).filter(Boolean))].sort();
    out.periods=keys.slice(-3).map(function(key){const row=rows.find(function(x){return String(x.period_key)===key;});return{period:key,sessions:secNum_(row.sessions),cvr:typeof apCvr_==='function'?apCvr_(row.unit_session_rate):secNum_(row.unit_session_rate),units:secNum_(row.ordered_units),sales:secNum_(row.ordered_sales)};});
  }

  if (category === 'リサーチ') {
    if (product) {
      const pack=secJson_(product.keepa_data,{}),pf=pack.product_facts||{},pg=pack.page_facts||{},mf=pack.market_facts||{},screen=pack.decision_screen||{};
      const urls=secJson_(product.urls,[]),keepaUrl=Array.isArray(urls)?(urls.find(function(url){return String(url).indexOf('keepa.com')>=0;})||''):'';
      const nullable=function(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(String(value).replace(/[%,]/g,''));return isNaN(n)?null:n;};
      const price=pf.price==null||pf.price===''?product.price:pf.price;
      const hasAplus=pg.has_aplus==null?null:(pg.has_aplus===true||String(pg.has_aplus).toUpperCase()==='YES'||String(pg.has_aplus)==='1');
      out.research={
        title:String(product.title||pf.title||''),status:String(screen.result||screen.decision||product.status||''),
        monthly_sold:nullable(pf.monthly_sold==null?product.monthly_sales:pf.monthly_sold),price_min:nullable(price),price_max:nullable(price),
        offer_count:nullable(mf.total_offer_count),fba_count:nullable(mf.fba_offer_count),image_count:nullable(pg.image_count),
        has_aplus:hasAplus,keepa_url:String(keepaUrl)
      };
    }
  }
  return out;
}
