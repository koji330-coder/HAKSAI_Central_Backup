/** ページ制作前のラクマート候補発掘・比較・採用。 */
const RS_BRIEF_SHEET = 'rakumart_search_briefs';
const RS_CANDIDATE_SHEET = 'rakumart_supplier_candidates';
const RS_SEARCH_TEMPLATE_DEFAULT = 'https://www.rakumart.com/CommoditySearch?keyword={keyword}';
const RS_BRIEF_HEADERS = ['brief_id','page_project_id','source_card_id','brief_json','comparison_json','created_at','updated_at'];
const RS_CANDIDATE_HEADERS = ['candidate_id','brief_id','status','supplier_url','source_keyword_id','user_memo','screenshot_ids','extracted_json','created_at','updated_at'];

function rsSheet_(name, headers) {
  const ss = getSpreadsheet_(); let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1,1,1,headers.length).setValues([headers]); sh.setFrozenRows(1); }
  return sh;
}
function rsRows_(name, headers) {
  const sh = rsSheet_(name, headers); if (sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues(), head = data[0].map(String);
  return data.slice(1).map(function(row, i) { const x={_row:i+2}; head.forEach(function(h,j){x[h]=row[j];}); return x; });
}
function rsJson_(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return {}; } }
function rsSetRow_(sh, headers, rowNo, obj) { sh.getRange(rowNo,1,1,headers.length).setValues([headers.map(function(h){return obj[h] == null ? '' : obj[h];})]); }
function rsSearchTemplate_() { return PropertiesService.getScriptProperties().getProperty('RAKUMART_SEARCH_URL_TEMPLATE') || RS_SEARCH_TEMPLATE_DEFAULT; }
function setRakumartSearchUrlTemplate(template) {
  template=String(template||'').trim(); if (!template.includes('{keyword}')) throw new Error('{keyword}を含むURLテンプレートが必要です。');
  PropertiesService.getScriptProperties().setProperty('RAKUMART_SEARCH_URL_TEMPLATE', template); return template;
}

function generateRakumartSearchBrief_(projectData) {
  const p=projectData||{}, extra=p.extra_texts||{}, fact=p.page_draft&&p.page_draft.atlas_fact_pack||null;
  if (!p.id) throw new Error('page project id required');
  const prompt=`あなたは中国輸入商品の仕入先探索担当です。競合情報から、ラクマートで探す条件と検索語を作成してください。
競合の機能を仕入候補に存在するとみなさないでください。競合の不満は「確認すべき仮説」に変換してください。
中国語検索キーワードは最低8件。各件に自然な日本語訳を必ず付けてください。

商品名: ${p.title||''}
カテゴリ: ${p.category||''}
競合価格: ${p.price||''}
月販: ${p.monthly_sales||''}
競合の弱点: ${p.weakness||''}
競合レビュー・ATLAS事実: ${extra.competitor_reviews||''}
人間メモ: ${extra.target_notes||''} ${extra.free_memo||''}
fact_pack: ${JSON.stringify(fact||{})}

JSONのみ:
{"target_customers":[],"product_concept_hypothesis":"","market_insights":[],
"must_have_conditions":[{"condition":"","why":"","evidence_required":""}],
"nice_to_have_conditions":[],"exclusion_conditions":[],"verification_checklist":[],
"search_keywords":[{"id":"kw1","group":"基本|機能|用途","chinese":"","japanese":"","search_intent":"","priority":"high|medium|low"}]}`;
  const raw=callGeminiWithRetry({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:8192,responseMimeType:'application/json'}});
  const api=JSON.parse(raw); if(!api.candidates||!api.candidates.length) throw new Error('Geminiの回答が空です。');
  const brief=extractJson_(api.candidates[0].content.parts[0].text);
  brief.search_keywords=Array.isArray(brief.search_keywords)?brief.search_keywords:[];
  brief.search_keywords=brief.search_keywords.filter(function(k){return String(k.chinese||'').trim()&&String(k.japanese||'').trim();}).map(function(k,i){
    k.id='kw'+(i+1); k.search_url=rsSearchTemplate_().replace('{keyword}',encodeURIComponent(k.chinese)); return k;
  });
  if(brief.search_keywords.length<8) throw new Error('中国語＋日本語の検索キーワードが8件未満でした。再実行してください。');
  brief._meta={generated_at:new Date().toISOString(),generated_by:GEMINI_MODEL,status:'hypothesis'};
  const now=new Date().toISOString(), rows=rsRows_(RS_BRIEF_SHEET,RS_BRIEF_HEADERS);
  const old=rows.find(function(r){return String(r.page_project_id)===String(p.id);});
  const rec={brief_id:old?old.brief_id:Utilities.getUuid(),page_project_id:p.id,source_card_id:p.source_card_id||'',brief_json:JSON.stringify(brief),comparison_json:old?old.comparison_json||'':'',created_at:old?old.created_at:now,updated_at:now};
  const sh=rsSheet_(RS_BRIEF_SHEET,RS_BRIEF_HEADERS); if(old)rsSetRow_(sh,RS_BRIEF_HEADERS,old._row,rec);else sh.appendRow(RS_BRIEF_HEADERS.map(function(h){return rec[h]||'';}));
  return {brief_id:rec.brief_id,brief:brief,search_url_template:rsSearchTemplate_()};
}

