/* motoai_v38_1_debug_semantic_pricing.js (patched)
✅ GỘP: v27 (BM25 + Extractive QA + Auto-Price Learn + Multi-site)
+ v37.6 (UI nhỏ như Messenger + DeepContext + ưu tiên moto_sitemap.json)
+ v38.1 (Debug counters + console.table, fix UI input, iOS keyboard-safe)
✅ PATCH theo yêu cầu:
1) Không gửi link trong câu trả lời chatbot
2) Loại bỏ ký tự/định dạng markdown như ***
3) Nhận diện tên xe viết tắt kiểu đời thường (vd: “vision giá”, “lead 1 tháng”, “ex 3 ngày”…)

Public API: window.MotoAI_v38.{open,close,send,learnNow,getIndex,clearLearnCache,debugDump}
*/
(function(){
if (window.MotoAI_v38_LOADED) return;
window.MotoAI_v38_LOADED = true;

/* ====== CONFIG ====== */
const DEF = {
brand: “Nguyen Tu”,
phone: “0942467674”,
zalo:  “”,
map:   “”,
avatar: “👩‍💼”,
themeColor: “#0084FF”,

autolearn: true,
viOnly: true,
deepContext: true,
maxContextTurns: 5,

extraSites: [location.origin],
crawlDepth: 1,
refreshHours: 24,
maxPagesPerDomain: 80,
maxTotalPages: 300,

fetchTimeoutMs: 10000,
fetchPauseMs: 160,
disableQuickMap: false,

// Smart flags
smart: {
  semanticSearch: true,   // BM25
  extractiveQA:   true,   // chích câu “đinh”
  autoPriceLearn: true    // trích giá từ HTML
},

// Debug / profiling
debug: true

};
const ORG = (window.MotoAI_CONFIG||{});
if(!ORG.zalo && (ORG.phone||DEF.phone)) ORG.zalo = ‘https://zalo.me/’ + String(ORG.phone||DEF.phone).replace(/\s+/g,’’);
const CFG = Object.assign({}, DEF, ORG);
CFG.smart = Object.assign({}, DEF.smart, (ORG.smart||{}));

/* ====== HELPERS ====== /
const $  = s => document.querySelector(s);
const safe = s => { try{ return JSON.parse(s); }catch{ return null; } };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const nowSec = ()=> Math.floor(Date.now()/1000);
const pick = a => a[Math.floor(Math.random()a.length)];
const nfVND = n => (n||0).toLocaleString(‘vi-VN’);
const clamp = (n,min,max)=> Math.max(min, Math.min(max,n));
const sameHost = (u, origin)=> { try{ return new URL(u).host.replace(/^www./,’’) === new URL(origin).host.replace(/^www./,’’); }catch{ return false; } };
function naturalize(t){
if(!t) return t;
let s = “ “+t+” “;
s = s.replace(/\s+ạ([.!?,\s]|$)/gi, “$1”).replace(/\s+nhé([.!?,\s]|$)/gi, “$1”).replace(/\s+nha([.!?,\s]|$)/gi, “$1”);
s = s.replace(/\s{2,}/g,” “).trim(); if(!/[.!?]$/.test(s)) s+=”.”; return s.replace(/../g,”.”);
}
function looksVN(s){
if(/[ăâêôơưđà-ỹ]/i.test(s)) return true;
const hits = (s.match(/\b(xe|thuê|giá|liên hệ|hà nội|cọc|giấy tờ)\b/gi)||[]).length;
return hits >= 2;
}
// Loại bỏ link & markdown cơ bản trong câu trả lời bot
function stripMdAndLinks(s){
if(!s) return s;
let x = String(s);
x = x.replace(/https?://\S+/gi, ‘’);                           // URL trần
x = x.replace(/![^]][^)]+/g, ‘’);                      // 
x = x.replace(/([^]+)][^)]+/g, ‘$1’);                   // text￼
x = x.replace(/[_~]{1,3}/g, '');                               // *** __ ~~ code`
x = x.replace(/\s{2,}/g, ’ ’).trim();
return x;
}

/* ====== STORAGE KEYS ====== */
const K = {
sess:  “MotoAI_v38_session”,
ctx:   “MotoAI_v38_ctx”,
learn: “MotoAI_v38_learn”,       // { domainKey: {ts, pages:[{url,title,text}] } }
autoprices: “MotoAI_v38_auto_prices”,
stamp: “MotoAI_v38_learnStamp”,
clean: “MotoAI_v38_lastClean”,
dbg:   “MotoAI_v38_debug_stats”
};

/* ====== UI (Messenger-like, input ~32px) ====== */
const CSS = `
:root{
–mta-z:2147483647;
–m-blue:${CFG.themeColor};
–m-bg:#fff;
–m-text:#0b1220;

/* Input sizing (tùy biến nhanh) */
--m-in-h: 34px;         /* chiều cao ô nhập. Đổi 34/36 nếu muốn lớn hơn */
--m-in-fs: 15px;        /* cỡ chữ trong ô nhập */
--m-send-size: 36px;    /* kích thước nút gửi */

}
#mta-root{
position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0));z-index:var(–mta-z);
font-family:-apple-system,system-ui,Segoe UI,Roboto,“Helvetica Neue”,Arial,sans-serif
}
#mta-bubble{
width:56px;height:56px;border:none;border-radius:999px;
background:linear-gradient(150deg,var(–m-blue),#00B2FF);
display:flex;align-items:center;justify-content:center;cursor:pointer;
box-shadow:0 10px 28px rgba(0,0,0,.18);color:#fff;font-size:22px
}
#mta-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.2);opacity:0;pointer-events:none;transition:opacity .15s ease}
#mta-backdrop.show{opacity:1;pointer-events:auto}

#mta-card{
position:fixed;right:16px;bottom:16px;width:min(420px,calc(100% - 24px));
height:70vh;max-height:740px;background:var(–m-bg);color:var(–m-text);
border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.25);
display:flex;flex-direction:column;overflow:hidden;
transform:translateY(110%);transition:transform .22s cubic-bezier(.22,1,.36,1)
}
#mta-card.open{transform:translateY(0)}

#mta-header{background:linear-gradient(130deg,var(–m-blue),#00B2FF);color:#fff}
#mta-header .bar{display:flex;align-items:center;gap:10px;padding:11px 12px}
#mta-header .avatar{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:15px}
#mta-header .info{
display:flex; flex-direction:column; gap:2px;
}
#mta-header .name{font-weight:700;font-size:14px;line-height:1.1}
#mta-header .status{font-size:12px;opacity:.9;display:flex;align-items:center;gap:4px}
#mta-header .status-dot{width:8px;height:8px;border-radius:50%;background:#3fff6c}
#mta-header .actions{margin-left:auto;display:flex;gap:6px;align-items:center}
#mta-header .act{width:28px;height:28px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;text-decoration:none}
#mta-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer}

#mta-body{
flex:1;overflow-y:auto;background:linear-gradient(180deg,#E9EEF5 0%, #D7E0EC 100%);
padding:14px 10px 12px; scroll-behavior:smooth;
}
.m-msg{max-width:78%;margin:6px 0;padding:8px 11px;border-radius:20px;line-height:1.45;word-break:break-word;box-shadow:0 1px 1px rgba(0,0,0,.05);font-size:14px}
.m-msg.bot{background:#fff;color:#0d1117;border:1px solid rgba(0,0,0,.03)}
.m-msg.user{background:#0084FF;color:#fff;margin-left:auto;border-bottom-right-radius:3px}

/* Typing + quick tags */
#mta-typing{display:inline-flex;gap:6px;align-items:center;margin:6px 0}
#mta-typing span{background:#fff;padding:6px 8px;border-radius:999px;font-size:12px}
#mta-tags{background:#f6f7f9;border-top:1px solid rgba(0,0,0,.05);transition:max-height .2s ease,opacity .2s ease}
#mta-tags.hidden{max-height:0;opacity:0;overflow:hidden}
#mta-tags .track{display:block;white-space:nowrap;overflow-x:auto;padding:8px 10px 10px}
#mta-tags button{display:inline-block;margin-right:8px;background:#fff;border:1px solid rgba(0,0,0,.05);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer}

/* Input bar (keyboard-safe) */
#mta-input{
background:#fff;border-top:1px solid rgba(0,0,0,.05);
padding:8px 8px; display:flex;gap:8px;align-items:center;
position:sticky; bottom:0;
}
#mta-in{
flex:1;border:1px solid rgba(0,0,0,.12);
height:var(–m-in-h); line-height:var(–m-in-h);
padding:0 14px;border-radius:calc(var(–m-in-h)/2);
background:#F2F4F7;color:#0b1220; font-size:var(–m-in-fs);
box-sizing:border-box;-webkit-appearance:none;appearance:none
}
#mta-in::placeholder{ color:rgba(0,0,0,.45) }
#mta-send{
width:var(–m-send-size); height:var(–m-send-size);
border:none;border-radius:50%;
background:linear-gradient(160deg,#0084FF,#00B2FF);
color:#fff;cursor:pointer;box-shadow:0 6px 18px rgba(0,132,255,.4);
font-size:15px; display:flex;align-items:center;justify-content:center
}

@media(max-width:520px){
#mta-card{right:8px;left:8px;width:auto;height:70vh}
#mta-body{padding-bottom:8px}
}
@media(prefers-color-scheme:dark){
:root{–m-bg:#1a1c20;–m-text:#ecf0f5}
#mta-body{background:linear-gradient(180deg,#131416,#1a1c20)}
.m-msg.bot{background:#23252a;color:#fff;border:1px solid rgba(255,255,255,.03)}
#mta-input{background:#1a1c20;border-top:1px solid rgba(255,255,255,.04)}
#mta-in{background:#121317;color:#fff;border:1px solid rgba(255,255,255,.12)}
#mta-in::placeholder{ color: rgba(255,255,255,.66) }
#mta-tags{background:#1c1e22;border-top:1px solid rgba(255,255,255,.05)}
#mta-tags button{background:#22242a;color:#fff;border:1px solid rgba(255,255,255,.1)}
}; const HTML = 

  <div id="mta-root" aria-live="polite">
    <button id="mta-bubble" aria-label="Mở chat cùng ${CFG.brand}" aria-expanded="false">💬</button>
    <div id="mta-backdrop"></div>
    <section id="mta-card" role="dialog" aria-label="Chat ${CFG.brand}" aria-hidden="true">
      <header id="mta-header">
        <div class="bar">
          <div class="avatar">${CFG.avatar||"👩‍💼"}</div>
          <div class="info">
            <div class="name">${CFG.brand} — Đang hoạt động</div>
            <div class="status"><span class="status-dot"></span>Trực tuyến</div>
          </div>
          <div class="actions">
            ${CFG.phone?`<a class="act" href="tel:${CFG.phone}" title="Gọi nhanh">📞</a>`:""}
            ${CFG.zalo?`<a class="act" href="${CFG.zalo}" target="_blank" rel="noopener" title="Zalo">Z</a>`:""}
            ${CFG.map?`<a class="act q-map" href="${CFG.map}" target="_blank" rel="noopener" title="Bản đồ">📍</a>`:""}
          </div>
          <button id="mta-close" aria-label="Đóng">×</button>
        </div>
      </header>
      <main id="mta-body" role="log"></main>
      <div id="mta-tags" role="toolbar" aria-label="Gợi ý nhanh">
        <div class="track" id="mta-tag-track">
          <button data-q="Giá thuê xe máy">💰 Giá thuê</button>
          <button data-q="Thuê xe ga">🛵 Xe ga</button>
          <button data-q="Thuê xe số">🏍 Xe số</button>
          <button data-q="Thuê theo tháng">📆 Theo tháng</button>
          <button data-q="Giao xe tận nơi">🚚 Giao tận nơi</button>
          <button data-q="Thủ tục">📄 Thủ tục</button>
          <button data-q="Đặt cọc">💳 Đặt cọc</button>
        </div>
      </div>
      <footer id="mta-input">
        <input id="mta-in" placeholder="Nhắn cho ${CFG.brand}..." autocomplete="off" />
        <button id="mta-send" aria-label="Gửi tin">➤</button>
      </footer>
    </section>
  </div>`;


/* ====== SESSION / CONTEXT ====== */
const MAX_MSG = 10;
function getSess(){ const arr = safe(localStorage.getItem(K.sess))||[]; return Array.isArray(arr)?arr:[]; }
function saveSess(a){ try{ localStorage.setItem(K.sess, JSON.stringify(a.slice(-MAX_MSG))); }catch{} }
function addMsg(role,text){
if(!text) return;
const body=$(”#mta-body”); if(!body) return;
const el=document.createElement(“div”); el.className=“m-msg “+(role===“user”?“user”:“bot”);
const safeText = role===“bot” ? stripMdAndLinks(text) : text; // lọc link/markdown cho bot
el.textContent = safeText;
body.appendChild(el); body.scrollTop=body.scrollHeight;
const arr=getSess(); arr.push({role,text:safeText,t:Date.now()}); saveSess(arr);
}
function renderSess(){
const body=$(”#mta-body”); body.innerHTML=””;
const arr=getSess();
if(arr.length) arr.forEach(m=> addMsg(m.role,m.text));
else addMsg(“bot”, naturalize(Xin chào 👋, em là nhân viên hỗ trợ của ${CFG.brand}. Anh/chị cần thuê xe số, xe ga hay theo tháng?));
}
function getCtx(){ return safe(localStorage.getItem(K.ctx)) || {turns:[]}; }
function pushCtx(delta){
try{
const ctx=getCtx(); ctx.turns.push(Object.assign({t:Date.now()}, delta||{}));
ctx.turns = ctx.turns.slice(-clamp(CFG.maxContextTurns||5,3,8));
localStorage.setItem(K.ctx, JSON.stringify(ctx));
}catch{}
}

/* ====== NLP nhẹ (loại xe / số ngày) ====== /
const TYPE_ALIASES = [
{canon:‘vision’,     re:/\bvi\ssion\b|\bvision\b|\bvis\b/i},
{canon:‘air blade’,  re:/\bair\sblade\b|\bairblade\b|\bab\b/i},
{canon:‘50cc’,       re:/\b50\scc\b|\b50cc\b/i},
{canon:‘xe điện’,    re:/\bxe\sđiện\b|vinfast|yadea|dibao|gogo|klara|evo|impes/i},
{canon:‘xe côn tay’, re:/\b(côn\stay|tay\scôn|exciter|ex\b|winner|win\b|raider|w175|msx|cb150|cbf190)\b/i},
{canon:‘xe ga’,      re:/\b(sh\smode|sh|lead|vespa|liberty|grande|janus|pcx|attila|mio|novo)\b|\bxe\sga\b/i},
{canon:‘xe số’,      re:/\b(wave(\salpha)?|alpha|blade|sirius|jupiter|future|dream)\b|\bxe\ssố\b/i}
];
function detectType(t){
const s = (t||’’).toLowerCase().normalize(‘NFC’);
for(const it of TYPE_ALIASES){ if(it.re.test(s)) return it.canon; }
return null;
}
function detectQty(t){
const m=(t||””).match(/(\d+)\s(ngày|day|tuần|tuan|week|tháng|thang|month)?/i);
if(!m) return null; const n=parseInt(m[1],10); if(!n) return null;
let unit=“ngày”; if(m[2]){ if(/tuần|tuan|week/i.test(m[2])) unit=“tuần”; else if(/tháng|thang|month/i.test(m[2])) unit=“tháng”; }
return {n,unit};
}
function detectIntent(t){
return {
needPrice:   /(giá|gia\b|bao nhiêu|thuê|tính tiền|cost|price)/i.test(t),
needDocs:    /(thủ tục|giấy tờ|cccd|passport|hộ chiếu)/i.test(t),
needContact: /(liên hệ|zalo|gọi|hotline|sđt|sdt|phone)/i.test(t),
needDelivery:/(giao|ship|tận nơi|đưa xe|mang xe)/i.test(t),
needReturn:  /(trả xe|gia hạn|đổi xe|kết thúc thuê)/i.test(t),
needPolicy:  /(điều kiện|chính sách|bảo hiểm|hư hỏng|sự cố|đặt cọc|cọc)/i.test(t)
};
}

/* ====== PRICE TABLE + Auto-Price Learn ====== /
const PRICE_TABLE = {
‘xe số’:      { day:[150000],          week:[600000,700000], month:[850000,1200000] },
‘xe ga’:      { day:[150000,200000],   week:[600000,1000000], month:[1100000,2000000] },
‘air blade’:  { day:[200000],          week:[800000], month:[1600000,1800000] },
‘vision’:     { day:[200000],          week:[700000,850000], month:[1400000,1900000] },
‘xe điện’:    { day:[170000],          week:[800000], month:[1600000] },
‘50cc’:       { day:[200000],          week:[800000], month:[1700000] },
‘xe côn tay’: { day:[300000],          week:[1200000], month:null }
};
function baseFor(type,unit){
const it=PRICE_TABLE[type]; if(!it) return null;
const key = unit===“tuần”?“week”:(unit===“tháng”?“month”:“day”);
const arr=it[key]; if(!arr) return null; return Array.isArray(arr)?arr[0]:arr;
}
function extractPricesFromText(txt){
const clean = String(txt||’’);
const lines = clean.replace(/<script[\s\S]?</script>/gi,’ ‘)
.replace(/<style[\s\S]?</style>/gi,’ ‘)
.replace(/<[^>]+>/g,’ ‘)
.replace(/\s+/g,’ ’)
.split(/[\n.•-–]|<br\s/?>/i);
const out = [];
const reNum = /(\d{2,3}(?:[.,]\d{3})+|\d{4,})(?:\s*(?:vnđ|vnd|đ|d|k))?/i;
const models = [
{key:/\bvision\b/i,                   type:‘vision’},
{key:/air\sblade|airblade|\bab\b/i,  type:‘air blade’},
{key:/\b50\scc\b|\b50cc\b/i,         type:‘50cc’},
{key:/côn\stay|tay\scôn/i,          type:‘xe côn tay’},
{key:/xe\sđiện|vinfast|yadea|dibao|gogo|klara/i, type:‘xe điện’},
{key:/wave|sirius|blade|jupiter|xe\ssố/i, type:‘xe số’},
{key:/xe\s*ga|vision|lead|vespa|liberty|grande|janus/i, type:‘xe ga’}
];
for(const raw of lines){
const line = String(raw||’’);
const found = models.find(m=> m.key.test(line));
if(!found) continue;
const m = line.match(reNum);
if(!m) continue;
let val = m[1].replace(/[^\d]/g,’’);
if(/\bk\b/i.test(line) && parseInt(val,10)<100000) val = String(parseInt(val,10)*1000); // 120k -> 120000
const price = parseInt(val,10);
if(!price || price >= 5000000) continue;

  const unit = /\b(tháng|thang|month)\b/i.test(line)
    ? 'tháng'
    : (/\b(tuần|tuan|week)\b/i.test(line) ? 'tuần' : 'ngày');

  out.push({type:found.type, unit, price});
}
return out;

}

/* ====== SIMPLE INDEX + BM25 mini ====== /
function tk(s){
const str = (s||””).toLowerCase().normalize(‘NFC’);
try{
return str.replace(/[^\p{L}\p{N}\s]+/gu,’ ‘).split(/\s+/).filter(Boolean);
}catch{
return str.replace(/[^0-9a-zA-Z\u00C0-\u1EF9\s]+/g,’ ’).split(/\s+/).filter(Boolean);
}
}
function loadLearn(){ return safe(localStorage.getItem(K.learn)) || {}; }
function saveLearn(o){ try{ localStorage.setItem(K.learn, JSON.stringify(o)); }catch{} }
function getIndexFlat(){
const cache=loadLearn(); const out=[];
Object.keys(cache).forEach(key=>{ (cache[key].pages||[]).forEach(pg=> out.push(Object.assign({source:key}, pg))); });
return out;
}
function buildBM25(docs){
const k1=1.5,b=0.75; const df=new Map(), tf=new Map(); let total=0;
docs.forEach(d=>{
const toks=tk(d.text); total+=toks.length;
const map=new Map(); toks.forEach(t=> map.set(t,(map.get(t)||0)+1));
tf.set(d.id,map); new Set(toks).forEach(t=> df.set(t,(df.get(t)||0)+1));
});
const N=docs.length||1, avgdl=total/Math.max(1,N); const idf=new Map();
df.forEach((c,t)=> idf.set(t, Math.log(1 + (N - c + .5)/(c + .5))));
function score(query, docId, docLen){
const qToks=new Set(tk(query)); const map=tf.get(docId)||new Map(); let s=0;
qToks.forEach(t=>{ const f=map.get(t)||0; if(!f) return; const idfv=idf.get(t)||0;
s += idfv(f*(k1+1))/(f + k1*(1 - b + b*(docLen/avgdl)));
});
return s;
}
return {score, tf, avgdl};
}
function searchIndex(query, k=3){
const idx = getIndexFlat(); if(!idx.length) return [];
const docs = idx.map((it,i)=>({id:String(i), text:((it.title||’’)+’ ‘+(it.text||’’)), meta:it}));
const bm = CFG.smart.semanticSearch ? buildBM25(docs) : null;
const scored = bm
? docs.map(d=>({score: bm.score(query, d.id, tk(d.text).length||1), meta:d.meta}))
.filter(x=>x.score>0).sort((a,b)=> b.score - a.score).slice(0,k).map(x=>x.meta)
: idx.map(it=> Object.assign({score: tk(it.title+” “+it.text).filter(t=> tk(query).includes(t)).length}, it))
.filter(x=>x.score>0).sort((a,b)=> b.score - a.score).slice(0,k);
return scored;
}
function bestSentences(text, query, k=2){
const sents = String(text||’’).replace(/\s+/g,’ ’).split(/(?<=[.!?])\s+/).slice(0,80);
const qToks=new Set(tk(query)); const scored = sents.map(s=>{
const toks=tk(s); let hit=0; qToks.forEach(t=>{ if(toks.includes(t)) hit++; });
const lenp = Math.max(0.5, 12/Math.max(12, toks.length));
return {s, score: hit*lenp};
}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
return scored.slice(0,k).map(x=>x.s);
}

/* ====== FETCH / PARSE ====== */
async function fetchText(url){
const ctl = new AbortController(); const id = setTimeout(()=>ctl.abort(), CFG.fetchTimeoutMs);
try{
const res = await fetch(url, {signal: ctl.signal, mode:‘cors’, credentials:‘omit’});
clearTimeout(id); if(!res.ok) return null;
return await res.text();
}catch(e){ clearTimeout(id); return null; }
}
function parseXML(t){ try{ return (new DOMParser()).parseFromString(t,‘text/xml’); }catch{ return null; } }
function parseHTML(t){ try{ return (new DOMParser()).parseFromString(t,‘text/html’); }catch{ return null; } }

/* ====== DEBUG COUNTERS ====== */
function newDomainStats(domain){
return {
domain,
startedAt: Date.now(),
durationMs: 0,
urlsSeen: 0,
pagesKept: 0,
txtPages: 0,
htmlPages: 0,
nonVNSkipped: 0,
noindexSkipped: 0,
autoPriceHits: 0
};
}
function finishStats(st){ st.durationMs = Date.now() - st.startedAt; return st; }
function saveStatsAll(all){
try{ localStorage.setItem(K.dbg, JSON.stringify(all)); }catch{}
}
function loadStatsAll(){ return safe(localStorage.getItem(K.dbg)) || {}; }

async function readSitemap(url){
const xml = await fetchText(url); if(!xml) return [];
const doc = parseXML(xml); if(!doc) return [];
const items = Array.from(doc.getElementsByTagName(‘item’));
if(items.length){
return items.map(it=> it.getElementsByTagName(‘link’)[0]?.textContent?.trim()).filter(Boolean);
}
const sm = Array.from(doc.getElementsByTagName(‘sitemap’))
.map(x=> x.getElementsByTagName(‘loc’)[0]?.textContent?.trim()).filter(Boolean);
if(sm.length){
const all=[]; for(const loc of sm){ try{ const child = await readSitemap(loc); if(child && child.length) all.push(…child); }catch{} }
return Array.from(new Set(all));
}
const urls = Array.from(doc.getElementsByTagName(‘url’))
.map(u=> u.getElementsByTagName(‘loc’)[0]?.textContent?.trim()).filter(Boolean);
return urls;
}

async function fallbackCrawl(origin){
const start = origin.endsWith(’/’)? origin : origin + ‘/’;
const html = await fetchText(start); if(!html) return [start];
const doc = parseHTML(html); if(!doc) return [start];
const links = Array.from(doc.querySelectorAll(‘a[href]’)).map(a=> a.getAttribute(‘href’)).filter(Boolean);
const set = new Set([start]);
for(const href of links){
try{
const u = new URL(href, start).toString().split(’#’)[0];
if(sameHost(u, origin)) set.add(u);
if(set.size>=40) break;
}catch{}
}
return Array.from(set);
}

async function pullPages(urls, stats){
const out=[];
stats.urlsSeen += urls.length;
for(const u of urls.slice(0, CFG.maxPagesPerDomain)){
const txt = await fetchText(u); if(!txt) continue;

  // tôn trọng noindex
  if (/\bname=(?:"|')robots(?:"|')[^>]*content=(?:"|')[^"']*noindex/i.test(txt)) { stats.noindexSkipped++; continue; }

  // title + description
  let title = (txt.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
  title = title.replace(/\s+/g,' ').trim();
  let desc = (txt.match(/<meta[^>]+name=(?:"|')description(?:"|')[^>]+content=(?:"|')([\s\S]*?)(?:"|')/i)||[])[1]||"";
  if(!desc){
    desc = txt.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
              .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,600);
  }
  const sample = (title+' '+desc).toLowerCase();
  if(CFG.viOnly && !looksVN(sample)) { stats.nonVNSkipped++; await sleep(CFG.fetchPauseMs); continue; }

  // Auto-Price learn
  if(CFG.smart.autoPriceLearn){
    try{
      const autos = extractPricesFromText(txt);
      if(autos && autos.length){
        stats.autoPriceHits += autos.length;
        const stash = safe(localStorage.getItem(K.autoprices))||[];
        stash.push(...autos.map(a=> Object.assign({url:u}, a)));
        localStorage.setItem(K.autoprices, JSON.stringify(stash.slice(-500)));
      }
    }catch{}
  }

  stats.htmlPages++;
  out.push({url:u, title, text:desc});
  stats.pagesKept++;
  await sleep(CFG.fetchPauseMs);
}
return out;

}

/* ====== AUTOLEARN: ưu tiên moto_sitemap.json, rồi sitemap/crawl; HỌC NHIỀU SITE ====== */
function loadLearnCache(){ return loadLearn(); }
function saveLearnCache(obj){ saveLearn(obj); }

async function learnOneOrigin(origin, stats){
try{
const key = new URL(origin).origin;

  // 1) moto_sitemap.json (ưu tiên)
  const candidatesJSON = [
    key + "/moto_sitemap.json",
    location.origin + (location.pathname.replace(/\/[^\/]*$/,'') || '') + "/moto_sitemap.json"
  ];
  for(const j of Array.from(new Set(candidatesJSON))){
    try{
      const r = await fetch(j);
      if(r && r.ok){
        const json = await r.json();
        const ds = [
          ...(json.categories?.datasets?.list || []),
          ...(json.categories?.pages?.list || [])
        ];
        const pages = [];
        stats.urlsSeen += ds.length;
        for(const u of ds){
          const txt = await fetchText(u); if(!txt) continue;
          if(/\.txt($|\?)/i.test(u)){
            const title = u.split("/").slice(-1)[0];
            const text  = txt.replace(/\s+/g," ").trim().slice(0,2000);
            pages.push({url:u,title,text}); stats.txtPages++; stats.pagesKept++;
          }else{
            let title=(txt.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
            title=title.replace(/\s+/g,' ').trim();
            let desc=(txt.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i)||[])[1]||"";
            if(!desc){
              desc = txt.replace(/<script[\s\S]*?<\/script>/gi,' ')
                        .replace(/<style[\s\S]*?<\/style>/gi,' ')
                        .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,600);
            }
            const sample=(title+' '+desc).toLowerCase();
            if(CFG.viOnly && !looksVN(sample)) { stats.nonVNSkipped++; continue; }
            // Auto-Price learn
            if(CFG.smart.autoPriceLearn){
              const autos = extractPricesFromText(txt);
              if(autos && autos.length){
                stats.autoPriceHits += autos.length;
                const stash = safe(localStorage.getItem(K.autoprices))||[];
                stash.push(...autos.map(a=> Object.assign({url:u}, a)));
                localStorage.setItem(K.autoprices, JSON.stringify(stash.slice(-500)));
              }
            }
            pages.push({url:u,title,text:desc}); stats.htmlPages++; stats.pagesKept++;
          }
          if(pages.length >= CFG.maxPagesPerDomain) break;
          await sleep(CFG.fetchPauseMs);
        }
        if(pages.length) return {domain:j, ts: nowSec(), pages};
      }
    }catch{}
  }

  // 2) sitemap.xml / index / 3) fallback crawl
  let urls=[];
  const smc = [key+'/sitemap.xml', key+'/sitemap_index.xml'];
  for(const c of smc){ try{ const u=await readSitemap(c); if(u && u.length){ urls=u; break; } }catch{} }
  if(!urls.length) urls = await fallbackCrawl(key);
  const uniq = Array.from(new Set(urls.map(u=>{ try{ return new URL(u).toString().split('#')[0]; }catch{ return null; } }).filter(Boolean).filter(u=> sameHost(u, key))));
  const pages = await pullPages(uniq, stats);
  return {domain:key, ts: nowSec(), pages};
}catch(e){ return null; }

}

function isExpired(ts, hrs){ if(!ts) return true; return ((nowSec()-ts)/3600) >= (hrs||CFG.refreshHours); }

async function learnSites(origins, force){
const list = Array.from(new Set(origins||[])).slice(0, 12);
const cache = loadLearnCache(); const results = {}; let total=0;

const allStats = loadStatsAll();

for(const origin of list){
  try{
    const key = new URL(origin).origin;
    const stats = newDomainStats(key);
    const cached = cache[key] || cache["sitemap-json"];
    if(!force && cached && !isExpired(cached.ts, CFG.refreshHours) && cached.pages?.length){
      results[key] = cached; total += cached.pages.length;
      stats.pagesKept = cached.pages.length;
      finishStats(stats); allStats[key] = stats; saveStatsAll(allStats);
      if(total>=CFG.maxTotalPages) break; continue;
    }
    const t0 = performance.now();
    const data = await learnOneOrigin(origin, stats);
    const t1 = performance.now();
    stats.durationMs = Math.round(t1 - t0);
    if(data && data.pages?.length){
      cache[key] = data;
      try{ saveLearnCache(cache); }
      catch(e){
        const ks = Object.keys(cache);
        if(ks.length){
          const oldest = ks.reduce((a,b)=> (cache[a]?.ts||0) <= (cache[b]?.ts||0) ? a : b);
          delete cache[oldest];
          try{ saveLearnCache(cache); }catch{}
        }
      }
      results[key] = data; total += data.pages.length;
    }
    allStats[key] = finishStats(stats); saveStatsAll(allStats);
    if(total >= CFG.maxTotalPages) break;
  }catch(e){}
  await sleep(CFG.fetchPauseMs);
}

if(CFG.debug){
  try{
    const rows = Object.values(loadStatsAll());
    if(rows.length){
      console.groupCollapsed("%cMotoAI v38.1 — Learn Summary","color:"+CFG.themeColor+";font-weight:bold");
      console.table(rows.map(r=>({
        domain: r.domain,
        'urlsSeen': r.urlsSeen,
        'pagesKept': r.pagesKept,
        'txtPages': r.txtPages,
        'htmlPages': r.htmlPages,
        'nonVNSkipped': r.nonVNSkipped,
        'noindexSkipped': r.noindexSkipped,
        'autoPriceHits': r.autoPriceHits,
        'durationMs': r.durationMs
      })));
      const totals = rows.reduce((m,r)=>({
        urlsSeen: m.urlsSeen+r.urlsSeen,
        pagesKept: m.pagesKept+r.pagesKept,
        txtPages: m.txtPages+r.txtPages,
        htmlPages: m.htmlPages+r.htmlPages,
        nonVNSkipped: m.nonVNSkipped+r.nonVNSkipped,
        noindexSkipped: m.noindexSkipped+r.noindexSkipped,
        autoPriceHits: m.autoPriceHits+r.autoPriceHits,
        durationMs: m.durationMs+r.durationMs
      }), {urlsSeen:0,pagesKept:0,txtPages:0,htmlPages:0,nonVNSkipped:0,noindexSkipped:0,autoPriceHits:0,durationMs:0});
      console.log("Totals:", totals);
      console.groupEnd();
    }
  }catch{}
}

try{ saveLearnCache(cache); }catch{}
localStorage.setItem(K.stamp, Date.now());
return results;

}

/* ====== ANSWER ENGINE (Deep + Semantic + QA) ====== */
const PREFIX = [“Chào anh/chị,”,“Xin chào 👋,”,“Em chào anh/chị,”,“Em ở “+CFG.brand+” đây,”];
function polite(s){ s = s || “em chưa nhận được câu hỏi, anh/chị nhập lại giúp em.”; return naturalize(${pick(PREFIX)} ${s}); }

function composePrice(type, qty){
if(!type) type = ‘xe số’;
if(!qty)  return naturalize(Anh/chị thuê ${type} theo ngày, tuần hay tháng để em báo đúng giá nhé.);
const base = baseFor(type, qty.unit);
if(!base)  return naturalize(Giá thuê ${type} theo ${qty.unit} cần kiểm tra. Anh/chị nhắn Zalo ${CFG.phone} để em chốt theo mẫu xe.);
const total = base * qty.n;
const label = qty.unit===“ngày”?“ngày”:(qty.unit===“tuần”?“tuần”:“tháng”);
let text = qty.n===1 ? Giá thuê ${type} 1 ${label} khoảng ${nfVND(base)}đ : Giá thuê ${type} ${qty.n} ${label} khoảng ${nfVND(total)}đ;
if(qty.unit===“ngày” && qty.n>=3) text += “ Nếu thuê theo tuần sẽ tiết kiệm hơn”;
return naturalize(${text}. Anh/chị cần em giữ xe và gửi ảnh xe qua Zalo ${CFG.phone} không?);
}

async function deepAnswer(userText){
const q = (userText||””).trim();
const intents = detectIntent(q);
let type = detectType(q);
const qty  = detectQty(q);

// Deep context
if(CFG.deepContext){
  const ctx = getCtx();
  for(let i=ctx.turns.length-1;i>=0;i--){
    const t = ctx.turns[i];
    if(!type && t.type) type=t.type;
    if(!qty && t.qty)   return composePrice(type||t.type, t.qty);
    if(type && qty) break;
  }
}

if(intents.needContact) return polite(`anh/chị gọi ${CFG.phone} hoặc nhắn Zalo qua số ${CFG.phone} là có người nhận ngay.`);
if(intents.needDocs)    return polite(`thủ tục gọn: CCCD/hộ chiếu + cọc theo xe. Có phương án giảm cọc khi đủ giấy tờ.`);
if(intents.needPolicy)  return polite(`đặt cọc tham khảo: xe số 2–3 triệu; xe ga 2–5 triệu; 50cc khoảng 4 triệu. Liên hệ Zalo ${CFG.phone} để chốt theo mẫu xe.`);
if(intents.needDelivery)return polite(`thuê 1–4 ngày vui lòng đến cửa hàng chọn xe; thuê tuần/tháng em giao tận nơi. Phí nội thành 20–100k tuỳ quận. Nhắn Zalo ${CFG.phone} để em set lịch.`);
if(intents.needReturn)  return polite(`trả xe tại cửa hàng hoặc hẹn trả tận nơi (thoả thuận). Báo trước 30 phút để em sắp xếp, hoàn cọc nhanh.`);

if(intents.needPrice)   return composePrice(type, qty);

// Semantic retrieval + Extractive QA (không chèn link)
try{
  const top = searchIndex(q, 3);
  if(top && top.length){
    const t0 = top[0];
    if(CFG.smart.extractiveQA){
      const sn = bestSentences((t0.title? (t0.title+'. ') : '') + (t0.text||''), q, 2).join(' ');
      if(sn) return naturalize(`${sn}`);
    }
    const fallback = ((t0.title? (t0.title+' — ') : '') + (t0.text||'')).slice(0,180);
    return polite(`${fallback} ...`);
  }
}catch(e){}

if(/(chào|xin chào|hello|hi|alo)/i.test(q)) return polite(`em là nhân viên hỗ trợ của ${CFG.brand}. Anh/chị muốn xem 🏍️ Xe số, 🛵 Xe ga, ⚡ Xe điện hay 📄 Thủ tục thuê xe?`);
return polite(`anh/chị quan tâm loại xe nào (xe số, Vision, Air Blade, 50cc, côn tay…) và thuê mấy ngày để em báo giá phù hợp.`);

}

/* ====== TÍCH HỢP AUTO-PRICE LEARN vào PRICE_TABLE (percentile) ====== /
function mergeAutoPrices(){
if(!CFG.smart.autoPriceLearn) return;
try{
const autos = safe(localStorage.getItem(K.autoprices))||[];
if(!autos.length) return;
const byType = autos.reduce((m,a)=>{ (m[a.type]||(m[a.type]=[])).push(a.price); return m; },{});
Object.keys(byType).forEach(t=>{
const arr = byType[t].sort((a,b)=>a-b);
const p25 = arr[Math.floor(arr.length0.25)];
const p50 = arr[Math.floor(arr.length*0.50)];
if(PRICE_TABLE[t]){
const dayRange = [p25, p50].filter(Boolean);
if(dayRange.length) PRICE_TABLE[t].day = dayRange;
}
});
}catch{}
}

/* ====== SEND / UI CONTROL ====== */
let isOpen=false, sending=false;
function showTyping(){
const body=$(”#mta-body”); if(!body) return;
const box=document.createElement(“div”); box.id=“mta-typing”; box.innerHTML=<span>Đang nhập</span>;
body.appendChild(box); body.scrollTop=body.scrollHeight;
}
function hideTyping(){ const t=$(”#mta-typing”); if(t) t.remove(); }
function ensureInputVisible(){
const inp=$(”#mta-in”), body=$(”#mta-body”);
if(!inp||!body) return;
try{ inp.scrollIntoView({block:‘nearest’, inline:‘nearest’}); }catch{}
body.scrollTop = body.scrollHeight;
}
function setAriaOpen(open){
const card=$(”#mta-card”), bubble=$(”#mta-bubble”);
if(card) card.setAttribute(“aria-hidden”, open ? “false” : “true”);
if(bubble) bubble.setAttribute(“aria-expanded”, open ? “true” : “false”);
}

async function sendUser(text){
if(sending) return;
const v=(text||””).trim(); if(!v) return;
sending=true; addMsg(“user”, v);
pushCtx({from:“user”, raw:v, type:detectType(v), qty:detectQty(v)});
const isMobile = window.innerWidth < 480; const wait = (isMobile? 1600 + Math.random()*1200 : 2400 + Math.random()*2200);
showTyping(); await sleep(wait);
const ans = await deepAnswer(v);
hideTyping(); addMsg(“bot”, ans); pushCtx({from:“bot”, raw:ans});
sending=false;
ensureInputVisible();
}
function openChat(){
if(isOpen) return;
$(”#mta-card”).classList.add(“open”);
$(”#mta-backdrop”).classList.add(“show”);
$(”#mta-bubble”).style.display=“none”;
isOpen=true; setAriaOpen(true); renderSess();
setTimeout(()=>{ const i=$(”#mta-in”); if(i) i.focus(); }, 160);
}
function closeChat(){
if(!isOpen) return;
$(”#mta-card”).classList.remove(“open”);
$(”#mta-backdrop”).classList.remove(“show”);
$(”#mta-bubble”).style.display=“flex”;
isOpen=false; hideTyping(); setAriaOpen(false);
const b=$(”#mta-bubble”); if(b) b.focus();
}
function autoAvoid(){
const root=$(”#mta-root”); const body=$(”#mta-body”); if(!root||!body) return;
let bottom = 16;
const blockers = document.querySelector(”.qca,#quickcall,.bottom-appbar”);
if(blockers){
const r = blockers.getBoundingClientRect();
const gap = window.innerHeight - r.top;
if(gap < 140) bottom = gap + 72;
}
if(window.visualViewport){
const kb = Math.max(0, window.innerHeight - window.visualViewport.height);
bottom = Math.max(bottom, kb + 8);
body.style.paddingBottom = (12 + kb) + “px”;
}
root.style.bottom = bottom + “px”;
}
function maybeDisableQuickMap(){
if(!CFG.disableQuickMap) return;
const m=document.querySelector(”.q-map,#mta-header .q-map”); if(m){ m.removeAttribute(“href”); m.style.opacity=”.4”; m.style.pointerEvents=“none”; }
}
function bindEvents(){
$(”#mta-bubble”).addEventListener(“click”, openChat);
$(”#mta-backdrop”).addEventListener(“click”, closeChat);
$(”#mta-close”).addEventListener(“click”, closeChat);
$(”#mta-send”).addEventListener(“click”, ()=>{
const inp=$(”#mta-in”); const v=inp.value.trim(); if(!v) return; inp.value=””; sendUser(v);
});
$(”#mta-in”).addEventListener(“keydown”, e=>{
if(e.isComposing || e.keyCode === 229) return; // tránh gửi khi đang gõ dấu
if(e.key===“Enter” && !e.shiftKey){ e.preventDefault(); const v=e.target.value.trim(); if(!v) return; e.target.value=””; sendUser(v); }
const tags=$(”#mta-tags”); if(tags){ if(e.target.value.trim().length>0) tags.classList.add(‘hidden’); else tags.classList.remove(‘hidden’); }
ensureInputVisible();
});
const track=$(”#mta-tag-track”);
if(track){ track.querySelectorAll(“button”).forEach(btn=> btn.addEventListener(“click”, ()=> sendUser(btn.dataset.q||btn.textContent))); }
window.addEventListener(“resize”, autoAvoid, {passive:true});
window.addEventListener(“scroll”, autoAvoid, {passive:true});
if(window.visualViewport){
window.visualViewport.addEventListener(“resize”, autoAvoid, {passive:true});
window.visualViewport.addEventListener(“scroll”, autoAvoid, {passive:true});
}
document.addEventListener(“keydown”, (e)=>{ if(e.key===“Escape” && isOpen){ e.preventDefault(); closeChat(); } }, {passive:false});
}

function ready(fn){ if(document.readyState===“complete”||document.readyState===“interactive”) fn(); else document.addEventListener(“DOMContentLoaded”, fn); }

/* ====== BOOT ====== /
ready(async ()=>{
const lastClean = parseInt(localStorage.getItem(K.clean)||0);
if(!lastClean || (Date.now()-lastClean) > 72436001000){
localStorage.removeItem(K.ctx);
localStorage.setItem(K.clean, Date.now());
console.log(“MotoAI v38.1: maintenance OK”);
}

const wrap=document.createElement("div"); wrap.innerHTML=HTML; document.body.appendChild(wrap.firstElementChild);
const st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st);
bindEvents(); autoAvoid(); maybeDisableQuickMap();

mergeAutoPrices();

if(CFG.autolearn){
  try{
    const origins = Array.from(new Set([location.origin, ...(CFG.extraSites||[])]));
    const last = parseInt(localStorage.getItem(K.stamp)||0);
    if(!last || (Date.now()-last) >= CFG.refreshHours*3600*1000){
      if(CFG.debug) console.groupCollapsed("%cMotoAI v38.1 — AutoLearn start","color:"+CFG.themeColor+";font-weight:bold");
      await learnSites(origins, false);
      if(CFG.debug) console.groupEnd();
      console.log("%cMotoAI v38.1 — learned from multiple sites","color:"+CFG.themeColor+";font-weight:bold;");
    }else{
      console.log("MotoAI v38.1 — skip learn (fresh cache)");
    }
  }catch(e){ console.warn("MotoAI v38.1 autolearn error", e); }
}

});

/* ====== PUBLIC API ====== */
window.MotoAI_v38 = {
open: openChat,
close: closeChat,
send: (t)=> sendUser(t),
learnNow: async (sites, force)=>{
const list = Array.isArray(sites)&&sites.length?sites:([location.origin, …(CFG.extraSites||[])]);
return await learnSites(Array.from(new Set(list)), !!force);
},
getIndex: getIndexFlat,
clearLearnCache: ()=> { try{ localStorage.removeItem(K.learn); localStorage.removeItem(K.autoprices); localStorage.removeItem(K.dbg);}catch{} },
debugDump: ()=> ({stats: loadStatsAll(), indexSize: getIndexFlat().length, priceSamples:(safe(localStorage.getItem(K.autoprices))||[]).length})
};
})();
