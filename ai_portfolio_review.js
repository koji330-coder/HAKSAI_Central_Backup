/** HAKSAI Central 全体AIレビュー v1 — 手動実行、3 signal、既存秘書カード統合 */
const AIR_RUNS_SHEET = 'ReviewRuns';
const AIR_RUN_HEADERS = ['run_id','review_type','review_date','trigger','status','prompt_version','schema_version','model','input_snapshot_file_id','output_json','latency_ms','validation_log','created_at'];
const AIR_PROMPT_VERSION = 'v1.0';

function airSheet_() {
  const ss=getSpreadsheet_(); let sh=ss.getSheetByName(AIR_RUNS_SHEET);
  if(!sh) sh=ss.insertSheet(AIR_RUNS_SHEET);
  const current=sh.getLastColumn()?sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String):[];
  if(!current.some(Boolean)) sh.getRange(1,1,1,AIR_RUN_HEADERS.length).setValues([AIR_RUN_HEADERS]);
  else AIR_RUN_HEADERS.forEach(function(h){if(current.indexOf(h)<0){sh.getRange(1,current.length+1).setValue(h);current.push(h);}});
  return sh;
}

function airSignalFromEvent_(event,index,date) {
  const map={stockout_risk:'STOCKOUT_RISK',home_replenishment:'HOME_REPLENISHMENT',acos_over_breakeven:'AD_LOSS',cvr_drop:'CVR_DROP'};
  const code=map[event.type]; if(!code)return null;
  return {signal_id:'S-'+date.replace(/-/g,'')+'-'+String(index+1).padStart(3,'0'),code:code,
    asin:event.asin||'',product_name:String(event.name||'').slice(0,90),severity:event.priority==='P1'?1:event.priority==='P2'?2:3,
    metrics:event.facts||{},note:event.detail||'',route:event.route||'',recommended_action:event.next_action||''};
}

function airFeedback_() {
  const now=Date.now(), days30=30*864e5, cards=secCardObjects_();
  const canonical=function(c){if(c.dedupe_key&&String(c.dedupe_key).indexOf('|')>0)return String(c.dedupe_key);const m=String(c.event_key||'').match(/^(stockout_risk|home_replenishment|acos_over_breakeven|cvr_drop):(.+)$/);if(!m)return String(c.event_key||'');return({stockout_risk:'STOCKOUT_RISK',home_replenishment:'HOME_REPLENISHMENT',acos_over_breakeven:'AD_LOSS',cvr_drop:'CVR_DROP'}[m[1]])+'|'+m[2];};
  const trim=function(c){return{dedupe_key:canonical(c),title:String(c.title||'').slice(0,80),reason:String(c.dismiss_reason||'').slice(0,200),age_days:Math.max(0,Math.floor((now-secDate_(c.created_date).getTime())/864e5))};};
  return {
    completed_recent:cards.filter(function(c){return c.status==='done'&&now-secDate_(c.status_updated_at).getTime()<=days30;}).slice(-20).map(trim),
    dismissed_recent:cards.filter(function(c){return c.status==='dismissed'&&now-secDate_(c.status_updated_at).getTime()<=days30;}).slice(-20).map(trim),
    open_actions:cards.filter(function(c){return c.status==='open'||c.status==='snoozed';}).slice(-30).map(trim)
  };
}

function airBuildInput_() {
  const date=secToday_(), settings=secGetSettings_(), events=secDetectEvents_();
  const signals=events.map(function(e,i){return airSignalFromEvent_(e,i,date);}).filter(Boolean);
  const counts={STOCKOUT_RISK:0,HOME_REPLENISHMENT:0,AD_LOSS:0,CVR_DROP:0};signals.forEach(function(s){counts[s.code]++;});
  return {meta:{review_type:'daily',review_date:date,schema_version:1,prompt_version:AIR_PROMPT_VERSION,currency:'JPY'},
    owner_context:{time_budget:'副業。1日に使える時間は限られる',assistant_name:settings.assistant_name,owner_name:settings.owner_name,tone:settings.tone,custom_instruction:settings.custom_instruction},
    portfolio_summary:{detected_signal_count:signals.length,stockout_risk_count:counts.STOCKOUT_RISK,home_replenishment_count:counts.HOME_REPLENISHMENT,ad_loss_count:counts.AD_LOSS,cvr_drop_count:counts.CVR_DROP},
    signals:signals,action_feedback:airFeedback_(),data_quality:{notes:['v1は欠品・広告赤字・CVR低下の3種類を対象とする']}};
}