function getRakumartSourcingBoard_(pageProjectId) {
  const briefRow=rsRows_(RS_BRIEF_SHEET,RS_BRIEF_HEADERS).find(function(r){return String(r.page_project_id)===String(pageProjectId);});
  if(!briefRow)return {brief:null,candidates:[],comparison:null,search_url_template:rsSearchTemplate_()};
  const candidates=rsRows_(RS_CANDIDATE_SHEET,RS_CANDIDATE_HEADERS).filter(function(r){return String(r.brief_id)===String(briefRow.brief_id);}).map(function(r){return {
    candidate_id:r.candidate_id,status:r.status,supplier_url:r.supplier_url,source_keyword_id:r.source_keyword_id,user_memo:r.user_memo,
    screenshot_ids:rsJson_(r.screenshot_ids),extracted:rsJson_(r.extracted_json),created_at:r.created_at,updated_at:r.updated_at
  };});
  return {brief_id:briefRow.brief_id,brief:rsJson_(briefRow.brief_json),candidates:candidates,comparison:rsJson_(briefRow.comparison_json),search_url_template:rsSearchTemplate_()};
}

/** 一覧用。候補ボードを個別GETせず、候補の有無だけをpage projectへ付加する。 */
function attachPageProjectSourcingFlags_(projects) {
  const briefs = rsRows_(RS_BRIEF_SHEET, RS_BRIEF_HEADERS);
  const candidates = rsRows_(RS_CANDIDATE_SHEET, RS_CANDIDATE_HEADERS);
  const candidateBriefIds = new Set(candidates.map(function(c) { return String(c.brief_id || ''); }).filter(String));
  const projectFlags = {};
  briefs.forEach(function(b) {
    if (candidateBriefIds.has(String(b.brief_id || ''))) projectFlags[String(b.page_project_id || '')] = true;
  });
  return (projects || []).map(function(p) {
    p.has_supplier_candidates = !!projectFlags[String(p.id || '')];
    return p;
  });
}

