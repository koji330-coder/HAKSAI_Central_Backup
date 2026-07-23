/** データパックの最小UI＋スクリプトプロパティ認証 */
function getPackKey_() {
  return PropertiesService.getScriptProperties().getProperty('PACK_KEY') || '';
}

/** 初回セットアップ用。既存キーは上書きしない。 */
function initializePackKey() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('PACK_KEY');
  if (existing) {
    Logger.log('PACK_KEY is already configured.');
    return existing;
  }
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('PACK_KEY', key);
  Logger.log('PACK_KEY initialized: ' + key);
  return key;
}

function packAuthOk_(e) {
  const key = getPackKey_();
  return key && String((e && e.parameter && e.parameter.key) || '') === key;
}

function packDeny_() {
  return ContentService.createTextOutput('{"error":"invalid key"}')
    .setMimeType(ContentService.MimeType.JSON);
}

function getPackJsonForView(action, asin, key) {
  if (!key || key !== getPackKey_()) throw new Error('invalid key');
  const pack = action === 'decision_pack'
    ? buildDecisionPack(String(asin || '').trim())
    : action === 'audit_pack'
      ? buildAuditPack(String(asin || '').trim())
      : null;
  if (!pack) throw new Error('invalid action');
  return JSON.stringify(pack, null, 1);
}

function doGetPackView_(e) {
  const viewKey = JSON.stringify(getPackKey_());
  const html = `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>判断データパック</title>
<style>
  body{font-family:sans-serif;margin:16px;background:#14140f;color:#e8e2d0}
  h1{font-size:16px;letter-spacing:.15em;border-bottom:1px solid #b08d2f;padding-bottom:8px}
  input,button,textarea{font-size:16px;border-radius:8px;border:1px solid #6b5a2a}
  input{width:100%;box-sizing:border-box;padding:10px;background:#1e1d16;color:#e8e2d0}
  .row{display:flex;gap:8px;margin:12px 0}
  .guide{font-size:13px;line-height:1.7;color:#cfc9b5;margin:10px 0 14px}
  .guide b{color:#e8e2d0}
  .group{margin:14px 0 8px;color:#b08d2f;font-size:13px;font-weight:bold}
  button{flex:1;padding:12px 0;background:#b08d2f;color:#14140f;font-weight:bold;border:none}
  button.sub{background:#3a3627;color:#e8e2d0}
  textarea{width:100%;box-sizing:border-box;height:44vh;background:#1e1d16;color:#cfc9b5;padding:8px}
  #st{font-size:12px;color:#b08d2f;min-height:1em}
  @media(max-width:600px){.row{flex-direction:column}}
</style></head><body>
<h1>判断データパック</h1>
<div class="guide">
  <b>新商品</b>は参入判断、<b>販売中の商品</b>はページ診断を使います。<br>
  個別に調べるときだけ、下にASINを入力してください。
</div>
<input id="asin" placeholder="個別に調べるASINを入力" autocapitalize="characters">
<div class="group">新商品の仕入れを判断</div>
<div class="row">
  <button onclick="load('decision_pack',true,true)">このASINを参入判断</button>
  <button class="sub" onclick="load('decision_pack',false,false)">自社の判断基準だけ取得</button>
</div>
<div class="group">販売中商品のページを診断</div>
<div class="row">
  <button onclick="load('audit_pack',true,true)">このASINをページ診断</button>
  <button class="sub" onclick="load('audit_pack',false,false)">全商品を横断診断</button>
</div>
<div class="row"><button class="sub" onclick="copyIt()">JSONをコピー → Claudeへ</button></div>
<div id="st"></div>
<textarea id="out" readonly placeholder="ここにJSONが出ます"></textarea>
<script>
function load(action,useAsin,required){
  const input = document.getElementById('asin').value.trim();
  if(required && !input){
    st('この操作にはASINの入力が必要です');
    document.getElementById('asin').focus();
    return;
  }
  const asin = useAsin ? input : '';
  st('取得中…');
  google.script.run
    .withSuccessHandler(function(text){
      document.getElementById('out').value = text;
      st(action + ' 取得OK');
    })
    .withFailureHandler(function(err){ st('エラー: ' + (err && err.message ? err.message : err)); })
    .getPackJsonForView(action, asin, ${viewKey});
}
function copyIt(){
  const t = document.getElementById('out');
  t.select(); t.setSelectionRange(0, 999999);
  navigator.clipboard.writeText(t.value).then(()=>st('コピーしました'), ()=>st('長押しでコピーしてください'));
}
function st(m){ document.getElementById('st').textContent = m; }
</script></body></html>`;
  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