function airPrompt_(input) {
  return `あなたはAmazon物販事業HAKSAI Centralの経営参謀です。入力済みの計算結果だけを使い、「今日どこに時間を使うか」を判断してください。
数値を再計算せず、入力にない事実・原因・ASINを作らないでください。evidenceにはsignals内のsignal_idだけを使ってください。
priority_actionsは最大3件。既存open_actionsと同じ問題は新規提案しません。dismissed_recentは理由を尊重してください。
分析内容は簡潔で厳密にし、secretary_voiceだけはowner_contextの秘書名・呼び名・口調・追加注文を反映してください。secretary_voiceに新しい事実や数値を足してはいけません。
JSONのみを返してください。形式:
{"executive_summary":"3文以内","today_focus":{"title":"","why":"","action_ref":""},"portfolio_diagnosis":[{"aspect":"在庫|広告|ページ","state":"good|warning|bad","comment":""}],"priority_actions":[{"id":"A1","priority":"P1|P2|P3","category":"在庫|広告|ページ|販売","asin":"","title":"","finding":"","evidence":["signal_id"],"business_impact":"","recommended_action":"","why_now":"","uncertainties":[],"route":"","dedupe_key":"CODE|ASIN"}],"questions_for_owner":[],"data_gaps":[],"confidence":{"level":"high|medium|low","reason":""},"secretary_voice":{"opening":"","comment":"","encouragement":""}}
入力JSON:
${JSON.stringify(input)}`;
}

function airCallGemini_(input) {
  if(!GEMINI_API_KEY)throw new Error('GEMINI_API_KEY 未設定');
  const model=GEMINI_MODEL||'gemini-3.1-flash-lite', url='https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+GEMINI_API_KEY;
  const payload={contents:[{parts:[{text:airPrompt_(input)}]}],generationConfig:{temperature:0.2,maxOutputTokens:4096,responseMimeType:'application/json'}};
  let last;
  for(let i=0;i<2;i++){
    try{const r=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify(payload)});if(r.getResponseCode()!==200)throw new Error('Gemini HTTP '+r.getResponseCode()+': '+r.getContentText().slice(0,200));const j=JSON.parse(r.getContentText());return{output:JSON.parse(j.candidates[0].content.parts[0].text),model:model};}
    catch(e){last=e;if(i===0)Utilities.sleep(2000);}
  }
  throw last;
}

function airValidate_(output,input) {
  output=output||{}; const log=[], ids=new Set(input.signals.map(function(s){return s.signal_id;})), signals=Object.fromEntries(input.signals.map(function(s){return[s.signal_id,s];}));
  const blocked=new Set(input.action_feedback.open_actions.concat(input.action_feedback.dismissed_recent).map(function(x){return x.dedupe_key;}));
  const actions=(Array.isArray(output.priority_actions)?output.priority_actions:[]).filter(function(a){
    const evidence=(Array.isArray(a.evidence)?a.evidence:[]).filter(function(id){return ids.has(id);});a.evidence=evidence;
    if(!evidence.length){log.push('evidence不正のため破棄: '+String(a.title||''));return false;}
    const signal=signals[evidence[0]], key=signal.code+'|'+signal.asin;a.dedupe_key=key;a.asin=signal.asin;
    if(blocked.has(key)){log.push('重複抑止: '+key);return false;} return true;
  }).sort(function(a,b){return({P1:0,P2:1,P3:2}[a.priority]||9)-({P1:0,P2:1,P3:2}[b.priority]||9);}).slice(0,3);
  output.priority_actions=actions;output.portfolio_diagnosis=Array.isArray(output.portfolio_diagnosis)?output.portfolio_diagnosis:[];
  output.questions_for_owner=Array.isArray(output.questions_for_owner)?output.questions_for_owner:[];output.data_gaps=Array.isArray(output.data_gaps)?output.data_gaps:[];
  output.secretary_voice=output.secretary_voice||{};return{output:output,log:log};
}

