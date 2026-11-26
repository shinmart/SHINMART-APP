// Проверка Ops.gs + расходов + ролей на модели таблицы. Запуск: node tests/ops.test.js (exit code 1, если есть FAIL).
// Это модель, а не настоящая таблица: см. LESSONS L-015.
// минимальная модель таблиц для проверки Ops + расходы + роли
const fs=require('fs');
const sheets={};
function mk(name){ const d=[]; const sh={name,d,
 getLastRow(){ let n=d.length; while(n>0&&!(d[n-1]||[]).some(x=>x!==''&&x!==undefined))n--; return n;},
 getMaxRows(){return 1000}, getLastColumn(){return 10},
 getRange(r,c,nr=1,nc=1){ return {
  getValues(){ const o=[]; for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++)row.push((d[r-1+i]||[])[c-1+j]??'');o.push(row);} return o;},
  setValues(v){ v.forEach((row,i)=>row.forEach((x,j)=>{ (d[r-1+i]=d[r-1+i]||[])[c-1+j]=x;}));return this;},
  setValue(x){ (d[r-1]=d[r-1]||[])[c-1]=x;return this;},
  clearContent(){ for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){ if(d[r-1+i]) d[r-1+i][c-1+j]='';} return this;},
  setFontWeight(){return this}, setNumberFormat(){return this}}; },
 appendRow(v){ d.push(v); }, setFrozenRows(){}, };
 return sh; }
const ss={getSheetByName:n=>sheets[n]||null, insertSheet:n=>sheets[n]=mk(n), getSpreadsheetTimeZone:()=> 'Asia/Almaty', getId:()=> 'x'};
sheets['ПРОДАЖИ']=mk('ПРОДАЖИ');
let user='owner@x.kz';
global.getSS_=()=>ss; global.SHEETS={PRODAJI:'ПРОДАЖИ'}; global.SpreadsheetApp={getUi(){throw new Error('no ui')}};
const cache={}; global.CacheService={getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v},remove:k=>{delete cache[k]}})};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};
global.Session={getActiveUser:()=>({getEmail:()=>user}),getEffectiveUser:()=>({getEmail:()=>user})};
global.Utilities={formatDate:(d,tz,f)=>{const p=n=>String(n).padStart(2,'0');return f==='yyyy-MM-dd'?`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`:`${d.getFullYear()}-${p(d.getMonth()+1)}`},
  parseDate:(s)=>new Date(s+'T00:00:00'), base64Decode:()=>[1,2,3], newBlob:()=>({}) };
global.PropertiesService={getScriptProperties:()=>({getProperty:()=>null,setProperty(){}})};
let src=['WebApp','Ops'].map(f=>fs.readFileSync(__dirname+'/../apps-script/'+f+'.gs','utf8')).join('\n');
src=src.replace(/\nconst (\w+) =/g,'\nglobalThis.$1 =');
// appReadSales_ заглушка: два продажи
src+=`\nglobalThis.appReadSales_=function(){ const t=new Date(); const d=Utilities.formatDate(t,'x','yyyy-MM-dd'); return [{day:d,price:100000,qty:4,cost:300000,margin:100000,pay:'QR',size:'a',name:'b',row:5,who:'x'},{day:d,price:50000,qty:2,cost:80000,margin:20000,pay:'рассрочка',size:'a',name:'b',row:6,who:'x'},{day:d,price:30000,qty:1,cost:20000,margin:10000,pay:'нал',size:'a',name:'b',row:7,who:'x'}]; };`;
src+=`\nglobalThis.APP_ALLOWED=['owner@x.kz','seller@x.kz'];globalThis.appLog_=()=>{};`;
(0,eval)(src);
(async()=>{
 const ok=(c,m)=>{ if(!c){console.log('FAIL',m);process.exitCode=1;} else console.log('ok  ',m); };
 let r=appOpsInit({}); ok(r.ok&&r.role==='owner'&&r.accs.length===2&&r.pays.length===4,'init owner');
 r=appTransfer({reqId:'a1',from:'Kaspi',to:'Касса',sum:50000}); 
 ok(r.ok&&r.accs.find(a=>a.n==='Касса').bal===50000&&r.accs.find(a=>a.n==='Kaspi').bal===-50000,'transfer '+JSON.stringify(r.accs));
 r=appAdjustAccount({reqId:'a2',acc:'Касса',fact:70000}); ok(r.ok&&r.diff===20000,'adjust');
 r=appAddAccount({reqId:'a3',n:'Halyk',bal:1000}); ok(r.ok&&r.accs.length===3,'add account');
 r=appAddAccount({reqId:'a4',n:'halyk'}); ok(!r.ok,'dup account rejected');
 // расход
 r=appAddExpense({reqId:'e1',cat:'Аренда',sum:30000,acc:'Касса',file:'https://drive.google.com/file/d/1/view',note:'ноябрь'});
 ok(r.ok&&r.exp.rows[0].acc==='Касса'&&r.exp.rows[0].f.includes('drive.google.com'),'expense with acc+file');
 let accs=appOpsInit({}).accs; ok(accs.find(a=>a.n==='Касса').bal===40000,'cash after expense '+accs.find(a=>a.n==='Касса').bal);
 r=appAddExpense({reqId:'e2',cat:'Другое',sum:100,file:'http://evil.com/x'}); ok(r.ok&&r.exp.rows[0].f==='','non-drive link dropped');
 // комиссия
 r=appBankInfo({}); ok(r.ok&&r.fee===Math.round(400000*0.95/100+100000*12/100),'fee '+r.fee);
 ok(r.pending.items.length===2 && Math.round(r.pending.sum)===500000,'pending '+JSON.stringify(r.pending.sum));
 // настройки
 r=appSaveSettings({reqId:'s1',pays:[{n:'нал',fee:0,days:0},{n:'QR',fee:1,days:1}],cats:['Аренда','Еда']}); ok(r.ok&&r.pays.length===2&&r.cats.length===2,'save settings');
 // отмена расхода
 const rows=appGetExpenses({}).exp.rows; 
 // продавец
 const st=opsSettingsSheet_(); st.getRange(2,8,1,2).setValues([['seller@x.kz','продавец']]);
 user='seller@x.kz';
 r=appOpsInit({}); ok(r.role==='seller'&&!r.accs,'seller: no accounts');
 ok(!appStats({}).ok,'seller: stats blocked'); ok(!appAddExpense({reqId:'e3',cat:'x',sum:5}).ok,'seller: expense blocked');
 ok(!appTransfer({reqId:'t9',from:'Касса',to:'Kaspi',sum:1}).ok,'seller: transfer blocked');
 ok(!appBankInfo({}).ok,'seller: bank blocked');
 const scr=opsScrub_('seller@x.kz',{ok:true,items:[{s:'1',b:[[1,2,3]],c:500,kv:3}],rows:[{c:9,m:8,pr:7}],cost:5});
 ok(scr.items[0].b.length===0&&scr.items[0].c===0&&scr.rows[0].m===0&&scr.rows[0].pr===7&&scr.cost===0,'scrub');
 user='owner@x.kz'; ok(opsScrub_('owner@x.kz',{cost:5}).cost===5,'owner not scrubbed');
})();