function addRakumartCandidate_(pageProjectId, data, images) {
  const board=getRakumartSourcingBoard_(pageProjectId); if(!board.brief_id)throw new Error('先に検索指示書を生成してください。');
  data=data||{}; const url=String(data.supplier_url||'').trim(); if(!url)throw new Error('仕入元URLが必要です。');
  if(!/^https?:\/\//i.test(url))throw new Error('仕入元URLはhttp(s)形式で入力してください。');
  if(!images||!images.length)throw new Error('スクリーンショットを1枚以上追加してください。');
  const imageIds=saveImagesToDrive_(images,'rakumart_'+Utilities.getUuid(),'candidate');
  const prompt=`ラクマート候補のスクリーンショットを読み取り、確認できる事実だけを抽出してください。
競合情報や検索条件を、この候補の仕様として扱わないでください。見えない性能はunknown_fieldsへ入れてください。
URL: ${url}\nメモ: ${data.user_memo||''}\n検索条件: ${JSON.stringify(board.brief||{})}
JSONのみ:{"supplier_title":"","unit_price_cny":null,"moq":null,"variations":[],"confirmed_facts":[{"field":"","value":"","source_image":1,"confidence":"high|medium"}],"inferred_facts":[{"field":"","value":"","basis":"","confidence":"low|medium"}],"unknown_fields":[],"concerns":[]}`;
  const parts=[];(images||[]).forEach(function(img,i){parts.push({text:'候補画像'+(i+1)});parts.push({inline_data:{mime_type:img.mimeType||'image/jpeg',data:img.base64}});});parts.push({text:prompt});
  const raw=callGeminiWithRetry({contents:[{parts:parts}],generationConfig:{temperature:0.1,maxOutputTokens:8192,responseMimeType:'application/json'}});
  const api=JSON.parse(raw), extracted=extractJson_(api.candidates[0].content.parts[0].text); extracted._meta={extracted_at:new Date().toISOString(),review_status:'needs-human-review'};
  const now=new Date().toISOString(), rec={candidate_id:Utilities.getUuid(),brief_id:board.brief_id,status:'comparison',supplier_url:url,source_keyword_id:data.source_keyword_id||'',user_memo:data.user_memo||'',screenshot_ids:JSON.stringify(imageIds),extracted_json:JSON.stringify(extracted),created_at:now,updated_at:now};
  rsSheet_(RS_CANDIDATE_SHEET,RS_CANDIDATE_HEADERS).appendRow(RS_CANDIDATE_HEADERS.map(function(h){return rec[h]||'';}));
  return getRakumartSourcingBoard_(pageProjectId);
}

function compareRakumartCandidates_(pageProjectId) {
  const board=getRakumartSourcingBoard_(pageProjectId); if(board.candidates.length<1)throw new Error('候補を1件以上保存してください。');
  const safeCandidates=board.candidates.map(function(c){return {candidate_id:c.candidate_id,supplier_url:c.supplier_url,user_memo:c.user_memo,extracted:c.extracted};});
  const prompt=`仕入候補を比較してください。1件なら採用可否と追加確認事項を評価してください。
確認済み・推定・未確認を混同しないこと。競合の機能を候補に存在するとみなさないこと。自動採用はしないこと。
検索指示書:${JSON.stringify(board.brief)}\n候補:${JSON.stringify(safeCandidates)}
JSONのみ:{"ranking":[{"candidate_id":"","rank":1,"pageability":"A|B|C","strengths":[],"risks":[],"missing":[]}],"recommended_candidate_id":"","recommendation_reason":"","additional_checks":[],"comparison_notes":""}`;
  const raw=callGeminiWithRetry({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:8192,responseMimeType:'application/json'}});
  const api=JSON.parse(raw),comparison=extractJson_(api.candidates[0].content.parts[0].text);comparison._meta={compared_at:new Date().toISOString(),generated_by:GEMINI_MODEL};
  const row=rsRows_(RS_BRIEF_SHEET,RS_BRIEF_HEADERS).find(function(r){return String(r.brief_id)===String(board.brief_id);}),sh=rsSheet_(RS_BRIEF_SHEET,RS_BRIEF_HEADERS);
  row.comparison_json=JSON.stringify(comparison);row.updated_at=new Date().toISOString();rsSetRow_(sh,RS_BRIEF_HEADERS,row._row,row);
  return getRakumartSourcingBoard_(pageProjectId);
}