function airSaveSnapshot_(runId,input) {
  if(!DRIVE_FOLDER_ID)return '';
  try{return DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile('ai_review_input_'+runId+'.json',JSON.stringify(input,null,2),MimeType.PLAIN_TEXT).getId();}catch(e){return '';}
}

function airAppendCards_(runId,actions,input) {
  if(!actions.length)return 0; const sh=secEnsureCardsSheet_(), existing=secCardObjects_(), headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String), signalMap=Object.fromEntries(input.signals.map(function(s){return[s.signal_id,s];}));
  const rows=[];actions.forEach(function(a){const old=existing.find(function(c){return c.dedupe_key===a.dedupe_key&&(c.status==='open'||c.status==='snoozed');});if(old)return;
    const obj={card_id:Utilities.getUuid(),created_date:secToday_(),priority:a.priority||'P3',category:a.category||'その他',asin:a.asin||'',title:a.title||'',body:a.finding||'',next_action:a.recommended_action||'',route:a.route||'',impact_note:a.business_impact||'',status:'open',event_key:'ai_review:'+a.dedupe_key,event_fingerprint:secHash_(JSON.stringify(a)),source_detail:(a.evidence||[]).map(function(id){return(signalMap[id]||{}).note||id;}).join('\n'),facts_json:JSON.stringify({evidence:a.evidence||[]}),source:'ai_review',review_run_id:runId,dedupe_key:a.dedupe_key,evidence_json:JSON.stringify(a.evidence||[]),why_now:a.why_now||'',uncertainties_json:JSON.stringify(a.uncertainties||[])};
    rows.push(headers.map(function(h){return obj[h]==null?'':obj[h];}));});
  if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,headers.length).setValues(rows);return rows.length;
}

function runAiPortfolioReview_(opts) {
  opts=opts||{}; const started=Date.now(), input=airBuildInput_(), runId='R-'+secToday_().replace(/-/g,'')+'-'+Utilities.formatDate(new Date(),'Asia/Tokyo','HHmmss');
  let status='success', output, validation=[] ,model=GEMINI_MODEL||'gemini-3.1-flash-lite';
  try{const ai=airCallGemini_(input), checked=airValidate_(ai.output,input);output=checked.output;validation=checked.log;model=ai.model;}
  catch(e){status='fallback';validation.push(String(e));const first=input.signals.slice().sort(function(a,b){return a.severity-b.severity;})[0];output={executive_summary:'AI分析を取得できなかったため、検出事実のみを表示しています。',today_focus:first?{title:first.product_name,why:first.note,action_ref:''}:{title:'緊急の検出事項はありません',why:'対象signalは0件です',action_ref:''},portfolio_diagnosis:[],priority_actions:[],questions_for_owner:[],data_gaps:['AIレビュー取得失敗'],confidence:{level:'low',reason:'フォールバック'},secretary_voice:{opening:'',comment:'検出事実だけを確認できる状態です。',encouragement:'必要なところから一つずつ見ていきましょう。'}};}
  const snapshot=airSaveSnapshot_(runId,input);airAppendCards_(runId,output.priority_actions||[],input);
  const rec={run_id:runId,review_type:'daily',review_date:secToday_(),trigger:opts.trigger||'manual',status:status,prompt_version:AIR_PROMPT_VERSION,schema_version:1,model:model,input_snapshot_file_id:snapshot,output_json:JSON.stringify(output),latency_ms:Date.now()-started,validation_log:JSON.stringify(validation),created_at:new Date().toISOString()};
  const sh=airSheet_();sh.appendRow(AIR_RUN_HEADERS.map(function(h){return rec[h]==null?'':rec[h];}));return{run_id:runId,status:status,review:output,created_cards:(output.priority_actions||[]).length};
}

function airGetLatestReview_() {
  const sh=airSheet_();if(sh.getLastRow()<2)return null;const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String),row=sh.getRange(sh.getLastRow(),1,1,headers.length).getValues()[0],obj=Object.fromEntries(headers.map(function(h,i){return[h,row[i]];}));
  try{obj.review=JSON.parse(obj.output_json||'{}');}catch(e){obj.review={};}delete obj.output_json;return obj;
}
