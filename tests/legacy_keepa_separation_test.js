const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, {sheet,row,col,rows,cols}); }
  getValues() {
    const out=[];
    for(let r=0;r<this.rows;r++){
      const line=[];
      for(let c=0;c<this.cols;c++) line.push((this.sheet.values[this.row-1+r]||[])[this.col-1+c] ?? '');
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line,r)=>line.forEach((value,c)=>{
      while(this.sheet.values.length<this.row+r) this.sheet.values.push([]);
      this.sheet.values[this.row-1+r][this.col-1+c]=value;
    }));
    return this;
  }
  setFontWeight(){return this;}
}

class Sheet {
  constructor(name, values){this.name=name;this.values=values.map(row=>row.slice());}
  getName(){return this.name;}
  setName(name){this.name=name;return this;}
  getLastRow(){return this.values.length;}
  getLastColumn(){return this.values.reduce((max,row)=>Math.max(max,row.length),0);}
  getDataRange(){return new Range(this,1,1,this.getLastRow(),this.getLastColumn());}
  getRange(row,col,rows=1,cols=1){return new Range(this,row,col,rows,cols);}
  copyTo(ss){const copy=new Sheet('Copy of '+this.name,this.values);ss.sheets.push(copy);return copy;}
  clear(){this.values=[];return this;}
  setFrozenRows(){return this;}
  autoResizeColumns(){return this;}
}

class Spreadsheet {
  constructor(id,name,sheets){this.id=id;this.name=name;this.sheets=sheets;}
  getId(){return this.id;}
  getName(){return this.name;}
  getUrl(){return 'https://docs.google.com/spreadsheets/d/'+this.id+'/edit';}
  getSheets(){return this.sheets;}
  getSheetByName(name){return this.sheets.find(sheet=>sheet.name===name)||null;}
  deleteSheet(sheet){this.sheets=this.sheets.filter(item=>item!==sheet);}
}

const keepaPack=JSON.stringify({product_facts:{title:'候補'},decision_screen:{pipeline:'sourcing-decision'}});
const source=new Spreadsheet('SOURCE','HAKSAI Central',[
  new Sheet('keepa_research_candidates',[
    ['asin','source_pipeline'],['B000000001',''],['B000000002','sourcing-decision']
  ]),
  new Sheet('keepa_batch_schedule',[['hour','selection_json'],[18,'{}']]),
  new Sheet('keepa_seller_master',[['seller_id','status'],['S1','取得済']]),
  new Sheet('keepa_ng_categories',[['id'],[1]]),
  new Sheet('keepa_category_master',[['id','name'],[1,'カテゴリ']]),
  new Sheet('keepa_history_trial_preview',[['asin'],['B000000002']]),
  new Sheet('product_lifecycle',[
    ['asin','source','keepa_data'],['B000000002','ATLAS_SOURCING_DECISION',keepaPack]
  ]),
  new Sheet('listing_snapshots',[['asin'],['B000000002']])
]);
let archive=null;
const props={SPREADSHEET_ID:'SOURCE'};
const triggers=[
  {handler:'runKeepaBatch',id:'T1'},
  {handler:'convertCompletedTitlesToValues',id:'T2'},
  {handler:'runDailyBrief',id:'T3'}
].map(item=>({
  getHandlerFunction:()=>item.handler,getUniqueId:()=>item.id,getEventType:()=> 'CLOCK'
}));
const trashed=[];
const logs=[];

const context={
  Date,JSON,Object,Array,String,Number,Math,isNaN,
  SpreadsheetApp:{
    openById:id=>{assert.strictEqual(id,'SOURCE');return source;},
    create:name=>{archive=new Spreadsheet('ARCHIVE',name,[new Sheet('Sheet1',[['']])]);return archive;},
    flush(){}
  },
  PropertiesService:{getScriptProperties:()=>({
    getProperty:key=>props[key]||'',
    setProperties:values=>Object.assign(props,values)
  })},
  ScriptApp:{
    getProjectTriggers:()=>triggers.slice(),
    deleteTrigger:trigger=>{const index=triggers.indexOf(trigger);if(index>=0)triggers.splice(index,1);}
  },
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  DriveApp:{getFileById:id=>({
    setTrashed:value=>trashed.push([id,value]),
    getParents:()=>({hasNext:()=>false}),
    moveTo(){}
  })},
  Utilities:{
    formatDate:()=> '20260718_220000',
    DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
    computeDigest:(algorithm,text)=>Array.from(crypto.createHash('sha256').update(text).digest()).map(v=>v>127?v-256:v)
  },
  Logger:{log:value=>logs.push(value)}
};

vm.createContext(context);
const separationScript=fs.existsSync('旧Keepa自動リサーチ分離.js')
  ? '旧Keepa自動リサーチ分離.js'
  : 'デバッグ_保守/旧Keepa自動リサーチ分離.js';
vm.runInContext(fs.readFileSync(separationScript,'utf8'),context);
const preview=context.previewLegacyKeepaSeparation();
assert.strictEqual(preview.ready,true);
assert.deepStrictEqual(Array.from(preview.sourcing_projection_asins),['B000000002']);
assert.strictEqual(preview.target_trigger_count,2);
assert(source.getSheetByName('keepa_research_candidates'));

const result=context.executeLegacyKeepaSeparation();
assert.strictEqual(result.status,'completed');
assert.strictEqual(result.copied_sheets.length,6);
assert.strictEqual(source.getSheetByName('keepa_research_candidates'),null);
assert(source.getSheetByName('product_lifecycle'));
assert(source.getSheetByName('listing_snapshots'));
assert(archive.getSheetByName('keepa_research_candidates'));
assert(archive.getSheetByName('_archive_manifest'));
assert.deepStrictEqual(triggers.map(t=>t.getHandlerFunction()),['runDailyBrief']);
assert.strictEqual(props.LEGACY_KEEPA_ARCHIVE_SPREADSHEET_ID,'ARCHIVE');
assert.strictEqual(trashed.length,0);
console.log('legacy_keepa_separation_test: OK');