function adoptRakumartCandidate_(pageProjectId,candidateId) {
  const board=getRakumartSourcingBoard_(pageProjectId), chosen=board.candidates.find(function(c){return c.candidate_id===candidateId;}); if(!chosen)throw new Error('候補が見つかりません。');
  const rows=rsRows_(RS_CANDIDATE_SHEET,RS_CANDIDATE_HEADERS),sh=rsSheet_(RS_CANDIDATE_SHEET,RS_CANDIDATE_HEADERS);
  rows.filter(function(r){return String(r.brief_id)===String(board.brief_id);}).forEach(function(r){r.status=r.candidate_id===candidateId?'adopted':(r.status==='adopted'?'on_hold':r.status);r.updated_at=new Date().toISOString();rsSetRow_(sh,RS_CANDIDATE_HEADERS,r._row,r);});
  const confirmed=Array.isArray(chosen.extracted.confirmed_facts)?chosen.extracted.confirmed_facts:[], unknown=Array.isArray(chosen.extracted.unknown_fields)?chosen.extracted.unknown_fields:[];
  const handoff={ready:confirmed.length>0,selected_candidate_id:candidateId,supplier:{url:chosen.supplier_url,title:chosen.extracted.supplier_title||'',unit_price_cny:chosen.extracted.unit_price_cny==null?null:chosen.extracted.unit_price_cny,screenshot_ids:chosen.screenshot_ids},market_insights:board.brief.market_insights||[],confirmed_facts:confirmed,unconfirmed_items:unknown,selected_variations:chosen.extracted.variations||[],claim_guard:{allowed_claims:confirmed,prohibited_claims:unknown,market_priorities:board.brief.must_have_conditions||[]},candidate_decision_log:{comparison:board.comparison||{},adopted_at:new Date().toISOString()}};
  const projects=getAllPageProjects(),project=projects.find(function(p){return String(p.id)===String(pageProjectId);});if(!project)throw new Error('ページ案件が見つかりません。');
  
  // 採用時に自動で概算利益計算を実行し、プロジェクト情報に書き込む
  try {
    const cnyPrice = chosen.extracted.unit_price_cny || null;
    const roughSim = calculateRoughProfit_(project, cnyPrice);
    if (roughSim) {
      project.cost_simulation = roughSim;
      project.profit = roughSim;
      Logger.log('Adopt: 自動利益シミュレーション成功。');
    }
  } catch (simErr) {
    Logger.log('Adopt: 自動利益シミュレーション失敗(処理は継続): ' + simErr);
  }

  project.adopted_candidate_id=candidateId;project.supplier_selection=chosen;project.sourcing_brief=board.brief;project.sourcing_comparison=board.comparison||{};project.listing_handoff=handoff;project.sourcing_state=handoff.ready?'supplier_adopted':'supplier_needs_confirmation';
  project.status = '素材追加中';
  project.extra_texts=project.extra_texts||{};project.extra_texts.supplier_url=chosen.supplier_url;project.extracted_input=chosen.extracted;
  
  updatePageProjectInSheet(project);
  
  // 親のライフサイクルカード（product_lifecycle）が存在する場合、利益計算結果を同期する
  const sourceCardId = String(project.source_card_id || '').trim();
  if (sourceCardId && project.cost_simulation) {
    try {
      const parentCard = getCardDetail_ProductLifecycle(sourceCardId);
      if (parentCard) {
        parentCard.cost_simulation = project.cost_simulation;
        parentCard.profit = project.profit;
        updateCardInLifecycle(parentCard);
        Logger.log('Adopt: 親ライフサイクルカードへの利益計算データの同期成功。');
      }
    } catch (syncErr) {
      Logger.log('Adopt: 親ライフサイクルカードへの同期失敗(処理は継続): ' + syncErr);
    }
  }
  return {board:getRakumartSourcingBoard_(pageProjectId),project:project};
}

