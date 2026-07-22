/** 競合ASINとは別に自社ASINを接続し、将来の公開ページ比較に備える。 */
const LF_SNAPSHOT_SHEET = 'listing_snapshots';
const LF_SNAPSHOT_HEADERS = ['snapshot_id','page_project_id','own_asin','captured_at','source','title','bullets_json','description','image_urls_json','aplus_json','price','rating','review_count','raw_file_id'];

function ensureListingSnapshotSheet_() {
  const ss=getSpreadsheet_(); let sh=ss.getSheetByName(LF_SNAPSHOT_SHEET);
  if(!sh){sh=ss.insertSheet(LF_SNAPSHOT_SHEET);sh.getRange(1,1,1,LF_SNAPSHOT_HEADERS.length).setValues([LF_SNAPSHOT_HEADERS]);sh.setFrozenRows(1);}
  return sh;
}
function lfAsin_(value) {
  const asin=String(value||'').trim().toUpperCase();
  if(!asin)return '';
  if(!/^[A-Z0-9]{10}$/.test(asin))throw new Error('ASINは10文字の英数字で入力してください: '+asin);
  return asin;
}
function saveOwnListingLink_(pageProjectId,input) {
  const lock=LockService.getScriptLock(); lock.waitLock(30000);
  try {
  input=input||{}; const projects=getAllPageProjects(),p=projects.find(function(x){return String(x.id)===String(pageProjectId);});
  if(!p)throw new Error('ページ制作案件が見つかりません。');
  const primary=lfAsin_(input.primary_asin),parent=lfAsin_(input.parent_asin);
  const children=(Array.isArray(input.child_asins)?input.child_asins:[]).map(lfAsin_).filter(Boolean);
  if(!primary&&!parent&&!children.length)throw new Error('自社ASINを1件以上入力してください。');
  assertAsinsInSkuMaster_([primary,parent].concat(children).filter(Boolean));
  const lineage=p.research_lineage||{}, competitors=(lineage.competitor_asins||[]).map(function(x){return String(x||'').toUpperCase();});
  [primary,parent].concat(children).filter(Boolean).forEach(function(asin){if(competitors.indexOf(asin)>=0)throw new Error('競合ASINを自社ASINとして登録できません: '+asin);});
  const old=p.own_listing||{},now=new Date().toISOString();
  p.own_listing={primary_asin:primary,parent_asin:parent,child_asins:Array.from(new Set(children)),connected_at:old.connected_at||now,updated_at:now,keepa_status:old.keepa_status||'not_fetched',latest_snapshot_id:old.latest_snapshot_id||''};
  if(!p.document_status)p.document_status='candidate_selected';
  ensureListingSnapshotSheet_();
  updatePageProjectInSheet(p);

  const cardId = p.source_card_id || p.card_id;
  if (cardId) {
    const card = getCardDetail_ProductLifecycle(cardId);
    if (!card) throw new Error('連携元のカードが見つかりません。');
    card.is_launched = true;
    card.origin_type = card.origin_type || 'research';
    const mainAsin = primary || parent || (children.length ? children[0] : '');
    if (mainAsin) card.asin = mainAsin;
    card.own_listing = p.own_listing;
    if(!updateCardInLifecycle(card))throw new Error('product_lifecycleの更新に失敗しました。');
    }
  return p;
  } finally { lock.releaseLock(); }
}