/** 通常ルート（仕入先URL＋スクショ解析）の結果を、採用済み仕入候補として確定する。 */
function adoptExtractedInputAsSupplier_(pageProjectId, supplierUrlOverride) {
  const project = getAllPageProjects().find(function(p) {
    return String(p.id) === String(pageProjectId);
  });
  if (!project) throw new Error('ページ案件が見つかりません。');

  const extracted = project.extracted_input && typeof project.extracted_input === 'object'
    ? project.extracted_input : {};
  if (!extracted._meta && !(project.extraction_meta && project.extraction_meta.extracted_at)) {
    throw new Error('採用できません。不足: スクショ解析結果（先に「スクショから必要事項を抽出」を実行してください）');
  }

  const extra = project.extra_texts || {};
  const supplier = extracted.supplier && typeof extracted.supplier === 'object' ? extracted.supplier : {};
  const url = String(extra.supplier_url || supplier.url || supplierUrlOverride || '').trim();
  if (!url) throw new Error('採用できません。不足: 仕入先URL（仕入先URL欄に入力してください）');
  if (!/^https?:\/\//i.test(url)) throw new Error('仕入先URLはhttp(s)形式で入力してください。');

  const directFacts = Array.isArray(extracted.confirmed_facts) ? extracted.confirmed_facts : [];
  const confirmed = directFacts.length ? directFacts : (Array.isArray(extracted.evidence) ? extracted.evidence : [])
    .filter(function(ev) {
      return ev && ev.source_image != null && String(ev.field || '').trim();
    }).map(function(ev) {
      return {
        field: ev.field,
        value: ev.value,
        source_image: ev.source_image,
        confidence: ev.confidence || 'medium',
        evidence_note: ev.evidence_note || ''
      };
    });
  const unknown = Array.isArray(extracted.unknown_fields) ? extracted.unknown_fields : [];
  const brief = project.sourcing_brief && typeof project.sourcing_brief === 'object'
    ? project.sourcing_brief : {};
  const candidateId = 'extracted:' + project.id;
  const selectedVariations = supplier.dimensions && Array.isArray(supplier.dimensions.specifications)
    ? supplier.dimensions.specifications
    : (Array.isArray(supplier.variations) ? supplier.variations : []);

  const handoff = {
    ready: confirmed.length > 0,
    selected_candidate_id: candidateId,
    supplier: {
      url: url,
      title: supplier.title || '',
      unit_price_cny: supplier.unit_price_cny == null ? null : supplier.unit_price_cny,
      screenshot_ids: Array.isArray(project.extra_image_ids) ? project.extra_image_ids : []
    },
    market_insights: brief.market_insights || [],
    confirmed_facts: confirmed,
    unconfirmed_items: unknown,
    selected_variations: selectedVariations,
    claim_guard: {
      allowed_claims: confirmed,
      prohibited_claims: unknown,
      market_priorities: brief.must_have_conditions || []
    },
    candidate_decision_log: {
      origin: 'extracted_input',
      adopted_at: new Date().toISOString()
    }
  };

  try {
    const roughSim = calculateRoughProfit_(project, supplier.unit_price_cny || null);
    if (roughSim) {
      project.cost_simulation = roughSim;
      project.profit = roughSim;
    }
  } catch (simErr) {
    Logger.log('AdoptExtracted: 利益シミュレーション失敗(継続): ' + simErr);
  }

  project.adopted_candidate_id = candidateId;
  project.supplier_selection = {
    candidate_id: candidateId,
    origin: 'extracted_input',
    supplier_url: url,
    screenshot_ids: project.extra_image_ids || [],
    extracted: extracted
  };
  project.listing_handoff = handoff;
  project.sourcing_state = handoff.ready ? 'supplier_adopted' : 'supplier_needs_confirmation';
  project.extra_texts = extra;
  project.extra_texts.supplier_url = url;
  project.updated_at = new Date().toISOString();
  updatePageProjectInSheet(project);

  const sourceCardId = String(project.source_card_id || '').trim();
  if (sourceCardId && project.cost_simulation) {
    try {
      const parentCard = getCardDetail_ProductLifecycle(sourceCardId);
      if (parentCard) {
        parentCard.cost_simulation = project.cost_simulation;
        parentCard.profit = project.profit;
        updateCardInLifecycle(parentCard);
      }
    } catch (syncErr) {
      Logger.log('AdoptExtracted: 親カード同期失敗(継続): ' + syncErr);
    }
  }

  return {
    project: project,
    ready: handoff.ready,
    missing: handoff.ready ? [] : ['根拠付きの確認済み仕様（1件以上）']
  };
}
