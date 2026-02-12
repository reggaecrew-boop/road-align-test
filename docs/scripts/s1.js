// ---- preflight: required helpers (avoid "initial screen only" failures) ----
// Some builds previously failed because a helper was not global. Make this defensive.
if (typeof window.escapeHtml !== 'function') {
  window.escapeHtml = function escapeHtml(s){
    return String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  };
}

// ---- Safe storage wrapper (Safari private mode can throw on localStorage access) ----
const LS = {
  get(k){
    try { return localStorage.getItem(k); }
    catch (e) { return null; }
  },
  set(k,v){
    try { localStorage.setItem(k, String(v)); return true; }
    catch (e) { return false; }
  },
  remove(k){
    try { localStorage.removeItem(k); }
    catch (e) {}
  },
};




// --- early boot: version badge + SW (defensive) ---
(function(){
  try {
    var onReady = function(){
      try {
        var v = String(window.APP_VERSION || '');
        var b = document.getElementById('appVerBadge');
        if (b) b.textContent = v ? ('v' + v) : 'v--';
      } catch(e){}
      try {
        if (window.__TRY_REGISTER_SW__) window.__TRY_REGISTER_SW__();
      } catch(e){}
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(onReady, 0);
    } else {
      document.addEventListener('DOMContentLoaded', onReady);
    }
  } catch (e) {}
})();

// --- diagnostics (v18.10.36) ---
(function(){
  const escapeHtml = (s)=>String(s??'').replace(/[&<>"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const show = (title, err)=>{
    try{
      const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err||'');
      const el = document.getElementById('bootStatus');
      if (el) {
        el.innerHTML = `<span class='warn'>⚠️ ${title}: ${escapeHtml(msg)}</span> <button id='btnResetLS2' class='btn btn-ghost' style='margin-left:10px; width:auto;'>保存データ初期化</button>`;
        setTimeout(()=>{
          const b=document.getElementById('btnResetLS2');
          if (b) b.onclick=()=>{ try{ LS.remove(LS_KEY_NEW); LS.remove(LS_KEY_OLD); }catch(_){ } location.reload(); };
        },0);
      } else {
        alert(title+": "+msg);
      }
    }catch(_){ }
  };
  window.addEventListener('error', (e)=> show('JavaScriptエラー', e.error || e.message));
  window.addEventListener('unhandledrejection', (e)=> show('Promiseエラー', e.reason));
})();

/* =========================
   State + autosave (iPad)
========================= */
const LS_KEY_NEW = "road_align_pwa_state_v3_unified";
const LS_KEY_OLD = "road_align_pwa_state_v2_profile";
const LS_KEY = LS_KEY_NEW;

// --- UI state (header collapse) ---
const UI_KEY = "road_align_pwa_ui_v1";
let uiState = { headerCollapsed: false, coordSearch: "" };
try {
  const raw = LS.get(UI_KEY);
  if (raw) uiState = Object.assign(uiState, JSON.parse(raw));
} catch (e) {}
function applyHeaderCollapsed(){
  const header = document.getElementById('topHeader');
  const body = document.getElementById('headerBody');
  const btn = document.getElementById('btnHeaderToggle');
  if (!header || !body || !btn) return;
  if (uiState.headerCollapsed){
    header.classList.add('collapsed');
    btn.textContent = '▼';
    btn.title = 'ヘッダを表示';
  } else {
    header.classList.remove('collapsed');
    btn.textContent = '▲';
    btn.title = 'ヘッダを隠す';
  }
}
function saveUI(){
  try { LS.set(UI_KEY, JSON.stringify(uiState)); } catch(e) {}
}

let state = {
  projectName: "テスト案件",
  coordDecimals: 3,
  staPitch: 20,
  outputStep: 20,
  dsSpiral: 0.5,
  clothoidMode: "A",
  // 座標一覧（CSV取り込み）
  coordCatalog: { items: [], lastFile: "", lastLoadedAt: "" },


  bp: { name: "BP", N: 0, E: 0 },
  ep: { name: "EP", N: 0, E: 500 },

  ipPoints: [
    { id: 1, name: "IP1", N: 0, E: 0 },
    { id: 2, name: "IP2", N: 0, E: 200 },
    { id: 3, name: "IP3", N: 150, E: 350 },
  ],
  useIpCount: 3,

  curveSettings: [
    { id: 1, ipName: "IP2", R: 200, A1: 100, A2: 100, direction: "auto", ds: 0.5 }
  ],

  // 追加測点（タブ別）
  extraStations: {
    plan: [],
    profile: [],
    cross: [],
    output: [],
  },
  nextExtraId: {
    plan: 1,
    profile: 1,
    cross: 1,
    output: 1,
  },

  plotStep: 5.0,
  showKeypoints: true,
  showArrow: false,

  // 縦断簡易図
  profilePlotStep: 5.0,
  profileShowPV: true,
  profileShowVC: true,

  // ===== 縦断（勾配区間 + 縦断曲線(VPI単位)） =====
  profile: {
    enabled: true,
    startSta: 0.000,
    startZ: 0.000,
    grades: [
      { id: 1, nextSta: 100.000, gradePct:  2.534 },
      { id: 2, nextSta: 300.000, gradePct: -1.000 },
      { id: 3, nextSta: 500.000, gradePct:  0.500 }
    ],
    nextGradeId: 4,

    // VPIごと（PVの中間点）に縦断曲線を紐付け
    // L優先。Lが空なら ymax から L=8*ymax/|A| に換算
    vcurves: [
      { id: 1, vpiSta: 100.000, L: 80.000, ymax: null },
      { id: 2, vpiSta: 300.000, L: null,   ymax: 0.145 }
    ],
    nextVcurveId: 3,
  },

  // ===== 横断（中心からの勾配区間） =====
  // 共通（全測点）テンプレ + 測点別の例外（必要な測点だけ）
  cross: {
    enabled: true,


    // 拡幅割付（テーパ）：例外測点（最外端距離）を制御点にして線形補間
    taper: { enabled: true, anchorRight: 3.000, anchorLeft: 3.000 },

    // ---- 共通（全測点） ----
    // 中心(0.000m, Z=0.000m) から外側へ。end は中心からの距離(m)。
    // 勾配(%)は「外側へ進むほど Z が上がる：+ / 下がる：-」で入力。
    right: {
      segs: [
        { id: 1, end: 3.000, mode: 'pct', slopePct: -2.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
        { id: 2, end: 4.500, mode: 'pct', slopePct:  0.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
        { id: 3, end: 5.000, mode: 'pct', slopePct: -1.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
      ],
      nextSegId: 4
    },
    left: {
      segs: [
        { id: 1, end: 3.000, mode: 'pct', slopePct: -2.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
        { id: 2, end: 4.500, mode: 'pct', slopePct:  0.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
        { id: 3, end: 5.000, mode: 'pct', slopePct: -1.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
      ],
      nextSegId: 4
    },

    // ---- 測点別（例外） ----
    // key: "100.000" のように 0.001m丸めの測点文字列
    // value: { right:{segs,nextSegId}, left:{...} }
    overrides: {},

    // UI状態（選択中の例外測点 / プレビュー測点）
    ui: { selectedStaKey: "", previewTok: "" }
  }


};

// expose for inline helpers in index.html (e.g., datalist population)
// keep as a reference to the current state object
try { window.state = state; } catch (e) {}

function saveState() {
  try { LS.set(LS_KEY, JSON.stringify(state)); } catch(e) {}
}
function normalizeState(s) {
  // --- extraStations ---
  if (Array.isArray(s.extraStations)) {
    // 旧: extraStations:[] / nextExtraId:number を output に移す
    const old = s.extraStations;
    const oldNext = Number.isFinite(s.nextExtraId)
      ? s.nextExtraId
      : (Math.max(0, ...old.map(r => r.id || 0)) + 1);
    s.extraStations = { plan: [], profile: [], cross: [], output: old };
    s.nextExtraId = { plan: 1, profile: 1, cross: 1, output: oldNext };
  } else {
    s.extraStations = Object.assign({ plan: [], profile: [], cross: [], output: [] }, s.extraStations || {});
    for (const k of ["plan", "profile", "cross", "output"]) {
      if (!Array.isArray(s.extraStations[k])) s.extraStations[k] = [];
    }
    if (!s.nextExtraId || typeof s.nextExtraId !== "object" || Array.isArray(s.nextExtraId)) {
      s.nextExtraId = { plan: 1, profile: 1, cross: 1, output: 1 };
    }
    s.nextExtraId = Object.assign({ plan: 1, profile: 1, cross: 1, output: 1 }, s.nextExtraId);
  }

  // --- profile ---
  s.profile = Object.assign({
    enabled: true,
    startSta: 0,
    startZ: 0,
    grades: [],
    nextGradeId: 1,
    vcurves: [],
    nextVcurveId: 1,
  }, s.profile || {});

  // 旧: rows/nextRowId -> grades/vcurves
  if (Array.isArray(s.profile.rows)) {
    const rows = (s.profile.rows || [])
      .filter(r => Number.isFinite(r.nextSta) && Number.isFinite(r.gradePct))
      .slice()
      .sort((a, b) => Number(a.nextSta) - Number(b.nextSta));

    s.profile.grades = rows.map((r, idx) => ({
      id: Number.isFinite(r.id) ? r.id : (idx + 1),
      nextSta: Number(r.nextSta) || 0,
      gradePct: Number(r.gradePct) || 0,
    }));

    s.profile.nextGradeId = Number.isFinite(s.profile.nextRowId)
      ? s.profile.nextRowId
      : (Math.max(0, ...s.profile.grades.map(r => r.id || 0)) + 1);

    const vc = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const r = rows[i];
      const L = (r.vcL == null || r.vcL === "") ? null : Number(r.vcL);
      const ymax = (r.vcYmax == null || r.vcYmax === "") ? null : Number(r.vcYmax);
      const hasL = Number.isFinite(L) && L > 0;
      const hasY = Number.isFinite(ymax) && ymax > 0;
      if (!hasL && !hasY) continue;
      vc.push({
        id: vc.length + 1,
        vpiSta: Number(r.nextSta) || 0,
        L: hasL ? L : null,
        ymax: hasY ? ymax : null,
      });
    }
    s.profile.vcurves = vc;
    s.profile.nextVcurveId = vc.length + 1;

    delete s.profile.rows;
    delete s.profile.nextRowId;
  }

  s.profile.grades = Array.isArray(s.profile.grades) ? s.profile.grades : [];
  s.profile.vcurves = Array.isArray(s.profile.vcurves) ? s.profile.vcurves : [];

  s.profile.nextGradeId = Number.isFinite(s.profile.nextGradeId)
    ? s.profile.nextGradeId
    : (Math.max(0, ...s.profile.grades.map(r => r.id || 0)) + 1);

  s.profile.nextVcurveId = Number.isFinite(s.profile.nextVcurveId)
    ? s.profile.nextVcurveId
    : (Math.max(0, ...s.profile.vcurves.map(r => r.id || 0)) + 1);

  
  // --- cross ---
  s.cross = Object.assign({
    enabled: true,
    taper: { enabled: true, anchorRight: 3.000, anchorLeft: 3.000 },
    right: { segs: [], nextSegId: 1 },
    left:  { segs: [], nextSegId: 1 },
    overrides: {},
    ui: { selectedStaKey: "", previewTok: "" },
  }, s.cross || {});

  if (!s.cross.overrides || typeof s.cross.overrides !== "object" || Array.isArray(s.cross.overrides)) {
    s.cross.overrides = {};
  }
  if (!s.cross.ui || typeof s.cross.ui !== "object" || Array.isArray(s.cross.ui)) {
    s.cross.ui = { selectedStaKey: "", previewTok: "" };
  }
  if (typeof s.cross.ui.selectedStaKey !== "string") s.cross.ui.selectedStaKey = "";
  if (typeof s.cross.ui.previewTok !== "string") s.cross.ui.previewTok = "";

  const normSide = (obj)=>{
    obj = (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
    let segs = Array.isArray(obj.segs) ? obj.segs : [];
    segs = segs.map((r, idx)=>{
      const id = (r && Number.isFinite(r.id)) ? r.id : (idx + 1);
      const end = Number(r && r.end);
      const slopePct = Number.isFinite(Number(r && r.slopePct)) ? Number(r.slopePct) : 0;
      const mode = (r && typeof r.mode === 'string') ? r.mode : 'pct';
      const ratioX = Number.isFinite(Number(r && r.ratioX)) ? Number(r.ratioX) : 20;
      const ratioDir = (r && (r.ratioDir === 'up' || r.ratioDir === 'down')) ? r.ratioDir : (slopePct >= 0 ? 'up' : 'down');
      const stepDz = Number.isFinite(Number(r && r.stepDz)) ? Number(r.stepDz) : 0;
      return { id, end, mode, slopePct, ratioX, ratioDir, stepDz };
    }).filter(r => Number.isFinite(r.end) && r.end > 0);

    segs.sort((a,b)=>a.end-b.end);

    let nextSegId = obj.nextSegId;
    if (!Number.isFinite(nextSegId)) {
      const mx = Math.max(0, ...segs.map(r => r.id || 0));
      nextSegId = mx + 1;
    }
    return { segs, nextSegId };
  };

  s.cross.right = normSide(s.cross.right);
  s.cross.left  = normSide(s.cross.left);

  const newOver = {};
  for (const [k, ov] of Object.entries(s.cross.overrides || {})) {
    const m = parseFloat(k);
    if (!Number.isFinite(m)) continue;
    const key = m.toFixed(3);
    if (!ov || typeof ov !== "object" || Array.isArray(ov)) continue;
    newOver[key] = {
      right: normSide(ov.right),
      left:  normSide(ov.left),
    };
  }
  s.cross.overrides = newOver;

  if (s.cross.ui.selectedStaKey && !s.cross.overrides[s.cross.ui.selectedStaKey]) {
    s.cross.ui.selectedStaKey = "";
  }
// --- view options defaults ---
if (!Number.isFinite(s.plotStep)) s.plotStep = 5.0;
if (typeof s.showKeypoints !== "boolean") s.showKeypoints = true;
if (typeof s.showArrow !== "boolean") s.showArrow = false;

if (!Number.isFinite(s.profilePlotStep)) s.profilePlotStep = 5.0;
if (typeof s.profileShowPV !== "boolean") s.profileShowPV = true;
if (typeof s.profileShowVC !== "boolean") s.profileShowVC = true;

  // --- coordCatalog (CSV coordinate list) ---
  if (!s.coordCatalog || typeof s.coordCatalog !== "object" || Array.isArray(s.coordCatalog)) {
    s.coordCatalog = { items: [], lastFile: "", lastLoadedAt: "" };
  }
  if (!Array.isArray(s.coordCatalog.items)) s.coordCatalog.items = [];
  s.coordCatalog.items = s.coordCatalog.items.map((r)=>({
    name: String(r && r.name != null ? r.name : "").replace(/^﻿/,"").trim(),
    N: Number(r && r.N),
    E: Number(r && r.E),
    Z: (r && (r.Z === "" || r.Z == null)) ? null : Number(r && r.Z),
  })).filter(r => r.name && Number.isFinite(r.N) && Number.isFinite(r.E)).slice(0, 5000);
  if (typeof s.coordCatalog.lastFile !== "string") s.coordCatalog.lastFile = "";
  if (typeof s.coordCatalog.lastLoadedAt !== "string") s.coordCatalog.lastLoadedAt = "";





  // --- plan overlay (cross on plan) ---
  s.planOverlay = Object.assign({ showCross:false, crossMode:'selected' }, s.planOverlay || {});
  if (typeof s.planOverlay.showCross !== 'boolean') s.planOverlay.showCross = !!s.planOverlay.showCross;
  if (typeof s.planOverlay.crossMode !== 'string') s.planOverlay.crossMode = 'selected';

  return s;
}

/* =======================
   PLAN IMPORT (SIMA / XRF)
   ======================= */

let planImportMsgText = "";
function escHtml(s){
  return String(s??"").replace(/[&<>"\']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"
  }[c]));
}

// read local file with proper encoding (SIMA is often Shift-JIS)
async function readLocalFileText(file){
  const ab = await file.arrayBuffer();
  const u8 = new Uint8Array(ab);
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const tryDec = (label)=>{
    try { return new TextDecoder(label).decode(u8); } catch(e){ return null; }
  };

  if (ext === "sim") {
    return tryDec("shift_jis") || tryDec("shift-jis") || tryDec("sjis") || tryDec("utf-8") || new TextDecoder().decode(u8);
  }
  // xrf is UTF-8 xml in practice
  return tryDec("utf-8") || tryDec("shift_jis") || new TextDecoder().decode(u8);
}

function asObjectFromJsonText(txt){
  try { return JSON.parse(txt); } catch(e){ return null; }
}
function applyPlanFromJsonObject(obj){
  const src = (obj && typeof obj === "object") ? obj : null;
  if (!src) throw new Error("JSONが不正です。");
  // full state or partial
  const o = src.bp || src.ep || src.ipPoints ? src : (src.plan || src);
  if (o.bp) state.bp = o.bp;
  if (o.ep) state.ep = o.ep;
  if (Array.isArray(o.ipPoints)){ state.ipPoints = o.ipPoints; state.useIpCount = (typeof o.useIpCount==="number") ? o.useIpCount : o.ipPoints.length; }
  // curve settings are optional; safest is clear if mismatch
  state.curveSettings = Array.isArray(o.curveSettings) ? o.curveSettings : [];
}
function applyProfileFromJsonObject(obj){
  const src = (obj && typeof obj === "object") ? obj : null;
  if (!src) throw new Error("JSONが不正です。");
  const p = src.profile ? src.profile : src;
  if (!p || typeof p !== "object") throw new Error("profileが見つかりません。");
  state.profile = p;
}
function applyCrossFromJsonObject(obj){
  const src = (obj && typeof obj === "object") ? obj : null;
  if (!src) throw new Error("JSONが不正です。");
  const c = src.cross ? src.cross : src;
  if (!c || typeof c !== "object") throw new Error("crossが見つかりません。");
  // preserve UI fields if not provided
  const prevUi = state.cross && state.cross.ui ? state.cross.ui : null;
  state.cross = c;
  if (prevUi && (!state.cross.ui)) state.cross.ui = prevUi;
}


/* =======================
   DXF IMPORT (ASCII DXF)

// --- DXF import runtime policy ---
const DXF_SMARTPHONE_MAX_BYTES = 25 * 1024 * 1024; // 25MB
function isSmartphoneDevice(){
  const ua = (navigator && navigator.userAgent) ? navigator.userAgent : "";
  return /iPhone|iPod|Android/i.test(ua);
}
function enforceDxfSizeLimit(file, msgEl){
  if (!file) return false;
  if (isSmartphoneDevice() && file.size > DXF_SMARTPHONE_MAX_BYTES){
    const mb = (file.size / 1024 / 1024).toFixed(1);
    if (msgEl){
      msgEl.textContent =
        `DXFが大きすぎます（${mb}MB）。スマホ解析は25MB以下にしてください。` +
        `\nPCでDXFを解析して、解析済みJSONを読み込む運用が安全です。`;
    } else {
      alert(`DXFが大きすぎます（${mb}MB）。スマホ解析は25MB以下にしてください。`);
    }
    return false;
  }
  return true;
}

   ======================= */

// NOTE(iOS対策): 大きいDXFで lines.split() をするとメモリが跳ねて
// Safariがタブごとリロード（白画面→戻る）することがある。
// そこで、ペア配列を作らずに1パスで走査できるイテレータを用意する。
function dxfForEachPair(text, fn){
  // ASCII DXF is: <groupCode>\n<value>\n repeating.
  const s0 = String(text||"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  let i = 0;
  const n = s0.length;
  while (i < n){
    let j = s0.indexOf("\n", i);
    if (j < 0) break;
    const code = s0.slice(i, j).trim();
    i = j + 1;
    j = s0.indexOf("\n", i);
    if (j < 0) break;
    const val = s0.slice(i, j);
    i = j + 1;
    if (code !== "") fn(code, val);
  }
}

// 互換用（小さなDXF向け）: 既存ロジックが必要な場所ではこれを使える。
function dxfParsePairs(text){
  const pairs = [];
  dxfForEachPair(text, (code,val)=>pairs.push([code,val]));
  return pairs;
}

function dxfExtractTextLike(text){
  const kinds = new Set(["TEXT","MTEXT","ATTRIB","DIMENSION"]);
  const out = [];
  let cur = null;
  dxfForEachPair(text, (code,val)=>{
    if (code === "0"){
      if (cur && cur.text) out.push(cur);
      if (kinds.has(val)) cur = { etype: val, layer:"", x:null, y:null, h:null, text:"" };
      else cur = null;
      return;
    }
    if (!cur) return;
    if (code === "8") cur.layer = val;
    else if (code === "10") cur.x = parseFloat(val);
    else if (code === "20") cur.y = parseFloat(val);
    else if (code === "40") cur.h = parseFloat(val);
    else if (code === "1" || code === "3"){
      if (cur.etype === "MTEXT") cur.text += val;
      else if (code === "1") cur.text += val;
    }
  });
  if (cur && cur.text) out.push(cur);

  const clean = (s)=>String(s||"")
    .replace(/\\A\d+;/g,"")
    .replace(/\\P/g,"\n")
    .replace(/[{}]/g,"")
    .replace(/　/g," ")
    .trim();

  return out.map(r=>({
    etype:r.etype,
    layer:String(r.layer||""),
    x:Number.isFinite(r.x)?r.x:null,
    y:Number.isFinite(r.y)?r.y:null,
    h:Number.isFinite(r.h)?r.h:null,
    text: clean(r.text)
  }));
}

function dxfExtractLwPolylines(text){
  const out = [];
  let cur = null;
  dxfForEachPair(text, (code,val)=>{
    if (code === "0"){
      if (cur) out.push(cur);
      if (val === "LWPOLYLINE") cur = { layer:"", xs:[], ys:[], flags:0 };
      else cur = null;
      return;
    }
    if (!cur) return;
    if (code === "8") cur.layer = val;
    else if (code === "10") cur.xs.push(parseFloat(val));
    else if (code === "20") cur.ys.push(parseFloat(val));
    else if (code === "70") cur.flags = parseInt(val,10)||0;
  });
  if (cur) out.push(cur);
  return out.map(p=>{
    const n = Math.min(p.xs.length, p.ys.length);
    const pts = [];
    for (let i=0;i<n;i++) pts.push([p.xs[i], p.ys[i]]);
    return { layer:String(p.layer||""), closed: ((p.flags|0)&1)===1, pts };
  }).filter(r=>r.pts && r.pts.length>=2);
}

function polylineLength(pts, closed){
  let L=0;
  for (let i=0;i<pts.length-1;i++){
    const dx=pts[i+1][0]-pts[i][0];
    const dy=pts[i+1][1]-pts[i][1];
    L += Math.hypot(dx,dy);
  }
  if (closed && pts.length>2){
    const dx=pts[0][0]-pts[pts.length-1][0];
    const dy=pts[0][1]-pts[pts.length-1][1];
    L += Math.hypot(dx,dy);
  }
  return L;
}

function rdpSimplify(points, eps){
  if (!points || points.length<3) return points || [];
  const p0 = points[0];
  const p1 = points[points.length-1];
  const dx = p1[0]-p0[0], dy=p1[1]-p0[1];
  const denom = dx*dx+dy*dy;
  let maxD=-1, idx=-1;
  for (let i=1;i<points.length-1;i++){
    const p = points[i];
    let dist;
    if (denom===0){
      dist = Math.hypot(p[0]-p0[0], p[1]-p0[1]);
    } else {
      const t = ((p[0]-p0[0])*dx+(p[1]-p0[1])*dy)/denom;
      const tt = Math.max(0, Math.min(1, t));
      const cx = p0[0]+tt*dx, cy=p0[1]+tt*dy;
      dist = Math.hypot(p[0]-cx, p[1]-cy);
    }
    if (dist>maxD){ maxD=dist; idx=i; }
  }
  if (maxD>eps){
    const left = rdpSimplify(points.slice(0, idx+1), eps);
    const right = rdpSimplify(points.slice(idx), eps);
    return left.slice(0, left.length-1).concat(right);
  }
  return [p0, p1];
}

function projectPointToPolyline(px, py, pts){
  // returns {sta, dist, foot:[x,y]}
  let best = { sta:0, dist: Infinity, foot:[pts[0][0], pts[0][1]] };
  let cum = 0;
  for (let i=0;i<pts.length-1;i++){
    const x1=pts[i][0], y1=pts[i][1];
    const x2=pts[i+1][0], y2=pts[i+1][1];
    const dx=x2-x1, dy=y2-y1;
    const segLen = Math.hypot(dx,dy);
    if (!Number.isFinite(segLen) || segLen===0){ continue; }
    let t = ((px-x1)*dx + (py-y1)*dy)/(segLen*segLen);
    t = Math.max(0, Math.min(1, t));
    const fx = x1 + t*dx, fy = y1 + t*dy;
    const dist = Math.hypot(px-fx, py-fy);
    const sta = cum + t*segLen;
    if (dist < best.dist){ best = { sta, dist, foot:[fx,fy] }; }
    cum += segLen;
  }
  return best;
}

function staTokenToMeters(tok){
  const t = String(tok||"").toUpperCase().replace(/STA\.?/g,"").replace(/\s+/g,"").replace(/＋/g,"+");
  const m = t.match(/([+-]?\d+)\+(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const km = parseInt(m[1],10);
  const mm = parseFloat(m[2]);
  if (!Number.isFinite(km) || !Number.isFinite(mm)) return null;
  return km*1000 + mm;
}

function findRowNearLabel(texts, labelRegex){
  const hit = texts.find(t=>labelRegex.test(t.text||""));
  if (!hit || !Number.isFinite(hit.y)) return null;
  const y0 = hit.y;
  // numeric cells on same row (loose tolerance)
  const nums = texts
    .filter(t=>Number.isFinite(t.x) && Number.isFinite(t.y) && Math.abs(t.y-y0) <= 3)
    .map(t=>({x:t.x, y:t.y, raw:t.text}))
    .filter(r=>/^[+-]?\d+(?:\.\d+)?$/.test(String(r.raw).trim()))
    .map(r=>({x:r.x, y:r.y, v: parseFloat(String(r.raw).trim())}))
    .filter(r=>Number.isFinite(r.v))
    .sort((a,b)=>a.x-b.x);
  return { y0, cells: nums };
}

function dxfScoreCenterlineCandidate(p){
  // p: {layer, pts, closed}
  const L = polylineLength(p.pts, p.closed);
  if (!Number.isFinite(L)) return -Infinity;

  // bounding box span
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const pt of (p.pts||[])){
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
    minX=Math.min(minX, pt[0]); minY=Math.min(minY, pt[1]);
    maxX=Math.max(maxX, pt[0]); maxY=Math.max(maxY, pt[1]);
  }
  const spanX = (Number.isFinite(maxX-minX)? (maxX-minX):0);
  const spanY = (Number.isFinite(maxY-minY)? (maxY-minY):0);
  const span = Math.max(spanX, spanY);

  // layer hints (optional)
  const layer = String(p.layer||"").toUpperCase();
  let bonus = 0;
  if (layer.includes("CL") || layer.includes("CENTER") || layer.includes("CENT") || layer.includes("中心") || layer.includes("既設") || layer.includes("RANE")) bonus += 0.10;
  if (layer.includes("GRID") || layer.includes("枠") || layer.includes("TITLE") || layer.includes("VIEW")) bonus -= 0.10;

  // score: length dominates; span helps; layer bonus small
  return L * (1 + bonus) + span * 0.05;
}

function dxfPickCenterlinePolyline(dxfText){
  const polylines = dxfExtractLwPolylines(dxfText);

  // baseline filter: non-trivial, non-closed, has points
  const cand = polylines
    .filter(p=>Array.isArray(p.pts) && p.pts.length >= 2)
    .filter(p=>!p.closed) // centerline should not be closed in most cases
    .map(p=>({ p, score: dxfScoreCenterlineCandidate(p), L: polylineLength(p.pts,p.closed) }))
    .filter(r=>Number.isFinite(r.score) && r.L > 100) // ignore tiny stuff (title blocks, etc.)
    .sort((a,b)=>b.score-a.score);

  if (!cand.length) return null;

  // if there are multiple plausible candidates, let user choose (mobile-safe: prompt)
  const top = cand[0];
  const shortlist = cand.slice(0, 8);
  const near = shortlist.filter(r=>r.L >= top.L * 0.80); // within 80% length of top
  const list = (near.length >= 2) ? near : shortlist.slice(0, Math.min(4, shortlist.length));

  if (list.length >= 2){
    const lines = list.map((r,i)=>`${i}: layer=${String(r.p.layer||"")} / L=${r.L.toFixed(1)}`);
    const ans = prompt(
      "中心線候補が複数見つかりました。番号を選んでください（未入力なら0）\n\n" + lines.join("\n"),
      "0"
    );
    const k = parseInt(String(ans||"0"),10);
    if (Number.isFinite(k) && k>=0 && k<list.length) return list[k].p;
  }
  return top.p;
}

function dxfBuildPlanFromCenterline(dxfText){
  // 中心線レイヤ名が現場でまちまちなので、ポリライン候補をスコアリングして選択する
  const picked = dxfPickCenterlinePolyline(dxfText);
  if (!picked) throw new Error("中心線候補（LWPOLYLINE）が見つかりません。中心線がポリラインで作図されているか確認してください。");

  const pts = rdpSimplify(picked.pts, 0.01);
  if (pts.length<2) throw new Error("中心線の点列が不足しています");
  const bp = pts[0];
  const ep = pts[pts.length-1];
  const ips = pts.slice(1, pts.length-1);
  return { bp, ep, ips, clPts: pts };
}

// 図面の座標系が「現場座標として設定されている」かの簡易判定。
// DXFは必ず数値座標を持つが、(0,0)近傍のローカル座標は「座標設定なし」扱いにする。
function dxfIsLikelyGeoreferenced(pts){
  if (!Array.isArray(pts) || pts.length < 2) return false;
  let maxAbs = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts){
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const x = +p[0], y = +p[1];
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX-minX, maxY-minY);
  // spanが極端に小さい図は対象外（誤抽出）
  if (!Number.isFinite(span) || span < 10) return false;
  // 日本の平面直角座標系などは概ね 1e4〜1e6 オーダー。ローカル図面は数百〜数千に収まることが多い。
  return maxAbs >= 10000;
}

// ---- Plan control points (BP/EP/IP) from coordinate texts ----
// DXFの図面上に BP/EP/IP の座標（E/N または X/Y）を文字として記載してある前提で、
// その数値を読み取り state.bp/state.ep/state.ipPoints に反映する。
// 座標が見つからない場合は null を返す（呼び出し側でメッセージ表示）。
function dxfDetectCoordConvention(texts){
  // global hint: does the drawing use X/Y or E/N
  const all = texts.map(t=>String(t.text||'')).join('\n');
  if (/[XＸ]\s*[:=]/i.test(all) || /\bX\b/i.test(all)) return 'XY';
  if (/[EＥ]\s*[:=]/i.test(all) || /\bE\b/i.test(all)) return 'EN';
  if (/[NＮ]\s*[:=]/i.test(all) || /\bN\b/i.test(all)) return 'EN';
  return 'UNKNOWN';
}

function dxfParseCoordInline(text){
  const s = String(text||'')
    .replace(/[\uFF0B]/g,'+')
    .replace(/[\uFF0D]/g,'-')
    .replace(/[\uFF1A]/g,':')
    .replace(/[\uFF1D]/g,'=')
    .replace(/[\u3000]/g,' ');
  // E/N style
  const mE = s.match(/(?:\bE\b|Ｅ|EAST|EASTING)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  const mN = s.match(/(?:\bN\b|Ｎ|NORTH|NORTHING)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  // X/Y style (common: X=Northing, Y=Easting)
  const mX = s.match(/(?:\bX\b|Ｘ)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  const mY = s.match(/(?:\bY\b|Ｙ)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  const out = {};
  if (mE) out.E = parseFloat(mE[1]);
  if (mN) out.N = parseFloat(mN[1]);
  if (mX) out.X = parseFloat(mX[1]);
  if (mY) out.Y = parseFloat(mY[1]);
  if ([out.E,out.N,out.X,out.Y].some(v=>Number.isFinite(v))) return out;
  return null;
}

function dxfDist(a,b){
  const dx = (a.x||0) - (b.x||0);
  const dy = (a.y||0) - (b.y||0);
  return Math.hypot(dx,dy);
}

function dxfFindNearbyText(texts, ref, radius){
  const r = radius||60;
  return texts
    .filter(t=>Number.isFinite(t.x)&&Number.isFinite(t.y))
    .map(t=>({t, d:dxfDist(t, ref)}))
    .filter(o=>o.d>0 && o.d<=r)
    .sort((a,b)=>a.d-b.d)
    .map(o=>o.t);
}

function dxfIsNumberOnly(text){
  return /^[+-]?\d+(?:\.\d+)?$/.test(String(text||'').trim());
}

function dxfLabelToIpIndex(label){
  const s = String(label||'').toUpperCase().replace(/\s+/g,'');
  // IP1, IP-1, IP(1)
  const m = s.match(/IP\(?-?(\d+)\)?/);
  if (!m) return null;
  const k = parseInt(m[1],10);
  return Number.isFinite(k) ? k : null;
}

function dxfExtractPlanControlPoints(dxfText){
  const texts = dxfExtractTextLike(dxfText)
    .filter(t=>t.text)
    .map(t=>({
      ...t,
      text: String(t.text).replace(/[\u3000]/g,' ').trim()
    }));
  const conv = dxfDetectCoordConvention(texts);

  // 1) inline coords: a single entity contains both coords
  const pts = { BP:null, EP:null, IP:[] };
  for (const t of texts){
    const s = t.text.toUpperCase();
    const inline = dxfParseCoordInline(t.text);
    if (!inline) continue;
    const coord = (function(){
      // map inline to {E,N}
      let E=null,N=null;
      if (Number.isFinite(inline.E) && Number.isFinite(inline.N)) { E=inline.E; N=inline.N; }
      else if (Number.isFinite(inline.X) && Number.isFinite(inline.Y)) { N=inline.X; E=inline.Y; }
      if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
      return {E,N};
    })();
    if (!coord) continue;
    if (/\bBP\b/.test(s)) pts.BP = { name:'BP', ...coord };
    else if (/\bEP\b/.test(s)) pts.EP = { name:'EP', ...coord };
    else if (/\bIP\b/.test(s)) {
      const idx = dxfLabelToIpIndex(s) || (pts.IP.length+1);
      pts.IP.push({ idx, name:`IP${idx}`, ...coord });
    }
  }

  // 2) proximity coords: label entity near two numeric entities (E/N or X/Y)
  function resolveByProximity(labelRegex, name){
    const lab = texts.find(t=>labelRegex.test(String(t.text||'')) && Number.isFinite(t.x) && Number.isFinite(t.y));
    if (!lab) return null;
    // parse if label text itself contains coords (handled above) -> skip
    const near = dxfFindNearbyText(texts, lab, 120);
    // prefer strings like "X=..." or "E=..."
    let E=null, N=null;
    for (const n of near){
      const inl = dxfParseCoordInline(n.text);
      if (!inl) continue;
      if (Number.isFinite(inl.E)) E=inl.E;
      if (Number.isFinite(inl.N)) N=inl.N;
      if (Number.isFinite(inl.X)) N=inl.X;
      if (Number.isFinite(inl.Y)) E=inl.Y;
    }
    if (Number.isFinite(E) && Number.isFinite(N)) return { name, E, N };

    // otherwise pick two closest numeric-only values (coordinate-like)
    const nums = near
      .filter(t=>dxfIsNumberOnly(t.text))
      .map(t=>({t, v:parseFloat(String(t.text).trim())}))
      .filter(o=>Number.isFinite(o.v))
      // coord-like: avoid small dims
      .filter(o=>Math.abs(o.v) >= 1000)
      .slice(0, 6);
    if (nums.length < 2) return null;
    // choose two with smallest distance to label
    nums.sort((a,b)=>dxfDist(a.t,lab)-dxfDist(b.t,lab));
    const a=nums[0], b=nums[1];
    // assign by convention + x ordering (common table: X then Y, or N then E)
    const left = (a.t.x <= b.t.x) ? a : b;
    const right= (a.t.x <= b.t.x) ? b : a;
    if (conv==='XY') {
      N = left.v; E = right.v;
    } else {
      N = left.v; E = right.v;
    }
    if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
    return { name, E, N };
  }

  if (!pts.BP) pts.BP = resolveByProximity(/^BP\b/i, 'BP');
  if (!pts.EP) pts.EP = resolveByProximity(/^EP\b/i, 'EP');

  // IP labels: resolve all that appear
  const ipLabs = texts
    .filter(t=>/^IP\s*[-(]?\d+\b/i.test(String(t.text||'')) && Number.isFinite(t.x)&&Number.isFinite(t.y))
    .slice(0, 80);
  for (const lab of ipLabs){
    const idx = dxfLabelToIpIndex(lab.text);
    if (!idx) continue;
    // skip if already resolved
    if (pts.IP.some(p=>p.idx===idx)) continue;
    const r = resolveByProximity(new RegExp(`^IP\\s*[-(]?${idx}\\b`, 'i'), `IP${idx}`);
    if (r) pts.IP.push({ idx, name:`IP${idx}`, E:r.E, N:r.N });
  }

  pts.IP.sort((a,b)=>a.idx-b.idx);
  // sanity: need BP/EP at minimum
  if (!pts.BP || !pts.EP) return null;
  return pts;
}

function dxfBuildProfileFromBoxTable(dxfText){
  const texts = dxfExtractTextLike(dxfText).filter(t=>Number.isFinite(t.x)&&Number.isFinite(t.y));
  // find labels (best-effort)
  const rowSta = findRowNearLabel(texts, /累加\s*距離|累加距離/);
  const rowZ   = findRowNearLabel(texts, /計画\s*高|計画高/);
  if (!rowSta || rowSta.cells.length<2) throw new Error("箱書きの『累加距離』行が見つかりません");
  if (!rowZ   || rowZ.cells.length<2)   throw new Error("箱書きの『計画高』行が見つかりません");

  // map by nearest x
  const zs = rowZ.cells;
  const points = rowSta.cells.map(c=>{
    let best = zs[0];
    let bestDx = Math.abs(best.x - c.x);
    for (const z of zs){
      const dx = Math.abs(z.x - c.x);
      if (dx < bestDx){ bestDx = dx; best = z; }
    }
    return { sta: c.v, z: best.v };
  }).filter(p=>Number.isFinite(p.sta)&&Number.isFinite(p.z));

  points.sort((a,b)=>a.sta-b.sta);
  if (points.length<2) throw new Error("箱書きから測点・標高の点が十分に取れません");

  const startSta = points[0].sta;
  const startZ   = points[0].z;
  const grades = [];
  for (let i=0;i<points.length-1;i++){
    const s0=points[i].sta, z0=points[i].z;
    const s1=points[i+1].sta, z1=points[i+1].z;
    const g = 100*(z1-z0)/(s1-s0);
    grades.push({ id: i+1, nextSta: +s1.toFixed(3), gradePct: +g.toFixed(6) });
  }
  return { startSta: +startSta.toFixed(3), startZ: +startZ.toFixed(3), grades };
}

function dxfFindStaListNearCL(dxfText){
  const texts = dxfExtractTextLike(dxfText).filter(t=>t.text && /\+/.test(t.text));
  const stas = [];
  for (const t of texts){
    const m = staTokenToMeters(t.text);
    if (m==null) continue;
    stas.push(+m.toFixed(3));
  }
  // unique
  const uniq = Array.from(new Set(stas)).sort((a,b)=>a-b);
  return uniq;
}

function dxfFindBridgeRanges(dxfText, clPts){
  const texts = dxfExtractTextLike(dxfText)
    .filter(t=>t.layer && t.layer.toUpperCase().includes('BRDG'))
    .filter(t=>t.text && /^[AP]\d$/i.test(String(t.text).trim()))
    .filter(t=>Number.isFinite(t.x) && Number.isFinite(t.y));
  const pts = [];
  for (const t of texts){
    const pr = projectPointToPolyline(t.x, t.y, clPts);
    if (!Number.isFinite(pr.sta) || !Number.isFinite(pr.dist)) continue;
    if (pr.dist > 60) continue; // far from CL -> ignore
    pts.push({ label: String(t.text).trim().toUpperCase(), sta: pr.sta });
  }
  pts.sort((a,b)=>a.sta-b.sta);
  // cluster by station gap
  const clusters = [];
  let cur = [];
  for (const p of pts){
    if (!cur.length){ cur.push(p); continue; }
    if (p.sta - cur[cur.length-1].sta <= 300){ cur.push(p); }
    else { clusters.push(cur); cur=[p]; }
  }
  if (cur.length) clusters.push(cur);
  const ranges = clusters
    .map((c,i)=>({
      group: i+1,
      start: Math.min(...c.map(r=>r.sta)),
      end: Math.max(...c.map(r=>r.sta)),
      labels: c.map(r=>r.label)
    }))
    .filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start);
  return ranges;
}

function buildSideFromSimple(simpleSegs){
  const segs = (simpleSegs||[]).map((s,i)=>({
    id: Number.isFinite(s.id)?s.id:(i+1),
    end: +(+s.end).toFixed(3),
    mode: 'pct',
    slopePct: +(+s.slopePct).toFixed(3),
    ratioX: 20,
    ratioDir: 'down',
    stepDz: 0
  })).filter(s=>Number.isFinite(s.end));
  return { segs, nextSegId: (Math.max(0,...segs.map(s=>s.id))+1) };
}

function getStdCrossTemplate(which){
  // Standard templates derived from earlier DXF extraction. Edit here if your standard changes.
  // which: 4/5/6
  if (which===6){
    return {
      right: buildSideFromSimple([{id:1,end:3.5,slopePct:-2.0},{id:2,end:5.0,slopePct:-2.5}]),
      left:  buildSideFromSimple([{id:1,end:3.5,slopePct:-2.0},{id:2,end:5.25,slopePct:-2.5}])
    };
  }
  // 4/5: shoulder max (1.750〜2.500) -> end=6.0 as safe template
  return {
    right: buildSideFromSimple([{id:1,end:3.5,slopePct:-2.0},{id:2,end:6.0,slopePct:-2.5}]),
    left:  buildSideFromSimple([{id:1,end:3.5,slopePct:-2.0},{id:2,end:6.0,slopePct:-2.5}])
  };
}


function parseSimaA01Points(text){
  const pts = [];
  const lines = String(text||"").split(/\r?\n/);
  for (const ln0 of lines){
    const ln = ln0.trim();
    if (!ln || ln.startsWith("Z") || ln.startsWith("G") || ln.startsWith("A00")) continue;
    if (!ln.startsWith("A01")) continue;
    // CSV-ish: A01,   26,IP.1           ,25196.601780,13374.111999,    0.000,
    const cols = ln.split(",").map(s=>s.trim());
    if (cols.length < 6) continue;
    const name = (cols[2]||"").replace(/\s+/g," ").trim();
    const x = parseNumLoose(cols[3]||"");
    const y = parseNumLoose(cols[4]||"");
    const z = parseNumLoose(cols[5]||"");
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const no = parseInt(String(cols[1]||"").replace(/[^\d\-]/g,""),10);
    pts.push({ name, x, y, z: Number.isFinite(z)?z:0, no: Number.isFinite(no)?no:null });
  }
  // sort by point number if present
  pts.sort((a,b)=>{
    if (a.no!=null && b.no!=null) return a.no-b.no;
    return 0;
  });
  return pts;
}

function parseSimaRoutes(text){
  const src = String(text||"");
  const lines = src.split(/\r?\n/);
  const routes = [];
  for (let i=0;i<lines.length;i++){
    const ln = (lines[i]||"").trim();
    if (!ln.startsWith("F00")) continue;
    const cols0 = ln.split(",").map(s=>s.trim());
    const routeName = (cols0[3]||"").replace(/\s+/g," ").trim();
    const body = [];
    for (let j=i+1; j<lines.length; j++){
      const ln2 = (lines[j]||"").trim();
      if (ln2.startsWith("F99")) { i = j; break; }
      if (ln2.startsWith("F00")) { i = j-1; break; }
      body.push(ln2);
    }
    routes.push({ name: routeName, lines: body });
  }
  return routes;
}

// SIMA(.sim/.sima) から路線データ（主要線/中心線）の C01/C02 を拾って曲線設定まで復元（ベストエフォート）
function parseSimaPlan(text){
  const pts = parseSimaA01Points(text);
  if (!pts.length) throw new Error("SIMAからA01座標点が見つかりませんでした");

  // point map: name -> {N,E,Z}
  const pmap = new Map();
  for (const p of pts){
    const nm = (p.name||"").trim().replace(/\s+/g," ");
    if (!pmap.has(nm)) pmap.set(nm, { N: p.x, E: p.y, Z: p.z });
  }

  const routes = parseSimaRoutes(text);
  const pickRoute = (re)=> routes.find(r=>re.test(r.name)) || null;

  // IP線（PI列）を優先
  const rIP = pickRoute(/IP\s*線/i) || pickRoute(/IP線/);
  let piNames = [];
  if (rIP){
    for (const ln of rIP.lines){
      if (!ln || !ln.startsWith("B01")) continue;
      const cols = ln.split(",").map(s=>s.trim());
      const nm = (cols[2]||"").replace(/\s+/g," ").trim();
      if (nm) piNames.push(nm);
    }
  }

  // fallback: A01から BP/IP/EP を拾う（曲線設定は保証しない）
  if (piNames.length < 2){
    const {bp, ep} = pickBpEpFromPoints(pts);
    const ips = extractIpPointsFromSima(pts);
    return { bp:{N:bp.x,E:bp.y}, ep:{N:ep.x,E:ep.y}, ips, curveSettings:[], staPitch:null };
  }

  const pis = piNames.map(nm=>{
    const p = pmap.get(nm);
    return p ? ({ name: nm, N: p.N, E: p.E }) : null;
  }).filter(Boolean);

  if (pis.length < 2) throw new Error("SIMAのIP線からBP/EPが取得できませんでした（座標点が不足）");

  const bp = { name: "BP", N: pis[0].N, E: pis[0].E, srcName: pis[0].name };
  const ep = { name: "EP", N: pis[pis.length-1].N, E: pis[pis.length-1].E, srcName: pis[pis.length-1].name };
  const ips = pis.slice(1, -1).map((p,i)=>({ id: i+1, name: `IP${i+1}`, N: p.N, E: p.E, srcName: p.name }));

  // main route (主要線/中心線) を解析して C01/C02 をPIに紐付け
  // main route: prefer the route that actually contains curve codes (C01/C02). 
// Many SIMA files have multiple routes (IP線/主要線/中心線 etc). We pick the most "curve-rich" one.
const scoreRoute = (r)=>{
  if (!r || !Array.isArray(r.lines)) return -1;
  const name = String(r.name||"");
  if (/IP\s*線/i.test(name) || /IP線/.test(name)) return -1;
  let c01=0, c02=0;
  for (const ln of r.lines){
    const s = String(ln||"").trim();
    if (s.startsWith("C01")) c01++;
    else if (s.startsWith("C02")) c02++;
  }
  const bonus = (/主要\s*線/i.test(name) || /主要線/.test(name) || /中心\s*線/i.test(name) || /中心線/.test(name)) ? 5 : 0;
  return (c01*2 + c02*2) + bonus;
};
let rMain = null;
let bestScore = -1;
for (const r of routes){
  const sc = scoreRoute(r);
  if (sc > bestScore){
    bestScore = sc;
    rMain = r;
  }
}
  const byRef = new Map();
  let staPitch = null;

  // helpers (standard XY: x=E, y=N)
  const orient2 = (a,b,c)=> (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
  const circleCenters = (S,E,r)=>{
    const dx = E.x - S.x, dy = E.y - S.y;
    const d = Math.hypot(dx, dy);
    if (!Number.isFinite(d) || d === 0 || d > 2*r) return [];
    const mx = (S.x + E.x) / 2, my = (S.y + E.y) / 2;
    const h = Math.sqrt(Math.max(r*r - (d/2)*(d/2), 0));
    const ux = -dy / d, uy = dx / d; // perp unit
    return [{ x: mx + ux*h, y: my + uy*h }, { x: mx - ux*h, y: my - uy*h }];
  };
  const arcLenFrom3Pts = (sN,sE, mN,mE, eN,eE, r)=>{
    const S = { x: sE, y: sN }, M = { x: mE, y: mN }, E = { x: eE, y: eN };
    const dir = orient2(S, M, E) >= 0 ? "ccw" : "cw";
    const centers = circleCenters(S, E, r);
    // chord fallback
    if (!centers.length){
      const chord = Math.hypot(E.x-S.x, E.y-S.y);
      const theta = 2 * Math.asin(Math.min(1, chord/(2*r)));
      return { len: r*theta, dir };
    }
    let best = centers[0], bestErr = Infinity;
    for (const c of centers){
      const err = Math.abs(Math.hypot(M.x-c.x, M.y-c.y) - r);
      if (err < bestErr){ bestErr = err; best = c; }
    }
    const v1 = { x: S.x-best.x, y: S.y-best.y };
    const v2 = { x: E.x-best.x, y: E.y-best.y };
    const cross = v1.x*v2.y - v1.y*v2.x;
    const dot = v1.x*v2.x + v1.y*v2.y;
    let ang = Math.atan2(cross, dot); // [-pi,pi]
    if (dir === "ccw") { if (ang < 0) ang += 2*Math.PI; }
    else { if (ang > 0) ang -= 2*Math.PI; ang = -ang; }
    return { len: Math.abs(ang) * r, dir };
  };

  const addRec = (ref)=>{
    const rec = byRef.get(ref) || { curves: [], clothoids: [] };
    byRef.set(ref, rec);
    return rec;
  };
  const isSpPoint = (nm)=>{
    const n = String(nm||"").toUpperCase().replace(/\s+/g,"");
    return n.startsWith("SP.") || n.startsWith("SP");
  };

  if (rMain){
    const f03 = rMain.lines.find(l=>String(l||"").trim().startsWith("F03"));
    if (f03){
      const cols = f03.split(",").map(s=>s.trim());
      const sub = parseNumLoose(cols[3]);
      if (Number.isFinite(sub) && sub > 0) staPitch = sub;
    }

    let cur = null;
    let pendingArc = null;

    for (let i=0; i<rMain.lines.length; i++){
      const ln = String(rMain.lines[i]||"").trim();
      if (!ln) continue;
      const cols = ln.split(",").map(s=>s.trim());
      const code = cols[0];

      if (code === "B01"){
        cur = (cols[2]||"").replace(/\s+/g," ").trim();
        continue;
      }

      if (code === "C02"){
        const A = parseNumLoose(cols[1]);
        const R1 = parseNumLoose(cols[2]);
        const R2 = parseNumLoose(cols[3]);

        let j = i+1;
        while (j < rMain.lines.length && !String(rMain.lines[j]||"").trim()) j++;
        let piName = "";
        if (j < rMain.lines.length && String(rMain.lines[j]||"").trim().startsWith("C04")){
          const c = String(rMain.lines[j]).split(",").map(s=>s.trim());
          piName = (c[2]||"").replace(/\s+/g," ").trim();
          j++;
        }
        while (j < rMain.lines.length && !String(rMain.lines[j]||"").trim()) j++;
        let endName = "";
        if (j < rMain.lines.length && String(rMain.lines[j]||"").trim().startsWith("B01")){
          const c = String(rMain.lines[j]).split(",").map(s=>s.trim());
          endName = (c[2]||"").replace(/\s+/g," ").trim();
        }

        if (cur && endName && piName && Number.isFinite(A) && A >= 0){
          const ps = pmap.get(cur), pp = pmap.get(piName), pe = pmap.get(endName);
          let dir = "ccw";
          if (ps && pp && pe){
            const S = { x: ps.E, y: ps.N }, P = { x: pp.E, y: pp.N }, E = { x: pe.E, y: pe.N };
            dir = orient2(S, P, E) >= 0 ? "ccw" : "cw";
          }
          const inv = (R)=> (Number.isFinite(R) && Math.abs(R) > 1e-12) ? 1/Math.abs(R) : 0;
          const L = Math.abs(A*A*(inv(R2) - inv(R1)));
          addRec(piName).clothoids.push({ A, dir, len: Number.isFinite(L) ? L : null });
          cur = endName;
        }

        pendingArc = null;
        i = j;
        continue;
      }

      if (code === "C01"){
        let R = parseNumLoose(cols[2]);
        if (!Number.isFinite(R)) R = parseNumLoose(cols[1]);
        R = Math.abs(R);

        let j = i+1;
        while (j < rMain.lines.length && !String(rMain.lines[j]||"").trim()) j++;
        let piName = "";
        if (j < rMain.lines.length && String(rMain.lines[j]||"").trim().startsWith("C04")){
          const c = String(rMain.lines[j]).split(",").map(s=>s.trim());
          piName = (c[2]||"").replace(/\s+/g," ").trim();
          j++;
        }
        while (j < rMain.lines.length && !String(rMain.lines[j]||"").trim()) j++;
        let pName = "";
        if (j < rMain.lines.length && String(rMain.lines[j]||"").trim().startsWith("B01")){
          const c = String(rMain.lines[j]).split(",").map(s=>s.trim());
          pName = (c[2]||"").replace(/\s+/g," ").trim();
        }

        if (!cur || !pName || !piName || !Number.isFinite(R) || R <= 0){
          i = j;
          continue;
        }

        if (!pendingArc){
          pendingArc = { start: cur, mid: null, R, piName };
          if (isSpPoint(pName)){
            pendingArc.mid = pName;
          } else {
            // no SP: chord minor arc (direction unknown -> ccw as default)
            const ps = pmap.get(cur), pe = pmap.get(pName);
            if (ps && pe){
              const S = { x: ps.E, y: ps.N }, E = { x: pe.E, y: pe.N };
              const chord = Math.hypot(E.x-S.x, E.y-S.y);
              const theta = 2 * Math.asin(Math.min(1, chord/(2*R)));
              addRec(piName).curves.push({ radius: R, dir: "ccw", len: R*theta });
            }
            cur = pName;
            pendingArc = null;
          }
        } else {
          // complete arc (start-mid-end)
          const startName = pendingArc.start;
          const midName = pendingArc.mid;
          const endName = pName;

          const ps = pmap.get(startName), pm = midName ? pmap.get(midName) : null, pe = pmap.get(endName);
          if (ps && pm && pe){
            const res = arcLenFrom3Pts(ps.N, ps.E, pm.N, pm.E, pe.N, pe.E, pendingArc.R);
            addRec(piName).curves.push({ radius: pendingArc.R, dir: res.dir, len: res.len });
          } else if (ps && pe){
            const S = { x: ps.E, y: ps.N }, E = { x: pe.E, y: pe.N };
            const chord = Math.hypot(E.x-S.x, E.y-S.y);
            const theta = 2 * Math.asin(Math.min(1, chord/(2*pendingArc.R)));
            addRec(piName).curves.push({ radius: pendingArc.R, dir: "ccw", len: pendingArc.R*theta });
          }

          cur = endName;
          pendingArc = null;
        }

        i = j;
        continue;
      }
    }
  }

  // curve settings (same policy as XRF)
  const curveSettings = [];
  for (const ip of ips){
    const rec = byRef.get(ip.srcName);
    if (!rec || !rec.curves.length) continue;

    const c = rec.curves.slice().sort((a,b)=>(b.len||0)-(a.len||0))[0];
    const dir = c.dir === "ccw" ? "left" : c.dir === "cw" ? "right" : "auto";

    let A1 = 0, A2 = 0;
    if (rec.clothoids && rec.clothoids.length){
      const cs = rec.clothoids.slice().sort((a,b)=>(b.len||0)-(a.len||0));
      A1 = cs[0].A || 0;
      A2 = (cs[1]?.A ?? A1) || 0;
    }

    curveSettings.push({ id: curveSettings.length+1, ipName: ip.name, R: c.radius, A1, A2, direction: dir, ds: state.dsSpiral || 0.5 });
  }

  return { bp, ep, ips, curveSettings, staPitch };
}

function pickBpEpFromPoints(pts){
  const normName = (s)=>String(s||"").toUpperCase().replace(/\s+/g,"").replace(/_/g,"");
  let bp = null, ep = null;

  // BP: exact "BP" if exists
  bp = pts.find(p => normName(p.name) === "BP") || null;

  // EP: exact "EP" or "*.EP"
  const isEp = (p)=>{
    const n = normName(p.name);
    if (n === "EP") return true;
    if (n.endsWith(".EP")) return true;
    // avoid EBC/KEE etc
    if (n.includes("EBC") || n.includes("KEE") || n.includes("KAE")) return false;
    return /(^|[.\-])EP$/.test(n);
  };
  ep = pts.find(isEp) || null;

  if (!bp && pts.length) bp = pts[0];
  if (!ep && pts.length) ep = pts[pts.length-1];

  return { bp, ep };
}

function extractIpPointsFromSima(pts){
  const ip = pts
    .filter(p => /^IP[\.\d]/i.test(p.name.trim()) || /^IP\./i.test(p.name.trim()))
    .map(p=>{
      // id by suffix number if any
      const m = p.name.match(/IP\.?\s*([0-9]+)/i);
      const id = m ? parseInt(m[1],10) : null;
      return { id, name: p.name.trim().replace(/\s+/g," "), N: p.x, E: p.y };
    });

  // unique by name
  const seen = new Set();
  const uniq = [];
  for (const p of ip){
    const k = p.name;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  uniq.sort((a,b)=>{
    if (a.id!=null && b.id!=null) return a.id-b.id;
    if (a.id!=null) return -1;
    if (b.id!=null) return 1;
    return a.name.localeCompare(b.name);
  });
  // ensure ids sequential
  return uniq.map((p,i)=>({ id: i+1, name: `IP${i+1}`, N: p.N, E: p.E, srcName: p.name }));
}

// parse XRF (RoadGM) and return {bp,ep,ips,curveSettings?,staPitch?}
function parseXrfRoadGM(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const pe = doc.getElementsByTagName("parsererror");
  if (pe && pe.length) throw new Error("XRF(XML)の解析に失敗しました（parsererror）");

  const all = Array.from(doc.getElementsByTagName("*"));

  const pis = all
    .filter(el => el.localName === "PI" && el.parentElement && el.parentElement.localName === "PIs")
    .map(el => ({
      name: el.getAttribute("Name") || "",
      x: parseNumLoose(el.getAttribute("x")),
      y: parseNumLoose(el.getAttribute("y")),
    }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (pis.length < 2) throw new Error("XRFからPI(BP/EP)が取得できませんでした");

  const bp = { name: "BP", N: pis[0].x, E: pis[0].y, srcName: pis[0].name };
  const ep = { name: "EP", N: pis[pis.length-1].x, E: pis[pis.length-1].y, srcName: pis[pis.length-1].name };

  const ips = pis.slice(1, -1).map((p,i)=>({
    id: i+1,
    name: `IP${i+1}`,
    N: p.x,
    E: p.y,
    srcName: p.name
  }));

  // station pitch
  let staPitch = null;
  const interval = all.find(el => el.localName === "Interval" && el.parentElement && el.parentElement.localName === "StationEquation");
  if (interval) {
    const sub = parseNumLoose(interval.getAttribute("Sub"));
    if (Number.isFinite(sub) && sub > 0) staPitch = sub;
  }

  // curve settings (best-effort)
  const gmEls = all.filter(el => el.localName === "GmElement");
  const byRef = new Map();
  for (const ge of gmEls){
    const ref = ge.getAttribute("RefPI") || "";
    if (!ref) continue;
    const kids = Array.from(ge.children || []);
    const curve = kids.find(k=>k.localName==="Curve");
    const clothoid = kids.find(k=>k.localName==="Clothoid");
    const rec = byRef.get(ref) || { curves: [], clothoids: [] };
    if (curve){
      const radius = parseFloat(curve.getAttribute("Radius"));
      const dir = (curve.getAttribute("Direction")||"").toLowerCase();
      const len = parseFloat(curve.getAttribute("Length"));
      if (Number.isFinite(radius) && radius>0) rec.curves.push({ radius, dir, len: Number.isFinite(len)?len:null });
    }
    if (clothoid){
      const A = parseFloat(clothoid.getAttribute("A"));
      const dir = (clothoid.getAttribute("Direction")||"").toLowerCase();
      const len = parseFloat(clothoid.getAttribute("Length"));
      if (Number.isFinite(A) && A>=0) rec.clothoids.push({ A, dir, len: Number.isFinite(len)?len:null });
    }
    byRef.set(ref, rec);
  }

  const curveSettings = [];
  for (const ip of ips){
    const rec = byRef.get(ip.srcName);
    if (!rec || !rec.curves.length) continue;

    // pick the longest curve if multiple
    const c = rec.curves
      .slice()
      .sort((a,b)=>(b.len||0)-(a.len||0))[0];

    const dir = c.dir === "ccw" ? "left" : c.dir === "cw" ? "right" : "auto";

    // A1/A2 from clothoids (take first 2 by length)
    let A1 = 0, A2 = 0;
    if (rec.clothoids && rec.clothoids.length){
      const cs = rec.clothoids.slice().sort((a,b)=>(b.len||0)-(a.len||0));
      A1 = cs[0].A || 0;
      A2 = (cs[1]?.A ?? A1) || 0;
    }

    curveSettings.push({ id: curveSettings.length+1, ipName: ip.name, R: c.radius, A1, A2, direction: dir, ds: state.dsSpiral || 0.5 });
  }

  return { bp, ep, ips, curveSettings, staPitch };
}

function applyPlanImport(result, mode, msgText){
  planImportMsgText = msgText || "";
  // mode: "xrf" or "sim"
  state.bp = { name: "BP", N: result.bp.N, E: result.bp.E };
  state.ep = { name: "EP", N: result.ep.N, E: result.ep.E };
  state.ipPoints = result.ips.map(p=>({ id: p.id, name: p.name, N: p.N, E: p.E }));
  state.useIpCount = state.ipPoints.length;


  // 曲線設定とピッチ（SIMA/XRFどちらも、取得できた分だけ反映）
  if (Array.isArray(result.curveSettings) && result.curveSettings.length){
    state.curveSettings = result.curveSettings;
  } else {
    state.curveSettings = [];
  }
  if (Number.isFinite(result.staPitch) && result.staPitch>0){
    state.staPitch = Math.round(result.staPitch);
    state.outputStep = Math.round(result.staPitch);
  }

  // enforce IP1..IPn naming (no gaps)
  renumberIpsNoGaps();

  saveState();
  render();
}

function loadState() {
  const tNew = LS.get(LS_KEY_NEW);
  const tOld = LS.get(LS_KEY_OLD);
  const t = tNew || tOld;
  if (!t) return;
  try {
    const obj = JSON.parse(t);
    if (obj && typeof obj === "object") {
      state = Object.assign(state, obj);
      state = normalizeState(state);
      try { window.state = state; } catch (e) {}

      // 旧キーから読み込んだ場合は新キーにも書き戻す
      if (!tNew && tOld) {
        try { LS.set(LS_KEY_NEW, JSON.stringify(state)); } catch (e) {}
      }
    }
  } catch (e) {}
}
loadState();

/* =========================
   Math / utilities
========================= */
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const norm = (x, y) => Math.sqrt(x * x + y * y);
const unit = (x, y) => {
  const len = norm(x, y);
  return len === 0 ? [1, 0] : [x / len, y / len];
};
const dot = (ax, ay, bx, by) => ax * bx + ay * by;
const crossZ = (ax, ay, bx, by) => ax * by - ay * bx;
const wrap360 = (deg) => ((deg % 360) + 360) % 360;

const azFromVec = (dE, dN) => wrap360((Math.atan2(dE, dN) * 180) / Math.PI);
const psiFromAz = (azDeg) => (Math.PI / 2) - (azDeg * Math.PI / 180);
const azFromPsi = (psi) => wrap360(((Math.PI / 2 - psi) * 180) / Math.PI);

const dedupeConsecutivePoints = (pts, eps = 1e-9) => {
  const out = [];
  for (const p of pts) {
    if (!out.length) { out.push(p); continue; }
    const q = out[out.length - 1];
    if (Math.hypot(p.E - q.E, p.N - q.N) > eps) out.push(p);
  }
  return out;
};

const dedupeSorted = (arr, eps = 1e-7) => {
  const out = [];
  for (const v of arr) {
    if (!out.length || Math.abs(v - out[out.length - 1]) > eps) out.push(v);
  }
  return out;
};

const csvEscape = (v) => {
  const s = String(v ?? "");
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};


// ---- Coordinate CSV (名称,X座標,Y座標,Z標高) ----
function parseCoordCsv(text){
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l);
  if (!lines.length) return [];
  const splitCols = (ln)=> ln.split(',').map(s=>String(s).trim());
  let start = 0;
  const c0 = splitCols(lines[0]);
  if ((c0[0]||"").includes('名称') || (c0[0]||"").toLowerCase().includes('name')) start = 1;

  const items = [];
  for (let i=start; i<lines.length; i++){
    const cols = splitCols(lines[i]);
    if (cols.length < 3) continue;
    const name = (cols[0]||"").replace(/^\uFEFF/,"").trim();
    if (!name) continue;
    const x = parseNumLoose(cols[1]||""); // X=Northing
    const y = parseNumLoose(cols[2]||""); // Y=Easting
    const z = parseNumLoose((cols[3] ?? ""));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    items.push({ name, N:x, E:y, Z: Number.isFinite(z) ? z : null });
  }
  return items;
}

// ---- IP renumber: no gaps (IP1..IPn) and keep curveSettings linked by order ----
function renumberIpsNoGaps(){
  const oldNames = state.ipPoints.map(p=>p && p.name ? String(p.name) : "");
  const nameToIdx = new Map();
  oldNames.forEach((nm, idx)=>{ if(nm) nameToIdx.set(nm, idx); });

  // rename IPs in current order
  state.ipPoints.forEach((p, idx)=>{
    p.id = idx + 1;
    p.name = `IP${idx+1}`;
  });

  // keep useIpCount valid
  state.useIpCount = Math.max(0, Math.min(state.useIpCount, state.ipPoints.length));

  // curveSettings: remap ipName using old order
  if (!Array.isArray(state.curveSettings)) state.curveSettings = [];
  const newCurves = [];
  for (const c of state.curveSettings){
    const old = String(c && c.ipName ? c.ipName : "");
    let idx = nameToIdx.get(old);
    if (idx == null){
      // fallback: if old is like IP2 etc
      const m = /^IP(\d+)$/.exec(old);
      if (m) idx = Math.max(0, parseInt(m[1],10)-1);
    }
    if (idx == null || idx < 0 || idx >= state.ipPoints.length) continue;
    const nc = Object.assign({}, c, { ipName: `IP${idx+1}` });
    newCurves.push(nc);
  }
  // normalize curve IDs
  state.curveSettings = newCurves.map((c, i)=>Object.assign({}, c, { id: i+1 }));
}

const downloadText = (text, filename, mime="text/plain;charset=utf-8") => {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};

/* =========================
   Tab JSON Export helpers
   ========================= */
function exportPlanJson(){
  const obj = {
    meta: { kind: "plan", version: String(window.APP_VERSION||"") },
    bp: state.bp,
    ep: state.ep,
    ipPoints: state.ipPoints,
    useIpCount: state.useIpCount,
    curveSettings: Array.isArray(state.curveSettings) ? state.curveSettings : []
  };
  downloadText(JSON.stringify(obj, null, 2), buildExportFileName("plan"), "application/json;charset=utf-8");
}
function exportProfileJson(){
  const obj = { meta: { kind: "profile", version: String(window.APP_VERSION||"") }, profile: state.profile };
  downloadText(JSON.stringify(obj, null, 2), buildExportFileName("profile"), "application/json;charset=utf-8");
}
function exportCrossJson(){
  const obj = { meta: { kind: "cross", version: String(window.APP_VERSION||"") }, cross: state.cross };
  downloadText(JSON.stringify(obj, null, 2), buildExportFileName("cross"), "application/json;charset=utf-8");
}



/* =========================
   v18: Plan export (SIMA/XRF) + Design elevation query
========================= */

// ASCII-safe name for SIMA and XRF (avoid encoding trouble on import)
const normNameAscii = (s, maxLen=32) => {
  s = String(s ?? "").trim();
  if (!s) s = "P";
  // replace anything except [A-Za-z0-9_ . + -] with _
  s = s.replace(/[^\w\.\+\-]/g, "_").replace(/_+/g, "_");
  if (s.length > maxLen) s = s.slice(0, maxLen);

  return s;
};


// ---- number parsing (keep minus sign) ----
// iOS/Excelで混ざりやすい「全角/Unicodeマイナス」「全角数字」「全角小数点」などを正規化
const normNumStr = (v) => {
  let s = String(v ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "");
  // normalize various dashes/minus to ASCII '-'
  s = s.replace(/[−－ー﹣‐‑‒–—―]/g, "-");
  // fullwidth digits -> ascii
  s = s.replace(/[０-９]/g, (ch)=>String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30));
  // fullwidth dot/comma variants
  s = s.replace(/[．。]/g, ".").replace(/[，､]/g, ",");
  // decimal comma support:
  //  - if both '.' and ',' exist => treat ',' as thousands separator and remove it
  //  - if only ',' exists => treat as decimal separator and convert to '.'
  if (s.includes(".") && s.includes(",")) s = s.replace(/,/g, "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, ".");

  return s;
};

const parseNumLoose = (v) => {
  const s = normNumStr(v);
  if (!s) return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
};


// Parse station input in 100m-major style (e.g., "STA2+12.651" => 212.651m)
// Also accepts plain meters ("212.651") and "STA.-1-20" style.
const parseSta100 = (token) => {
  let s = String(token ?? "").trim();
  if (!s) throw new Error("STAが空です");
  s = s.replace(/[mMｍＭ]\s*$/, "").trim();
  s = s.replace(/^STA\.?/i, "").trim();

  // allow "2+12.651"
  if (s.includes("+")) {
    const [a,b] = s.split("+",2);
    const k = parseNumLoose(a);
    const rem = parseNumLoose(b);
    if (!Number.isFinite(k) || !Number.isFinite(rem)) throw new Error("STA形式が不正です");
    return k*100 + rem;
  }

  // allow "-1-20" (meaning -100 - 20)
  const m = s.match(/^(-?\d+(?:\.\d+)?)[-－−](\d+(?:\.\d+)?)$/);
  if (m) {
    const k = parseNumLoose(m[1]);
    const rem = parseNumLoose(m[2]);
    if (!Number.isFinite(k) || !Number.isFinite(rem)) throw new Error("STA形式が不正です");
    return k*100 - rem;
  }

  const mv = parseNumLoose(s);
  if (!Number.isFinite(mv)) throw new Error("数値が不正です");
  return mv;
};

const staName100 = (m, dec=3) => {
  m = Number(m);
  if (!Number.isFinite(m)) return "STA.?";
  const isNeg = m < 0;
  // major is 100m unit
  let major;
  if (!isNeg) major = Math.floor(m/100);
  else major = -Math.ceil(Math.abs(m)/100);
  let rem = m - major*100;
  if (Math.abs(rem) < 1e-9) rem = 0;

  if (rem === 0) return `STA.${major}`;
  const sign = rem >= 0 ? "+" : "-";
  const a = Math.abs(rem);
  // integer-ish -> no decimals
  const r = Math.abs(a - Math.round(a)) < 1e-9 ? String(Math.round(a)) : a.toFixed(dec).replace(/\.?0+$/,"");
  return `STA.${major}${sign}${r}`;
};

const degToDmsStr = (deg) => {
  deg = wrap360(Number(deg) || 0);
  let D = Math.floor(deg);
  let r = (deg - D) * 60;
  let M = Math.floor(r);
  let S = (r - M) * 60;
  // normalize carry
  if (S >= 59.999995) { S = 0; M += 1; }
  if (M >= 60) { M = 0; D = (D + 1) % 360; }
  const mm = String(M).padStart(2,"0");
  const ss = String(S.toFixed(5)).padStart(8,"0");
  return `${D}-${mm}-${ss}`;
};

const xmlEscape = (s) =>
  String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");


// Cross segment helpers (v18.10.35)
// mode: 'pct' uses slopePct directly, 'ratio' uses 1:X (vertical 1 : horizontal X)
const crossRowSlopePct = (r)=>{
  const mode = (r && typeof r.mode === 'string') ? r.mode : 'pct';
  if (mode === 'ratio') {
    const X = Number(r && r.ratioX);
    if (!Number.isFinite(X) || X <= 0) return 0;
    const dir = (r && r.ratioDir === 'up') ? 1 : -1;
    return dir * (100.0 / X);
  }
  return Number(r && r.slopePct) || 0;
};
const crossRowStepDz = (r)=>{
  // Prefer typed text + direction if present, to keep UI stable on iOS
  const dir = (r && (r.stepDir === 'down' || r.stepDir === 'up')) ? r.stepDir : null;
  const t = (r && typeof r.stepAbsText === 'string') ? r.stepAbsText : null;
  if (dir && t != null) {
    const s = normalizeJpNum(t).trim();
    if (s === "") return 0;
    const n = parseFloat(s.replace(/,/g,"."));
    if (!Number.isFinite(n)) return 0;
    const abs = Math.abs(n);
    return (dir === 'down') ? -abs : abs;
  }
  const v = Number(r && r.stepDz);
  return Number.isFinite(v) ? v : 0;
};

// "割分" parser: supports "1割5分2厘", "5分", "2分5厘", "5%".
// Also accepts numeric like "0.5" (interpreted as 0.5割 = 5%) and integer like "5" (5%).
const normalizeJpNum = (s)=> String(s ?? "")
  .replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xFF10))
  .replace(/[．]/g, '.')
  .replace(/[，]/g, ',')
  .replace(/[−―–]/g, '-');

const parseWaribun = (input)=>{
  if (input == null) return null;
  let t = normalizeJpNum(input).trim();
  if (!t) return null;
  t = t.replace(/\s+/g,'').replace(/勾配/g,'');
  let sign = 1;
  let signSpecified = false;  if (t[0] === '+' || t[0] === '-') {
    signSpecified = true;
    if (t[0] === '-') sign = -1;
    t = t.slice(1);
  }
  if (!t) return null;

  // Percent notation
  if (t.endsWith('%')) {
    const n = parseFloat(t.slice(0,-1).replace(/,/g,'.'));
    if (!Number.isFinite(n)) return null;
    return { pctAbs: Math.abs(n), pctSigned: sign * n, signSpecified };
  }

  // Numeric only: decimal => "割" (x10%), integer => percent
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return null;
    const pct = (t.includes('.')) ? (n * 10.0) : n;
    return { pctAbs: Math.abs(pct), pctSigned: sign * pct, signSpecified };
  }

  const mW = t.match(/(\d+(?:\.\d+)?)割/);
  const mB = t.match(/(\d+(?:\.\d+)?)分/);
  const mR = t.match(/(\d+(?:\.\d+)?)厘/);
  if (!mW && !mB && !mR) return null;

  const wari = mW ? parseFloat(mW[1]) : 0;
  const bu   = mB ? parseFloat(mB[1]) : 0;
  const rin  = mR ? parseFloat(mR[1]) : 0;
  if (![wari, bu, rin].every(Number.isFinite)) return null;

  const ratio = wari*0.1 + bu*0.01 + rin*0.001;
  const pct = ratio * 100.0;
  return { pctAbs: Math.abs(pct), pctSigned: sign * pct, signSpecified };
};


// Cross: integrate piecewise slopes (+ optional vertical step at end) to get ΔZ at offset (m)
const evalCrossDzAtOffset = (segs, off) => {
  off = Math.max(0, Number(off) || 0);
  segs = (Array.isArray(segs) ? segs : []).slice().sort((a,b)=>{
    const ea = Number(a && a.end) || 0;
    const eb = Number(b && b.end) || 0;
    if (Math.abs(ea-eb) > 1e-12) return ea-eb;
    return (Number(a && a.id)||0) - (Number(b && b.id)||0);
  });
  if (!segs.length) return 0;

  let z = 0;
  let x0 = 0;
  let lastSlope = crossRowSlopePct(segs[0]);

  for (const r of segs) {
    const x1 = Number(r && r.end);
    if (!Number.isFinite(x1) || x1 < x0 - 1e-12) continue;

    const slope = crossRowSlopePct(r);
    const stepDz = crossRowStepDz(r);

    // integrate slope if this row has a span
    if (x1 > x0 + 1e-12) {
      lastSlope = slope;
      const use = Math.min(off, x1);
      if (use > x0 + 1e-12) z += (slope/100.0) * (use - x0);

      // If query is strictly inside the span, stop here (step is at end)
      if (off < x1 - 1e-12) return z;

      // If query is at the end (or beyond), apply step at end
      if (Math.abs(off - x1) <= 1e-12 || off > x1 + 1e-12) {
        if (Number.isFinite(stepDz) && Math.abs(stepDz) > 0) z += stepDz;
      }

      x0 = x1;
      if (off <= x1 + 1e-12) return z;
      continue;
    }

    // x1 == x0 (no span) but may have a step at this point
    if (off >= x1 - 1e-12) {
      if (Number.isFinite(stepDz) && Math.abs(stepDz) > 0) z += stepDz;
    }
  }

  // extend beyond last end with last slope
  if (off > x0 + 1e-12) z += (lastSlope/100.0) * (off - x0);
  return z;
};

// Cross: at STA// Cross: at STA (m), choose override segments if present.
// If between two overrides, linearly interpolate ΔZ(off) (supports different segment structures).
const evalCrossDzAtSta = (m, side, off) => {
  ensureCrossState();
  side = (side === "left") ? "left" : "right";
  m = Number(m);
  off = Math.max(0, Number(off) || 0);

  const key = Number(m).toFixed(3);
  const ovr = state.cross?.overrides?.[key]?.[side];
  if (ovr?.segs?.length) {
    const w = computeCrossRowsFromSegs(ovr.segs).lastEnd || 0;
    return { dz: evalCrossDzAtOffset(ovr.segs, off), width: w, source: "例外(一致)", prevKey: key, nextKey: key, t: 0 };
  }

  // build control list from overrides
  const pts = [];
  for (const k of Object.keys(state.cross?.overrides || {})) {
    const mk = Number(k);
    if (!Number.isFinite(mk)) continue;
    const segs = state.cross.overrides[k]?.[side]?.segs;
    if (!segs?.length) continue;
    const w = computeCrossRowsFromSegs(segs).lastEnd || 0;
    if (w > 0) pts.push({ m: mk, key: k, segs, w });
  }
  pts.sort((a,b)=>a.m-b.m);

  let prev=null, next=null;
  for (const p of pts) {
    if (p.m < m - 1e-9) prev = p;
    else if (p.m > m + 1e-9) { next = p; break; }
  }

  if (prev && next) {
    const t = (m - prev.m) / Math.max(1e-9, (next.m - prev.m));
    const dz0 = evalCrossDzAtOffset(prev.segs, off);
    const dz1 = evalCrossDzAtOffset(next.segs, off);
    const w = prev.w + (next.w - prev.w) * t;
    return { dz: dz0 + (dz1 - dz0) * t, width: w, source: "擦り付け(ΔZ線形補間)", prevKey: prev.key, nextKey: next.key, t };
  }
  if (prev) {
    return { dz: evalCrossDzAtOffset(prev.segs, off), width: prev.w, source: "前の例外保持", prevKey: prev.key, nextKey: "", t: 0 };
  }
  if (next) {
    return { dz: evalCrossDzAtOffset(next.segs, off), width: next.w, source: "後の例外保持", prevKey: "", nextKey: next.key, t: 0 };
  }

  // fall back: common or width-taper based on control points
  const eff = getEffectiveCrossSegsAt(m, side);
  const w = computeCrossRowsFromSegs(eff.segs).lastEnd || (eff.info?.width||0);
  return { dz: evalCrossDzAtOffset(eff.segs, off), width: w, source: eff.info?.source ? `${eff.info.source}(${eff.info.mode||""})` : "共通", prevKey:"", nextKey:"", t:0 };
};

const buildPlanSimaText = (projectName, workPoints, keypoints, stations, segments) => {
  // ASCII-only SIMA to be safely read as Shift-JIS by legacy tools.
  const lines = [];
  const proj = normNameAscii(projectName || "ALIGN", 24);

  const points = [];
  const addPt = (name, E, N, Z=0) => {
    if (!Number.isFinite(E) || !Number.isFinite(N)) return;
    points.push({ name: normNameAscii(name, 16), E:Number(E), N:Number(N), Z:Number(Z)||0 });
  };

  // PIs
  for (const p of (workPoints||[])) addPt(p.name, p.E, p.N, 0);

  // Keypoints (TS/SC/CS/ST)
  const kps = (keypoints||[]).filter(k=>Number.isFinite(k.sta)).slice().sort((a,b)=>a.sta-b.sta);
  for (const k of kps) addPt(k.name, k.E, k.N, 0);

  // Stations (use RGm-like names)
  for (const s of (stations||[])) {
    const name = staName100(s, 3);
    const p = evalAlignment(segments, s);
    addPt(name, p.E, p.N, 0);
  }

  // Deduplicate by (name,E,N) roughly, and also keep first occurrence of names
  const seen = new Set();
  const outPts = [];
  for (const p of points) {
    const key = `${p.name}|${p.E.toFixed(6)}|${p.N.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outPts.push(p);
  }

  // Build id map
  const idOf = {};
  outPts.forEach((p,i)=>{ idOf[p.name] = i+1; });

  lines.push("Z00, /* TREND-ONE(MINOR 07.00) : BuildNo 7012 */,");
  lines.push("Z01,2,");
  lines.push("G00,03,01,");
  lines.push("Z00, /* COORDINATE DATA */,");
  lines.push("A00,");

  for (let i=0;i<outPts.length;i++) {
    const p = outPts[i];
    const id = String(i+1).padStart(5," ");
    const nm = (p.name||"P").padEnd(16," ");
    lines.push(`A01,${id},${nm},${p.E.toFixed(6)},${p.N.toFixed(6)},${p.Z.toFixed(3)},`);
  }

  lines.push("A99,");
  lines.push("Z00, /* ROUTE DATA */,");
  // Centerline with station list
  lines.push(`F00,3,1,${proj},3,`);
  lines.push("F03,   0.0000, 100.0000,  20.0000,");
  // Start
  const bpName = normNameAscii(workPoints?.[0]?.name || "BP", 16);
  const epName = normNameAscii(workPoints?.[workPoints.length-1]?.name || "EP", 16);
  if (idOf[bpName]) {
    lines.push(`B01,${String(idOf[bpName]).padStart(5," ")},${bpName},`);
    lines.push(`B03,${(0).toFixed(4).padStart(10," ")},`);
  }
  lines.push("C00,");
  for (const s of (stations||[])) {
    const nm = normNameAscii(staName100(s,3), 16);
    const pid = idOf[nm];
    if (!pid) continue;
    lines.push(`B01,${String(pid).padStart(5," ")},${nm},`);
    lines.push(`B03,${s.toFixed(4).padStart(10," ")},`);
  }
  lines.push("C99,");
  // End
  const total = stations?.length ? stations[stations.length-1] : 0;
  if (idOf[epName]) {
    lines.push(`B01,${String(idOf[epName]).padStart(5," ")},${epName},`);
    lines.push(`B03,${Number(total||0).toFixed(4).padStart(10," ")},`);
  }
  lines.push("F99,");

  return lines.join("\r\n");
};

const buildPlanXrfText = (projectName, workPoints, keypoints, stations, segments) => {
  const route = projectName ? String(projectName) : "線形";
  const nmRoute = xmlEscape(route);
  const total = segments?.length ? Number(segments[segments.length-1].s1) : 0;

  const endNO = Math.floor(total/100);
  const endAdd = total - endNO*100;
  const sub = Number(state.outputStep||20).toFixed(4);

  // element points: BP + keypoints + EP (sorted by sta)
  const epts = [];
  const pushEpt = (name, s, E, N) => {
    if (!Number.isFinite(E) || !Number.isFinite(N)) return;
    epts.push({ name: normNameAscii(name, 32), s: Number(s), E:Number(E), N:Number(N) });
  };

  if (workPoints?.length) pushEpt(workPoints[0].name, 0, workPoints[0].E, workPoints[0].N);
  for (const k of (keypoints||[])) {
    if (!Number.isFinite(k.sta)) continue;
    pushEpt(k.name, k.sta, k.E, k.N);
  }
  if (workPoints?.length) pushEpt(workPoints[workPoints.length-1].name, total, workPoints[workPoints.length-1].E, workPoints[workPoints.length-1].N);

  // dedupe by s within 1mm keeping first
  epts.sort((a,b)=>a.s-b.s);
  const epts2=[];
  for (const p of epts) {
    if (!epts2.length || Math.abs(p.s - epts2[epts2.length-1].s) > 1e-3) epts2.push(p);
  }

  const eptNameAt = (s, preferPrefix=null) => {
    const key = epts2.filter(p=>Math.abs(p.s - s) <= 1e-3);
    if (!key.length) return normNameAscii(staName100(s,3), 32);
    if (preferPrefix) {
      const f = key.find(p=>String(p.name).startsWith(preferPrefix));
      if (f) return f.name;
    }
    return key[0].name;
  };

  // PIs: work points only
  const pis = (workPoints||[]).map(p=>({ name: normNameAscii(p.name, 32), E:p.E, N:p.N }));

  // Build gm elements: include spiral/arc/straight
  const elems = [];
  let idx=1;
  for (const seg of (segments||[])) {
    if (!seg || !Number.isFinite(seg.s0) || !Number.isFinite(seg.s1)) continue;
    const s0=seg.s0, s1=seg.s1;
    const startNm = eptNameAt(s0, seg.type==="spiral" ? (seg.mode==="in" ? "TS(" : "CS(") : (seg.type==="arc" ? "SC(" : null));
    const endNm   = eptNameAt(s1, seg.type==="spiral" ? (seg.mode==="in" ? "SC(" : "ST(") : (seg.type==="arc" ? "CS(" : null));

    // RefPI: attempt from keypoint name like TS(IP.1)
    const pickPi = (nm)=> {
      const m = String(nm).match(/^[A-Z]+?\((.+?)\)$/);
      if (m) return normNameAscii(m[1], 32);
      return "";
    };
    const refPi = pickPi(startNm) || pickPi(endNm);

    if (seg.type === "arc") {
      elems.push({
        name: `CURVE${idx++}`,
        startNm, endNm, refPi,
        xml: `<rgm:Curve Direction="${seg.turnSign>0?"ccw":"cw"}" Radius="${Number(seg.R).toFixed(4)}" Length="${Number(seg.length).toFixed(4)}"/>`
      });
    } else if (seg.type === "spiral") {
      const L = Number(seg.length);
      const R = Number(seg.R);
      const A = Math.sqrt(Math.max(0, R*L));
      const sr = (seg.mode === "in") ? 0.0 : R;
      const er = (seg.mode === "in") ? R : 0.0;
      elems.push({
        name: `CLOTHOID${idx++}`,
        startNm, endNm, refPi,
        xml: `<rgm:Clothoid Direction="${seg.turnSign>0?"ccw":"cw"}" StartRadius="${sr.toFixed(4)}" EndRadius="${er.toFixed(4)}" A="${A.toFixed(4)}" Length="${L.toFixed(4)}"/>`
      });
    } else if (seg.type === "straight") {
      // NOTE: RoadGM schema usually allows Straight elements; kept for generality.
      elems.push({
        name: `LINE${idx++}`,
        startNm, endNm, refPi,
        xml: `<rgm:Line Length="${Number(seg.length).toFixed(4)}"/>`
      });
    }
  }

  const lines=[];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<tsf:TSFormControlData version="4.1" xmlns:tsf="http://www.nilim.go.jp/ts/main/TSFormControl-4.1" xmlns:rgm="http://www.nilim.go.jp/ts/main/RoadGM-1.1">');
  lines.push('\t<tsf:StructureType type="道路土工" jobName="" company="" stationType="NO"/>');
  lines.push(`\t<rgm:RoadGm RouteName="${nmRoute}" Classification="" DesignSpeed="0">`);
  lines.push('\t\t<rgm:Alignments>');
  lines.push(`\t\t\t<rgm:Alignment Name="${nmRoute}" RefCRS="" IsRiver="0">`);
  lines.push(`\t\t\t\t<rgm:Horizontal Name="${nmRoute}" StartStationNO="0" StartAddDist="0.0000" CumulativeDist="0.0000" EndStationNO="${endNO}" EndAddDist="${endAdd.toFixed(4)}" Length="${total.toFixed(4)}" Method="要素法">`);
  lines.push('\t\t\t\t\t<rgm:StationEquation>');
  lines.push(`						<rgm:Interval Main=\"100.0000\" Sub=\"${sub}\"/>`);
  lines.push('\t\t\t\t\t</rgm:StationEquation>');

  // ElementPnts
  lines.push('\t\t\t\t\t<rgm:ElementPnts>');
  for (const p of epts2) {
    lines.push(`\t\t\t\t\t\t<rgm:ElementPnt Name="${xmlEscape(p.name)}" x="${p.E.toFixed(6)}" y="${p.N.toFixed(6)}"/>`);
  }
  lines.push('\t\t\t\t\t</rgm:ElementPnts>');

  // PIs
  lines.push('\t\t\t\t\t<rgm:PIs>');
  for (const p of pis) {
    lines.push(`\t\t\t\t\t\t<rgm:PI Name="${xmlEscape(p.name)}" x="${Number(p.E).toFixed(6)}" y="${Number(p.N).toFixed(6)}"/>`);
  }
  lines.push('\t\t\t\t\t</rgm:PIs>');

  // IntermediatePnts
  lines.push('\t\t\t\t\t<rgm:IntermediatePnts>');
  for (const s of (stations||[])) {
    const p = evalAlignment(segments, s);
    const nm = staName100(s, 3);
    lines.push(`\t\t\t\t\t\t<rgm:IntermediatePnt Name="${xmlEscape(normNameAscii(nm,32))}" x="${p.E.toFixed(6)}" y="${p.N.toFixed(6)}" CumulativeDist="${Number(s).toFixed(4)}" TangentDirectionAngle="${degToDmsStr(p.az)}"/>`);
  }
  lines.push('\t\t\t\t\t</rgm:IntermediatePnts>');

  // Elements
  for (const e of elems) {
    const ref = e.refPi ? ` RefPI="${xmlEscape(e.refPi)}"` : "";
    lines.push(`\t\t\t\t\t<rgm:GmElement Name="${xmlEscape(e.name)}" StartElementPnt="${xmlEscape(e.startNm)}" EndElementPnt="${xmlEscape(e.endNm)}"${ref}>`);
    lines.push(`\t\t\t\t\t\t${e.xml}`);
    lines.push('\t\t\t\t\t</rgm:GmElement>');
  }

  lines.push('\t\t\t\t</rgm:Horizontal>');
  lines.push('\t\t\t</rgm:Alignment>');
  lines.push('\t\t</rgm:Alignments>');
  lines.push('\t</rgm:RoadGm>');
  lines.push('</tsf:TSFormControlData>');
  return lines.join("\n");
};

const downloadCSV = (rows, filename) => {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const body = rows.map(r => headers.map(h => csvEscape(r[h])).join(","));
  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};

/* ---- 測点（ピッチ表示） ---- */
const metersToStaPitch = (m, pitch, d=3) => {
  pitch = Math.max(1, Math.floor(pitch || 1));
  if (!Number.isFinite(m)) return "-";
  if (m < 0) return m.toFixed(d);
  const k = Math.floor(m / pitch);
  const rem = m - k * pitch;
  return `${k}+${rem.toFixed(d)}`;
};

const parseTokenToM = (token, pitch) => {
  pitch = Math.max(1, Math.floor(pitch || 1));
  let s = String(token ?? "").trim();
  if (!s) throw new Error("空です");
  s = s.replace(/[mMｍＭ]\s*$/, "").trim();
  if (s.includes("+")) {
    const [a, b] = s.split("+", 2);
    const k = parseNumLoose(a);
    const rem = parseNumLoose(b);
    if (!Number.isFinite(k) || !Number.isFinite(rem)) throw new Error("測点の数値が不正");
    return k * pitch + rem;
  }
  const mv = parseNumLoose(s);
  if (!Number.isFinite(mv)) throw new Error("数値が不正");
  return mv;
};


// Parse STA token in pitch-based style: "2+0" => 2*pitch + 0 (pitch m)
// Accepts optional "STA" prefix and "k-rem" (e.g., "-1-2.5") forms
const parseStaPitch = (token, pitch) => {
  pitch = Math.max(1, Math.floor(pitch || 1));
  let s = String(token ?? "").trim();
  if (!s) throw new Error("STAが空です");
  s = s.replace(/[mMｍＭ]\s*$/, "").trim();
  s = s.replace(/^STA\.?/i, "").trim();

  if (s.includes("+")) {
    const [a, b] = s.split("+", 2);
    const k = parseNumLoose(a);
    const rem = parseNumLoose(b);
    if (!Number.isFinite(k) || !Number.isFinite(rem)) throw new Error("STA形式が不正です");
    return k * pitch + rem;
  }

  // allow "k-rem" (rem is positive)
  const mm = s.match(/^(-?\d+(?:\.\d+)?)[-－−](\d+(?:\.\d+)?)$/);
  if (mm) {
    const k = parseNumLoose(mm[1]);
    const rem = parseNumLoose(mm[2]);
    if (!Number.isFinite(k) || !Number.isFinite(rem)) throw new Error("STA形式が不正です");
    return k * pitch - rem;
  }

  const mv = parseNumLoose(s);
  if (!Number.isFinite(mv)) throw new Error("数値が不正です");
  return mv;
};


const setOrNull = (v)=> {
  const t = String(v ?? "").trim();
  if (t === "") return null;
  const n = parseFloat(t.replace(/,/g,"."));
  return Number.isFinite(n) ? n : null;
};

/* ---- 追加測点（タブ別） ---- */
const EXTRA_GROUPS = ["plan","profile","cross","output"];

const ensureExtraState = ()=> {
  state.extraStations = state.extraStations || {};
  state.nextExtraId = state.nextExtraId || {};
  for (const k of EXTRA_GROUPS) {
    if (!Array.isArray(state.extraStations[k])) state.extraStations[k] = [];
    if (!Number.isFinite(state.nextExtraId[k])) {
      const mx = Math.max(0, ...state.extraStations[k].map(r=>r.id||0));
      state.nextExtraId[k] = mx + 1;
    }
  }
};

const addExtrasFromText = (groupKey, text, pitch)=> {
  ensureExtraState();
  const parts = (String(text||"").trim())
    .split(/[\s,]+/)
    .map(s=>s.trim())
    .filter(Boolean);
  const errs = [];
  for (const tok of parts) {
    try {
      const mv = parseTokenToM(tok, pitch);
      state.extraStations[groupKey].push({ id: state.nextExtraId[groupKey]++, m: mv });
    } catch(e) {
      errs.push(`${tok}: ${e.message || e}`);
    }
  }
  return errs;
};

const bindExtraUI = (groupKey, rootEl, pitch)=> {
  ensureExtraState();
  const addBtn = document.getElementById(`addExtras_${groupKey}`);
  const ta = document.getElementById(`extraTokens_${groupKey}`);
  const clearBtn = document.getElementById(`clearExtras_${groupKey}`);

  if (addBtn && ta) {
    addBtn.onclick = ()=> {
      const txt = (ta.value||"").trim();
      if (!txt) return;
      const errs = addExtrasFromText(groupKey, txt, pitch);
      ta.value = "";
      saveState();
      if (errs.length) alert("追加エラー:\n" + errs.join("\n"));
      render();
    };
  }
  if (clearBtn) {
    clearBtn.onclick = ()=> {
      state.extraStations[groupKey] = [];
      state.nextExtraId[groupKey] = 1;
      saveState();
      render();
    };
  }

  if (!rootEl) return;
  rootEl.querySelectorAll(`input[data-ex-group="${groupKey}"][data-ex-id]`).forEach(inp=>{
    const id = parseInt(inp.getAttribute("data-ex-id"),10);
    const commit = (e)=>{
      const row = state.extraStations[groupKey].find(x=>x.id===id);
      if (!row) return;
      const t = String(e.target.value ?? "").trim();
      if (t === "") { render(); return; }
      const n = parseFloat(t.replace(/,/g,"."));
      if (!Number.isFinite(n)) { render(); return; }
      row.m = n;
      saveState();
      render();
    };
    inp.onchange = commit;
    inp.onblur = commit;
  });
  rootEl.querySelectorAll(`button[data-ex-del][data-ex-group="${groupKey}"]`).forEach(btn=>{
    const id = parseInt(btn.getAttribute("data-ex-del"),10);
    btn.onclick = ()=>{
      state.extraStations[groupKey] = state.extraStations[groupKey].filter(x=>x.id!==id);
      saveState();
      render();
    };
  });
};



/* =========================
   Cross slope (横断)
========================= */
const ensureCrossState = ()=>{
  if (!state.cross || typeof state.cross !== 'object' || Array.isArray(state.cross)) {
    state.cross = {
      enabled: true,
      taper: { enabled: true, anchorRight: 3.000, anchorLeft: 3.000 },
      right: { segs: [], nextSegId: 1 },
      left:  { segs: [], nextSegId: 1 },
      overrides: {},
      ui: { selectedStaKey: "", previewTok: "" },
    };
  }
  if (!state.cross.overrides || typeof state.cross.overrides !== 'object' || Array.isArray(state.cross.overrides)) {
    state.cross.overrides = {};
  }
  if (!state.cross.ui || typeof state.cross.ui !== 'object' || Array.isArray(state.cross.ui)) {
    state.cross.ui = { selectedStaKey: "" };
  }
  if (typeof state.cross.ui.selectedStaKey !== "string") state.cross.ui.selectedStaKey = "";
  if (typeof state.cross.ui.elemMode !== "string") state.cross.ui.elemMode = "common";
  if (typeof state.cross.ui.overrideSel !== "string") state.cross.ui.overrideSel = "";
  if (typeof state.cross.ui.editStaTok !== "string") state.cross.ui.editStaTok = "";
  if (typeof state.cross.ui.standardEditStaTok !== "string") state.cross.ui.standardEditStaTok = "";
  if (!Array.isArray(state.cross.ui.drawingStaList)) state.cross.ui.drawingStaList = [];


  if (state.cross.ui.elemMode !== "common" && state.cross.ui.elemMode !== "override") state.cross.ui.elemMode = "common";
  if (typeof state.cross.ui.editStaTok !== "string") state.cross.ui.editStaTok = "";
  if (typeof state.cross.ui.queryTok !== "string") state.cross.ui.queryTok = "";

  // taper
  if (!state.cross.taper || typeof state.cross.taper !== 'object' || Array.isArray(state.cross.taper)) {
    state.cross.taper = { enabled: true, anchorRight: 3.000, anchorLeft: 3.000 };
  }
  if (typeof state.cross.taper.enabled !== 'boolean') state.cross.taper.enabled = true;
  if (!Number.isFinite(Number(state.cross.taper.anchorRight))) state.cross.taper.anchorRight = 3.000;
  if (!Number.isFinite(Number(state.cross.taper.anchorLeft))) state.cross.taper.anchorLeft = 3.000;

  if (typeof state.cross.ui.previewTok !== 'string') state.cross.ui.previewTok = "";

  const ensureSide = (obj)=>{
    obj = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : { segs: [], nextSegId: 1 };
    if (!Array.isArray(obj.segs)) obj.segs = [];
    
    obj.segs = obj.segs.map((r, idx)=>({
      id: (r && Number.isFinite(r.id)) ? r.id : (idx + 1),
      end: Number(r && r.end),
      mode: (r && (r.mode === 'pct' || r.mode === 'ratio')) ? r.mode : 'pct',
      slopePct: Number.isFinite(Number(r && r.slopePct)) ? Number(r.slopePct) : 0,
      wb: (r && typeof r.wb === 'string') ? r.wb : "",
      ratioX: (r && Number.isFinite(Number(r.ratioX)) && Number(r.ratioX) > 0) ? Number(r.ratioX) : 20,
      ratioDir: (r && (r.ratioDir === 'up' || r.ratioDir === 'down')) ? r.ratioDir : ((Number(r && r.slopePct)||0) >= 0 ? 'up' : 'down'),
      stepDir: (r && (r.stepDir === 'up' || r.stepDir === 'down')) ? r.stepDir : ((Number(r && r.stepDz)||0) < 0 ? 'down' : 'up'),
      stepAbsText: (r && typeof r.stepAbsText === 'string') ? r.stepAbsText : (Number.isFinite(Number(r && r.stepDz)) ? String(Math.abs(Number(r.stepDz))) : "0.000"),
      stepDz: Number.isFinite(Number(r && r.stepDz)) ? Number(r.stepDz) : 0,
    }));
if (!Number.isFinite(obj.nextSegId)) {
      const mx = Math.max(0, ...obj.segs.map(r=>r.id||0));
      obj.nextSegId = mx + 1;
    }
    return obj;
  };

  state.cross.right = ensureSide(state.cross.right);
  state.cross.left  = ensureSide(state.cross.left);

  for (const k of Object.keys(state.cross.overrides)) {
    const ov = state.cross.overrides[k];
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) { delete state.cross.overrides[k]; continue; }
    ov.right = ensureSide(ov.right);
    ov.left  = ensureSide(ov.left);
  }

  const sel = state.cross.ui.selectedStaKey;
  if (sel && !state.cross.overrides[sel]) state.cross.ui.selectedStaKey = "";

  // --- Phase1: xrange/base + elements (v18.10.35) ---
  if (!state.cross.xrangeDefault || typeof state.cross.xrangeDefault !== 'object' || Array.isArray(state.cross.xrangeDefault)) {
    // default clip range equals current lastEnd
    const cr0 = computeCrossRowsFromSegs(state.cross.right?.segs||[]);
    const cl0 = computeCrossRowsFromSegs(state.cross.left?.segs||[]);
    state.cross.xrangeDefault = { L: Number.isFinite(cl0.lastEnd)? cl0.lastEnd : 5.0, R: Number.isFinite(cr0.lastEnd)? cr0.lastEnd : 5.0 };
  }
  if (!Number.isFinite(Number(state.cross.xrangeDefault.L)) || Number(state.cross.xrangeDefault.L) <= 0) state.cross.xrangeDefault.L = 5.0;
  if (!Number.isFinite(Number(state.cross.xrangeDefault.R)) || Number(state.cross.xrangeDefault.R) <= 0) state.cross.xrangeDefault.R = 5.0;

  if (!state.cross.xrangeOverrides || typeof state.cross.xrangeOverrides !== 'object' || Array.isArray(state.cross.xrangeOverrides)) state.cross.xrangeOverrides = {};

  if (!state.cross.baseDefault || typeof state.cross.baseDefault !== 'object' || Array.isArray(state.cross.baseDefault)) state.cross.baseDefault = { type: "CL" };
  if (typeof state.cross.baseDefault.type !== 'string') state.cross.baseDefault.type = "CL";
  if (!state.cross.baseOverrides || typeof state.cross.baseOverrides !== 'object' || Array.isArray(state.cross.baseOverrides)) state.cross.baseOverrides = {};

  if (!state.cross.elemCommon || typeof state.cross.elemCommon !== 'object' || Array.isArray(state.cross.elemCommon)) {
    state.cross.elemCommon = { right:{ items:[], nextId:1 }, left:{ items:[], nextId:1 } };
  }
  const ensureElemSide = (sideKey)=>{
    const es = state.cross.elemCommon[sideKey];
    if (!es || typeof es !== 'object' || Array.isArray(es)) state.cross.elemCommon[sideKey] = { items:[], nextId:1 };
    if (!Array.isArray(state.cross.elemCommon[sideKey].items)) state.cross.elemCommon[sideKey].items = [];
    if (!Number.isFinite(Number(state.cross.elemCommon[sideKey].nextId))) {
      const mx = Math.max(0, ...state.cross.elemCommon[sideKey].items.map(it=>Number(it?.id)||0));
      state.cross.elemCommon[sideKey].nextId = mx + 1;
    }
  };
  ensureElemSide('right'); ensureElemSide('left');

  if (!state.cross.templates || typeof state.cross.templates !== 'object' || Array.isArray(state.cross.templates)) {
    state.cross.templates = { items: [], nextId: 1 };
  }
};

// =========================
// Cross (Phase1): Elements
// =========================
const CROSS_ELEM_TYPES = { PAV:'PAV', STEP:'STEP', SLOPE_H:'SLOPE_H', SLOPE_EXT:'SLOPE_EXT', FLAT:'FLAT' };

const parseNumSafe = (v)=>{ const n = Number(String(v??'').trim()); return Number.isFinite(n) ? n : null; };

const slopePctFromRatioX = (x)=> (x>0 ? (100.0 / x) : 0);

const buildElemFromSegs = (segs)=>{
  const out = [];
  segs = (Array.isArray(segs)?segs:[]).slice().sort((a,b)=>{
    const ea = Number(a?.end)||0, eb = Number(b?.end)||0;
    if (Math.abs(ea-eb)>1e-12) return ea-eb;
    return (Number(a?.id)||0)-(Number(b?.id)||0);
  });
  let x0 = 0;
  for (const r of segs) {
    const end = Number(r?.end);
    if (!Number.isFinite(end) || end<=0) continue;
    const span = end - x0;
    const slope = crossRowSlopePct(r);
    const stepDz = crossRowStepDz(r);
    if (span > 1e-9) {
      out.push({ id: out.length+1, type: 'PAV', L: span, pctText: slope.toFixed(3) });
    }
    if (Number.isFinite(stepDz) && Math.abs(stepDz) > 0) {
      out.push({ id: out.length+1, type: 'STEP', dzText: Math.abs(stepDz).toFixed(3), dir: (stepDz<0?'down':'up') });
    }
    x0 = end;
  }
  return out;
};

const ensureElemCommonInitialized = ()=>{
  ensureCrossState();
  const r = state.cross.elemCommon?.right?.items || [];
  const l = state.cross.elemCommon?.left?.items || [];
  if (!r.length && Array.isArray(state.cross.right?.segs) && state.cross.right.segs.length) {
    state.cross.elemCommon.right.items = buildElemFromSegs(state.cross.right.segs);
    state.cross.elemCommon.right.nextId = Math.max(0, ...state.cross.elemCommon.right.items.map(it=>it.id||0)) + 1;
  }
  if (!l.length && Array.isArray(state.cross.left?.segs) && state.cross.left.segs.length) {
    state.cross.elemCommon.left.items = buildElemFromSegs(state.cross.left.segs);
    state.cross.elemCommon.left.nextId = Math.max(0, ...state.cross.elemCommon.left.items.map(it=>it.id||0)) + 1;
  }
};

const getXrangeForStaKey = (staKey)=>{
  ensureCrossState();
  const d = state.cross.xrangeDefault || {L:5,R:5};
  const ov = (staKey && state.cross.xrangeOverrides && state.cross.xrangeOverrides[staKey]) ? state.cross.xrangeOverrides[staKey] : null;
  const L = Number.isFinite(Number(ov?.L)) ? Number(ov.L) : Number(d.L);
  const R = Number.isFinite(Number(ov?.R)) ? Number(ov.R) : Number(d.R);
  return { L: Math.max(0, L), R: Math.max(0, R), source: ov ? 'override' : 'default' };
};

const elemsToSegs = (items, sideKey, widthLimit)=>{
  items = Array.isArray(items) ? items : [];
  const segs = [];
  let id = 1;
  let end = 0;
  const clampEnd = (e)=> (Number.isFinite(widthLimit) && widthLimit>0 ? Math.min(e, widthLimit) : e);

  // helper to push a span segment
  const pushSpan = (L, slopePct, src)=>{
    const nL = Number(L);
    if (!Number.isFinite(nL) || nL <= 0) return;
    const newEnd = clampEnd(end + nL);
    if (newEnd <= end + 1e-12) return;
    segs.push({ id: id++, end: newEnd, mode:'pct', slopePct: Number(slopePct)||0, src: src||'SPAN', wb:'', ratioX:20, ratioDir: ((Number(slopePct)||0)>=0?'up':'down'), stepDir:'up', stepAbsText:'0.000', stepDz:0 });
    end = newEnd;
  };
  const pushStep = (dz, dir)=>{
    const n = Number(dz);
    if (!Number.isFinite(n) || n===0) return;
    const signed = (dir==='down') ? -Math.abs(n) : Math.abs(n);
    segs.push({ id: id++, end: clampEnd(end), mode:'pct', slopePct: (segs.length?segs[segs.length-1].slopePct:0), src:'STEP', wb:'', ratioX:20, ratioDir: ((segs.length?segs[segs.length-1].slopePct:0)>=0?'up':'down'),
      stepDir: (dir==='down'?'down':'up'), stepAbsText: Math.abs(n).toFixed(3), stepDz: signed });
  };

  // Build until widthLimit reached
  for (let i=0;i<items.length;i++){
    const it = items[i] || {};
    if (Number.isFinite(widthLimit) && widthLimit>0 && end >= widthLimit - 1e-9) break;

    if (it.type==='PAV' || it.type==='FLAT'){
      const pct = (it.type==='FLAT') ? 0 : (parseNumSafe(it.pctText) ?? 0);
      pushSpan(parseNumSafe(it.L) ?? 0, pct, (it.type==='FLAT')?'PAV':'PAV');
      continue;
    }
    if (it.type==='STEP'){
      const dz = parseNumSafe(it.dzText) ?? 0;
      const dir = (it.dir==='down')?'down':'up';
      pushStep(dz, dir);
      continue;
    }
    if (it.type==='SLOPE_H'){
      const x = parseNumSafe(it.ratioX) ?? 0;
      const H = parseNumSafe(it.H) ?? 0;
      const dir = (it.dir==='down')?'down':'up';
      if (x>0 && H>0){
        const pctAbs = slopePctFromRatioX(x);
        const pct = (dir==='down') ? -pctAbs : pctAbs;
        pushSpan(H*x, pct, 'SLOPE');
      }
      continue;
    }
    if (it.type==='SLOPE_EXT'){
      // handled after loop as extension
      continue;
    }
  }

  // extension: if last is SLOPE_EXT and end < widthLimit
  const last = items.length ? items[items.length-1] : null;
  if (last && last.type==='SLOPE_EXT' && Number.isFinite(widthLimit) && widthLimit>0 && end < widthLimit - 1e-9){
    const x = parseNumSafe(last.ratioX) ?? 0;
    const dir = (last.dir==='down')?'down':'up';
    if (x>0){
      const pctAbs = slopePctFromRatioX(x);
      const pct = (dir==='down') ? -pctAbs : pctAbs;
      pushSpan(widthLimit - end, pct, 'SLOPE');
    }
  } else {
    // If no explicit EXT, optionally extend with last slope? (Phase1: do not)
  }

  // guarantee last end equals widthLimit if widthLimit is set and segs exist
  if (Number.isFinite(widthLimit) && widthLimit>0 && segs.length){
    const lastEnd = segs[segs.length-1].end;
    if (lastEnd < widthLimit - 1e-6){
      // keep flat extension? no (Phase1)
    }
  }

  return segs;
};

// Elem overrides (station-specific element editing). Stored separately from seg tables.
const ensureElemOverrideInitialized = (staKey)=>{
  ensureCrossOverride(staKey);
  if (!state.cross.elemOverrides || typeof state.cross.elemOverrides !== 'object' || Array.isArray(state.cross.elemOverrides)) {
    state.cross.elemOverrides = {};
  }
  if (!state.cross.elemOverrides[staKey]) {
    state.cross.elemOverrides[staKey] = { right:{ items:[], nextId:1 }, left:{ items:[], nextId:1 } };
  }
  for (const side of ["right","left"]) {
    if (!state.cross.elemOverrides[staKey][side] || typeof state.cross.elemOverrides[staKey][side] !== 'object') {
      state.cross.elemOverrides[staKey][side] = { items:[], nextId:1 };
    }
    if (!Array.isArray(state.cross.elemOverrides[staKey][side].items)) state.cross.elemOverrides[staKey][side].items = [];
    if (!state.cross.elemOverrides[staKey][side].items.length && Array.isArray(state.cross.overrides?.[staKey]?.[side]?.segs) && state.cross.overrides[staKey][side].segs.length) {
      state.cross.elemOverrides[staKey][side].items = buildElemFromSegs(state.cross.overrides[staKey][side].segs);
      state.cross.elemOverrides[staKey][side].nextId = Math.max(0, ...state.cross.elemOverrides[staKey][side].items.map(it=>it.id||0)) + 1;
    } else if (!Number.isFinite(Number(state.cross.elemOverrides[staKey][side].nextId))) {
      state.cross.elemOverrides[staKey][side].nextId = Math.max(0, ...state.cross.elemOverrides[staKey][side].items.map(it=>it.id||0)) + 1;
    }
  }
};

const getActiveElemMode = ()=> (state.cross.ui?.elemMode === "override") ? "override" : "common";
const getActiveStaKeyForElem = ()=> (getActiveElemMode()==="override") ? String(state.cross.ui?.selectedStaKey||"").trim() : "";
const getActiveElemStore = (side)=>{
  if (getActiveElemMode()==="override") {
    const k = getActiveStaKeyForElem();
    if (!k) return null;
    ensureElemOverrideInitialized(k);
    return state.cross.elemOverrides[k][side];
  }
  ensureElemCommonInitialized();
  return state.cross.elemCommon?.[side];
};

const syncCrossCommonSegsFromElems = ()=>{
  ensureElemCommonInitialized();
  const xr = getXrangeForStaKey(null);
  state.cross.right.segs = elemsToSegs(state.cross.elemCommon.right.items, 'right', xr.R);
  state.cross.left.segs  = elemsToSegs(state.cross.elemCommon.left.items,  'left',  xr.L);
  state.cross.right.nextSegId = Math.max(0, ...state.cross.right.segs.map(r=>r.id||0)) + 1;
  state.cross.left.nextSegId  = Math.max(0, ...state.cross.left.segs.map(r=>r.id||0)) + 1;
};

const syncCrossOverrideSegsFromElems = (staKey)=>{
  ensureElemOverrideInitialized(staKey);
  const xr = getXrangeForStaKey(staKey);
  const ovr = state.cross.overrides[staKey];
  ovr.right.segs = elemsToSegs(state.cross.elemOverrides[staKey].right.items, 'right', xr.R);
  ovr.left.segs  = elemsToSegs(state.cross.elemOverrides[staKey].left.items,  'left',  xr.L);
  ovr.right.nextSegId = Math.max(0, ...ovr.right.segs.map(r=>r.id||0)) + 1;
  ovr.left.nextSegId  = Math.max(0, ...ovr.left.segs.map(r=>r.id||0)) + 1;
};

const syncCrossActiveSegsFromElems = ()=>{
  if (getActiveElemMode()==="override") {
    const k = getActiveStaKeyForElem();
    if (!k) return;
    syncCrossOverrideSegsFromElems(k);
  } else {
    syncCrossCommonSegsFromElems();
  }
};



const renderCrossElemListHtml = (sideKey)=>{
  const store = getActiveElemStore(sideKey);
  const items = store?.items || [];
  const selId = Number(state.cross.ui?.elemSel?.[sideKey] || 0);

  const optType = (v)=>[
    ['PAV','路面(%)'],['STEP','段差'],['SLOPE_H','法面(H)'],['SLOPE_EXT','法面(延長)'],['FLAT','水平(0%)']
  ].map(([k,l])=>`<option value="${k}" ${v===k?'selected':''}>${l}</option>`).join('');

  const dirSel = (v)=>`<option value="up" ${v==='up'?'selected':''}>上</option><option value="down" ${v==='down'?'selected':''}>下</option>`;

  const rowHtml = (it)=>{
    const id = Number(it?.id)||0;
    const type = String(it?.type||'PAV');
    const selClass = (id===selId) ? ' style="outline:2px solid var(--accent); border-radius:12px; padding:8px;"' : ' style="padding:8px;"';
    let inputs = '';
    if (type==='PAV'){
      inputs = `
        <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
          <div style="width:120px;"><label>長さL(m)</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="L" type="number" step="0.001" value="${Number(it?.L||0).toFixed(3)}"/></div>
          <div style="width:120px;"><label>勾配(%)</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="pctText" type="text" inputmode="decimal" value="${escHtml(String(it?.pctText??'0.000'))}"/></div>
        </div>`;
    } else if (type==='FLAT'){
      inputs = `
        <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
          <div style="width:120px;"><label>長さL(m)</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="L" type="number" step="0.001" value="${Number(it?.L||0).toFixed(3)}"/></div>
          <div class="mini" style="margin-bottom:10px;">0%</div>
        </div>`;
    } else if (type==='STEP'){
      inputs = `
        <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
          <div style="width:120px;"><label>段差ΔZ(m)</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="dzText" type="text" inputmode="decimal" value="${escHtml(String(it?.dzText??'0.000'))}"/></div>
          <div style="width:120px;"><label>方向</label><select class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="dir">${dirSel(it?.dir||'up')}</select></div>
        </div>`;
    } else if (type==='SLOPE_H'){
      inputs = `
        <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
          <div style="width:120px;"><label>法面 1:X</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="ratioX" type="number" step="0.001" value="${Number(it?.ratioX||1.5)}"/></div>
          <div style="width:120px;"><label>高さH(m)</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="H" type="number" step="0.001" value="${Number(it?.H||1.0)}"/></div>
          <div style="width:120px;"><label>方向</label><select class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="dir">${dirSel(it?.dir||'down')}</select></div>
        </div>`;
    } else if (type==='SLOPE_EXT'){
      inputs = `
        <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
          <div style="width:120px;"><label>法面 1:X</label><input class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="ratioX" type="number" step="0.001" value="${Number(it?.ratioX||1.5)}"/></div>
          <div style="width:120px;"><label>方向</label><select class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="dir">${dirSel(it?.dir||'down')}</select></div>
          <div class="mini" style="margin-bottom:10px;">横断範囲まで延長</div>
        </div>`;
    }

    return `
      <div class="xsRow" data-id="${id}" ${selClass}>
        <div style="display:flex; gap:10px; align-items:flex-start;">
          <div class="xsDragIcon" aria-hidden="true" style="width:34px; text-align:center; padding:6px 10px; color:var(--muted); border:1px solid var(--line); border-radius:10px; background:#fff;">≡</div>
          <div style="flex:1;">
            <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
              <div style="width:160px;">
                <label>種類</label>
                <select class="xsElInput" data-xs-side="${sideKey}" data-xs-id="${id}" data-xs-field="type">
                  ${optType(type)}
                </select>
              </div>
              <div style="flex:1; min-width:260px;">
                ${inputs}
              </div>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; width:90px;">
            <button class="btn btn-ghost" type="button" data-xs-act="dup" data-xs-side="${sideKey}" data-xs-id="${id}" style="width:auto;">複製</button>
            <button class="btn btn-ghost" type="button" data-xs-act="del" data-xs-side="${sideKey}" data-xs-id="${id}" style="width:auto;">削除</button>
          </div>
        </div>
      </div>
    `;
  };

  return items.map(rowHtml).join('') || `<div class="mini" style="padding:8px;">（まだエレメントがありません。下の＋ボタンで追加）</div>`;
};

// Drag reorder (disabled on iPhone/iPad Safari for input stability)
const enableElemDrag = (sideKey)=>{ /* no-op */ };

const cloneCrossSide = (src)=>{
  const segs = (src?.segs || []).map((r, i)=>({
    id: i + 1,
    end: Number(r?.end) || 0,
    mode: (r && typeof r.mode === 'string') ? r.mode : 'pct',
    slopePct: Number(r?.slopePct) || 0,
    ratioX: Number.isFinite(Number(r?.ratioX)) ? Number(r.ratioX) : 20,
    ratioDir: (r && (r.ratioDir === 'up' || r.ratioDir === 'down')) ? r.ratioDir : ((Number(r?.slopePct)||0) >= 0 ? 'up' : 'down'),
    stepDz: Number(r?.stepDz) || 0,
  })).filter(r => Number.isFinite(r.end) && r.end > 0);
  const mx = Math.max(0, ...segs.map(r=>r.id||0));
  return { segs, nextSegId: mx + 1 };
};

const ensureCrossOverride = (staKey)=>{
  ensureCrossState();
  if (!staKey) return;
  if (!state.cross.overrides[staKey]) {
    state.cross.overrides[staKey] = {
      right: cloneCrossSide(state.cross.right),
      left:  cloneCrossSide(state.cross.left),
    };
  }
  const ov = state.cross.overrides[staKey];
  if (!ov.right) ov.right = cloneCrossSide(state.cross.right);
  if (!ov.left)  ov.left  = cloneCrossSide(state.cross.left);
};

const getCrossStore = (scope, side, staKey)=>{
  ensureCrossState();
  if (scope === "ovr") {
    ensureCrossOverride(staKey);
    return state.cross.overrides[staKey][side];
  }
  return state.cross[side];
};

const sortCrossSegs = (scope, side, staKey)=>{
  const store = getCrossStore(scope, side, staKey);
  store.segs.sort((a,b)=> (Number(a.end)||0) - (Number(b.end)||0));
};

const normalizeCrossToOuterEnd = (store, endVal)=>{
  endVal = Number(endVal);
  if (!Number.isFinite(endVal) || endVal <= 0) return;

  store.segs = Array.isArray(store.segs) ? store.segs.slice() : [];
  store.segs = store.segs
    .map((r, idx)=>{
      const id = (r && Number.isFinite(r.id)) ? r.id : (idx + 1);
      const end = Number(r && r.end);
      const slopePct = Number.isFinite(Number(r && r.slopePct)) ? Number(r.slopePct) : 0;
      const mode = (r && typeof r.mode === 'string') ? r.mode : 'pct';
      const ratioX = Number.isFinite(Number(r && r.ratioX)) ? Number(r.ratioX) : 20;
      const ratioDir = (r && (r.ratioDir === 'up' || r.ratioDir === 'down')) ? r.ratioDir : (slopePct >= 0 ? 'up' : 'down');
      const stepDz = Number.isFinite(Number(r && r.stepDz)) ? Number(r.stepDz) : 0;
      return { id, end, mode, slopePct, ratioX, ratioDir, stepDz };
    })
    .filter(r => Number.isFinite(r.end) && r.end > 0);

  store.segs.sort((a,b)=>a.end-b.end);

  // endVal より外側の区間は削除
  store.segs = store.segs.filter(r => r.end <= endVal + 1e-9);

  if (!store.segs.length) {
    store.segs = [{ id: 1, end: Number(endVal.toFixed(3)), mode: 'pct', slopePct: 0.0, ratioX: 20, ratioDir: 'down', stepDz: 0 }];
    store.nextSegId = 2;
    return;
  }

  const last = store.segs[store.segs.length - 1];
  const prevEnd = (store.segs.length >= 2) ? store.segs[store.segs.length - 2].end : 0;
  last.end = Number(Math.max(endVal, prevEnd).toFixed(3));

  const mx = Math.max(0, ...store.segs.map(r=>r.id||0));
  if (!Number.isFinite(store.nextSegId)) store.nextSegId = mx + 1;
  store.nextSegId = Math.max(store.nextSegId, mx + 1);
};

const applyCrossOuterEnd = (rightEnd, leftEnd, affectOverrides)=>{
  ensureCrossState();
  // Phase1: treat as clip range (xrange)
  const r = Number(rightEnd);
  const l = Number(leftEnd);
  if (Number.isFinite(r) && r > 0) state.cross.xrangeDefault.R = r;
  if (Number.isFinite(l) && l > 0) state.cross.xrangeDefault.L = l;

  if (affectOverrides) {
    for (const k of Object.keys(state.cross.overrides || {})) {
      // store per-station clip range (safe, no geometry rewrite)
      state.cross.xrangeOverrides[k] = { L: state.cross.xrangeDefault.L, R: state.cross.xrangeDefault.R };
    }
  }
  // Rebuild common segs to match clip range
  syncCrossActiveSegsFromElems();
};

const computeCrossSide = (scope, side, staKey)=>{
  const store = getCrossStore(scope, side, staKey);
  const segs = (store.segs||[]).slice().sort((a,b)=>{
    const ea = Number(a && a.end) || 0;
    const eb = Number(b && b.end) || 0;
    if (Math.abs(ea-eb) > 1e-12) return ea-eb;
    return (Number(a && a.id)||0) - (Number(b && b.id)||0);
  });
  const warnings = [];
  let start = 0;
  let z = 0;
  const rows = [];

  for (const r of segs) {
    const end = Number(r && r.end);
    const slopePct = crossRowSlopePct(r);
    const stepDz = crossRowStepDz(r);
    if (!Number.isFinite(end) || end <= 0) { warnings.push('end<=0 の行があります'); continue; }
    const span = end - start;
    if (span < -1e-9) { warnings.push('距離が昇順ではありません'); continue; }
    if (Math.abs(span) < 1e-9 && !(Number.isFinite(stepDz) && Math.abs(stepDz) > 0)) { warnings.push('同一距離(end)の行があります'); }

    const dzSlope = (slopePct/100.0) * span;
    z += dzSlope;
    if (Number.isFinite(stepDz) && Math.abs(stepDz) > 0) z += stepDz;

    rows.push({ id: r.id, start, end, mode: (r&&r.mode)||'pct', slopePct, ratioX: r?.ratioX, ratioDir: r?.ratioDir, stepDz, span, dzSlope, zEnd: z, src: r?.src });
    start = end;
  }
  return { rows, lastEnd: start, lastZ: z, warnings };
};


// ---- Cross taper + preview ----
const computeCrossRowsFromSegs = (segs)=>{
  segs = (Array.isArray(segs)?segs:[]).slice().sort((a,b)=>{
    const ea = Number(a && a.end) || 0;
    const eb = Number(b && b.end) || 0;
    if (Math.abs(ea-eb) > 1e-12) return ea-eb;
    return (Number(a && a.id)||0) - (Number(b && b.id)||0);
  });
  const warnings = [];
  let start = 0;
  let z = 0;
  const rows = [];
  for (const r of segs) {
    const end = Number(r && r.end);
    const slopePct = crossRowSlopePct(r);
    const stepDz = crossRowStepDz(r);
    if (!Number.isFinite(end) || end <= 0) { warnings.push('end<=0 の行があります'); continue; }
    const span = end - start;
    if (span < -1e-9) { warnings.push('距離が昇順ではありません'); continue; }
    if (Math.abs(span) < 1e-9 && !(Number.isFinite(stepDz) && Math.abs(stepDz) > 0)) { warnings.push('同一距離(end)の行があります'); }
    const dzSlope = (slopePct/100.0) * span;
    z += dzSlope;
    if (Number.isFinite(stepDz) && Math.abs(stepDz) > 0) z += stepDz;
    rows.push({ start, end, slopePct, stepDz, dzSlope, zEnd: z, src: r?.src });
    start = end;
  }
  return { rows, lastEnd: start, lastZ: z, warnings };
};

const getCrossControlPoints = (side)=>{
  ensureCrossState();
  const pts = [];
  for (const k of Object.keys(state.cross.overrides||{})) {
    const m = Number(k);
    if (!Number.isFinite(m)) continue;
    const ov = state.cross.overrides[k];
    const store = ov && ov[side];
    const c = computeCrossRowsFromSegs(store?.segs||[]);
    if (Number.isFinite(c.lastEnd) && c.lastEnd > 0) pts.push({ m, w: c.lastEnd });
  }
  pts.sort((a,b)=>a.m-b.m);
  return pts;
};

const getCrossWidthAt = (m, side)=>{
  ensureCrossState();
  const base = computeCrossRowsFromSegs(state.cross[side]?.segs||[]);
  const baseW = base.lastEnd || 0;
  const pts = getCrossControlPoints(side);
  const mk = Number(Number(m).toFixed(3));

  for (const p of pts) {
    if (Math.abs(p.m - mk) < 1e-6) return { w: p.w, mode: '制御点', prev: p, next: p, baseW };
  }

  let prev = null, next = null;
  for (const p of pts) {
    if (p.m < mk) prev = p;
    else if (p.m > mk) { next = p; break; }
  }

  if (prev && next) {
    const t = (mk - prev.m) / Math.max(1e-9, (next.m - prev.m));
    return { w: prev.w + (next.w - prev.w)*t, mode: '線形補間', prev, next, baseW };
  }
  if (prev) return { w: prev.w, mode: '前の制御点保持', prev, next, baseW };
  if (next) return { w: next.w, mode: '後の制御点保持', prev, next, baseW };
  return { w: baseW, mode: '共通', prev, next, baseW };
};

const widenCrossSegsFromCommon = (commonSegs, targetW, anchor)=>{
  commonSegs = (Array.isArray(commonSegs)?commonSegs:[]).slice().sort((a,b)=>{
    const ea = Number(a && a.end) || 0;
    const eb = Number(b && b.end) || 0;
    if (Math.abs(ea-eb) > 1e-12) return ea-eb;
    return (Number(a && a.id)||0) - (Number(b && b.id)||0);
  });
  const base = computeCrossRowsFromSegs(commonSegs);
  const baseW = base.lastEnd || 0;
  targetW = Number(targetW);
  if (!Number.isFinite(targetW) || targetW <= 0) targetW = baseW;

  anchor = Number(anchor);
  if (!Number.isFinite(anchor) || anchor < 0) anchor = 0;

  // targetW が anchor より小さい場合は anchor にクランプ
  if (targetW < anchor) targetW = anchor;

  const delta = targetW - baseW;

  const cloneSeg = (src, end, keepStep)=>({
    end: Number(end),
    mode: (src && typeof src.mode === 'string') ? src.mode : 'pct',
    slopePct: Number(src && src.slopePct) || 0,
    ratioX: Number.isFinite(Number(src && src.ratioX)) ? Number(src.ratioX) : 20,
    ratioDir: (src && (src.ratioDir === 'up' || src.ratioDir === 'down')) ? src.ratioDir : ((Number(src && src.slopePct)||0) >= 0 ? 'up' : 'down'),
    stepDz: keepStep ? (Number(src && src.stepDz) || 0) : 0,
  });

  if (Math.abs(delta) < 1e-9) {
    // 念のため最後を targetW に合わせる
    const out = commonSegs
      .filter(r=>Number.isFinite(Number(r && r.end)) && Number(r.end) > 0)
      .map(r=>cloneSeg(r, Number(r.end), true));
    if (out.length) out[out.length-1].end = Number(targetW.toFixed(3));
    return out.map((r,i)=>Object.assign({ id: i+1 }, r));
  }

  const out = [];
  let start = 0;
  for (const r of commonSegs) {
    const end0 = Number(r && r.end);
    if (!Number.isFinite(end0) || end0 <= 0) continue;

    if (end0 <= anchor + 1e-9) {
      out.push(cloneSeg(r, end0, true));
    } else if (start < anchor - 1e-9 && end0 > anchor + 1e-9) {
      // cross anchor -> split (step at original end belongs to the outer piece)
      out.push(cloneSeg(r, anchor, false));
      out.push(cloneSeg(r, end0 + delta, true));
    } else {
      out.push(cloneSeg(r, end0 + delta, true));
    }
    start = end0;
  }

  // 0以下/逆転を除去しつつ、targetW でトリム
  const cleaned = [];
  let last = 0;
  for (const r of out.sort((a,b)=>a.end-b.end)) {
    let e = Number(r.end);
    if (!Number.isFinite(e)) continue;
    if (e <= last + 1e-9) continue;
    if (e > targetW + 1e-9) continue;
    cleaned.push(Object.assign({}, r, { end: e }));
    last = e;
  }

  if (!cleaned.length) {
    cleaned.push({ end: Number(targetW.toFixed(3)), mode: 'pct', slopePct: 0.0, ratioX: 20, ratioDir: 'down', stepDz: 0 });
  } else {
    const prevEnd = (cleaned.length>=2) ? cleaned[cleaned.length-2].end : 0;
    cleaned[cleaned.length-1].end = Number(Math.max(targetW, prevEnd).toFixed(3));
  }

  return cleaned.map((r,i)=>Object.assign({ id: i+1 }, r));
};

const getEffectiveCrossSegsAt = (m, side)=>{
  ensureCrossState();
  const key = Number(m).toFixed(3);
  const hasOvr = !!(state.cross.overrides && state.cross.overrides[key]);
  const taperOn = !!(state.cross.taper && state.cross.taper.enabled);

  if (hasOvr) {
    const segs = (state.cross.overrides[key][side]?.segs||[]).slice();
    const info = { source: '例外', width: computeCrossRowsFromSegs(segs).lastEnd || 0, mode: '制御点' };
    return { segs, info };
  }

  const commonSegs = (state.cross[side]?.segs||[]).slice();
  if (!taperOn) {
    const info = { source: '共通', width: computeCrossRowsFromSegs(commonSegs).lastEnd || 0, mode: '共通' };
    return { segs: commonSegs, info };
  }

  const wInfo = getCrossWidthAt(m, side);
  const anchor = (side==='right') ? Number(state.cross.taper.anchorRight) : Number(state.cross.taper.anchorLeft);
  const segs = widenCrossSegsFromCommon(commonSegs, wInfo.w, anchor);
  const info = { source: '割付', width: wInfo.w, mode: wInfo.mode, prev: wInfo.prev, next: wInfo.next };
  return { segs, info };
};

const setOverrideWidthFromCommon = (staKey, rightW, leftW)=>{
  ensureCrossOverride(staKey);
  const ar = Number(state.cross.taper?.anchorRight ?? 0);
  const al = Number(state.cross.taper?.anchorLeft ?? 0);
  if (Number.isFinite(rightW) && rightW>0) {
    state.cross.overrides[staKey].right.segs = widenCrossSegsFromCommon(state.cross.right.segs, rightW, ar);
    state.cross.overrides[staKey].right.nextSegId = Math.max(1, state.cross.overrides[staKey].right.segs.length + 1);
  }
  if (Number.isFinite(leftW) && leftW>0) {
    state.cross.overrides[staKey].left.segs = widenCrossSegsFromCommon(state.cross.left.segs, leftW, al);
    state.cross.overrides[staKey].left.nextSegId = Math.max(1, state.cross.overrides[staKey].left.segs.length + 1);
  }
};

const drawCrossPreviewCanvas = (canvas, pts, labels, marks)=>{
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const pad = 30;
  const xs = pts.map(p=>p.x);
  const zs = pts.map(p=>p.z);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const dx = Math.max(1e-6, maxX - minX);
  const dz = Math.max(1e-6, maxZ - minZ);
  // add margin
  minX -= dx*0.08; maxX += dx*0.08;
  minZ -= dz*0.15; maxZ += dz*0.15;

  const sx = (W - pad*2) / Math.max(1e-6, (maxX - minX));
  const sy = (H - pad*2) / Math.max(1e-6, (maxZ - minZ));

  const tx = (x)=> pad + (x - minX) * sx;
  const ty = (z)=> H - pad - (z - minZ) * sy;

  // axes
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(tx(0), pad);
  ctx.lineTo(tx(0), H-pad);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pad, ty(0));
  ctx.lineTo(W-pad, ty(0));
  ctx.stroke();

  // polyline
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#2563eb';
  ctx.beginPath();
  for (let i=0;i<pts.length;i++) {
    const p = pts[i];
    const X = tx(p.x), Y = ty(p.z);
    if (i===0) ctx.moveTo(X,Y);
    else ctx.lineTo(X,Y);
  }
  ctx.stroke();

  // points
  ctx.fillStyle = '#0f172a';
  for (const p of pts) {
    const X = tx(p.x), Y = ty(p.z);
    ctx.beginPath();
    ctx.arc(X,Y,3,0,Math.PI*2);
    ctx.fill();
  }

  // highlight marks
  if (marks && marks.length) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    for (const m of marks) {
      const X = tx(m.x), Y = ty(m.z);
      ctx.beginPath();
      ctx.arc(X, Y, 6, 0, Math.PI*2);
      ctx.stroke();
    }
  }


  // highlighted marks
  if (marks && marks.length) {
    for (const m of marks) {
      const X = tx(m.x), Y = ty(m.z);
      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = m.color || '#ef4444';
      ctx.arc(X, Y, m.r || 7, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#cbd5e1';
  }


  // marks (highlight)
  if (marks && marks.length) {
    for (const m of marks) {
      const X = tx(m.x), Y = ty(m.z);
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = m.color || '#ef4444';
      ctx.arc(X,Y, m.r||6, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  // labels (optional)
  if (labels && labels.length) {
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillStyle = '#334155';
    for (const l of labels) {
      const X = tx(l.x), Y = ty(l.z);
      ctx.fillText(l.text, X+6, Y-6);
    }
  }
};


const setCrossExample = (scope, side, staKey)=>{
  const store = getCrossStore(scope, side, staKey);
  store.segs = [
    { id: 1, end: 3.000, mode: 'pct', slopePct: -2.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
    { id: 2, end: 4.500, mode: 'pct', slopePct:  0.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
    { id: 3, end: 5.000, mode: 'pct', slopePct: -1.000, ratioX: 20, ratioDir: 'down', stepDz: 0 },
  ];
  store.nextSegId = 4;
  saveState();
  render();
};

const bindCrossSlopeUI = (rootEl)=>{
  ensureCrossState();

  const bindSide = (side, scope, staKey)=>{
    const suffix = (scope === "ovr") ? `ovr_${side}` : side;
    const addBtn = document.getElementById(`addCrossSeg_${suffix}`);
    const clearBtn = document.getElementById(`clearCrossSeg_${suffix}`);
    const exBtn = document.getElementById(`exampleCrossSeg_${suffix}`);

    if (addBtn) {
      addBtn.onclick = ()=>{
        const store = getCrossStore(scope, side, staKey);
        const last = Math.max(0, ...(store.segs||[]).map(r=>Number(r.end)||0));
        store.segs.push({ id: store.nextSegId++, end: Number((last + 1.0).toFixed(3)), mode: 'pct', slopePct: 0.0, ratioX: 20, ratioDir: 'down', stepDz: 0 });
        sortCrossSegs(scope, side, staKey);
        saveState();
        render();
      };
    }
    if (clearBtn) {
      clearBtn.onclick = ()=>{
        const store = getCrossStore(scope, side, staKey);
        store.segs = [];
        store.nextSegId = 1;
        saveState();
        render();
      };
    }
    if (exBtn) {
      exBtn.onclick = ()=> setCrossExample(scope, side, staKey);
    }

    if (!rootEl) return;

    const staSel = (scope === "ovr" && staKey) ? `[data-xs-sta="${staKey}"]` : ``;

    rootEl.querySelectorAll(`input[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-end]`).forEach(inp=>{
      const id = parseInt(inp.getAttribute('data-xs-id'),10);
      const commit = (e)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;
        const t = String(e.target.value ?? "").trim();
        if (t === "") { render(); return; }
        const n = parseFloat(t.replace(/,/g,"."));
        if (!Number.isFinite(n)) { render(); return; }
        r.end = n;
        sortCrossSegs(scope, side, staKey);
        saveState();
        render();
      };
      inp.onchange = commit;
      inp.onblur = commit;
    });

    // mode select
    rootEl.querySelectorAll(`select[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-mode]`).forEach(selEl=>{
      const id = parseInt(selEl.getAttribute('data-xs-id'),10);
      const commit = (e)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;
        const v = String(e.target.value||'pct');
        r.mode = (v === 'ratio') ? 'ratio' : 'pct';
        if (!Number.isFinite(Number(r.ratioX))) r.ratioX = 20;
        if (r.mode === 'ratio') {
          // keep direction, compute slopePct for compatibility
          if (r.ratioDir !== 'up' && r.ratioDir !== 'down') r.ratioDir = (Number(r.slopePct)||0) >= 0 ? 'up' : 'down';
          const X = Number(r.ratioX)||20;
          const dir = (r.ratioDir === 'up') ? 1 : -1;
          r.slopePct = dir * (100.0 / Math.max(1e-9, X));
        }
        saveState();
        render();
      };
      selEl.onchange = commit;
      selEl.onblur = commit;
    });

    // % slope input (when mode=pct)
    rootEl.querySelectorAll(`input[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-slope]`).forEach(inp=>{
      const id = parseInt(inp.getAttribute('data-xs-id'),10);
      const commit = (e)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;
        const t = String(e.target.value ?? "").trim();
        if (t === "") { render(); return; }
        const n = parseFloat(t.replace(/,/g,"."));
        if (!Number.isFinite(n)) { render(); return; }
        r.mode = 'pct';
        r.slopePct = n;
        saveState();
        render();
      };
      inp.onchange = commit;
      inp.onblur = commit;
    });

    

// waribun input (割分 → %)
rootEl.querySelectorAll(`input[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-wb]`).forEach(inp=>{
  const id = parseInt(inp.getAttribute('data-xs-id'),10);
  const apply = (v, commit=false)=>{
    const store = getCrossStore(scope, side, staKey);
    const r = (store.segs||[]).find(x=>x.id===id);
    if (!r) return;
    r.wb = String(v ?? "");
    if (!commit) return;
    const info = parseWaribun(r.wb);
    if (info && Number.isFinite(info.pctAbs) && info.pctAbs > 0) {
      const cur = Number(r.slopePct) || 0;
      const sgn = info.signSpecified ? ((info.pctSigned < 0) ? -1 : 1) : ((cur < 0) ? -1 : 1);
      r.mode = 'pct';
      r.slopePct = sgn * info.pctAbs;
    }
    saveState();
    render();
  };
  inp.oninput  = (e)=> apply(e.target.value, false);
  inp.onchange = (e)=> apply(e.target.value, true);
  inp.onblur   = inp.onchange;
});
// ratio X input
    rootEl.querySelectorAll(`input[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-ratiox]`).forEach(inp=>{
      const id = parseInt(inp.getAttribute('data-xs-id'),10);
      const commit = (e)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;
        const t = String(e.target.value ?? "").trim();
        if (t === "") { render(); return; }
        const n = parseFloat(t.replace(/,/g,"."));
        if (!Number.isFinite(n) || n <= 0) { render(); return; }
        r.mode = 'ratio';
        r.ratioX = n;
        if (r.ratioDir !== 'up' && r.ratioDir !== 'down') r.ratioDir = 'down';
        const dir = (r.ratioDir === 'up') ? 1 : -1;
        r.slopePct = dir * (100.0 / Math.max(1e-9, n));
        saveState();
        render();
      };
      inp.onchange = commit;
      inp.onblur = commit;
    });

    // ratio direction
    rootEl.querySelectorAll(`select[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-ratiodir]`).forEach(selEl=>{
      const id = parseInt(selEl.getAttribute('data-xs-id'),10);
      const commit = (e)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;
        const v = String(e.target.value||'down');
        r.mode = 'ratio';
        r.ratioDir = (v === 'up') ? 'up' : 'down';
        const X = Number(r.ratioX) || 20;
        const dir = (r.ratioDir === 'up') ? 1 : -1;
        r.slopePct = dir * (100.0 / Math.max(1e-9, X));
        saveState();
        render();
      };
      selEl.onchange = commit;
      selEl.onblur = commit;
    });

    // step abs input
    // iOS/Safari の number 入力は確定時に 0 へ正規化されることがあるため、
    // 入力文字列は stepAbsText として保持し、計算は別で数値化する
    rootEl.querySelectorAll(`input[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-stepabs]`).forEach(inp=>{
      const id = parseInt(inp.getAttribute('data-xs-id'),10);
      const apply = (raw, commit=false)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;

        r.stepAbsText = String(raw ?? "");
        // 数値化できる場合だけ stepDz を更新（プレビュー列用）
        const s = normalizeJpNum(r.stepAbsText).trim();
        if (s === "") {
          r.stepDz = 0;
          if (commit) { saveState(); render(); }
          return;
        }
        const n = parseFloat(s.replace(/,/g,"."));
        if (!Number.isFinite(n)) {
          if (commit) render();
          return;
        }
        if (r.stepDir !== 'up' && r.stepDir !== 'down') {
          r.stepDir = (Number(r.stepDz)||0) < 0 ? 'down' : 'up';
        }
        const abs = Math.abs(n);
        r.stepDz = (r.stepDir === 'down') ? -abs : abs;

        if (commit) { saveState(); render(); }
      };

      inp.oninput  = (e)=> apply(e.target.value, false);
      inp.onchange = (e)=> apply(e.target.value, true);
      inp.onblur   = inp.onchange;
    });


    // step direction
    rootEl.querySelectorAll(`select[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-stepdir]`).forEach(selEl=>{
      const id = parseInt(selEl.getAttribute('data-xs-id'),10);
      const commit = (e)=>{
        const store = getCrossStore(scope, side, staKey);
        const r = (store.segs||[]).find(x=>x.id===id);
        if (!r) return;
        const v = String(e.target.value||'up');
        r.stepDir = (v === 'down') ? 'down' : 'up';

        // 入力文字列が数値化できるなら stepDz も同期
        const s = normalizeJpNum(String(r.stepAbsText ?? "")).trim();
        const n = s==="" ? 0 : parseFloat(s.replace(/,/g,"."));
        if (Number.isFinite(n)) {
          const abs = Math.abs(n);
          r.stepDz = (r.stepDir === 'down') ? -abs : abs;
        }

        saveState();
        render();
      };
      selEl.onchange = commit;
      selEl.onblur = commit;
    });


    rootEl.querySelectorAll(`button[data-xs-scope="${scope}"]${staSel}[data-xs-side="${side}"][data-xs-del]`).forEach(btn=>{
      const id = parseInt(btn.getAttribute('data-xs-del'),10);
      btn.onclick = ()=>{
        const store = getCrossStore(scope, side, staKey);
        store.segs = (store.segs||[]).filter(x=>x.id!==id);
        saveState();
        render();
      };
    });
  };

  // 共通
  bindSide('right', 'common');
  bindSide('left',  'common');

  // 測点別（選択中のみ）
  const sel = state.cross.ui.selectedStaKey;
  if (sel && state.cross.overrides && state.cross.overrides[sel]) {
    bindSide('right', 'ovr', sel);
    bindSide('left',  'ovr', sel);
  }
};

/* =========================
   Profile (Vertical)
========================= */
const toDecGrade = (pct) => (Number(pct) || 0) / 100.0;

const buildProfileModel = (prof, totalPlan) => {
  const warnings = [];
  if (!prof?.enabled) return { ok: false, pv: [], segments: [], curves: [], warnings };

  const grades = (prof.grades || [])
    .filter(r => Number.isFinite(r.nextSta) && Number.isFinite(r.gradePct))
    .slice()
    .sort((a, b) => Number(a.nextSta) - Number(b.nextSta));

  const s0 = Number(prof.startSta) || 0;
  const z0 = Number(prof.startZ) || 0;

  const pv = [{ sta: s0, z: z0 }];
  let curSta = s0, curZ = z0;

  for (const r of grades) {
    const s1 = Number(r.nextSta);
    const g = toDecGrade(Number(r.gradePct));
    if (!(s1 > curSta)) {
      warnings.push(`縦断: nextStaが増加していません（${s1.toFixed(3)}）`);
      continue;
    }
    curZ = curZ + g * (s1 - curSta);
    curSta = s1;
    pv.push({ sta: curSta, z: curZ });
  }

  if (Number.isFinite(totalPlan) && pv.length >= 2) {
    const lastSta = pv[pv.length - 1].sta;
    if (totalPlan > lastSta + 1e-6) {
      const lastGrade = grades.length ? grades[grades.length - 1] : { gradePct: 0 };
      const gLast = toDecGrade(Number(lastGrade.gradePct));
      const zEnd = pv[pv.length - 1].z + gLast * (totalPlan - lastSta);
      pv.push({ sta: totalPlan, z: zEnd });
      warnings.push(`縦断: 終点測点が平面総延長(${totalPlan.toFixed(3)})に届かないため、最後勾配で延長しました`);
    } else if (totalPlan < lastSta - 1e-6) {
      warnings.push(`縦断: 勾配終点(${lastSta.toFixed(3)})が平面総延長(${totalPlan.toFixed(3)})を超えています（出力は平面総延長まで）`);
    }
  }

  // segments: pv[i] -> pv[i+1] は grades[i] の勾配
  const segments = [];
  for (let i = 0; i < pv.length - 1; i++) {
    const staA = pv[i].sta, staB = pv[i + 1].sta;
    const src = grades[i] || grades[grades.length - 1] || { gradePct: 0 };
    const gPct = Number(src.gradePct ?? 0);
    segments.push({ s0: staA, s1: staB, z0: pv[i].z, gDec: toDecGrade(gPct) });
  }

  // VPI曲線（VPI単位）
  const curves = [];
  const pvKeys = new Set([...(pv.slice(1, -1).map(p => p.sta.toFixed(3)))]);

  // 重複チェック（同一VPIに複数）
  const vcMap = new Map();
  for (const vc of (prof.vcurves || [])) {
    const vpiSta = Number(vc.vpiSta);
    if (!Number.isFinite(vpiSta)) continue;
    const key = vpiSta.toFixed(3);
    if (vcMap.has(key)) warnings.push(`縦断: VPI@${key} に縦断曲線が重複しています（最後の設定を使用）`);
    vcMap.set(key, vc);
  }

  // PVに存在しないVPI指定
  for (const key of vcMap.keys()) {
    if (!pvKeys.has(key)) warnings.push(`縦断: 縦断曲線のVPI測点(${key})がPV点に存在しません（スキップ）`);
  }

  for (let i = 1; i < pv.length - 1; i++) {
    const vpiSta = pv[i].sta;
    const key = vpiSta.toFixed(3);
    const spec = vcMap.get(key);
    if (!spec) continue;

    const prevSeg = segments[i - 1];
    const nextSeg = segments[i];
    if (!prevSeg || !nextSeg) continue;

    const g1 = prevSeg.gDec;
    const g2 = nextSeg.gDec;
    const A = g2 - g1;

    let L = Number(spec.L);
    const ymax = (spec.ymax == null ? NaN : Number(spec.ymax));

    if (!Number.isFinite(L) || L <= 0) {
      if (Number.isFinite(ymax) && ymax > 0) {
        if (Math.abs(A) < 1e-12) {
          warnings.push(`縦断: VPI@${key} で勾配差0のため ymax→L換算できません`);
          continue;
        }
        L = 8 * ymax / Math.abs(A);
      } else {
        continue;
      }
    }

    if (Number.isFinite(ymax) && ymax > 0 && Number.isFinite(L) && L > 0 && Math.abs(A) > 1e-12) {
      const ycalc = Math.abs(A) * L / 8;
      if (Math.abs(ycalc - ymax) > 0.005) {
        warnings.push(`縦断: VPI@${key} のymax不一致（入力=${ymax.toFixed(3)} / 計算=${ycalc.toFixed(3)}）`);
      }
    }

    // 前後区間をはみ出さない最大L
    const maxL = 2 * Math.min(vpiSta - prevSeg.s0, nextSeg.s1 - vpiSta);
    if (maxL <= 0) continue;
    if (L > maxL) {
      warnings.push(`縦断: VPI@${key} のL(${L.toFixed(3)})が長すぎるため、最大(${maxL.toFixed(3)})に縮めました`);
      L = maxL;
    }

    const bvc = vpiSta - L / 2;
    const evc = vpiSta + L / 2;

    const zVPI = pv[i].z;
    const zBVC = zVPI - g1 * (L / 2);

    curves.push({ s0: bvc, s1: evc, L, zBVC, g1, A });
  }

  return { ok: true, pv, segments, curves, warnings };
};

const evalProfileZ = (model, s) => {
  if (!model?.ok) return NaN;

  for (const c of model.curves) {
    if (s >= c.s0 - 1e-9 && s <= c.s1 + 1e-9) {
      const x = clamp(s - c.s0, 0, c.L);
      return c.zBVC + c.g1 * x + (c.A / (2 * c.L)) * x * x;
    }
  }

  const segs = model.segments || [];
  if (!segs.length) return NaN;

  if (s <= segs[0].s0) return segs[0].z0;
  const last = segs[segs.length - 1];
  if (s >= last.s1) return last.z0 + last.gDec * (last.s1 - last.s0);

  for (const seg of segs) {
    if (s >= seg.s0 - 1e-9 && s <= seg.s1 + 1e-9) {
      return seg.z0 + seg.gDec * (s - seg.s0);
    }
  }
  return NaN;
};


/* =========================
   Segment classes (Plan)
========================= */
class SegmentStraight {
  constructor(s0, Ax, Ay, Bx, By) {
    this.type = "straight";
    this.s0 = s0;
    const L = norm(Bx - Ax, By - Ay);
    this.s1 = s0 + L;
    this.length = L;
    this.Ax = Ax; this.Ay = Ay;
    this.Bx = Bx; this.By = By;
    const [ux, uy] = unit(Bx - Ax, By - Ay);
    this.az = azFromVec(ux, uy);
  }
  eval(s) {
    const t = this.length === 0 ? 0 : clamp((s - this.s0) / this.length, 0, 1);
    return { N: this.Ay + t * (this.By - this.Ay), E: this.Ax + t * (this.Bx - this.Ax), az: this.az };
  }
}

class SegmentArc {
  constructor(s0, x0, y0, psi0, R, L, turnSign) {
    this.type = "arc";
    this.s0 = s0; this.s1 = s0 + L; this.length = L;
    this.R = R; this.turnSign = turnSign;
    this.x0 = x0; this.y0 = y0; this.psi0 = psi0;

    const nxL = -Math.sin(psi0), nyL = Math.cos(psi0);
    this.cx = x0 + turnSign * nxL * R;
    this.cy = y0 + turnSign * nyL * R;
    this.rx0 = x0 - this.cx;
    this.ry0 = y0 - this.cy;
  }
  eval(s) {
    const u = clamp(s - this.s0, 0, this.length);
    const ang = this.turnSign * (u / this.R);
    const ca = Math.cos(ang), sa = Math.sin(ang);

    const rx = ca * this.rx0 - sa * this.ry0;
    const ry = sa * this.rx0 + ca * this.ry0;

    const E = this.cx + rx;
    const N = this.cy + ry;

    const rL = norm(rx, ry);
    let psi = this.psi0;
    if (rL > 0) {
      const tE = -this.turnSign * ry;
      const tN =  this.turnSign * rx;
      psi = Math.atan2(tN, tE);
    }
    return { N, E, az: azFromPsi(psi) };
  }
}

class SegmentSpiral {
  constructor(s0, x0, y0, psi0, R, Ls, turnSign, mode, ds) {
    this.type = "spiral";
    this.s0 = s0; this.s1 = s0 + Ls; this.length = Ls;
    this.R = R;
    this.turnSign = turnSign;
    this.mode = mode;

    const n = Math.max(1, Math.ceil(Ls / Math.max(ds, 1e-6)));
    const step = Ls / n;

    this.ss = [0]; this.xs = [x0]; this.ys = [y0]; this.psis = [psi0];
    let x = x0, y = y0, psi = psi0;

    for (let i = 1; i <= n; i++) {
      const sMid = (i - 0.5) * step;
      const k = (mode === "in" ? sMid / Ls : 1 - sMid / Ls) / R;
      psi += turnSign * k * step;
      x += Math.cos(psi) * step;
      y += Math.sin(psi) * step;
      this.ss.push(i * step);
      this.xs.push(x);
      this.ys.push(y);
      this.psis.push(psi);
    }
  }
  endState() {
    const last = this.ss.length - 1;
    return { x: this.xs[last], y: this.ys[last], psi: this.psis[last] };
  }
  eval(s) {
    const u = clamp(s - this.s0, 0, this.length);
    if (u <= 0) return { N: this.ys[0], E: this.xs[0], az: azFromPsi(this.psis[0]) };
    if (u >= this.length) {
      const last = this.ss.length - 1;
      return { N: this.ys[last], E: this.xs[last], az: azFromPsi(this.psis[last]) };
    }
    let j = 0;
    while (j + 1 < this.ss.length && this.ss[j + 1] < u) j++;
    const t = (u - this.ss[j]) / (this.ss[j + 1] - this.ss[j]);
    const x = this.xs[j] + t * (this.xs[j + 1] - this.xs[j]);
    const y = this.ys[j] + t * (this.ys[j + 1] - this.ys[j]);
    const psi = this.psis[j] + t * (this.psis[j + 1] - this.psis[j]);
    return { N: y, E: x, az: azFromPsi(psi) };
  }
}

const evalAlignment = (segments, s) => {
  if (!segments?.length) return { N: 0, E: 0, az: 0 };
  if (s <= segments[0].s0) return segments[0].eval(segments[0].s0);
  if (s >= segments[segments.length - 1].s1) return segments[segments.length - 1].eval(segments[segments.length - 1].s1);
  for (const seg of segments) {
    if (s >= seg.s0 - 1e-9 && s <= seg.s1 + 1e-9) return seg.eval(s);
  }
  return segments[segments.length - 1].eval(segments[segments.length - 1].s1);
};

/* =========================
   Alignment computation
========================= */
const computeAlignment = (ipPoints, curveSettings, dsSpiral, clothoidMode) => {
  if (ipPoints.length < 2) return { segments: [], keypoints: [], total: 0, warnings: ["点が2点未満です"] };

  const warnings = [];
  const segments = [];
  const keypoints = [];

  let curX = ipPoints[0].E, curY = ipPoints[0].N, curSta = 0;

  {
    const [ux, uy] = unit(ipPoints[1].E - curX, ipPoints[1].N - curY);
    keypoints.push({ name: ipPoints[0].name, sta: 0, N: curY, E: curX, az: azFromVec(ux, uy) });
  }

  for (let i = 1; i < ipPoints.length - 1; i++) {
    const prev = ipPoints[i - 1], curr = ipPoints[i], next = ipPoints[i + 1];
    const [dinx, diny] = unit(curr.E - prev.E, curr.N - prev.N);
    const [doutx, douty] = unit(next.E - curr.E, next.N - curr.N);

    const Delta = Math.acos(clamp(dot(dinx, diny, doutx, douty), -1, 1));
    const cs = curveSettings.find(c => c.ipName === curr.name);

    if (!cs || cs.R <= 0 || Delta < 1e-9 || cs.direction === "none") {
      if (norm(curr.E - curX, curr.N - curY) > 1e-9) {
        const seg = new SegmentStraight(curSta, curX, curY, curr.E, curr.N);
        segments.push(seg);
        curSta = seg.s1; curX = curr.E; curY = curr.N;
      }
      continue;
    }

    const R = cs.R;

    let L1, L2;
    if (clothoidMode === "A") {
      const A1 = cs.A1 || 0, A2 = (cs.A2 ?? A1);
      L1 = R > 0 ? (A1 * A1) / R : 0;
      L2 = R > 0 ? (A2 * A2) / R : 0;
    } else {
      L1 = cs.Ls || 0;
      L2 = cs.Ls || 0;
    }

    const z = crossZ(dinx, diny, doutx, douty);
    const turnSign =
      cs.direction === "left" ? 1 :
      cs.direction === "right" ? -1 :
      (z >= 0 ? 1 : -1);

    const theta1 = L1 > 0 ? L1 / (2 * R) : 0;
    const theta2 = L2 > 0 ? L2 / (2 * R) : 0;
    const p = (L1 * L1 + L2 * L2) / (48 * R);
    const DeltaC = Delta - theta1 - theta2;

    if (DeltaC < -1e-9) {
      warnings.push(`${curr.name}: クロソイド長が長すぎ（ΔC<0）`);
      continue;
    }

    const T = (R + p) * Math.tan(Delta / 2) + (L1 + L2) / 4;
    const Lc = R * Math.max(0, DeltaC);

    const distIn = norm(curr.E - prev.E, curr.N - prev.N);
    const distOut = norm(next.E - curr.E, next.N - curr.N);

    if (distIn <= T + 1e-6 || distOut <= T + 1e-6) {
      warnings.push(`${curr.name}: 接線長不足`);
      continue;
    }

    const TSx = curr.E - dinx * T, TSy = curr.N - diny * T;
    const STx = curr.E + doutx * T, STy = curr.N + douty * T;

    if (norm(TSx - curX, TSy - curY) > 1e-9) {
      const seg = new SegmentStraight(curSta, curX, curY, TSx, TSy);
      segments.push(seg);
      curSta = seg.s1; curX = TSx; curY = TSy;
    }

    const azTS = azFromVec(dinx, diny);
    const psiTS = psiFromAz(azTS);
    const staTSstart = curSta;
    let psiSC = psiTS;

    if (L1 > 0) {
      const sp = new SegmentSpiral(curSta, curX, curY, psiTS, R, L1, turnSign, "in", (cs.ds ?? dsSpiral));
      segments.push(sp);
      curSta = sp.s1;
      const end = sp.endState();
      curX = end.x; curY = end.y; psiSC = end.psi;
    }

    const staSC = curSta;
    let psiCS = psiSC;

    if (Lc > 0) {
      const arc = new SegmentArc(curSta, curX, curY, psiSC, R, Lc, turnSign);
      segments.push(arc);
      curSta = arc.s1;
      const end = arc.eval(arc.s1);
      curX = end.E; curY = end.N;
      psiCS = psiFromAz(end.az);
    }

    const staCS = curSta;

    if (L2 > 0) {
      const sp = new SegmentSpiral(curSta, curX, curY, psiCS, R, L2, turnSign, "out", (cs.ds ?? dsSpiral));
      segments.push(sp);
      curSta = sp.s1;
      const end = sp.endState();
      curX = end.x; curY = end.y;
    }

    const staST = curSta;

    const err = norm(STx - curX, STy - curY);
    if (err > Math.max(0.05, dsSpiral * 0.2)) warnings.push(`${curr.name}: ST誤差 ${err.toFixed(3)}m`);
    curX = STx; curY = STy;

    for (const [nm, sta] of [[`TS(${curr.name})`, staTSstart], [`SC(${curr.name})`, staSC], [`CS(${curr.name})`, staCS], [`ST(${curr.name})`, staST]]) {
      const pt = evalAlignment(segments, sta);
      keypoints.push({ name: nm, sta, N: pt.N, E: pt.E, az: pt.az });
    }
    keypoints.push({ name: `PI(${curr.name})`, sta: NaN, N: curr.N, E: curr.E, az: azTS });
  }

  const last = ipPoints[ipPoints.length - 1];
  if (norm(last.E - curX, last.N - curY) > 1e-9) {
    const seg = new SegmentStraight(curSta, curX, curY, last.E, last.N);
    segments.push(seg);
    curSta = seg.s1;
  }

  if (ipPoints.length >= 2) {
    const prev = ipPoints[ipPoints.length - 2];
    const [ux, uy] = unit(last.E - prev.E, last.N - prev.N);
    keypoints.push({ name: last.name, sta: curSta, N: last.N, E: last.E, az: azFromVec(ux, uy) });
  }

  return { segments, keypoints, total: curSta, warnings };
};

/* =========================
   Work points + stations
========================= */
const getWorkPoints = () => {
  const k = Math.max(0, Math.min(state.useIpCount, state.ipPoints.length));
  const mid = state.ipPoints.slice(0, k).map(p => ({ name: p.name, N: p.N, E: p.E }));
  return dedupeConsecutivePoints([
    { name: state.bp.name || "BP", N: state.bp.N, E: state.bp.E },
    ...mid,
    { name: state.ep.name || "EP", N: state.ep.N, E: state.ep.E },
  ]);
};

const buildUnifiedStationList = (total, stepInt, sources) => {
  stepInt = Math.max(1, Math.floor(stepInt || 1));

  const base = [];
  for (let s = 0; s < total - 1e-9; s += stepInt) base.push(s);
  base.push(total);

  const extrasIn = [];
  const notes = [];

  for (const src of sources || []) {
    const label = src?.label || "追加測点";
    const values = src?.values || [];
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < -1e-9 || v > total + 1e-9) notes.push(`${label} ${v.toFixed(3)}m は範囲外なので除外`);
      else extrasIn.push(clamp(v, 0, total));
    }
  }

  const merged = [...base, ...extrasIn].sort((a, b) => a - b);
  return { stations: dedupeSorted(merged), notes, baseCount: base.length, extraCount: extrasIn.length };
};

/* =========================
   Canvas plot (left/right)
========================= */

function drawPlanCanvas(canvas, segments, workPoints, keypoints, options) {
  const crossOv = options && options.crossOverlay ? options.crossOverlay : null;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const samples = [];
  for (const seg of segments) {
    if (!seg || !seg.length || seg.length <= 0) continue;
    const t = seg.type;
    let ss = [];
    if (t === "straight") ss = [seg.s0, seg.s1];
    else {
      const n = Math.max(2, Math.ceil(seg.length / Math.max(options.plotStep, 0.1)) + 1);
      for (let i=0;i<n;i++) ss.push(seg.s0 + i*(seg.length/(n-1)));
    }
    const pts = ss.map(s => ({...evalAlignment(segments, s), s}));
    samples.push({ seg, pts });
  }
  if (!samples.length) return;

  let minE=Infinity, maxE=-Infinity, minN=Infinity, maxN=-Infinity;
  const pushPt = (E,N)=>{ minE=Math.min(minE,E); maxE=Math.max(maxE,E); minN=Math.min(minN,N); maxN=Math.max(maxN,N); };
  for (const block of samples) for (const p of block.pts) pushPt(p.E, p.N);
  for (const p of workPoints) pushPt(p.E, p.N);
  if (options.showKeypoints) for (const k of keypoints) if (Number.isFinite(k.sta)) pushPt(k.E, k.N);

  // include cross overlay in bbox
  if (crossOv && crossOv.enabled && Number.isFinite(crossOv.sta)) {
    try {
      const p = evalAlignment(segments, crossOv.sta);
      const psi = psiFromAz(p.az);
      // right normal (right is +)
      const nRx = Math.sin(psi), nRy = -Math.cos(psi);
      const L = Math.max(0, Number(crossOv.Wleft||0));
      const R = Math.max(0, Number(crossOv.Wright||0));
      pushPt(p.E + (-L)*nRx, p.N + (-L)*nRy);
      pushPt(p.E + ( R)*nRx, p.N + ( R)*nRy);
      const pts = Array.isArray(crossOv.points) ? crossOv.points : [];
      for (const q of pts) {
        if (!q || !Number.isFinite(q.x)) continue;
        pushPt(p.E + q.x*nRx, p.N + q.x*nRy);
      }
      const qp = crossOv.queryPoint;
      if (qp && Number.isFinite(qp.x)) {
        pushPt(p.E + qp.x*nRx, p.N + qp.x*nRy);
      }
    } catch(e){}
  }

  const pad = 30;
  const dx = Math.max(1e-9, maxE - minE);
  const dy = Math.max(1e-9, maxN - minN);
  const sx = (W - pad*2) / dx;
  const sy = (H - pad*2) / dy;
  const s = Math.min(sx, sy);

  const toXY = (E,N) => {
    const x = pad + (E - minE) * s;
    const y = H - (pad + (N - minN) * s);
    return [x,y];
  };

  const strokeFor = (seg) => {
    if (seg.type === "straight") return { w:2, col:"#0f172a" };
    const ts = seg.turnSign || 0;
    if (ts > 0) return { w:3, col:"#2563eb" };
    if (ts < 0) return { w:3, col:"#ef4444" };
    return { w:3, col:"#9333ea" };
  };

  for (const block of samples) {
    const {seg, pts} = block;
    const st = strokeFor(seg);
    ctx.beginPath();
    for (let i=0;i<pts.length;i++){
      const [x,y] = toXY(pts[i].E, pts[i].N);
      if (i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.lineWidth = st.w;
    ctx.strokeStyle = st.col;
    ctx.stroke();

    if (options.showArrow && pts.length >= 2) {
      const mid = Math.floor(pts.length/2);
      const p0 = pts[mid], p1 = pts[Math.min(mid+1, pts.length-1)];
      const [x0,y0] = toXY(p0.E,p0.N);
      const [x1,y1] = toXY(p1.E,p1.N);
      const ang = Math.atan2(y1-y0, x1-x0);
      const L = 10;
      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x1 - L*Math.cos(ang-0.5), y1 - L*Math.sin(ang-0.5));
      ctx.lineTo(x1 - L*Math.cos(ang+0.5), y1 - L*Math.sin(ang+0.5));
      ctx.closePath();
      ctx.fillStyle = st.col;
      ctx.fill();
    }
  }

  ctx.fillStyle = "#111827";
  for (const p of workPoints) {
    const [x,y] = toXY(p.E,p.N);
    ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    ctx.font = "12px system-ui";
    ctx.fillText(" " + p.name, x+6, y-6);
  }

  if (options.showKeypoints) {
    ctx.fillStyle = "#334155";
    ctx.font = "11px system-ui";
    for (const k of keypoints) {
      if (!Number.isFinite(k.sta)) continue;
      const [x,y] = toXY(k.E,k.N);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
      ctx.fillText(" " + k.name, x+6, y+12);
    }
  }

  // Cross overlay (station + normal line + representative points)
  if (crossOv && crossOv.enabled && Number.isFinite(crossOv.sta)) {
    try {
      const p = evalAlignment(segments, crossOv.sta);
      const psi = psiFromAz(p.az);
      const nRx = Math.sin(psi), nRy = -Math.cos(psi);
      const L = Math.max(0, Number(crossOv.Wleft||0));
      const R = Math.max(0, Number(crossOv.Wright||0));

      const [cx, cy] = toXY(p.E, p.N);
      const [xL, yL] = toXY(p.E + (-L)*nRx, p.N + (-L)*nRy);
      const [xR, yR] = toXY(p.E + ( R)*nRx, p.N + ( R)*nRy);

      // cross direction line
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111827";
      ctx.setLineDash([6,4]);
      ctx.beginPath();
      ctx.moveTo(xL,yL);
      ctx.lineTo(xR,yR);
      ctx.stroke();
      ctx.setLineDash([]);

      // station marker
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI*2);
      ctx.fill();

      // representative points
      const pts = Array.isArray(crossOv.points) ? crossOv.points : [];
      for (const q of pts) {
        if (!q || !Number.isFinite(q.x)) continue;
        const QE = p.E + q.x*nRx;
        const QN = p.N + q.x*nRy;
        const [qx,qy] = toXY(QE,QN);
        ctx.beginPath();
        ctx.arc(qx, qy, q.isSelected ? 6 : 4, 0, Math.PI*2);
        ctx.fillStyle = q.isSelected ? "#ef4444" : "#2563eb";
        ctx.fill();
      }
      // query point (STA + side + offset) if present
      const qp = crossOv.queryPoint;
      if (qp && Number.isFinite(qp.x)) {
        const QE = p.E + qp.x*nRx;
        const QN = p.N + qp.x*nRy;
        const [qx,qy] = toXY(QE,QN);
        ctx.beginPath();
        ctx.arc(qx, qy, 6, 0, Math.PI*2);
        ctx.strokeStyle = "#14532d";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#16a34a";
        ctx.fill();
        ctx.lineWidth = 1;
      }

      // label
      ctx.font = "12px system-ui";
      ctx.fillStyle = "#0f172a";
      ctx.fillText(`STA ${crossOv.sta.toFixed(3)}m`, cx+8, cy-8);

    } catch(e){}
  }

  const lx=10, ly=10;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(lx,ly,240,78,10);
    ctx.fill(); ctx.stroke();
  } else {
    ctx.fillRect(lx,ly,240,78);
    ctx.strokeRect(lx,ly,240,78);
  }

  const rows = [
    { label:"直線", col:"#0f172a" },
    { label:"曲線（左）", col:"#2563eb" },
    { label:"曲線（右）", col:"#ef4444" },
  ];
  ctx.font = "12px system-ui";
  for (let i=0;i<rows.length;i++){
    const y = ly + 22 + i*18;
    ctx.strokeStyle = rows[i].col;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(lx+12, y); ctx.lineTo(lx+50, y); ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.fillText(rows[i].label, lx+60, y+4);
  }
}


function drawProfileCanvas(canvas, model, total, options) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,W,H);

  if (!model?.ok || !Number.isFinite(total) || total <= 0) {
    ctx.fillStyle = "#334155";
    ctx.font = "14px system-ui";
    ctx.fillText("縦断が未確定です（勾配区間を入力してください）", 20, 40);
    return;
  }

  const step = Math.max(0.1, Number(options?.plotStep ?? 5.0));
  const n = Math.max(2, Math.ceil(total / step) + 1);

  const pts = [];
  for (let i=0;i<n;i++){
    const s = (i === n-1) ? total : i*step;
    const z = evalProfileZ(model, s);
    if (Number.isFinite(z)) pts.push({s, z});
  }
  if (!pts.length) return;

  // Include PV points & curve endpoints in bounds
  let minZ=Infinity, maxZ=-Infinity;
  const addZ = (z)=>{ minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z); };
  for (const p of pts) addZ(p.z);
  for (const pv of (model.pv||[])) if (Number.isFinite(pv.z)) addZ(pv.z);
  for (const c of (model.curves||[])) {
    const zb = evalProfileZ(model, c.s0);
    const ze = evalProfileZ(model, c.s1);
    if (Number.isFinite(zb)) addZ(zb);
    if (Number.isFinite(ze)) addZ(ze);
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return;
  const dz = Math.max(1e-6, maxZ - minZ);

  const padL=50, padR=20, padT=20, padB=35;
  const x0 = padL, x1 = W - padR;
  const y0 = padT, y1 = H - padB;

  const toX = (s)=> x0 + (s/total) * (x1-x0);
  const toY = (z)=> y1 - ((z - minZ)/dz) * (y1-y0);

  // axes
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1);
  ctx.stroke();

  // grid (4 lines)
  ctx.strokeStyle = "#f1f5f9";
  for (let i=1;i<=4;i++){
    const t = i/5;
    const yg = y0 + t*(y1-y0);
    ctx.beginPath(); ctx.moveTo(x0, yg); ctx.lineTo(x1, yg); ctx.stroke();
  }

  // main profile polyline
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i=0;i<pts.length;i++){
    const x = toX(pts[i].s);
    const y = toY(pts[i].z);
    if (i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // vertical curve highlights
  if (options?.showVC) {
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 3;
    for (const c of (model.curves||[])) {
      const s0 = clamp(c.s0, 0, total);
      const s1 = clamp(c.s1, 0, total);
      if (s1 <= s0) continue;

      const nn = Math.max(6, Math.ceil((s1-s0)/step) + 1);
      ctx.beginPath();
      for (let i=0;i<nn;i++){
        const s = (i===nn-1) ? s1 : (s0 + i*((s1-s0)/(nn-1)));
        const z = evalProfileZ(model, s);
        if (!Number.isFinite(z)) continue;
        const x = toX(s), y = toY(z);
        if (i===0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
  }

  // PV points
  if (options?.showPV) {
    ctx.fillStyle = "#111827";
    ctx.font = "11px system-ui";
    for (const pv of (model.pv||[])) {
      const s = pv.sta;
      const z = pv.z;
      if (!Number.isFinite(s) || !Number.isFinite(z)) continue;
      if (s < -1e-6 || s > total + 1e-6) continue;
      const x = toX(clamp(s,0,total)), y = toY(z);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();

      // label only for internal PV to keep clean
      if (s > 1e-6 && s < total - 1e-6) {
        const pitch = Number(options?.pitch ?? 20);
        const label = metersToStaPitch(s, pitch, 0);
        ctx.fillText(label, x+6, y-6);
      }
    }
  }

  // captions
  ctx.fillStyle = "#334155";
  ctx.font = "12px system-ui";
  ctx.fillText(`Sta 0.000 – ${total.toFixed(3)} m`, x0, H-10);
  ctx.fillText(`Z ${minZ.toFixed(3)} – ${maxZ.toFixed(3)} m`, x0, 14);
}

/* =========================
   Rendering
========================= */
const viewPlan = document.getElementById("viewPlan");
const viewProfile = document.getElementById("viewProfile");
const viewCross = document.getElementById("viewCross");
const viewOutput = document.getElementById("viewOutput");
const viewSave = document.getElementById("viewSave");

const computeAll = () => {
  const workPoints = getWorkPoints();
  const res = computeAlignment(workPoints, state.curveSettings, state.dsSpiral, state.clothoidMode);
  return { workPoints, res };
};

const render = () => {
  document.getElementById("projectName").value = state.projectName;
  document.getElementById("coordDecimals").value = String(state.coordDecimals);
  document.getElementById("staPitch").value = state.staPitch;
  document.getElementById("outputStep").value = state.outputStep;

  const d = Math.max(0, Math.min(4, parseInt(state.coordDecimals, 10) || 3));
  let workPoints = [];
  let res = { ok:false, segments:[], stations:[], keypoints:[], warnings:["計算未実行"] };
  let computeError = null;
  try {
    const tmp = computeAll();
    workPoints = tmp.workPoints;
    res = tmp.res;
  } catch (e) {
    computeError = e;
  }

  // show boot status / fatal hints
  const bs = document.getElementById("bootStatus");
  if (bs) {
    if (computeError) {
      const msg = (computeError && (computeError.message || computeError.toString())) || "unknown";
      bs.innerHTML = `<span class="warn">⚠️ 計算エラーで画面描画が止まりました：${escapeHtml(msg)}</span>
      <button id="btnResetLS" class="btn btn-ghost" style="margin-left:10px; width:auto; display:inline-block;">保存データ初期化</button>
      <span class="mini" style="margin-left:10px;">（localStorageを消して再起動）</span>`;
      setTimeout(()=>{
        const b = document.getElementById("btnResetLS");
        if (b) b.onclick = ()=>{ try{ LS.remove(LS_KEY_NEW); LS.remove(LS_KEY_OLD); }catch(_){ } location.reload(); };
      },0);
    } else {
      bs.innerHTML = `<span class="mini">起動OK（描画中）</span>`;
    }
  }
  const pitch = Math.max(1, Math.floor(state.staPitch||1));


  // coord catalog (CSV)
  const catalogAll = (state.coordCatalog && Array.isArray(state.coordCatalog.items)) ? state.coordCatalog.items : [];
  const catalogRows = catalogAll.map((r, i)=>Object.assign({_i:i}, r));
  const qCoord = String(uiState.coordSearch||"").trim().toLowerCase();
  const catalogFiltered = qCoord ? catalogRows.filter(r=>String(r.name||"").toLowerCase().includes(qCoord)) : catalogRows;
  const catalogShown = catalogFiltered.slice(0, 200);

  /* -------- PLAN -------- */
  viewPlan.innerHTML = `

    <div class="card" id="secPlanImport">
      <h2>平面線形の読み込み（SIMA / XRF）</h2>
      <div class="grid grid-2">
        <div>
          <label>ファイル（.sim / .sima / .xrf）</label>
          <input id="planImportFile" type="file" />
          <div class="mini">SIMA(.sim / .sima)は「路線データ（主要線/中心線）」のC01/C02を解析し、曲線（円弧/クロソイド）を可能な範囲で復元します。XRF(.xrf)も同様に復元します。</div>
        </div>
        <div>
          <label>読み込み</label>
          <button class="btn" id="btnPlanImport">読み込みして反映</button>
          <div id="planImportMsg" class="mini" style="margin-top:8px;">${escHtml(planImportMsgText)}</div>
        </div>
      </div>
    </div>

    <div class="card" id="secPlanDxfImport">
      <h2>平面線形の読み込み（DXF）</h2>
      <div class="grid grid-2">
        <div>
          <label>ファイル（ASCII DXF .dxf）<span class="mini">（スマホは25MB以下推奨／PCは大容量可）</span></label>
          <input id="planDxfFile" type="file" accept=".dxf,text/plain" />
          <div class="mini">平面図（003～008）想定。中心線（LWPOLYLINE）を探索してBP/EP/IPを作成します。橋梁(A1/A2/P1…のラベル)も見つけた場合は、橋梁区間のSTAに横断⑥を割当します。<br/>※DXF解析はPC推奨（スマホは25MB以下）。</div>
        </div>
        <div>
          <label>読み込み</label>
          <button class="btn" id="btnPlanDxfImport">DXFを解析して反映</button>
          <div id="planDxfMsg" class="mini" style="margin-top:8px;"></div>
        </div>
      </div>
    </div>

<div class="grid grid-2" style="margin-top:10px;">
  <div>
    <label>解析済みJSON（平面だけ / 全stateでもOK）</label>
    <input id="planJsonFile" type="file" accept="application/json" />
    <div class="mini">BP/EP/IP座標やIP点列などをJSONから反映します（現場ではDXF解析をPCで行い、スマホはJSONを読み込む運用が推奨）。</div>
  </div>
  <div>
    <label>読み込み</label>
    <button class="btn btn-ok" id="btnPlanJsonImport">JSONを反映</button>
    <button class="btn" id="btnPlanJsonExport">平面JSONを書き出し</button>
    <div id="planJsonMsg" class="mini" style="margin-top:8px;"></div>
  </div>
</div>


    <div class="card" id="secCoordCatalog">
      <h2>座標一覧（CSV）</h2>
      <div class="grid grid-3">
        <div>
          <label>CSVファイル</label>
          <input id="coordCsvFile" type="file" accept=".csv,text/csv,text/plain" />
          <div class="mini">形式：名称,X座標,Y座標,Z標高（<b>X=北N</b>、<b>Y=東E</b>）。ヘッダ有/無、末尾カンマもOK。</div>
        </div>
        <div>
          <label>検索（名称）</label>
          <input id="coordSearch" type="text" value="${escHtml(uiState.coordSearch||"")}" placeholder="名称で検索…" />
          <div class="mini">表示：${catalogShown.length}/${catalogFiltered.length}（全${catalogAll.length}）</div>
        </div>
        <div>
          <label>操作</label>
          <button class="btn" id="btnCoordLoad">CSVを読み込み</button>
          <div style="height:8px;"></div>
          <button class="btn btn-ghost" id="btnCoordClear">一覧をクリア</button>
          <div class="mini" style="margin-top:6px;">最終読込：${escHtml(state.coordCatalog.lastFile||"")} ${escHtml(state.coordCatalog.lastLoadedAt||"")}</div>
        </div>
      </div>

      <div style="overflow:auto; margin-top:10px; max-height:280px;">
        <table>
          <thead><tr><th>名称</th><th class="right">N(X)</th><th class="right">E(Y)</th><th class="right">Z</th><th>反映</th></tr></thead>
          <tbody>
            ${catalogShown.map((r)=>`
              <tr>
                <td class="mono">${escHtml(r.name)}</td>
                <td class="right mono">${Number(r.N).toFixed(d)}</td>
                <td class="right mono">${Number(r.E).toFixed(d)}</td>
                <td class="right mono">${(r.Z==null||!Number.isFinite(+r.Z))?"":Number(r.Z).toFixed(3)}</td>
                <td>
                  <button class="btn btn-ghost" data-cat-bp="${r._i}">BP</button>
                  <button class="btn btn-ghost" data-cat-ep="${r._i}">EP</button>
                  <button class="btn btn-ghost" data-cat-ip="${r._i}">+IP</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="mini" style="margin-top:8px;">※Zは平面入力では使いません（将来、縦断の初期標高に流用できます）。</div>
    </div>

    <div class="card" id="secPlan">
      <h2>平面線形：BP / EP（座標m）</h2>
      <div class="grid grid-2">
        <div>
          <div class="pill">BP</div>
          <div class="grid grid-2" style="margin-top:8px;">
            <div><label>N</label><input id="bpN" type="text" inputmode="decimal" autocomplete="off" /></div>
            <div><label>E</label><input id="bpE" type="text" inputmode="decimal" autocomplete="off" /></div>
          </div>
        </div>
        <div>
          <div class="pill">EP</div>
          <div class="grid grid-2" style="margin-top:8px;">
            <div><label>N</label><input id="epN" type="text" inputmode="decimal" autocomplete="off" /></div>
            <div><label>E</label><input id="epE" type="text" inputmode="decimal" autocomplete="off" /></div>
          </div>
        </div>
      </div>
      <div class="mini" style="margin-top:8px;">座標は m。通常は小数3桁、必要に応じて4桁。</div>
    </div>

    <div class="card">
      <h2>IP点（BP→IP1..IPk→EP）</h2>
      <div class="grid grid-3">
        <div>
          <label>使用IP数（IP1から）</label>
          <input id="useIpCount" type="range" min="0" max="${state.ipPoints.length}" />
          <div class="mini"><span id="useIpLabel"></span></div>
        </div>
        <div>
          <button class="btn" id="addIP">+ IP追加</button>
          <div style="height:10px;"></div>
          <button class="btn btn-ghost" id="resetDemo">デモ値に戻す</button>
        </div>
        <div>
          <label>IP削除（名前指定）</label>
          <select id="delIpSel">
            <option value="">（選択）</option>
            ${state.ipPoints.map(p=>`<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
          <div style="height:10px;"></div>
          <button class="btn btn-ghost" id="delIP">選択IPを削除</button>
        </div>
      </div>

      <div style="overflow:auto; margin-top:10px;">
        <table>
          <thead><tr><th>IP</th><th>N</th><th>E</th></tr></thead>
          <tbody>
            ${state.ipPoints.map(p=>`
              <tr>
                <td class="mono">${p.name}</td>
                <td><input data-ip-n="${p.id}" type="text" inputmode="decimal" autocomplete="off" value="${p.N}" /></td>
                <td><input data-ip-e="${p.id}" type="text" inputmode="decimal" autocomplete="off" value="${p.E}" /></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>曲線設定（IP名ごと）</h2>
      <div class="grid grid-3">
        <div class="mini">direction: auto/left/right/none、R>0 のとき曲線として扱います</div>
        <div><button class="btn" id="addCurve">+ 曲線追加</button></div>
        <div class="mini">A指定：L1=A1²/R、L2=A2²/R（A2空欄ならA1と同じ）</div>
      </div>

      <div style="overflow:auto; margin-top:10px;">
        <table>
          <thead>
            <tr><th>対象IP</th><th>direction</th><th>R</th><th>A1(起点)</th><th>A2(終点)</th><th class="right">L1(m)</th><th class="right">L2(m)</th><th>ds(内部刻みm)</th><th class="right">削除</th></tr>
          </thead>
          <tbody>
            ${state.curveSettings.map(c=>`
              <tr>
                <td>
                  <select data-c-ip="${c.id}">
                    ${state.ipPoints.map(p=>`<option value="${p.name}" ${p.name===c.ipName?"selected":""}>${p.name}</option>`).join("")}
                  </select>
                </td>
                <td>
                  <select data-c-dir="${c.id}">
                    ${["auto","left","right","none"].map(d=>`<option value="${d}" ${d===c.direction?"selected":""}>${d}</option>`).join("")}
                  </select>
                </td>
                <td><input data-c-r="${c.id}" type="text" inputmode="decimal" autocomplete="off" value="${c.R ?? ""}" /></td>
                <td><input data-c-a1="${c.id}" type="text" inputmode="decimal" autocomplete="off" value="${c.A1 ?? ""}" /></td>
                <td><input data-c-a2="${c.id}" type="text" inputmode="decimal" autocomplete="off" value="${((c.A2 ?? c.A1) ?? "")}" /></td>
                <td class="right">${(+c.R>0 && +c.A1>0) ? (((+c.A1)*(+c.A1))/(+c.R)).toFixed(3) : ""}</td>
                <td class="right">${(+c.R>0 && +((c.A2 ?? c.A1) ?? 0)>0) ? (((+((c.A2 ?? c.A1) ?? 0))*(+((c.A2 ?? c.A1) ?? 0)))/(+c.R)).toFixed(3) : ""}</td>

<td><input data-c-ds="${c.id}" type="text" inputmode="decimal" autocomplete="off" value="${c.ds ?? ""}" /></td>
                <td class="right"><button class="btn btn-ghost" data-c-del="${c.id}">削除</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>サマリ</h2>
      <div class="grid grid-3">
        <div><b>総延長</b>：<span class="kpi">${res.total.toFixed(3)} m</span></div>
        <div class="pill">警告 ${res.warnings.length} 件</div>
        <div class="pill">IP数 ${state.ipPoints.length}（使用 ${state.useIpCount}）</div>
      </div>
      ${res.warnings.map(w=>`<div class="warn">⚠ ${w}</div>`).join("")}
    </div>

    <div class="card">
      <h2>平面線形：簡易図（左/右が分かる）</h2>
      <div class="grid grid-3">
        <div>
          <label>図のサンプル間隔 ds(m)</label>
          <input id="plotStep" type="number" step="0.1" min="0.1" />
          <div class="mini">小さいほど滑らか（重くなる）</div>
        </div>
        <div>
          <label>表示</label>
          <div class="grid grid-2">
            <div><label class="mini"><input id="showKeypoints" type="checkbox" /> 主要点（TS/SC/CS/ST）</label></div>
            <div><label class="mini"><input id="showArrow" type="checkbox" /> 進行方向矢印</label></div>
          </div>
        </div>
        <div class="mini">凡例：直線/曲線（左）/曲線（右）</div>
      </div>

      <div class="sep"></div>
      <div class="grid grid-3">
        <div>
          <label>横断プロット</label>
          <label class="mini"><input id="planShowCross" type="checkbox" /> 横断プロット表示（横断タブのプレビューに連動）</label>
        </div>
        <div>
          <label>代表点の表示</label>
          <select id="planCrossMode">
            <option value="selected">選択中のみ</option>
            <option value="all">全部</option>
          </select>
          <div class="mini">横断方向線は常に表示</div>
        </div>
        <div class="mini">測点位置＋横断方向線＋代表点を平面図へプロット（右が＋）</div>
      </div>

      <div class="canvasWrap" style="margin-top:10px;">
        <canvas id="planCanvas" width="980" height="520"></canvas>
      </div>
      <div class="mini" style="margin-top:8px;">※iPadの回転/画面幅によっては横スクロールで見てね</div>
    </div>

    <div class="card">
      <h2>平面：追加測点（出力に統合）</h2>
      <div class="grid grid-3">
        <div class="mini">
          入力：追加距離(m) / k+rem（pitch=${pitch}m）<br/>
          区切り：空白・カンマ・改行
        </div>
        <div>
          <label>追加測点 追加入力</label>
          <textarea id="extraTokens_plan" placeholder="例：101.527 / 5+1.527 / 0+50.000 など"></textarea>
        </div>
        <div>
          <button class="btn" id="addExtras_plan">＋ 追加</button>
          <div style="height:10px;"></div>
          <button class="btn btn-ghost" id="clearExtras_plan">平面追加を全クリア</button>
        </div>
      </div>

      ${state.extraStations.plan.length ? `
      <div style="overflow:auto; margin-top:10px;">
        <table>
          <thead><tr><th>ID</th><th>測点表示</th><th>追加距離(m)</th><th class="right">削除</th></tr></thead>
          <tbody>
            ${state.extraStations.plan.map(x=>`
              <tr>
                <td>${x.id}</td>
                <td>${metersToStaPitch(x.m, pitch, 3)}</td>
                <td><input data-ex-group="plan" data-ex-id="${x.id}" type="number" step="0.001" value="${x.m}" /></td>
                <td class="right"><button class="btn btn-ghost" data-ex-group="plan" data-ex-del="${x.id}">削除</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : `<div class="mini" style="margin-top:10px;">（まだ平面の追加測点はありません）</div>`}
    </div>
  `;

  /* header bind */
  const inProjectName = document.getElementById("projectName");
  const commitProjectName = ()=>{ state.projectName = inProjectName.value; saveState(); render(); };
  inProjectName.onchange = commitProjectName;
  inProjectName.onblur = commitProjectName;
  document.getElementById("coordDecimals").onchange = (e)=>{ state.coordDecimals = parseInt(e.target.value,10)||3; saveState(); render(); };
  const inStaPitch = document.getElementById("staPitch");
  const commitStaPitch = ()=>{
    const t = String(inStaPitch.value ?? "").trim();
    const n = parseInt(t,10);
    if (!Number.isFinite(n) || n < 1) { render(); return; }
    state.staPitch = n;
    saveState(); render();
  };
  inStaPitch.onchange = commitStaPitch;
  inStaPitch.onblur = commitStaPitch;
  const inOutputStep = document.getElementById("outputStep");
  const commitOutputStep = ()=>{
    const t = String(inOutputStep.value ?? "").trim();
    const n = parseInt(t,10);
    if (!Number.isFinite(n) || n < 1) { render(); return; }
    state.outputStep = n;
    saveState(); render();
  };
  inOutputStep.onchange = commitOutputStep;
  inOutputStep.onblur = commitOutputStep;


  /* Plan import bind */
  (function(){
    const fi = document.getElementById("planImportFile");
    const btn = document.getElementById("btnPlanImport");
    const msg = document.getElementById("planImportMsg");
    if (!fi || !btn) return;
    btn.onclick = async ()=>{
      try{
        const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
        if (!file){ if (msg) msg.textContent = "ファイルを選択してください。"; return; }

        if (msg) msg.textContent = "読み込み中…";
        const text = await readLocalFileText(file);
        const name = String(file.name || "").toLowerCase();

        if (name.endsWith(".xrf") || text.trim().startsWith("<?xml")){
          const r = parseXrfRoadGM(text);
          applyPlanImport(r, "xrf", `XRF読み込み：IP ${r.ips.length}点 / 曲線設定 ${r.curveSettings.length}件`);
          return;
        }

        if ((name.endsWith(".sim") || name.endsWith(".sima"))){
          const r = parseSimaPlan(text);
          applyPlanImport(r, "sim", `SIMA読み込み：IP ${r.ips.length}点 / 曲線設定 ${r.curveSettings.length}件`);
          return;
        }

        throw new Error("拡張子が .sim / .sima / .xrf のファイルを選択してください");
      }catch(e){
        if (msg) msg.textContent = `読み込みエラー：${e && e.message ? e.message : e}`;
      }
    };
  })();

  /* Plan DXF import bind */
  (function(){
    const fi = document.getElementById("planDxfFile");
    const btn = document.getElementById("btnPlanDxfImport");
    const msg = document.getElementById("planDxfMsg");
    if (!fi || !btn) return;
    btn.onclick = async ()=>{
      try{
        const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
        if (!file){ if (msg) msg.textContent = "DXFファイルを選択してください。"; return; }

        // スマホは大容量DXFで落ちやすい（iOS白飛び/強制リロード対策）
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent||"");
        const LIMIT = 25 * 1024 * 1024; // 25MB
        if (isMobile && file.size > LIMIT){
          const mb = (file.size/1024/1024).toFixed(1);
          if (msg) msg.textContent = `DXFが${mb}MBあります。スマホ解析は25MB以下にしてください（PCで解析→JSON化して読み込む運用が安全です）。`;
          return;
        }
        if (msg) msg.textContent = "DXF解析中…";
        const dxfText = await readLocalFileText(file);

        // 1) まずは座標注記（BP/EP/IP）を優先で読む。
        // 2) 注記が無い場合は、中心線ポリラインの頂点から BP/EP/IP を生成してフォールバック。
        // 3) ただし座標が原点近傍（ローカル）なら「座標設定して下さい」として止める。
        let pl = null;
        const cp = dxfExtractPlanControlPoints(dxfText);
        if (cp && cp.BP && cp.EP){
          state.bp = { name:"BP", N: +cp.BP.N, E: +cp.BP.E };
          state.ep = { name:"EP", N: +cp.EP.N, E: +cp.EP.E };
          state.ipPoints = (cp.IP||[])
            .map((p)=>({ id: (Number.isFinite(p.idx)?p.idx:undefined), name: String(p.name||''), N:+p.N, E:+p.E }))
            .filter(p=>Number.isFinite(p.N)&&Number.isFinite(p.E))
            .sort((a,b)=>(a.id||0)-(b.id||0))
            .map((p,i)=>({ id: Number.isFinite(p.id)?p.id:(i+1), name: p.name || `IP${Number.isFinite(p.id)?p.id:(i+1)}`, N:p.N, E:p.E }));
          state.useIpCount = state.ipPoints.length;
        } else {
          // フォールバック：中心線（LWPOLYLINE）から作成
          pl = dxfBuildPlanFromCenterline(dxfText);
          if (!dxfIsLikelyGeoreferenced(pl.clPts)){
            throw new Error(
              "この平面DXFは、現場座標が設定されていない可能性があります（座標が原点近傍）。\n"+
              "図面の座標系を設定してから再度読み込んでください。\n"+
              "※BP/EP/IPの座標注記が無くても中心線から復元できますが、座標系が未設定だと現場座標になりません。"
            );
          }
          state.bp = { name:"BP", N: +pl.bp[1], E: +pl.bp[0] };
          state.ep = { name:"EP", N: +pl.ep[1], E: +pl.ep[0] };
          state.ipPoints = (pl.ips||[]).map((p,i)=>({ id:i+1, name:`IP${i+1}`, N:+p[1], E:+p[0] }));
          state.useIpCount = state.ipPoints.length;
        }


        // DXFからBP/EP/IPを更新したら、旧い曲線設定が残ると平面が描けないことがあるため一旦クリア
        state.curveSettings = [];
        // bridge -> cross6 overrides requires CL geometry (best-effort)
        try{
          if (!pl) pl = dxfBuildPlanFromCenterline(dxfText);
          const ranges = dxfFindBridgeRanges(dxfText, pl.clPts);
          if (ranges && ranges.length){
            const cross6 = getStdCrossTemplate(6);
            const commonBack = { right: cloneDeep(state.cross.right), left: cloneDeep(state.cross.left) };
            for (const r of ranges){
              const k1 = (+r.start).toFixed(3);
              const k2 = (+r.end).toFixed(3);
              state.cross.overrides[k1] = cross6;
              state.cross.overrides[k2] = commonBack;
            }
          }
        }catch(_){ /* bridge projection is best-effort */ }

        saveState(); render();
        if (msg) msg.textContent = cp ? `反映OK：BP/EP/IP 座標注記を読取り（IP ${state.ipPoints.length}点）`
                                      : `反映OK：中心線からBP/EP/IPを生成（IP ${state.ipPoints.length}点）`;
      }catch(e){
        if (msg) msg.textContent = `DXF読み込みエラー：${e && e.message ? e.message : e}`;
      }
    };
  })();
/* Plan JSON import bind */
(function(){
  const fi = document.getElementById("planJsonFile");
  const btn = document.getElementById("btnPlanJsonImport");
  const msg = document.getElementById("planJsonMsg");
  if (!fi || !btn) return;
  btn.onclick = async ()=>{
    try{
      const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
      if (!file){ if (msg) msg.textContent = "JSONファイルを選択してください。"; return; }
      if (msg) msg.textContent = "JSON読み込み中…";
      const txt = await readLocalFileText(file);
      const obj = asObjectFromJsonText(txt);
      if (!obj) throw new Error("JSONの解析に失敗しました。");
      applyPlanFromJsonObject(obj);
      // 反映後に整合を取る
      state.curveSettings = []; // 旧設定でコケるのを防止（必要なら後で復元）
      saveState();
      render();
      if (msg) msg.textContent = "JSONを平面に反映しました。";
    }catch(e){
      if (msg) msg.textContent = `JSON読み込みエラー：${e && e.message ? e.message : e}`;
    }
  };
})();

;


  /* Plan JSON import bind (partial apply: plan only) */
  (function(){
    const fi = document.getElementById("planJsonFile");
    const btn = document.getElementById("btnPlanJsonImport");
    const msg = document.getElementById("planJsonMsg");
    if (!fi || !btn) return;
    btn.onclick = async ()=>{
      try{
        const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
        if (!file){ if (msg) msg.textContent = 'JSONファイルを選択してください。'; return; }
        if (msg) msg.textContent = 'JSON読込中…';
        const text = await readLocalFileText(file);
        const obj = JSON.parse(text);
        const src = (obj && obj.projectName && obj.bp) ? obj : (obj && obj.state ? obj.state : obj);
        if (!src || !src.bp || !src.ep){ throw new Error('このJSONに平面（bp/ep）が見つかりません。'); }
        state.bp = cloneDeep(src.bp);
        state.ep = cloneDeep(src.ep);
        if (Array.isArray(src.ipPoints)){
          state.ipPoints = cloneDeep(src.ipPoints);
          state.useIpCount = state.ipPoints.length;
        }
        // 曲線設定は、IP点の整合が取れない場合が多いので基本クリア（必要なら後で再設定）
        state.curveSettings = Array.isArray(src.curveSettings) ? cloneDeep(src.curveSettings) : [];
        saveState(); render();
        if (msg) msg.textContent = `反映OK：平面JSON（IP ${state.ipPoints.length}点）`;
      }catch(e){
        if (msg) msg.textContent = `JSON読み込みエラー：${e && e.message ? e.message : e}`;
      }
    };
  })();


  /* Coord catalog bind */
  (function(){
    const inSearch = document.getElementById('coordSearch');
    if (inSearch) {
      inSearch.oninput = (e)=>{ uiState.coordSearch = e.target.value || ""; saveUI(); render(); };
    }

    const fi = document.getElementById('coordCsvFile');
    const btnLoad = document.getElementById('btnCoordLoad');
    const btnClear = document.getElementById('btnCoordClear');

    if (btnLoad) {
      btnLoad.onclick = async ()=>{
        try{
          const file = (fi && fi.files && fi.files[0]) ? fi.files[0] : null;
          if (!file) { alert('CSVファイルを選択してください'); return; }
          const txt = await readLocalFileText(file);
          const items = parseCoordCsv(txt);
          if (!items.length) { alert('有効な行が見つかりませんでした（名称,X,Y,Z）'); return; }
          state.coordCatalog = state.coordCatalog || { items: [], lastFile: '', lastLoadedAt: '' };
          state.coordCatalog.items = items;
          state.coordCatalog.lastFile = file.name || '';
          state.coordCatalog.lastLoadedAt = new Date().toLocaleString();
          saveState();
          if (fi) fi.value = '';
          render();
          alert(`座標一覧を読み込みました：${items.length}件`);
        }catch(e){
          alert('CSV読み込みに失敗: ' + (e && e.message ? e.message : e));
        }
      };
    }

    if (btnClear) {
      btnClear.onclick = ()=>{
        if (!confirm('座標一覧をクリアします。よろしい？')) return;
        state.coordCatalog = state.coordCatalog || { items: [], lastFile: '', lastLoadedAt: '' };
        state.coordCatalog.items = [];
        state.coordCatalog.lastFile = '';
        state.coordCatalog.lastLoadedAt = '';
        saveState();
        render();
      };
    }

    const getItem = (i)=>{
      const idx = parseInt(String(i), 10);
      if (!Number.isFinite(idx)) return null;
      const arr = state.coordCatalog && Array.isArray(state.coordCatalog.items) ? state.coordCatalog.items : [];
      return (idx>=0 && idx<arr.length) ? arr[idx] : null;
    };

    viewPlan.querySelectorAll('[data-cat-bp]').forEach(btn=>{
      btn.onclick = ()=>{
        const it = getItem(btn.getAttribute('data-cat-bp'));
        if (!it) return;
        state.bp.N = it.N; state.bp.E = it.E;
        saveState(); render();
      };
    });
    viewPlan.querySelectorAll('[data-cat-ep]').forEach(btn=>{
      btn.onclick = ()=>{
        const it = getItem(btn.getAttribute('data-cat-ep'));
        if (!it) return;
        state.ep.N = it.N; state.ep.E = it.E;
        saveState(); render();
      };
    });
    viewPlan.querySelectorAll('[data-cat-ip]').forEach(btn=>{
      btn.onclick = ()=>{
        const it = getItem(btn.getAttribute('data-cat-ip'));
        if (!it) return;
        const newId = Math.max(0, ...state.ipPoints.map(p=>p.id||0)) + 1;
        state.ipPoints.push({ id:newId, name:`IP${newId}`, N: it.N, E: it.E });
        state.useIpCount = Math.min(state.ipPoints.length, state.useIpCount + 1);
        renumberIpsNoGaps();
        saveState(); render();
      };
    });
  })();
  /* BP/EP bind */
  document.getElementById("bpN").value = state.bp.N;
  document.getElementById("bpE").value = state.bp.E;
  document.getElementById("epN").value = state.ep.N;
  document.getElementById("epE").value = state.ep.E;
  const in_bpN = document.getElementById("bpN");
const commit_bpN = ()=>{
  const t = String(in_bpN.value ?? "").trim();
  if (t === "") { render(); return; }
  const n = parseFloat(t.replace(/,/g,"."));
  if (!Number.isFinite(n)) { render(); return; }
  state.bp.N = n;
  saveState(); render();
};
in_bpN.onchange = commit_bpN;
in_bpN.onblur = commit_bpN;
  const in_bpE = document.getElementById("bpE");
const commit_bpE = ()=>{
  const t = String(in_bpE.value ?? "").trim();
  if (t === "") { render(); return; }
  const n = parseFloat(t.replace(/,/g,"."));
  if (!Number.isFinite(n)) { render(); return; }
  state.bp.E = n;
  saveState(); render();
};
in_bpE.onchange = commit_bpE;
in_bpE.onblur = commit_bpE;
  const in_epN = document.getElementById("epN");
const commit_epN = ()=>{
  const t = String(in_epN.value ?? "").trim();
  if (t === "") { render(); return; }
  const n = parseFloat(t.replace(/,/g,"."));
  if (!Number.isFinite(n)) { render(); return; }
  state.ep.N = n;
  saveState(); render();
};
in_epN.onchange = commit_epN;
in_epN.onblur = commit_epN;
  const in_epE = document.getElementById("epE");
const commit_epE = ()=>{
  const t = String(in_epE.value ?? "").trim();
  if (t === "") { render(); return; }
  const n = parseFloat(t.replace(/,/g,"."));
  if (!Number.isFinite(n)) { render(); return; }
  state.ep.E = n;
  saveState(); render();
};
in_epE.onchange = commit_epE;
in_epE.onblur = commit_epE;

  const useIp = document.getElementById("useIpCount");
  useIp.value = Math.max(0, Math.min(state.useIpCount, state.ipPoints.length));
  document.getElementById("useIpLabel").textContent = `${useIp.value} / ${state.ipPoints.length}`;
  useIp.oninput = (e)=>{ state.useIpCount = parseInt(e.target.value,10)||0; saveState(); render(); };

  document.getElementById("addIP").onclick = ()=>{
    const newId = Math.max(0, ...state.ipPoints.map(p=>p.id)) + 1;
    state.ipPoints.push({ id:newId, name:`IP${newId}`, N:0, E:0 });
    renumberIpsNoGaps();
    state.useIpCount = Math.min(state.ipPoints.length, state.useIpCount + 1);
    saveState(); render();
  };

  document.getElementById("resetDemo").onclick = ()=>{
    state.projectName="テスト案件";
    state.coordDecimals=3;
    state.staPitch=20;
    state.outputStep=20;
    state.dsSpiral=0.5;
    state.clothoidMode="A";
    state.bp={name:"BP",N:0,E:0};
    state.ep={name:"EP",N:0,E:500};
    state.ipPoints=[
      { id: 1, name:"IP1", N:0, E:0 },
      { id: 2, name:"IP2", N:0, E:200 },
      { id: 3, name:"IP3", N:150, E:350 },
    ];
    state.useIpCount=3;
    state.curveSettings=[{ id:1, ipName:"IP2", R:200, A1:100, A2:100, Ls:40, direction:"auto" }];

    renumberIpsNoGaps();
    state.extraStations=[];
    state.nextExtraId=1;

    state.profile.startSta = 0.0;
    state.profile.startZ = 0.0;
    state.profile.rows = [
      { id: 1, nextSta: 100.000, gradePct: 2.000, vcL: 60.000, vcYmax: null },
      { id: 2, nextSta: 300.000, gradePct: -1.000, vcL: null,  vcYmax: 0.100 },
      { id: 3, nextSta: 500.000, gradePct: 0.500, vcL: null, vcYmax: null },
    ];
    state.profile.nextRowId = 4;

    saveState(); render();
  };

  document.getElementById("delIP").onclick = ()=>{
    const sel = document.getElementById("delIpSel").value;
    if (!sel) return;
    const id = parseInt(sel,10);
    const delName = state.ipPoints.find(p=>p.id===id)?.name;
    state.ipPoints = state.ipPoints.filter(p=>p.id!==id);
    state.useIpCount = Math.min(state.useIpCount, state.ipPoints.length);
    const names = new Set(state.ipPoints.map(p=>p.name));
    state.curveSettings = state.curveSettings.filter(c=>names.has(c.ipName));
    if (delName) state.curveSettings = state.curveSettings.filter(c=>c.ipName!==delName);
    renumberIpsNoGaps();
    saveState(); render();
  };

  viewPlan.querySelectorAll("input[data-ip-name]").forEach(inp=>{
    const id = parseInt(inp.getAttribute("data-ip-name"),10);
    const commit = (e)=>{
      const p = state.ipPoints.find(x=>x.id===id);
      if (!p) return;
      const t = String(e.target.value ?? "").trim();
      if (t === "") { render(); return; }
      if (state.ipPoints.some(x=>x.id!==id && x.name===t)) { alert("IP名が重複しています"); render(); return; }
      const old = p.name;
      if (t !== old) {
        p.name = t;
        // 曲線設定の参照も追随
        state.curveSettings.forEach(c=>{ if(c.ipName===old) c.ipName = t; });
      }
      saveState(); render();
    };
    inp.onchange = commit;
    inp.onblur = commit;
  });
  viewPlan.querySelectorAll("input[data-ip-n]").forEach(inp=>{
    const id = parseInt(inp.getAttribute("data-ip-n"),10);
    const commit = (e)=>{
      const p = state.ipPoints.find(x=>x.id===id);
      if (!p) return;
      const t = String(e.target.value ?? "").trim();
      if (t === "") { render(); return; }
      const n = parseFloat(t.replace(/,/g,"."));
      if (!Number.isFinite(n)) { render(); return; }
      p.N = n;
      saveState(); render();
    };
    inp.onchange = commit;
    inp.onblur = commit;
  });
  viewPlan.querySelectorAll("input[data-ip-e]").forEach(inp=>{
    const id = parseInt(inp.getAttribute("data-ip-e"),10);
    const commit = (e)=>{
      const p = state.ipPoints.find(x=>x.id===id);
      if (!p) return;
      const t = String(e.target.value ?? "").trim();
      if (t === "") { render(); return; }
      const n = parseFloat(t.replace(/,/g,"."));
      if (!Number.isFinite(n)) { render(); return; }
      p.E = n;
      saveState(); render();
    };
    inp.onchange = commit;
    inp.onblur = commit;
  });

  document.getElementById("addCurve").onclick = ()=>{
    if (!state.ipPoints.length) return;
    const newId = Math.max(0, ...state.curveSettings.map(c=>c.id)) + 1;
    const defaultIP = state.ipPoints[Math.min(1, state.ipPoints.length-1)]?.name || state.ipPoints[0].name;
    state.curveSettings.push({ id:newId, ipName:defaultIP, R:200, A1:100, A2:100, Ls:40, direction:"auto" });
    saveState(); render();
  };

  viewPlan.querySelectorAll("select[data-c-ip]").forEach(sel=>{
    const id = parseInt(sel.getAttribute("data-c-ip"),10);
    sel.onchange = (e)=>{
      const c = state.curveSettings.find(x=>x.id===id);
      if (c) c.ipName = e.target.value;
      saveState(); render();
    };
  });
  viewPlan.querySelectorAll("select[data-c-dir]").forEach(sel=>{
    const id = parseInt(sel.getAttribute("data-c-dir"),10);
    sel.onchange = (e)=>{
      const c = state.curveSettings.find(x=>x.id===id);
      if (c) c.direction = e.target.value;
      saveState(); render();
    };
  });

  const bindNum = (attr, key, opt={ allowNull:true, min:null })=>{
  viewPlan.querySelectorAll(`input[${attr}]`).forEach(inp=>{
    const id = parseInt(inp.getAttribute(attr),10);
    const commit = (e)=>{
      const c = state.curveSettings.find(x=>x.id===id);
      if (!c) return;
      const t = String(e.target.value ?? "").trim();
      if (t === "") {
        if (opt.allowNull) c[key] = null;
        render(); return;
      }
      const n = parseFloat(t.replace(/,/g,"."));
      if (!Number.isFinite(n)) { render(); return; }
      if (opt.min != null && n < opt.min) { render(); return; }
      c[key] = n;
      saveState(); render();
    };
    inp.onchange = commit;
    inp.onblur = commit;
  });
};
bindNum("data-c-r","R", {allowNull:true, min:null});
bindNum("data-c-a1","A1", {allowNull:true, min:null});
bindNum("data-c-a2","A2", {allowNull:true, min:null});
bindNum("data-c-ds","ds", {allowNull:true, min:0.001});
viewPlan.querySelectorAll("button[data-c-del]").forEach(btn=>{
    const id = parseInt(btn.getAttribute("data-c-del"),10);
    btn.onclick = ()=>{
      state.curveSettings = state.curveSettings.filter(c=>c.id!==id);
      saveState(); render();
    };
  });

  document.getElementById("plotStep").value = state.plotStep;
  document.getElementById("showKeypoints").checked = !!state.showKeypoints;
  document.getElementById("showArrow").checked = !!state.showArrow;
  const inPlotStep = document.getElementById("plotStep");
  const commitPlotStep = ()=>{
    const t = String(inPlotStep.value ?? "").trim();
    if (t === "") { render(); return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { render(); return; }
    state.plotStep = Math.max(0.1, n);
    saveState(); render();
  };
  inPlotStep.onchange = commitPlotStep;
  inPlotStep.onblur = commitPlotStep;
  document.getElementById("showKeypoints").onchange = (e)=>{ state.showKeypoints = !!e.target.checked; saveState(); render(); };
  document.getElementById("showArrow").onchange = (e)=>{ state.showArrow = !!e.target.checked; saveState(); render(); };

  // plan cross overlay controls
  state.planOverlay = state.planOverlay || { showCross:false, crossMode:'selected' };
  const chkPlanCross = document.getElementById('planShowCross');
  const selPlanMode = document.getElementById('planCrossMode');
  if (chkPlanCross) chkPlanCross.checked = !!state.planOverlay.showCross;
  if (selPlanMode) selPlanMode.value = String(state.planOverlay.crossMode||'selected');
  if (chkPlanCross) chkPlanCross.onchange = (e)=>{ state.planOverlay.showCross = !!e.target.checked; saveState(); render(); };
  if (selPlanMode) selPlanMode.onchange = (e)=>{ state.planOverlay.crossMode = String(e.target.value||'selected'); saveState(); render(); };

  const canvas = document.getElementById("planCanvas");
  const crossCache = state.cross && state.cross.ui ? state.cross.ui.previewCache : null;
  const crossPickKey = String(state.cross?.ui?.previewPickKey||'');
  let crossOv = { enabled:false };
  if (state.planOverlay?.showCross && crossCache && Number.isFinite(crossCache.m)) {
    const sta = crossCache.m;
    const ptsAll = (crossCache.reps||[]).map(r=>({ key:r.key, label:r.label, x:r.x, isSelected: (r.key===crossPickKey) }));
    let pts = [];
    if (String(state.planOverlay.crossMode||'selected')==='all') {
      pts = ptsAll;
    } else {
      const sel = ptsAll.find(p=>p.key===crossPickKey);
      pts = sel ? [sel] : [];
    }
    // cross width from polyShift range
    const poly = crossCache.pts || [];
    let minX=0, maxX=0;
    if (poly.length) {
      minX = Math.min(...poly.map(p=>p.x));
      maxX = Math.max(...poly.map(p=>p.x));
    }
    const qp = crossCache.queryPoint || null;
    crossOv = { enabled:true, sta, Wleft: Math.max(0, -minX), Wright: Math.max(0, maxX), points: pts, queryPoint: qp };
  }

  drawPlanCanvas(canvas, res.segments, workPoints, res.keypoints, {
    plotStep: state.plotStep,
    showKeypoints: state.showKeypoints,
    showArrow: state.showArrow,
    crossOverlay: crossOv
  });


/* -------- PROFILE -------- */
const prof = state.profile || {enabled:false, startSta:0, startZ:0, grades:[], nextGradeId:1, vcurves:[], nextVcurveId:1};
const profModel = buildProfileModel(prof, res.total);
const pvInternal = (profModel.pv || []).slice(1, -1);
const pvKeys = new Set(pvInternal.map(p=>p.sta.toFixed(3)));
const vpiToA = new Map();
if (profModel.ok) {
  for (let i=1;i<profModel.pv.length-1;i++) {
    const key = profModel.pv[i].sta.toFixed(3);
    const prev = profModel.segments[i-1];
    const next = profModel.segments[i];
    const A = (next?.gDec ?? 0) - (prev?.gDec ?? 0);
    vpiToA.set(key, A);
  }
}

viewProfile.innerHTML = `
  <div class="card" id="secProfile">
    <h2>縦断線形（勾配区間 + 縦断曲線：VPI単位）</h2>

    <div class="grid grid-2" style="margin-top:8px;">
      <div>
        <label>縦断図DXF（ASCII .dxf）</label>
        <input id="profileDxfFile" type="file" accept=".dxf,text/plain" />
        <div class="mini">箱書き表（累加距離×計画高）を探索し、縦断（startSta/startZ + grades）へ自動反映します。<br/>※DXF解析はPC推奨（スマホは25MB以下）。</div>
      </div>
      <div>
        <label>読み込み</label>
        <button class="btn" id="btnProfileDxfImport">DXFを解析して反映</button>
        <div id="profileDxfMsg" class="mini" style="margin-top:8px;"></div>
      </div>
    </div>
<div class="grid grid-2" style="margin-top:10px;">
  <div>
    <label>解析済みJSON（縦断だけ / 全stateでもOK）</label>
    <input id="profileJsonFile" type="file" accept="application/json" />
    <div class="mini">profile（startSta/startZ/grades/vcurves）をJSONから反映します。</div>
  </div>
  <div>
    <label>読み込み</label>
    <button class="btn btn-ok" id="btnProfileJsonImport">JSONを反映</button>
    <button class="btn" id="btnProfileJsonExport">縦断JSONを書き出し</button>
    <div id="profileJsonMsg" class="mini" style="margin-top:8px;"></div>
  </div>
</div>



    <div class="grid grid-4">
      <div>
        <label class="mini"><input id="profEnabled" type="checkbox" /> 縦断を使う（GL出力）</label>
        <div class="mini">勾配%：小数3桁（例 2.534%） / ymax：小数3桁（例 0.145m）</div>
      </div>
      <div>
        <button class="btn" id="addGradeRow">＋ 勾配区間追加</button>
        <div style="height:10px;"></div>
        <button class="btn btn-ghost" id="sortGradeRow">測点で整列</button>
      </div>
      <div>
        <button class="btn btn-ok" id="setEndToTotal">終点を平面総延長にセット</button>
        <div class="mini" style="margin-top:8px;">最後の勾配区間の nextSta を ${res.total.toFixed(3)}m にします</div>
      </div>
      <div class="mini">
        <b>平面総延長</b>：${res.total.toFixed(3)} m<br/>
        <b>PV点</b>：${profModel.pv.length} / <b>曲線</b>：${profModel.curves.length}<br/>
        <span class="pill">警告 ${profModel.warnings.length} 件</span>
      </div>
    </div>

    <div class="sep"></div>

    <div class="grid grid-3">
      <div><label>勾配起点 測点(m)</label><input id="startSta" type="number" step="0.001" value="${Number(prof.startSta||0).toFixed(3)}"/></div>
      <div><label>勾配起点 標高(m)</label><input id="startZ" type="number" step="0.001" value="${Number(prof.startZ||0).toFixed(3)}"/></div>
      <div class="mini">
        参考：測点表示（pitch=${pitch}m）: ${metersToStaPitch(res.total, pitch, 3)}
      </div>
    </div>

    <div style="overflow:auto; margin-top:10px;">
      <table>
        <thead>
          <tr>
            <th>次の測点(m)</th>
            <th>勾配(%)</th>
            <th class="right">削除</th>
          </tr>
        </thead>
        <tbody>
          ${(prof.grades||[]).map(r=>`
            <tr>
              <td><input data-g-nextsta="${r.id}" type="number" step="0.001" value="${Number(r.nextSta??0).toFixed(3)}"/></td>
              <td><input data-g-grade="${r.id}" type="number" step="0.001" value="${Number(r.gradePct??0).toFixed(3)}"/></td>
              <td class="right"><button class="btn btn-ghost" data-g-del="${r.id}">削除</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${profModel.warnings.map(w=>`<div class="warn">⚠ ${w}</div>`).join("")}

<div class="sep"></div>

<h3>縦断：簡易縦断図</h3>
<div class="grid grid-3">
  <div>
    <label>図のサンプル間隔 ds(m)</label>
    <input id="profPlotStep" type="text" inputmode="decimal" autocomplete="off" />
    <div class="mini">小さいほど滑らか（重くなる）</div>
  </div>
  <div>
    <label>表示</label>
    <div class="grid grid-2">
      <div><label class="mini"><input id="profShowPV" type="checkbox" /> PV点</label></div>
      <div><label class="mini"><input id="profShowVC" type="checkbox" /> 縦断曲線</label></div>
    </div>
  </div>
  <div class="mini">
    範囲：0.000m 〜 ${res.total.toFixed(3)}m
  </div>
</div>

<div class="canvasWrap" style="margin-top:10px;">
  <canvas id="profileCanvas" width="980" height="340"></canvas>
</div>
<div class="mini" style="margin-top:8px;">※測点×標高（GL）。縦断曲線は青で強調</div>

  </div>

  <div class="card">
    <h2>縦断曲線（VPI単位で管理）</h2>
    <div class="grid grid-3">
      <div class="mini">
        VPIは「PV点（勾配の折点）」から選択。<br/>
        <b>L優先</b>。Lが空のときは ymax から <b>L=8*ymax/|A|</b> で換算（A=勾配差）。
      </div>
      <div>
        <button class="btn" id="addVcurve">＋ 縦断曲線追加</button>
        <div style="height:10px;"></div>
        <button class="btn btn-ghost" id="sortVcurve">VPIで整列</button>
      </div>
      <div class="mini">
        PV候補：${pvInternal.length} 点（内部PVのみ）
      </div>
    </div>

    <div style="overflow:auto; margin-top:10px;">
      <table>
        <thead>
          <tr>
            <th>VPI</th>
            <th>Δg(%)</th>
            <th>曲線長 L(m)</th>
            <th>ymax(m)</th>
            <th class="right">削除</th>
          </tr>
        </thead>
        <tbody>
          ${(prof.vcurves||[]).map(r=>{
            const k = (Number(r.vpiSta)||0).toFixed(3);
            const A = (vpiToA.get(k) ?? 0) * 100;
            const extraOpt = pvKeys.has(k) ? "" : `<option value="${k}" selected>（PVに無い） ${k}m</option>`;
            const opts = pvInternal.map(p=>{
              const v = p.sta.toFixed(3);
              const sel = (v===k) ? "selected" : "";
              return `<option value="${v}" ${sel}>${metersToStaPitch(p.sta, pitch, 3)} (${v}m)</option>`;
            }).join("");
            return `
              <tr>
                <td>
                  <select data-vc-vpi="${r.id}">
                    ${extraOpt}
                    ${opts}
                  </select>
                </td>
                <td>${A.toFixed(3)}</td>
                <td><input data-vc-l="${r.id}" type="number" step="0.001" value="${(r.L==null||r.L==="")?"":Number(r.L).toFixed(3)}" placeholder="例 80.000"/></td>
                <td><input data-vc-y="${r.id}" type="number" step="0.001" value="${(r.ymax==null||r.ymax==="")?"":Number(r.ymax).toFixed(3)}" placeholder="例 0.145"/></td>
                <td class="right"><button class="btn btn-ghost" data-vc-del="${r.id}">削除</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="mini" style="margin-top:8px;">※縦断曲線は対称（BVC=VPI-L/2, EVC=VPI+L/2）</div>
  </div>

  <div class="card">
    <h2>縦断：追加測点（出力に統合）</h2>
    <div class="grid grid-3">
      <div class="mini">
        入力：追加距離(m) / k+rem（pitch=${pitch}m）<br/>
        区切り：空白・カンマ・改行
      </div>
      <div>
        <label>追加測点 追加入力</label>
        <textarea id="extraTokens_profile" placeholder="例：101.527 / 5+1.527 / 0+50.000 など"></textarea>
      </div>
      <div>
        <button class="btn" id="addExtras_profile">＋ 追加</button>
        <div style="height:10px;"></div>
        <button class="btn btn-ghost" id="clearExtras_profile">縦断追加を全クリア</button>
      </div>
    </div>

    ${state.extraStations.profile.length ? `
    <div style="overflow:auto; margin-top:10px;">
      <table>
        <thead><tr><th>ID</th><th>測点表示</th><th>追加距離(m)</th><th class="right">削除</th></tr></thead>
        <tbody>
          ${state.extraStations.profile.map(x=>`
            <tr>
              <td>${x.id}</td>
              <td>${metersToStaPitch(x.m, pitch, 3)}</td>
              <td><input data-ex-group="profile" data-ex-id="${x.id}" type="number" step="0.001" value="${x.m}" /></td>
              <td class="right"><button class="btn btn-ghost" data-ex-group="profile" data-ex-del="${x.id}">削除</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>` : `<div class="mini" style="margin-top:10px;">（まだ縦断の追加測点はありません）</div>`}
  </div>
`;

document.getElementById("profEnabled").checked = !!prof.enabled;
document.getElementById("profEnabled").onchange = (e)=>{ state.profile.enabled = !!e.target.checked; saveState(); render(); };

/* Profile DXF import bind */
(function(){
  const fi = document.getElementById('profileDxfFile');
  const btn = document.getElementById('btnProfileDxfImport');
  const msg = document.getElementById('profileDxfMsg');
  if (!fi || !btn) return;
  btn.onclick = async ()=>{
    try{
      const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
      if (!file){ if (msg) msg.textContent = 'DXFファイルを選択してください。'; return; }


      // スマホは大容量DXFで落ちやすい（iOS白飛び/強制リロード対策）
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent||"");
      const LIMIT = 25 * 1024 * 1024; // 25MB
      if (isMobile && file.size > LIMIT){
        const mb = (file.size/1024/1024).toFixed(1);
        if (msg) msg.textContent = `DXFが${mb}MBあります。スマホ解析は25MB以下にしてください（PCで解析→JSON化して読み込む運用が安全です）。`;
        return;
      }
      if (msg) msg.textContent = 'DXF解析中…';
      const dxfText = await readLocalFileText(file);
      const pr = dxfBuildProfileFromBoxTable(dxfText);

      // apply
      state.profile.startSta = pr.startSta;
      state.profile.startZ = pr.startZ;
      state.profile.grades = pr.grades.map((r,i)=>({ id:i+1, nextSta: r.nextSta, gradePct: r.gradePct }));
      state.profile.nextGradeId = state.profile.grades.length + 1;

      // clear v-curves (DXF box table usually does not include them)
      state.profile.vcurves = [];
      state.profile.nextVcurveId = 1;

      saveState(); render();
      if (msg) msg.textContent = `反映OK：点 ${pr.grades.length+1}、勾配区間 ${pr.grades.length}件`;
    }catch(e){
      if (msg) msg.textContent = `DXF読み込みエラー：${e && e.message ? e.message : e}`;
    }
  };
})();
/* Profile JSON import bind */
(function(){
  const fi = document.getElementById('profileJsonFile');
  const btn = document.getElementById('btnProfileJsonImport');
  const msg = document.getElementById('profileJsonMsg');
  if (!fi || !btn) return;
  btn.onclick = async ()=>{
    try{
      const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
      if (!file){ if (msg) msg.textContent = 'JSONファイルを選択してください。'; return; }
      if (msg) msg.textContent = 'JSON読み込み中…';
      const txt = await readLocalFileText(file);
      const obj = asObjectFromJsonText(txt);
      if (!obj) throw new Error('JSONの解析に失敗しました。');
      applyProfileFromJsonObject(obj);
      saveState();
      render();
      if (msg) msg.textContent = 'JSONを縦断に反映しました。';
    }catch(e){
      if (msg) msg.textContent = `JSON読み込みエラー：${e && e.message ? e.message : e}`;
    }
  };
})();

;
const inStartSta = document.getElementById("startSta");
  const commitStartSta = ()=>{
    const t = String(inStartSta.value ?? "").trim();
    if (t === "") { render(); return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { render(); return; }
    state.profile.startSta = n;
    saveState(); render();
  };
  inStartSta.onchange = commitStartSta;
  inStartSta.onblur = commitStartSta;
const inStartZ = document.getElementById("startZ");
  const commitStartZ = ()=>{
    const t = String(inStartZ.value ?? "").trim();
    if (t === "") { render(); return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { render(); return; }
    state.profile.startZ = n;
    saveState(); render();
  };
  inStartZ.onchange = commitStartZ;
  inStartZ.onblur = commitStartZ;

document.getElementById("addGradeRow").onclick = ()=>{
  state.profile.grades.push({ id: state.profile.nextGradeId++, nextSta: 0.000, gradePct: 0.000 });
  saveState(); render();
};
document.getElementById("sortGradeRow").onclick = ()=>{
  state.profile.grades.sort((a,b)=> (Number(a.nextSta)||0) - (Number(b.nextSta)||0));
  saveState(); render();
};
document.getElementById("setEndToTotal").onclick = ()=>{
  const total = Number(res.total||0);
  if (!state.profile.grades.length) {
    state.profile.grades.push({ id: state.profile.nextGradeId++, nextSta: total, gradePct: 0.000 });
  } else {
    let idx = 0;
    for (let i=1;i<state.profile.grades.length;i++){
      if ((Number(state.profile.grades[i].nextSta)||0) >= (Number(state.profile.grades[idx].nextSta)||0)) idx = i;
    }
    state.profile.grades[idx].nextSta = Number(total.toFixed(3));
  }
  state.profile.grades.sort((a,b)=> (Number(a.nextSta)||0) - (Number(b.nextSta)||0));
  saveState(); render();
};

viewProfile.querySelectorAll("input[data-g-nextsta]").forEach(inp=>{
  const id = parseInt(inp.getAttribute("data-g-nextsta"),10);
  const apply = (v, commit=false)=>{
    const r = state.profile.grades.find(x=>x.id===id);
    if (!r) return;
    const t = String(v ?? "").trim();
    if (t === "") { if (commit) render(); return; } // 空欄は未確定扱い
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { if (commit) render(); return; }
    r.nextSta = n;
    if (commit) { saveState(); render(); }
  };
  inp.oninput  = (e)=> apply(e.target.value, false);
  inp.onchange = (e)=> apply(e.target.value, true);
  inp.onblur   = inp.onchange;
});
viewProfile.querySelectorAll("input[data-g-grade]").forEach(inp=>{
  const id = parseInt(inp.getAttribute("data-g-grade"),10);
  const apply = (v, commit=false)=>{
    const r = state.profile.grades.find(x=>x.id===id);
    if (!r) return;
    const t = String(v ?? "").trim();
    if (t === "") { if (commit) render(); return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { if (commit) render(); return; }
    r.gradePct = n;
    if (commit) { saveState(); render(); }
  };
  inp.oninput  = (e)=> apply(e.target.value, false);
  inp.onchange = (e)=> apply(e.target.value, true);
  inp.onblur   = inp.onchange;
});
viewProfile.querySelectorAll("button[data-g-del]").forEach(btn=>{
  const id = parseInt(btn.getAttribute("data-g-del"),10);
  btn.onclick = ()=>{
    state.profile.grades = state.profile.grades.filter(x=>x.id!==id);
    saveState(); render();
  };
});

const addVcurveBtn = document.getElementById("addVcurve");
if (addVcurveBtn) {
  addVcurveBtn.onclick = ()=>{
    // 入力中の値が state に反映されるよう、まずフォーカスを外す（iPad対策）
    try { if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur(); } catch(e){}
    if (!pvInternal.length) {
      alert("PV点がありません。先に勾配区間を入れてください");
      return;
    }
    // なるべく未使用のPVを選ぶ
    const used = new Set((state.profile.vcurves||[]).map(x=>(Number(x.vpiSta)||0).toFixed(3)));
    const pick = pvInternal.find(p=>!used.has(p.sta.toFixed(3))) || pvInternal[0];
    state.profile.vcurves.push({ id: state.profile.nextVcurveId++, vpiSta: Number(pick.sta.toFixed(3)), L: null, ymax: null });
    saveState(); render();
  };
}
const sortVcurveBtn = document.getElementById("sortVcurve");
if (sortVcurveBtn) {
  sortVcurveBtn.onclick = ()=>{
    try { if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur(); } catch(e){}
    state.profile.vcurves.sort((a,b)=> (Number(a.vpiSta)||0) - (Number(b.vpiSta)||0));
    saveState(); render();
  };
}

viewProfile.querySelectorAll("select[data-vc-vpi]").forEach(sel=>{
  const id = parseInt(sel.getAttribute("data-vc-vpi"),10);
  sel.onchange = (e)=>{
    const r = state.profile.vcurves.find(x=>x.id===id);
    if (!r) return;
    const t = String(e.target.value ?? "").trim();
    if (t === "") { render(); return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { render(); return; }
    r.vpiSta = n;
    saveState(); render();
  };
  sel.onblur = sel.onchange;
});
viewProfile.querySelectorAll("input[data-vc-l]").forEach(inp=>{
  const id = parseInt(inp.getAttribute("data-vc-l"),10);
  const apply = (v, commit=false)=>{
    const r = state.profile.vcurves.find(x=>x.id===id);
    if (!r) return;
    const t = String(v ?? "").trim();
    if (t === "") { r.L = null; if (commit) { saveState(); render(); } return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { if (commit) render(); return; } // 途中入力は保持
    r.L = n;
    if (commit) { saveState(); render(); }
  };
  inp.oninput  = (e)=> apply(e.target.value, false);  // 入力中は再描画しない
  inp.onchange = (e)=> apply(e.target.value, true);
  inp.onblur   = inp.onchange;
});
viewProfile.querySelectorAll("input[data-vc-y]").forEach(inp=>{
  const id = parseInt(inp.getAttribute("data-vc-y"),10);
  const apply = (v, commit=false)=>{
    const r = state.profile.vcurves.find(x=>x.id===id);
    if (!r) return;
    const t = String(v ?? "").trim();
    if (t === "") { r.ymax = null; if (commit) { saveState(); render(); } return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { if (commit) render(); return; }
    r.ymax = n;
    if (commit) { saveState(); render(); }
  };
  inp.oninput  = (e)=> apply(e.target.value, false);
  inp.onchange = (e)=> apply(e.target.value, true);
  inp.onblur   = inp.onchange;
});
viewProfile.querySelectorAll("button[data-vc-del]").forEach(btn=>{
  const id = parseInt(btn.getAttribute("data-vc-del"),10);
  btn.onclick = ()=>{
    state.profile.vcurves = state.profile.vcurves.filter(x=>x.id!==id);
    saveState(); render();
  };
});

// --- profile diagram controls & draw ---
const inProfPlot = document.getElementById("profPlotStep");
if (inProfPlot) {
  const v = Number(state.profilePlotStep ?? 5.0);
  inProfPlot.value = Number.isFinite(v) ? v.toFixed(1) : "5.0";
  const commitProfPlot = ()=>{
    const t = String(inProfPlot.value ?? "").trim();
    if (t === "") { render(); return; }
    const n = parseFloat(t.replace(/,/g,"."));
    if (!Number.isFinite(n)) { render(); return; }
    state.profilePlotStep = Math.max(0.1, n);
    saveState(); render();
  };
  inProfPlot.onchange = commitProfPlot;
  inProfPlot.onblur = commitProfPlot;
}

const cbPV = document.getElementById("profShowPV");
const cbVC = document.getElementById("profShowVC");
if (cbPV) cbPV.checked = !!state.profileShowPV;
if (cbVC) cbVC.checked = !!state.profileShowVC;
if (cbPV) cbPV.onchange = (e)=>{ state.profileShowPV = !!e.target.checked; saveState(); render(); };
if (cbVC) cbVC.onchange = (e)=>{ state.profileShowVC = !!e.target.checked; saveState(); render(); };

const profCanvas = document.getElementById("profileCanvas");
if (profCanvas) {
  drawProfileCanvas(profCanvas, profModel, res.total, {
    plotStep: state.profilePlotStep,
    showPV: state.profileShowPV,
    showVC: state.profileShowVC,
    pitch
  });
}

bindExtraUI("profile", viewProfile, pitch);

/* -------- CROSS -------- */
  ensureCrossState();
  ensureElemCommonInitialized();
  syncCrossActiveSegsFromElems();
const cr = computeCrossSide("common", "right");
  const cl = computeCrossSide("common", "left");

  const selKey = state.cross.ui.selectedStaKey || "";
  const hasSel = !!(selKey && state.cross.overrides && state.cross.overrides[selKey]);
  const or = hasSel ? computeCrossSide("ovr", "right", selKey) : null;
  const ol = hasSel ? computeCrossSide("ovr", "left",  selKey) : null;

  const crossRowsHtml = (scope, side, staKey)=>{
    const store = getCrossStore(scope, side, staKey);
    const segs = (store.segs||[]).slice().sort((a,b)=>{
      const ea = Number(a && a.end) || 0;
      const eb = Number(b && b.end) || 0;
      if (Math.abs(ea-eb) > 1e-12) return ea-eb;
      return (Number(a && a.id)||0) - (Number(b && b.id)||0);
    });
    const staAttr = (scope === "ovr" && staKey) ? ` data-xs-sta="${staKey}"` : "";

    if (!segs.length) {
      return `<tr><td colspan="9" class="mini">（まだ区間がありません）</td></tr>`;
    }

    let start = 0;
    let z = 0;
    const out = [];

    for (const r of segs) {
      const end = Number(r.end);
      const mode = (r && typeof r.mode === 'string') ? r.mode : 'pct';
      const ratioX = Number.isFinite(Number(r && r.ratioX)) ? Number(r.ratioX) : 20;
      const ratioDir = (r && (r.ratioDir === 'up' || r.ratioDir === 'down')) ? r.ratioDir : ((Number(r && r.slopePct)||0) >= 0 ? 'up' : 'down');
      const slopePctRaw = Number(r && r.slopePct)||0;
      const slopePct = crossRowSlopePct(r);
      const stepDz = crossRowStepDz(r);
      const stepAbs = Math.abs(Number(stepDz)||0);
      const stepAbsText = (r && typeof r.stepAbsText === 'string') ? r.stepAbsText : stepAbs.toFixed(3);
      const stepDir = (r && (r.stepDir==='up' || r.stepDir==='down')) ? r.stepDir : ((Number(stepDz)||0) >= 0 ? 'up' : 'down');
      const wbText = (r && typeof r.wb === 'string') ? r.wb : '';
      const wbInfo = parseWaribun(wbText);
      let wbPreviewPct = null;
      if (wbInfo && Number.isFinite(wbInfo.pctAbs) && wbInfo.pctAbs > 0) {
        const cur = Number(r && r.slopePct) || 0;
        const sgn = wbInfo.signSpecified ? ((wbInfo.pctSigned < 0) ? -1 : 1) : ((cur < 0) ? -1 : 1);
        wbPreviewPct = sgn * wbInfo.pctAbs;
      }

      const span = (Number.isFinite(end) ? (end - start) : NaN);
      const dzSlope = Number.isFinite(span) ? (slopePct/100.0)*span : NaN;
      if (Number.isFinite(dzSlope)) z += dzSlope;
      if (Number.isFinite(stepDz) && Math.abs(stepDz) > 0) z += stepDz;

      out.push(`
        <tr>
          <td class="right">${start.toFixed(3)}</td>
          <td><input data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-end type="number" step="0.001" value="${Number.isFinite(end)?end:0}" /></td>
          <td>
            <select data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-mode>
              <option value="pct" ${mode==='pct'?'selected':''}>%勾配</option>
              <option value="ratio" ${mode==='ratio'?'selected':''}>1:X</option>
            </select>
          </td>
          <td>
            ${mode==='pct' ? `
              <input data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-slope type="number" step="0.001" value="${slopePctRaw.toFixed(3)}" />
              <div class="mini">（+上がり / -下がり）</div>
              <div class="row" style="gap:6px; align-items:center; margin-top:6px;">
                <span class="mini">割分</span>
                <input data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-wb type="text" value="${xmlEscape(wbText)}" placeholder="例: 1割5分 / 5分 / 2分5厘 / 0.5(=5%)" style="width:190px;" />
              </div>
              ${wbPreviewPct!=null ? `<div class="mini">→ ${wbPreviewPct.toFixed(3)}%（1:${(100.0/Math.max(1e-9, Math.abs(wbPreviewPct))).toFixed(3)}）</div>` : `<div class="mini">（割/分/厘 または %。数値のみは 0.5=5% / 5=5%）</div>`}
            ` : `
              <div class="row" style="gap:6px; align-items:center;">
                <span>1:</span>
                <input data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-ratiox type="number" step="0.001" min="0" value="${ratioX.toFixed(3)}" style="width:110px;" />
                <select data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-ratiodir>
                  <option value="up" ${ratioDir==='up'?'selected':''}>上がり</option>
                  <option value="down" ${ratioDir==='down'?'selected':''}>下がり</option>
                </select>
              </div>
              <div class="mini">換算：${slopePct.toFixed(3)}%（例：5%は 1:20）</div>
            `}
          </td>
          <td>
            <div class="row" style="gap:6px; align-items:center;">
              <input data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-stepabs type="text" inputmode="decimal" value="${xmlEscape(stepAbsText)}" style="width:110px;" />
              <select data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-id="${r.id}" data-xs-stepdir>
                <option value="up" ${stepDir==='up'?'selected':''}>上</option>
                <option value="down" ${stepDir==='down'?'selected':''}>下</option>
              </select>
            </div>
            <div class="mini">段差（この終了点で瞬時に反映）</div>
          </td>
          <td class="right">${Number.isFinite(dzSlope)?dzSlope.toFixed(3):""}</td>
          <td class="right">${Number.isFinite(stepDz)?stepDz.toFixed(3):""}</td>
          <td class="right">${Number.isFinite(z)?z.toFixed(3):""}</td>
          <td class="right"><button class="btn btn-ghost" data-xs-scope="${scope}"${staAttr} data-xs-side="${side}" data-xs-del="${r.id}">削除</button></td>
        </tr>
      `);

      if (Number.isFinite(end)) start = end;
    }

    return out.join("");
  };

  const warnHtml = (arr)=> arr && arr.length ? `<div class="warn">${arr.join(" / ")}</div>` : "";

  const ovKeys = Object.keys(state.cross.overrides||{}).slice().sort((a,b)=> (Number(a)||0) - (Number(b)||0));
  const ovOptions = ovKeys.map(k=>{
    const m = Number(k);
    const label = Number.isFinite(m) ? `${metersToStaPitch(m, pitch, 3)} (${k}m)` : k;
    const sel = (k===selKey) ? "selected" : "";
    return `<option value="${k}" ${sel}>${label}</option>`;
  }).join("");

  viewCross.innerHTML = `
    <div class="card" id="secCross">
      <h2>横断：エレメント（中心 → 外側）</h2>
      <div class="row" id="xsEditTargetRow" style="margin-top:6px; align-items:center;">
        <div class="mini" id="xsEditTargetInfo" style="flex:1;"></div>
        <button class="btn btn-ok" id="xsPromoteStandardToOverride" style="display:none;">この測点を例外として保存</button>
      </div>
      <div class="mini">中心から外側へ、任意距離で勾配変化点を作れます。距離は自動で昇順に整列されます。</div>

      <div class="grid grid-2" style="margin-top:10px;">
        <div>
          <label>標準横断DXF（ASCII .dxf）</label>
          <input id="crossDxfFile" type="file" accept=".dxf,text/plain" />
          <div class="mini">標準横断図（4/5/6など）で、CL付近のSTA表記を拾って測点別例外に登録します。橋梁区間の“共通断面（⑥）”は平面DXF読込で割当するのが基本です。<br/>※DXF解析はPC推奨（スマホは25MB以下）。</div>
        </div>
        <div>
          <label>読み込み</label>
          <button class="btn" id="btnCrossDxfImport">DXFを解析して反映</button>
          <div id="crossDxfMsg" class="mini" style="margin-top:8px;"></div>
        </div>
      </div>
<div class="grid grid-2" style="margin-top:10px;">
  <div>
    <label>解析済みJSON（横断だけ / 全stateでもOK）</label>
    <input id="crossJsonFile" type="file" accept="application/json" />
    <div class="mini">cross（right/left/overridesなど）をJSONから反映します。</div>
  </div>
  <div>
    <label>読み込み</label>
    <button class="btn btn-ok" id="btnCrossJsonImport">JSONを反映</button>
    <button class="btn" id="btnCrossJsonExport">横断JSONを書き出し</button>
    <div id="crossJsonMsg" class="mini" style="margin-top:8px;"></div>
  </div>
</div>




      <div class="sep"></div>
      <h2 style="margin-top:0;">横断作成済み全STA一覧（図面STA）</h2>
      <div class="mini">図面から取得したSTAだけを距離の短い順に表示します。〔標準〕はテンプレ適用、〔例外〕は測点別断面が存在します。</div>

      <div class="row" style="margin-top:10px; align-items:flex-end;">
        <div style="width:320px; max-width:100%;">
          <label>STA（距離昇順 / 標準・例外タグ付き）</label>
          <select id="xsAllStaSel">
            <option value="">（選択なし）</option>
          </select>
        </div>
        <div style="width:200px;">
          <label>編集</label>
          <button class="btn" id="xsAllStaEditBtn">このSTAを編集対象にする</button>
        </div>
        <div style="flex:1; min-width:240px;">
          <div class="mini" id="xsAllStaMsg"></div>
        </div>
      </div>

      <div class="row" style="margin-top:10px;">
        <div style="width:200px;">
          <label>横断範囲（クリップ） 右(+)(m)</label>
          <input id="bulkCrossEnd_right" type="number" step="0.001" min="0" value="${Number(state.cross.xrangeDefault?.R||cr.lastEnd).toFixed(3)}" />
        </div>
        <div style="width:200px;">
          <label>横断範囲（クリップ） 左(-)(m)</label>
          <input id="bulkCrossEnd_left" type="number" step="0.001" min="0" value="${Number(state.cross.xrangeDefault?.L||cl.lastEnd).toFixed(3)}" />
        </div>
        <div style="flex:1; min-width:200px;">
          <label>一括適用</label>
          <button class="btn" id="applyBulkCrossEnd">横断範囲を一括更新</button>
          <div class="mini" style="margin-top:6px;">
            <label class="mini"><input id="bulkAffectOverrides" type="checkbox" checked /> 測点別の例外にも適用</label>
          </div>
        </div>

      </div>

      <div class="grid grid-2" style="margin-top:10px;">
        <div>
          <div class="pill">右側（+）エレメント（${(state.cross.ui?.elemMode==="override")?"例外":"標準"}）</div>
          <div class="mini">行をタップで選択（iPhone互換のため並べ替えは一旦停止）</div>
          <div id="xsElemList_right" class="xsElemList">
            ${renderCrossElemListHtml("right")}
          </div>
          <div class="row" style="margin-top:8px;">
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="PAV" data-xs-side="right">＋ 路面(%)</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="STEP" data-xs-side="right">＋ 段差</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="SLOPE_H" data-xs-side="right">＋ 法面(H)</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="SLOPE_EXT" data-xs-side="right">＋ 法面(延長)</button></div>
          </div>
        </div>
        <div>
          <div class="pill">左側（-）エレメント（${(state.cross.ui?.elemMode==="override")?"例外":"標準"}）</div>
          <div class="mini">行をタップで選択（iPhone互換のため並べ替えは一旦停止）</div>
          <div id="xsElemList_left" class="xsElemList">
            ${renderCrossElemListHtml("left")}
          </div>
          <div class="row" style="margin-top:8px;">
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="PAV" data-xs-side="left">＋ 路面(%)</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="STEP" data-xs-side="left">＋ 段差</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="SLOPE_H" data-xs-side="left">＋ 法面(H)</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" data-xs-add="SLOPE_EXT" data-xs-side="left">＋ 法面(延長)</button></div>
          </div>
        </div>
      </div>

      <div class="sep"></div>
      <div class="row" style="margin-top:0; align-items:flex-end;">
        <div style="flex:1; min-width:220px;">
          <label>左右コピー</label>
          <div class="row" style="margin-top:0;">
            <div style="flex:1; min-width:160px;"><button class="btn btn-ghost" id="xsCopy_r2l_all">右→左（全部）</button></div>
            <div style="flex:1; min-width:180px;"><button class="btn btn-ghost" id="xsCopy_r2l_to">右→左（ここまで）</button></div>
            <div style="flex:1; min-width:160px;"><button class="btn btn-ghost" id="xsCopy_r2l_row">右→左（行だけ）</button></div>
          </div>
          <div class="row" style="margin-top:0;">
            <div style="flex:1; min-width:160px;"><button class="btn btn-ghost" id="xsCopy_l2r_all">左→右（全部）</button></div>
            <div style="flex:1; min-width:180px;"><button class="btn btn-ghost" id="xsCopy_l2r_to">左→右（ここまで）</button></div>
            <div style="flex:1; min-width:160px;"><button class="btn btn-ghost" id="xsCopy_l2r_row">左→右（行だけ）</button></div>
          </div>
          <div class="mini">「ここまで」は選択行を含めて置換（以降は残る）</div>
        </div>

        <div style="width:360px;">
          <label>テンプレ（現在測点のみ適用）</label>
          <div class="row" style="margin-top:0;">
            <div style="flex:1; min-width:140px;"><button class="btn btn-ghost" id="xsTplSave">保存</button></div>
            <div style="flex:1; min-width:140px;"><button class="btn btn-ghost" id="xsTplApply">適用</button></div>
            <div style="flex:1; min-width:140px;"><button class="btn btn-ghost" id="xsTplManage">管理</button></div>
          </div>
          <div class="mini" id="xsTplInfo"></div>
        </div>
      </div>

      <div class="mini">例：中心→3.000m -2.000% / 3.000→4.500m 0.000% / 4.500→5.000m -1.000%</div>

      <div class="sep"></div>
      <h2 style="margin-top:0;">横断エレメント作成（標準 / 例外 切替）</h2>
      <div class="mini">横断エレメント作成はここに統合しました。プレビューは「いま編集している断面」を自動表示します（プレビュー側の測点選択はありません）。</div>

      <div class="grid grid-3" style="margin-top:10px;">
        <div>
          <label>編集モード</label>
          <select id="xsElemMode">
            <option value="common" ${((state.cross.ui?.elemMode||'common')==='common')?'selected':''}>標準（テンプレ）</option>
            <option value="override" ${((state.cross.ui?.elemMode||'common')==='override')?'selected':''}>例外（測点別）</option>
          </select>
          <div class="mini" style="margin-top:6px;">標準：テンプレ断面を編集／例外：選択中の測点断面を編集</div>
        </div>

        <div>
          <label>対象測点（標準モードのプレビュー基準 / 例外モードの作成入力）</label>
          <input id="xsOverrideSta" type="text" placeholder="例：100.000 / 5+0.000" value="${String(state.cross.ui?.editStaTok||'')}" />
          <div class="mini">pitch=${pitch}m（空白のときはプレビュー表示なし）</div>
        </div>

        <div>
          <label>作成済み横断測点（例外STAリスト）</label>
          <select id="xsOverrideSel" ${((state.cross.ui?.elemMode||'common')==='override')?'':'disabled'}>
            <option value="">（選択なし）</option>
            ${ovOptions}
          </select>
          <div class="row" style="margin-top:8px;">
            <div style="flex:1; min-width:120px;"><button class="btn" id="xsOverrideAddOrSelect" ${((state.cross.ui?.elemMode||'common')==='override')?'':'disabled'}>＋ 作成/選択</button></div>
            <div style="flex:1; min-width:120px;"><button class="btn btn-ghost" id="xsOverrideDelete" ${(((state.cross.ui?.elemMode||'common')==='override') && hasSel) ? '' : 'disabled'}>例外を削除</button></div>
          </div>
          <div class="mini">例外モード：STAリストから選ぶ or 直接入力 → 作成/選択</div>
        </div>
      </div>

      <div class="mini" id="xsEditInfo" style="margin-top:10px;"></div>
<div class="sep"></div>
      <h2 style="margin-top:0;">簡易横断図（プレビュー）</h2>
      <div class="mini">測点を指定すると、拡幅割付（テーパ）を反映した横断形状を表示します。</div>

      <div class="row" style="margin-top:10px; align-items:flex-end;">
        <div style="width:220px;">
          <label>基準（プレビュー表示）</label>
          <select id="xsBaseSel">
            <option value="CL">中心線（CL）</option>
          </select>
          <label class="mini" style="margin-top:6px;"><input id="xsShowLabels" type="checkbox" checked /> ラベル表示</label>
        </div>

        <div style="width:220px;">
          <label>出力</label>
          <button class="btn btn-ghost" id="xsExportCsv">断面点列CSV</button>
          <div style="height:8px;"></div>
          <button class="btn btn-ghost" id="xsExportRepCsv">代表点CSV</button>
        </div>

        <div style="flex:1; min-width:260px;">
          <div class="mini" id="xsPreviewInfo"></div>
        </div>
      </div>
      <div class="mini" id="xsPreviewElemView" style="margin-top:8px;"></div>
<div style="overflow:auto; margin-top:10px;">
        <canvas id="xsCanvas" width="1000" height="260" style="width:100%; max-width:1000px; border:1px solid var(--line); border-radius:12px; background:#fff;"></canvas>
      </div>
      <div class="mini" id="xsPreviewTable" style="margin-top:10px;"></div>

      
      <div class="sep"></div>
      <h2 style="margin-top:0;">横断範囲とアンカー</h2>
      <div class="mini">基本は空白（未入力）で横断幅の制限なし。必要なときだけ拡幅割付とアンカー距離を設定します。</div>
      <div class="row" style="margin-top:10px; align-items:flex-end;">
        <div style="width:180px;">
          <label>拡幅割付（線形）</label>
          <label class="mini"><input id="xsTaperEnabled" type="checkbox" ${state.cross.taper && state.cross.taper.enabled ? "checked" : ""} /> 有効</label>
        </div>
        <div style="width:200px;">
          <label>アンカー距離 右(+)(m)</label>
          <input id="xsAnchorRight" type="number" step="0.001" min="0" value="${Number(state.cross.taper?.anchorRight ?? 3.0).toFixed(3)}" />
        </div>
        <div style="width:200px;">
          <label>アンカー距離 左(-)(m)</label>
          <input id="xsAnchorLeft" type="number" step="0.001" min="0" value="${Number(state.cross.taper?.anchorLeft ?? 3.0).toFixed(3)}" />
        </div>
        <div style="flex:1; min-width:260px;">
          <div class="mini">例外測点の最外端距離を制御点として幅員を線形補間し、アンカーより外側の距離をシフトして割付します（左右独立）。</div>
        </div>
      </div>

      
<div class="sep"></div>
      <h3 style="margin:0;">指定点の計画標高</h3>
      <div class="mini">STA＋左右＋幅を入れると、その点を簡易横断図（緑丸）と平面図にプロットして計画標高を表示します。</div>
      <div class="grid grid-3" style="margin-top:10px;">
        <div>
          <label>STA（k+rem：pitch基準。例：2+0 / STA2+0 / 10.000）</label>
          <input id="qSta" type="text" inputmode="decimal" autocomplete="off" placeholder="2+0" />
        </div>
        <div>
          <label>方向</label>
          <select id="qSide">
            <option value="center">中心（幅=0）</option>
            <option value="right">右</option>
            <option value="left">左</option>
          </select>
          <div class="mini" style="margin-top:8px;">
            <span class="pill" id="qWidthPill">端部幅員：-</span>
          </div>
        </div>
        <div>
          <label>中心からの距離（m）</label>
          <input id="qOffset" type="number" step="0.001" min="0" value="0.000" />
          <div style="height:10px;"></div>
          <button class="btn btn-ok" id="btnQueryElev">指定点を計算</button>
        </div>
      </div>
      <div id="qOut" class="mini" style="margin-top:10px;"></div>
      <div class="mini" style="margin-top:8px;">
        ※縦断がOFFのときは中心標高（GL）が計算できません。横断は例外測点があれば優先し、前後があれば擦り付け（線形補間）扱いにします。
      </div>

    </div>

    <div class="card">
      <h2>横断（追加測点のみ）</h2>
      <div class="grid grid-3">
        <div class="mini">
          ここは「横断追加測点（中心線の測点）」の管理だけ。<br/>
          ここで追加した測点は最終CSVに統合します。
        </div>
        <div>
          <label>横断：追加測点 追加入力</label>
          <textarea id="extraTokens_cross" placeholder="例：101.527 / 5+1.527 / 0+50.000 など"></textarea>
        </div>
        <div>
          <button class="btn" id="addExtras_cross">＋ 追加</button>
          <div style="height:10px;"></div>
          <button class="btn btn-ghost" id="clearExtras_cross">横断追加を全クリア</button>
        </div>
      </div>

      ${state.extraStations.cross.length ? `
      <div style="overflow:auto; margin-top:10px;">
        <table>
          <thead><tr><th>ID</th><th>測点表示</th><th>追加距離(m)</th><th class="right">削除</th></tr></thead>
          <tbody>
            ${state.extraStations.cross.map(x=>`
              <tr>
                <td>${x.id}</td>
                <td>${metersToStaPitch(x.m, pitch, 3)}</td>
                <td><input data-ex-group="cross" data-ex-id="${x.id}" type="number" step="0.001" value="${x.m}" /></td>
                <td class="right"><button class="btn btn-ghost" data-ex-group="cross" data-ex-del="${x.id}">削除</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : `<div class="mini" style="margin-top:10px;">（まだ横断の追加測点はありません）</div>`}
    </div>
  `;

  /* Cross DXF import bind */
  (function(){
    const fi = document.getElementById('crossDxfFile');
    const btn = document.getElementById('btnCrossDxfImport');
    const msg = document.getElementById('crossDxfMsg');
    if (!fi || !btn) return;
    btn.onclick = async ()=>{
      try{
        const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
        if (!file){ if (msg) msg.textContent = 'DXFファイルを選択してください。'; return; }


      // スマホは大容量DXFで落ちやすい（iOS白飛び/強制リロード対策）
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent||"");
      const LIMIT = 25 * 1024 * 1024; // 25MB
      if (isMobile && file.size > LIMIT){
        const mb = (file.size/1024/1024).toFixed(1);
        if (msg) msg.textContent = `DXFが${mb}MBあります。スマホ解析は25MB以下にしてください（PCで解析→JSON化して読み込む運用が安全です）。`;
        return;
      }
        if (msg) msg.textContent = 'DXF解析中…';
        const dxfText = await readLocalFileText(file);
        const name = String(file.name||"");

        // decide template by filename hint (4/5/6)
        let which = null;
        if (/(\(|（)\s*4\s*(\)|）)/.test(name) || /横断図\s*4/.test(name) || /_0?38_/.test(name)) which = 4;
        else if (/(\(|（)\s*5\s*(\)|）)/.test(name) || /横断図\s*5/.test(name) || /_0?39_/.test(name)) which = 5;
        else if (/(\(|（)\s*6\s*(\)|）)/.test(name) || /横断図\s*6/.test(name) || /_0?40_/.test(name)) which = 6;

        if (which === 6) {
          // ⑥は測点が無いことが多いので、共通テンプレとして適用
          const t6 = getStdCrossTemplate(6);
          state.cross.right = t6.right;
          state.cross.left  = t6.left;
          // anchorを車道端へ寄せる（推奨）
          state.cross.taper = state.cross.taper || { enabled:true, anchorRight:3.5, anchorLeft:3.5 };
          state.cross.taper.anchorRight = 3.5;
          state.cross.taper.anchorLeft = 3.5;
          saveState(); render();
          if (msg) msg.textContent = '反映OK：標準横断⑥を共通テンプレとして設定しました';
          return;
        }

        if (which !== 4 && which !== 5) throw new Error('ファイル名から（4）（5）（6）の判定ができませんでした');

        const stas = dxfFindStaListNearCL(dxfText);
        // store drawing STA list (図面STA母集団)
        ensureCrossState();
        const prev = Array.isArray(state.cross.ui.drawingStaList) ? state.cross.ui.drawingStaList : [];
        const merged = prev.concat(stas);
        state.cross.ui.drawingStaList = Array.from(new Set(merged.map(v=>Number(v)).filter(v=>Number.isFinite(v)).map(v=>Number(v.toFixed(3))))).sort((a,b)=>a-b);

        if (!stas.length) throw new Error('STA表記が見つかりませんでした（CL付近の STA 0+.. 表記を確認してください）');
        const tpl = getStdCrossTemplate(which);
        for (const m of stas){
          const k = (+m).toFixed(3);
          state.cross.overrides[k] = tpl;
        }
        saveState(); render();
        if (msg) msg.textContent = `反映OK：標準横断${which} を STA ${stas.length}点へ登録（例外）`;
      }catch(e){
        if (msg) msg.textContent = `DXF読み込みエラー：${e && e.message ? e.message : e}`;
      }
    };
  })();
/* Cross JSON import bind */
(function(){
  const fi = document.getElementById('crossJsonFile');
  const btn = document.getElementById('btnCrossJsonImport');
  const msg = document.getElementById('crossJsonMsg');
  if (!fi || !btn) return;
  btn.onclick = async ()=>{
    try{
      const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
      if (!file){ if (msg) msg.textContent = 'JSONファイルを選択してください。'; return; }
      if (msg) msg.textContent = 'JSON読み込み中…';
      const txt = await readLocalFileText(file);
      const obj = asObjectFromJsonText(txt);
      if (!obj) throw new Error('JSONの解析に失敗しました。');
      applyCrossFromJsonObject(obj);
      saveState();
      render();
      if (msg) msg.textContent = 'JSONを横断に反映しました。';
    }catch(e){
      if (msg) msg.textContent = `JSON読み込みエラー：${e && e.message ? e.message : e}`;
    }
  };
})();

;

  /* Cross JSON import bind (partial apply: cross only) */
  (function(){
    const fi = document.getElementById("crossJsonFile");
    const btn = document.getElementById("btnCrossJsonImport");
    const msg = document.getElementById("crossJsonMsg");
    if (!fi || !btn) return;
    btn.onclick = async ()=>{
      try{
        const file = (fi.files && fi.files[0]) ? fi.files[0] : null;
        if (!file){ if (msg) msg.textContent = 'JSONファイルを選択してください。'; return; }
        if (msg) msg.textContent = 'JSON読込中…';
        const text = await readLocalFileText(file);
        const obj = JSON.parse(text);
        const src = (obj && obj.cross) ? obj : (obj && obj.state ? obj.state : obj);
        if (!src || !src.cross){ throw new Error('このJSONに横断（cross）が見つかりません。'); }
        // uiは維持して、共通断面/overrides等を更新
        const keepUi = state.cross && state.cross.ui ? cloneDeep(state.cross.ui) : null;
        state.cross = cloneDeep(src.cross);
        if (keepUi) state.cross.ui = keepUi;
        saveState(); render();
        if (msg) msg.textContent = `反映OK：横断JSON（override ${Object.keys(state.cross.overrides||{}).length}件）`;
      }catch(e){
        if (msg) msg.textContent = `JSON読み込みエラー：${e && e.message ? e.message : e}`;
      }
    };
  })();


  // 一括距離
  const bulkBtn = document.getElementById("applyBulkCrossEnd");
  if (bulkBtn) {
    bulkBtn.onclick = ()=>{
      const er = parseFloat(document.getElementById("bulkCrossEnd_right").value);
      const el = parseFloat(document.getElementById("bulkCrossEnd_left").value);
      const affect = !!document.getElementById("bulkAffectOverrides").checked;
      applyCrossOuterEnd(er, el, affect);
      saveState();
      render();
    };
  }

  // --- Phase1: elements UI bindings ---
  if (!state.cross.ui.elemSel || typeof state.cross.ui.elemSel !== 'object' || Array.isArray(state.cross.ui.elemSel)) {
    state.cross.ui.elemSel = { right: 0, left: 0 };
  }

  const setElemSel = (sideKey, id)=>{
    state.cross.ui.elemSel[sideKey] = Number(id)||0;
    saveState();
    render();
  };

  const findElem = (sideKey, id)=>{
    const store = getActiveElemStore(sideKey);
    const arr = store?.items || [];
    const idx = arr.findIndex(it=>Number(it?.id)===Number(id));
    return { arr, idx };
  };

  const deepCopy = (obj)=> JSON.parse(JSON.stringify(obj));

  const ensureDefaultElem = (type)=>{
    if (type==='PAV') return { type:'PAV', L:1.000, pctText:'0.000' };
    if (type==='FLAT') return { type:'FLAT', L:1.000 };
    if (type==='STEP') return { type:'STEP', dzText:'0.200', dir:'up' };
    if (type==='SLOPE_H') return { type:'SLOPE_H', ratioX:1.5, H:1.0, dir:'down' };
    if (type==='SLOPE_EXT') return { type:'SLOPE_EXT', ratioX:1.5, dir:'down' };
    return { type:'PAV', L:1.000, pctText:'0.000' };
  };

  const bindElemList = (sideKey)=>{
    const list = document.getElementById('xsElemList_'+sideKey);
    if (!list) return;

    // selection
    list.onclick = (ev)=>{
      // do not steal focus from form controls
      if (ev.target && ev.target.closest && ev.target.closest("input,select,textarea,button")) return;
      const row = ev.target.closest('.xsRow');
      if (!row) return;
      const id = Number(row.dataset.id);
      if (Number.isFinite(id)) setElemSel(sideKey, id);
    };

    // inputs
    list.addEventListener('change', (ev)=>{
      const el = ev.target.closest('.xsElInput');
      if (!el) return;
      const id = Number(el.dataset.xsId);
      const field = String(el.dataset.xsField||'');
      const side = String(el.dataset.xsSide||sideKey);
      const { arr, idx } = findElem(side, id);
      if (idx<0) return;
      const it = arr[idx];

      if (field==='type'){
        const t = String(el.value||'PAV');
        const base = ensureDefaultElem(t);
        // keep id
        arr[idx] = Object.assign({ id: it.id }, base);
      } else if (field==='pctText' || field==='dzText'){
        it[field] = String(el.value ?? '');
      } else if (field==='L' || field==='ratioX' || field==='H'){
        it[field] = Number(el.value);
      } else if (field==='dir'){
        it.dir = (String(el.value)==='down') ? 'down' : 'up';
      }

      syncCrossActiveSegsFromElems();
      saveState();
      render();
    });

    // actions dup/del
    list.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('[data-xs-act]');
      if (!btn) return;
      ev.preventDefault();
      const act = btn.dataset.xsAct;
      const id = Number(btn.dataset.xsId);
      const side = String(btn.dataset.xsSide||sideKey);
      const { arr, idx } = findElem(side, id);
      if (idx<0) return;

      if (act==='del'){
        arr.splice(idx,1);
        // selection fallback
        const next = arr[idx] || arr[idx-1];
        state.cross.ui.elemSel[side] = next ? next.id : 0;
      } else if (act==='dup'){
        const src = deepCopy(arr[idx]);
        const newId = store.nextId++;
        src.id = newId;
        arr.splice(idx+1,0,src);
        state.cross.ui.elemSel[side] = newId;
      }
      syncCrossActiveSegsFromElems();
      saveState();
      render();
    });

    enableElemDrag(sideKey);
  };

  bindElemList('right');
  bindElemList('left');

  // add buttons (insert after selected row)
  viewCross.querySelectorAll('[data-xs-add]').forEach(btn=>{
    btn.onclick = ()=>{
      const type = String(btn.dataset.xsAdd);
      const side = String(btn.dataset.xsSide);
      const store = getActiveElemStore(side);
      const arr = store?.items;
      if (!arr) return;
      const selId = Number(state.cross.ui?.elemSel?.[side]||0);
      const idx = arr.findIndex(it=>Number(it?.id)===selId);
      const newId = store.nextId++;
      const it = Object.assign({ id:newId }, ensureDefaultElem(type));
      if (idx>=0) arr.splice(idx+1,0,it); else arr.push(it);
      state.cross.ui.elemSel[side] = newId;
      syncCrossActiveSegsFromElems();
      saveState();
      render();
    };
  });

  // copy helpers
  const copyAll = (from,to)=>{
    const aFrom = getActiveElemStore(from);
    const aTo = getActiveElemStore(to);
    if (!aFrom || !aTo) return;
    aTo.items = deepCopy(aFrom.items||[]);
    aTo.nextId = Math.max(0, ...(aTo.items||[]).map(it=>Number(it.id)||0)) + 1;
  };
  const copyRow = (from,to)=>{
    const fromSel = Number(state.cross.ui.elemSel[from]||0);
    const srcArr = state.cross.elemCommon[from].items||[];
    const dstArr = state.cross.elemCommon[to].items||[];
    const srcIdx = srcArr.findIndex(it=>Number(it.id)===fromSel);
    if (srcIdx<0) { alert('コピー元の行を選択してください'); return; }
    const src = deepCopy(srcArr[srcIdx]);
    // insert/replace at dst selection
    const dstSel = Number(state.cross.ui.elemSel[to]||0);
    const dstIdx = dstArr.findIndex(it=>Number(it.id)===dstSel);
    const newId = state.cross.elemCommon[to].nextId++;
    src.id = newId;
    if (dstIdx>=0) dstArr.splice(dstIdx,1,src); else dstArr.push(src);
    state.cross.ui.elemSel[to] = newId;
  };
  const copyTo = (from,to)=>{
    const fromSel = Number(state.cross.ui.elemSel[from]||0);
    const srcArr = state.cross.elemCommon[from].items||[];
    const dstArr = state.cross.elemCommon[to].items||[];
    const srcIdx = srcArr.findIndex(it=>Number(it.id)===fromSel);
    if (srcIdx<0) { alert('コピー元の行を選択してください'); return; }
    const head = deepCopy(srcArr.slice(0, srcIdx+1));
    // re-id for destination (to avoid collisions)
    let nid = state.cross.elemCommon[to].nextId;
    head.forEach(it=>{ it.id = nid++; });
    state.cross.elemCommon[to].nextId = nid;
    // replace head portion, keep rest
    const rest = dstArr.slice(srcIdx+1);
    state.cross.elemCommon[to].items = head.concat(rest);
    // update selection
    state.cross.ui.elemSel[to] = head.length ? head[head.length-1].id : 0;
  };

  const bindCopyBtn = (id, fn)=>{
    const b = document.getElementById(id);
    if (b) b.onclick = ()=>{ fn(); syncCrossActiveSegsFromElems(); saveState(); render(); };
  };
  bindCopyBtn('xsCopy_r2l_all', ()=>copyAll('right','left'));
  bindCopyBtn('xsCopy_r2l_row', ()=>copyRow('right','left'));
  bindCopyBtn('xsCopy_r2l_to',  ()=>copyTo('right','left'));
  bindCopyBtn('xsCopy_l2r_all', ()=>copyAll('left','right'));
  bindCopyBtn('xsCopy_l2r_row', ()=>copyRow('left','right'));
  bindCopyBtn('xsCopy_l2r_to',  ()=>copyTo('left','right'));

  // template (minimal)
  const tplInfo = document.getElementById('xsTplInfo');
  const setTplInfo = (msg)=>{ if (tplInfo) tplInfo.textContent = msg||''; };

  const listTplNames = ()=> (state.cross.templates?.items||[]).map(t=>`${t.id}: ${t.name}`).join('\n');

  const tplSaveBtn = document.getElementById('xsTplSave');
  if (tplSaveBtn) tplSaveBtn.onclick = ()=>{
    const name = prompt('テンプレ名', '標準');
    if (!name) return;
    const tpl = {
      id: state.cross.templates.nextId++,
      name: String(name),
      savedAt: new Date().toISOString(),
      elem: deepCopy(state.cross.elemCommon),
      xrange: deepCopy(state.cross.xrangeDefault),
      base: deepCopy(state.cross.baseDefault)
    };
    state.cross.templates.items.push(tpl);
    saveState();
    setTplInfo(`保存：${tpl.name}`);
  };

  const pickTemplate = ()=>{
    const items = state.cross.templates?.items||[];
    if (!items.length){ alert('テンプレがありません'); return null; }
    const hint = listTplNames();
    const tok = prompt('適用するテンプレのIDを入力\n'+hint, String(items[items.length-1].id));
    if (!tok) return null;
    const id = Number(tok);
    const tpl = items.find(t=>Number(t.id)===id);
    if (!tpl){ alert('テンプレが見つかりません'); return null; }
    return tpl;
  };

  const tplApplyBtn = document.getElementById('xsTplApply');
  if (tplApplyBtn) tplApplyBtn.onclick = ()=>{
    const tpl = pickTemplate();
    if (!tpl) return;

    // target STA: selected override key or preview input
    let key = String(state.cross.ui.selectedStaKey||'').trim();
    if (!key){
      const tok = String(null?.value || state.cross.ui.previewTok || '').trim();
      if (!tok){ alert('適用先の測点が未指定です（プレビュー測点を入力するか、例外を選択してください）'); return; }
      try{
        const m = parseSta100(tok);
        key = Number(m).toFixed(3);
      }catch(e){
        alert('測点を解釈できません'); return;
      }
    }

    // apply as station override (safe)
    state.cross.xrangeOverrides[key] = deepCopy(tpl.xrange);
    state.cross.baseOverrides[key] = deepCopy(tpl.base);

    const xr = { L: Number(tpl.xrange?.L)||state.cross.xrangeDefault.L, R: Number(tpl.xrange?.R)||state.cross.xrangeDefault.R };
    const rSegs = elemsToSegs(tpl.elem?.right?.items||[], 'right', xr.R);
    const lSegs = elemsToSegs(tpl.elem?.left?.items||[],  'left',  xr.L);

    state.cross.overrides[key] = {
      right: { segs: rSegs, nextSegId: Math.max(0, ...rSegs.map(r=>r.id||0)) + 1 },
      left:  { segs: lSegs, nextSegId: Math.max(0, ...lSegs.map(r=>r.id||0)) + 1 }
    };

    state.cross.ui.selectedStaKey = key;
    saveState();
    render();
    setTplInfo(`適用：${tpl.name} → ${key}m`);
  };

  const tplManageBtn = document.getElementById('xsTplManage');
  if (tplManageBtn) tplManageBtn.onclick = ()=>{
    const items = state.cross.templates?.items||[];
    if (!items.length){ alert('テンプレがありません'); return; }
    const hint = listTplNames();
    const tok = prompt('管理：削除するテンプレIDを入力（キャンセルで何もしない）\n'+hint, '');
    if (!tok) return;
    const id = Number(tok);
    const idx = items.findIndex(t=>Number(t.id)===id);
    if (idx<0){ alert('テンプレが見つかりません'); return; }
    if (!confirm(`削除しますか？\n${items[idx].name}`)) return;
    items.splice(idx,1);
    saveState();
    setTplInfo('削除しました');
  };



  // エレメント編集モード（標準/例外）
  const modeEl = document.getElementById('xsElemMode');
  if (modeEl) {
    modeEl.onchange = (e)=>{
      ensureCrossState();
      const v = String(e.target.value||'common');
      state.cross.ui.elemMode = (v==='override') ? 'override' : 'common';
      saveState();
      render();
    };
  }

  // 対象測点（標準プレビュー基準 / 例外作成入力）
  const editStaEl = document.getElementById('xsOverrideSta');
  if (editStaEl) {
    const commit = ()=>{
      ensureCrossState();
      state.cross.ui.editStaTok = String(editStaEl.value||'').trim();
      saveState();
      render();
    };
    editStaEl.onchange = commit;
    editStaEl.onblur = commit;
  }
  // 例外：選択
  const selEl = document.getElementById("xsOverrideSel");
  if (selEl) {
    selEl.value = selKey;
    selEl.onchange = (e)=>{
      state.cross.ui.selectedStaKey = e.target.value || "";
      if (state.cross.ui.selectedStaKey) { state.cross.ui.elemMode = 'override'; ensureElemOverrideInitialized(state.cross.ui.selectedStaKey); }
      saveState();
      render();
    };
  }

  // 例外：作成/選択
  const addSelBtn = document.getElementById("xsOverrideAddOrSelect");
  if (addSelBtn) {
    addSelBtn.onclick = ()=>{
      const pitchNow = Math.max(1, Math.floor(state.staPitch||1));
      const sel = (document.getElementById("xsOverrideSel")?.value || "").trim();
      if (sel) {
        state.cross.ui.selectedStaKey = sel;
        state.cross.ui.elemMode = 'override';
        ensureElemOverrideInitialized(sel);
        saveState();
        render();
        return;
      }
      const tok = (document.getElementById("xsOverrideSta")?.value || "").trim();
      if (!tok) { alert("測点を入力してください"); return; }
      let m;
      try {
        m = parseTokenToM(tok, pitchNow);
      } catch(e) {
        alert("測点が不正です: " + (e.message||e));
        return;
      }
      const key = Number(m.toFixed(3));
      const k = key.toFixed(3);
      ensureCrossOverride(k);
      state.cross.ui.selectedStaKey = k;
      state.cross.ui.elemMode = 'override';
      ensureElemOverrideInitialized(k);
      saveState();
      render();
    };
  }

  // 例外：削除
  const delBtn = document.getElementById("xsOverrideDelete");
  if (delBtn) {
    delBtn.onclick = ()=>{
      const k = state.cross.ui.selectedStaKey;
      if (!k) return;
      if (!confirm(`例外（${k}m）を削除して共通に戻します。よいですか？`)) return;
      delete state.cross.overrides[k];
      if (state.cross.elemOverrides && state.cross.elemOverrides[k]) delete state.cross.elemOverrides[k];
      state.cross.ui.selectedStaKey = "";
      saveState();
      render();
    };
  }


  bindCrossSlopeUI(viewCross);

  // taper settings
  const cbTaper = document.getElementById('xsTaperEnabled');
  if (cbTaper) {
    cbTaper.onchange = ()=>{ ensureCrossState(); state.cross.taper.enabled = !!cbTaper.checked; saveState(); render(); };
  }
  const inAR = document.getElementById('xsAnchorRight');
  if (inAR) {
    const commitAR = ()=>{ ensureCrossState(); const t=String(inAR.value??"").trim(); if(t===""){ render(); return; } const n=parseFloat(t); if(!Number.isFinite(n)){ render(); return; } state.cross.taper.anchorRight = n; saveState(); render(); };
    inAR.onchange = commitAR;
    inAR.onblur = commitAR;
  }
  const inAL = document.getElementById('xsAnchorLeft');
  if (inAL) {
    const commitAL = ()=>{ ensureCrossState(); const t=String(inAL.value??"").trim(); if(t===""){ render(); return; } const n=parseFloat(t); if(!Number.isFinite(n)){ render(); return; } state.cross.taper.anchorLeft = n; saveState(); render(); };
    inAL.onchange = commitAL;
    inAL.onblur = commitAL;
  }

  // override width apply
  const btnApplyWidth = document.getElementById('applyOvrWidth');
  if (btnApplyWidth) {
    btnApplyWidth.onclick = ()=>{
      const k = state.cross.ui.selectedStaKey;
      if (!k) return;
      const wr = parseFloat(document.getElementById('ovrWidthRight')?.value);
      const wl = parseFloat(document.getElementById('ovrWidthLeft')?.value);
      if ((!Number.isFinite(wr) || wr<=0) && (!Number.isFinite(wl) || wl<=0)) { alert('幅員を入力してください'); return; }
      if (!confirm('共通形状から自動生成して、現在の例外形状を上書きします。よいですか？')) return;
      setOverrideWidthFromCommon(k, wr, wl);
      saveState();
      render();
    };
  }

  
  // 図面STA一覧（距離昇順 / 標準・例外タグ）
  const allStaSel = document.getElementById('xsAllStaSel');
  const allStaBtn = document.getElementById('xsAllStaEditBtn');
  const allStaMsg = document.getElementById('xsAllStaMsg');
  if (allStaSel) {
    ensureCrossState();
    // source: drawingStaList (図面STA) があればそれを優先。無ければ overrides のキーを暫定母集団にする
    const raw = Array.isArray(state.cross.ui?.drawingStaList) ? state.cross.ui.drawingStaList : [];
    let stas = raw.filter(v=>v!==null && v!==undefined && v!=="").map(v=>Number(v)).filter(v=>Number.isFinite(v));
    if (!stas.length) {
      stas = Object.keys(state.cross.overrides||{}).map(k=>Number(k)).filter(v=>Number.isFinite(v));
    }
    // unique + sort asc
    stas = Array.from(new Set(stas.map(v=>Number(v.toFixed(3))))).sort((a,b)=>a-b);

    const cur = String(state.cross.ui?.editStaTok||'').trim();
    let html = '<option value="">（選択なし）</option>';
    for (const v of stas) {
      const k = v.toFixed(3);
      const isOv = !!(state.cross.overrides && state.cross.overrides[k]);
      const tag = isOv ? '〔例外〕' : '〔標準〕';
      const sel = (cur && k===cur) ? 'selected' : '';
      html += `<option value="${k}" ${sel}>STA ${k} ${tag}</option>`;
    }
    allStaSel.innerHTML = html;
  }
  if (allStaBtn) {
    allStaBtn.onclick = ()=>{
      ensureCrossState();
      const tok = String((allStaSel && allStaSel.value) ? allStaSel.value : '').trim();
      if (!tok) { if (allStaMsg) allStaMsg.textContent = 'STAを選んでください。'; return; }
      state.cross.ui.editStaTok = tok;

      const isOv = !!(state.cross.overrides && state.cross.overrides[tok]);
      if (isOv) {
        state.cross.ui.elemMode = 'override';
        state.cross.ui.overrideSel = tok;
        state.cross.ui.standardEditStaTok = '';
        if (allStaMsg) allStaMsg.textContent = `編集対象：STA ${tok}（例外）`;
      } else {
        // 標準を表示しつつ、このSTAを“標準として確認/編集”の対象にする
        state.cross.ui.elemMode = 'common';
        state.cross.ui.overrideSel = '';
        state.cross.ui.standardEditStaTok = tok; // 保存時に例外化するための文脈
        if (allStaMsg) allStaMsg.textContent = `編集対象：STA ${tok}（標準）→ 保存すると例外になります`;
      }
      saveState();
      render();
    };
  }

  // 編集対象の表示 + 「標準→例外として保存」
  const tgtInfo = document.getElementById('xsEditTargetInfo');
  const promoteBtn = document.getElementById('xsPromoteStandardToOverride');
  if (tgtInfo) {
    ensureCrossState();
    const tok = String(state.cross.ui?.editStaTok||'').trim();
    const isOv = tok && !!(state.cross.overrides && state.cross.overrides[tok]);
    const isStdCtx = tok && !isOv && String(state.cross.ui?.standardEditStaTok||'').trim()===tok;
    if (!tok) {
      tgtInfo.textContent = '編集対象：未選択（図面STA一覧から選ぶと安全です）';
    } else if (isOv) {
      tgtInfo.textContent = `編集対象：STA ${tok}（例外）`;
    } else if (isStdCtx) {
      tgtInfo.textContent = `編集対象：STA ${tok}（標準）  ※保存すると例外として登録`;
    } else {
      tgtInfo.textContent = `編集対象：STA ${tok}（標準）`;
    }

    if (promoteBtn) {
      if (isStdCtx) {
        promoteBtn.style.display = '';
        promoteBtn.onclick = ()=>{
          ensureCrossState();
          const k = String(state.cross.ui?.editStaTok||'').trim();
          if (!k) return;
          if (!confirm(`STA ${k} は標準です。現在の編集内容を「例外断面」として登録します。\n（標準テンプレは変更されません）\nよいですか？`)) return;

          // effective common -> override template copy
          const tpl = { right: deepCopy(state.cross.right), left: deepCopy(state.cross.left) };
          state.cross.overrides[k] = tpl;
          state.cross.ui.elemMode = 'override';
          state.cross.ui.overrideSel = k;
          state.cross.ui.standardEditStaTok = '';
          saveState();
          render();
        };
      } else {
        promoteBtn.style.display = 'none';
      }
    }
  }
// preview
  const drawPreview = (tok)=>{
    const infoEl = document.getElementById('xsPreviewInfo');
    const tblEl = document.getElementById('xsPreviewTable');
    const canvas = document.getElementById('xsCanvas');
    if (!canvas) return;

    const pitchNow = Math.max(1, Math.floor(state.staPitch||1));
    let m;
    try {
      m = parseTokenToM(String(tok||'').trim(), pitchNow);
    } catch(e) {
      if (infoEl) infoEl.textContent = '測点が不正です: ' + (e.message||e);
      return;
    }
    m = clamp(m, 0, res.total||0);

    const R = getEffectiveCrossSegsAt(m, 'right');
    const L = getEffectiveCrossSegsAt(m, 'left');

    const rCalc = computeCrossRowsFromSegs(R.segs);
    const lCalc = computeCrossRowsFromSegs(L.segs);

    const ptsR = [{x:0,z:0}];
    for (const row of rCalc.rows) ptsR.push({x: row.end, z: row.zEnd});
    const ptsL = [{x:0,z:0}];
    for (const row of lCalc.rows) ptsL.push({x: -row.end, z: row.zEnd});

    const poly = [...ptsL.slice(1).reverse(), {x:0,z:0}, ...ptsR.slice(1)];

    // --- landmarks for base switching (Phase2) ---
    const landmarks = [];
    landmarks.push({ key:'CL', label:'中心線（CL）', x:0, z:0 });
    // steps (right)
    let stepIdxR=0;
    for (const row of rCalc.rows) {
      if (Number.isFinite(row.stepDz) && Math.abs(row.stepDz) > 1e-12) {
        stepIdxR++;
        const x = row.end;
        const zBefore = row.zEnd - row.stepDz;
        const zAfter  = row.zEnd;
        const zUp = Math.max(zBefore, zAfter);
        const zDown = Math.min(zBefore, zAfter);
        landmarks.push({ key:`R_STEP_UP_${stepIdxR}`, label:`右 段差上 #${stepIdxR}`, x, z:zUp });
        landmarks.push({ key:`R_STEP_DN_${stepIdxR}`, label:`右 段差下 #${stepIdxR}`, x, z:zDown });
      }
    }
    // steps (left)
    let stepIdxL=0;
    for (const row of lCalc.rows) {
      if (Number.isFinite(row.stepDz) && Math.abs(row.stepDz) > 1e-12) {
        stepIdxL++;
        const x = -row.end;
        const zBefore = row.zEnd - row.stepDz;
        const zAfter  = row.zEnd;
        const zUp = Math.max(zBefore, zAfter);
        const zDown = Math.min(zBefore, zAfter);
        landmarks.push({ key:`L_STEP_UP_${stepIdxL}`, label:`左 段差上 #${stepIdxL}`, x, z:zUp });
        landmarks.push({ key:`L_STEP_DN_${stepIdxL}`, label:`左 段差下 #${stepIdxL}`, x, z:zDown });
      }
    }

    // slope shoulders/toes (from element-generated segs only: row.src==='SLOPE')
    const addSlopeLandmarks = (rows, sign, prefix)=>{
      let idx=0;
      let prevZ=0;
      for (let i=0;i<rows.length;i++){
        const r = rows[i];
        const isSlope = (r && r.src==='SLOPE');
        const prev = (i>0?rows[i-1]:null);
        const prevIsSlope = (prev && prev.src==='SLOPE');
        const zStart = (i===0)?0:(prevZ);
        // update prevZ after computing
        const zEnd = r.zEnd;
        if (isSlope && !prevIsSlope){
          idx++;
          landmarks.push({ key:`${prefix}_SLOPE_SH_${idx}`, label:`${prefix==='R'?'右':'左'} 法肩 #${idx}`, x: sign*r.start, z: zStart });
        }
        const next = (i+1<rows.length?rows[i+1]:null);
        const nextIsSlope = (next && next.src==='SLOPE');
        if (isSlope && !nextIsSlope){
          landmarks.push({ key:`${prefix}_SLOPE_TOE_${idx}`, label:`${prefix==='R'?'右':'左'} 法尻 #${idx}`, x: sign*r.end, z: zEnd });
        }
        prevZ = zEnd;
      }
    };
    addSlopeLandmarks(rCalc.rows, +1, 'R');
    addSlopeLandmarks(lCalc.rows, -1, 'L');

    // ends
    landmarks.push({ key:'R_END', label:'右端', x: rCalc.lastEnd, z: rCalc.lastZ });
    landmarks.push({ key:'L_END', label:'左端', x: -lCalc.lastEnd, z: lCalc.lastZ });

    // populate base selector
    const baseSelEl = document.getElementById('xsBaseSel');
    if (baseSelEl) {
      const cur = String(state.cross.ui.previewBaseKey || 'CL');
      baseSelEl.innerHTML = landmarks.map(l=>`<option value="${l.key}" ${l.key===cur?'selected':''}>${l.label}</option>`).join('');
      if (!landmarks.some(l=>l.key===cur)) state.cross.ui.previewBaseKey = 'CL';
    }

    // apply base translation
    const baseKey = String(state.cross.ui.previewBaseKey || 'CL');
    const ref = landmarks.find(l=>l.key===baseKey) || landmarks[0];
    const polyShift = poly.map(p=>({ x: p.x - ref.x, z: p.z - ref.z }));

    const showLabels = (document.getElementById('xsShowLabels')?.checked ?? true);
    const pickKey = String(state.cross.ui.previewPickKey || '');
    const pickLm = landmarks.find(l=>l.key===pickKey);

    const labels = showLabels ? [
      { x: (-lCalc.lastEnd) - ref.x, z: lCalc.lastZ - ref.z, text: `左端 L=${lCalc.lastEnd.toFixed(3)}m` },
      { x: ( rCalc.lastEnd) - ref.x, z: rCalc.lastZ - ref.z, text: `右端 R=${rCalc.lastEnd.toFixed(3)}m` },
      ...landmarks
        .filter(l=>l.key.startsWith('R_STEP_UP_') || l.key.startsWith('L_STEP_UP_') || l.key.startsWith('R_SLOPE_SH_') || l.key.startsWith('L_SLOPE_SH_') || l.key.startsWith('R_SLOPE_TOE_') || l.key.startsWith('L_SLOPE_TOE_'))
        .map(l=>({ x:l.x - ref.x, z:l.z - ref.z, text:l.label })),
    ] : [];

    const marks = pickLm ? [{ x: pickLm.x - ref.x, z: pickLm.z - ref.z, r: 7, color:'#ef4444' }] : [];

    // add query point mark (from Output tab: STA + side + offset)
    const qp = state.cross?.ui?.queryPoint;
    const sameSta = qp && Number.isFinite(qp.m) && Math.abs(qp.m - m) < 1e-6;
    const zAtX = (polyPts, x)=>{
      if (!polyPts || polyPts.length < 2) return 0;
      const pts = polyPts.slice().sort((a,b)=>a.x-b.x);
      if (x <= pts[0].x) {
        const a=pts[0], b=pts[1];
        const t=(x-a.x)/Math.max(1e-9,(b.x-a.x));
        return a.z + t*(b.z-a.z);
      }
      if (x >= pts[pts.length-1].x) {
        const a=pts[pts.length-2], b=pts[pts.length-1];
        const t=(x-a.x)/Math.max(1e-9,(b.x-a.x));
        return a.z + t*(b.z-a.z);
      }
      for (let i=0;i<pts.length-1;i++){
        const a=pts[i], b=pts[i+1];
        if (x >= a.x-1e-9 && x <= b.x+1e-9){
          const t=(x-a.x)/Math.max(1e-9,(b.x-a.x));
          return a.z + t*(b.z-a.z);
        }
      }
      return 0;
    };
    if (sameSta && qp) {
      const zq = zAtX(poly, qp.x);
      const mx = qp.x - ref.x;
      const mz = zq - ref.z;
      marks.push({ x: mx, z: mz, r: 8, color:'#16a34a' });
      state.cross.ui.queryPoint._zRel = zq;
      state.cross.ui.queryPoint._xShift = mx;
      state.cross.ui.queryPoint._zShift = mz;
    }

    drawCrossPreviewCanvas(canvas, polyShift, labels, marks);

    if (infoEl) {
      const sLabel = metersToStaPitch(m, pitchNow, 3);
      const modeR = `${R.info.source}:${R.info.mode}`;
      const modeL = `${L.info.source}:${L.info.mode}`;
      infoEl.textContent = `${sLabel} (${m.toFixed(3)}m)  右(+): ${rCalc.lastEnd.toFixed(3)}m [${modeR}] / 左(-): ${lCalc.lastEnd.toFixed(3)}m [${modeL}]`;

      const qp2 = state.cross?.ui?.queryPoint;
      if (qp2 && Number.isFinite(qp2.m) && Math.abs(qp2.m - m) < 1e-6) {
        const sideTxt = (qp2.side==="right"?"右":qp2.side==="left"?"左":"中心");
        const zcTxt2 = Number.isFinite(zc) ? zc.toFixed(3) : '—';
        const zpTxt2 = Number.isFinite(qp2.zPlan) ? qp2.zPlan.toFixed(3) : '—';
        infoEl.textContent += ` / 指定点(${sideTxt} ${qp2.off.toFixed(3)}m): CL=${zcTxt2} ΔZ=${qp2.dz.toFixed(3)} 計画=${zpTxt2}`;
      }
    }

    if (tblEl) {
      // centerline design elevation
      let zc = NaN;
      if (state.profile && state.profile.enabled) {
        try {
          const pm = buildProfileModel(state.profile, res.total);
          if (pm && pm.ok) zc = evalProfileZ(pm, m);
        } catch {}
      }

      // representative points (shifted coords) + plan elevation
      const reps = landmarks.map(l=>({
        key: l.key,
        label: l.label,
        x: l.x - ref.x,
        z: l.z - ref.z,
        zPlan: Number.isFinite(zc) ? (zc + l.z) : NaN,
      }));

      // stable ordering: CL first, then right, then left, then ends
      const orderKey = (k)=>{
        if (k==='CL') return 0;
        if (k.startsWith('R_')) return 1;
        if (k.startsWith('L_')) return 2;
        return 9;
      };
      reps.sort((a,b)=>{
        const oa = orderKey(a.key), ob = orderKey(b.key);
        if (oa!==ob) return oa-ob;
        return a.label.localeCompare(b.label,'ja');
      });

      const sLabel = metersToStaPitch(m, pitchNow, 3);
      const zcTxt = Number.isFinite(zc) ? zc.toFixed(3) : '—';
      const rowsHtml = reps.map(r=>{
        const x = Number(r.x).toFixed(3);
        const z = Number(r.z).toFixed(3);
        const zp = Number.isFinite(r.zPlan) ? Number(r.zPlan).toFixed(3) : '—';
        const active = (String(state.cross.ui.previewPickKey||'')===r.key);
        return `<tr data-pick-key="${r.key}" style="cursor:pointer;${active?'background:#fee2e2;':''}"><td>${r.label}</td><td class="right">${x}</td><td class="right">${z}</td><td class="right">${zp}</td></tr>`;
      }).join('');

      tblEl.innerHTML = `
        <div class="mini"><b>代表点（基準後座標）</b> / 測点 ${sLabel} (${m.toFixed(3)}m) / CL計画標高 ${zcTxt}m</div>
        <div style="overflow:auto; margin-top:6px;">
          <table>
            <thead><tr><th>点名</th><th class="right">x(m)</th><th class="right">z(m)</th><th class="right">計画標高(m)</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;

      // click to highlight
      tblEl.onclick = (ev)=>{
        const tr = ev.target.closest('tr[data-pick-key]');
        if (!tr) return;
        const k = tr.getAttribute('data-pick-key');
        state.cross.ui.previewPickKey = k;
        saveState();
        drawPreview(state.cross.ui.previewTok||'0.000');
      };

      // cache for CSV export
      const qpCache = (state.cross?.ui?.queryPoint && Math.abs((state.cross.ui.queryPoint.m||0) - m) < 1e-6) ? state.cross.ui.queryPoint : null;
      
      // element view (read-only): effective segments at this station (for checking slope/changes)
      const elemViewEl = document.getElementById('xsPreviewElemView');
      if (elemViewEl) {
        const fmtSide = (sideKey, eff)=>{
          const w = computeCrossRowsFromSegs(eff.segs).lastEnd || 0;
          const src = eff.source || '';
          const rows = (eff.segs||[]).slice().sort((a,b)=>(+a.end)-(+b.end)).map(r=>{
            const end = (+r.end).toFixed(3);
            const g = (+r.slopePct).toFixed(3);
            return `<tr><td class="right">${end}</td><td class="right">${g}</td></tr>`;
          }).join('');
          return `
            <div class="mini"><b>${sideKey==='right'?'右(+)':'左(-)'}</b> / 幅員=${w.toFixed(3)}m / ${escapeHtml(src)}</div>
            <div style="overflow:auto; margin-top:6px;">
              <table>
                <thead><tr><th class="right">区間終点(m)</th><th class="right">勾配(%)</th></tr></thead>
                <tbody>${rows || `<tr><td colspan="2" class="mini">(定義なし)</td></tr>`}</tbody>
              </table>
            </div>
          `;
        };

        // 指定点で入力した任意STAは「確認用」。例外化はボタン押下時だけ。
        const canPromote = String(state.cross.ui.queryTok||'').trim() && (String(state.cross.ui.queryTok||'').trim() === tok);
        elemViewEl.innerHTML = `
          <div class="sep"></div>
          <div class="row" style="align-items:center;">
            <div class="mini" style="flex:1;"><b>エレメント表示（参照のみ）</b>：指定点で入力した任意測点もここに表示</div>
            ${canPromote ? `<button class="btn btn-ok" id="xsPromoteQueryToOverride">この測点を編集対象にする（例外として扱う）</button>` : ``}
          </div>
          ${fmtSide('right', R)}
          <div style="height:8px;"></div>
          ${fmtSide('left', L)}
        `;

        const btn = document.getElementById('xsPromoteQueryToOverride');
        if (btn) {
          btn.onclick = ()=>{
            try{
              const m = parseSta100(tok);
              const k = Number(m).toFixed(3);
              ensureCrossOverride(k);

              // initialize override segs from current effective (taper included)
              state.cross.overrides[k].right.segs = deepCopy(R.segs||[]);
              state.cross.overrides[k].left.segs  = deepCopy(L.segs||[]);
              state.cross.overrides[k].right.nextSegId = Math.max(0, ...state.cross.overrides[k].right.segs.map(r=>r.id||0)) + 1;
              state.cross.overrides[k].left.nextSegId  = Math.max(0, ...state.cross.overrides[k].left.segs.map(r=>r.id||0)) + 1;

              // bootstrap elem override from segs
              ensureElemOverrideInitialized(k);

              state.cross.ui.elemMode = 'override';
              state.cross.ui.selectedStaKey = k;
              state.cross.ui.queryTok = ''; // 編集に追従
              saveState();
              render();
            }catch(err){
              alert("例外化に失敗しました: " + (err?.message||String(err)));
            }
          };
        }
      }

state.cross.ui.previewCache = { m, baseKey: ref.key, baseLabel: ref.label, baseX: ref.x, baseZ: ref.z, pts: polyShift, landmarks, reps, zc, queryPoint: qpCache };
    } else {
    }
  };

  // プレビューは「いま編集している断面」へ自動追従（測点選択UIなし）
  const computePreviewTok = ()=>{
    ensureCrossState();
    const q = String(state.cross.ui.queryTok||'').trim();
    if (q) return q; // 指定点の任意STA（確認）
    if (state.cross.ui.elemMode === 'override') {
      const k = String(state.cross.ui.selectedStaKey||'').trim();
      if (k) return k;
    }
    const t = String(state.cross.ui.editStaTok||'').trim();
    return t;
  };

  const tok = computePreviewTok();
  ensureCrossState();
  state.cross.ui.previewTok = tok;
  saveState();

  if (tok) drawPreview(tok);
  else {
    // 空白の時は表示無し
    const infoEl = document.getElementById('xsPreviewInfo');
    const tblEl = document.getElementById('xsPreviewTable');
    const elemEl = document.getElementById('xsPreviewElemView');
    if (infoEl) infoEl.textContent = '';
    if (tblEl) tblEl.innerHTML = '';
    if (elemEl) elemEl.innerHTML = '';
    const canvas = document.getElementById('xsCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }
  }

bindExtraUI("cross", viewCross, pitch);


  /* -------- OUTPUT -------- */
  const stepInt = Math.max(1, Math.floor(state.outputStep||1));
  ensureExtraState();

  const planKeyStas = (res.keypoints||[]).filter(k=>Number.isFinite(k.sta)).map(k=>k.sta);
  const profModelOut = buildProfileModel(state.profile, res.total);

  const pvStas = (profModelOut.ok ? (profModelOut.pv||[]).map(p=>p.sta) : []);
  const vcStas = [];
  if (profModelOut.ok) {
    for (const c of (profModelOut.curves||[])) {
      vcStas.push(c.s0, c.s0 + c.L/2, c.s1);
    }
  }

  // 測点表示ピッチのグリッドも統合（出力と画面の測点がズレないように）
const pitchStep = Math.max(1e-6, Number(pitch || 1));
const pitchGrid = [];
if (Number.isFinite(res.total) && res.total >= 0 && Number.isFinite(pitchStep)) {
  // pitch が極端に小さいと点数が増えすぎるので、安全側に 1m 未満は 1m に丸める
  const stepSafe = Math.max(1, pitchStep);
  for (let s = 0; s < res.total - 1e-9; s += stepSafe) pitchGrid.push(s);
  pitchGrid.push(res.total);
}

  const sources = [
    { label: "平面主要点", values: planKeyStas },
    ...(state.profile.enabled && profModelOut.ok ? [
      { label: "縦断PV", values: pvStas },
      { label: "縦断曲線(BVC/VPI/EVC)", values: vcStas },
    ] : []),
    { label: "測点表示ピッチ", values: pitchGrid },
    { label: "平面追加", values: state.extraStations.plan.map(x=>x.m) },
    { label: "縦断追加", values: state.extraStations.profile.map(x=>x.m) },
    { label: "横断追加", values: state.extraStations.cross.map(x=>x.m) },
    { label: "統合追加", values: state.extraStations.output.map(x=>x.m) },
  ];

  const stBuild = buildUnifiedStationList(res.total, stepInt, sources);

  const breakdown = {
    planKey: planKeyStas.length,
    pv: pvStas.length,
    vc: vcStas.length,
    addPlan: state.extraStations.plan.length,
    addProf: state.extraStations.profile.length,
    addCross: state.extraStations.cross.length,
    addOut: state.extraStations.output.length,
  };

  viewOutput.innerHTML = `
    <div class="card" id="secOutput">
      <h2>最終出力（平面 + 縦断 + 横断の追加測点を統合して1本）</h2>
      <div class="grid grid-3">
        <div class="mini">
          <b>総延長</b>：${res.total.toFixed(3)} m<br/>
          <b>測点表示ピッチ</b>：${pitch} m / <b>出力間隔</b>：${stepInt} m<br/>
          <b>縦断GL出力</b>：${state.profile.enabled ? "ON" : "OFF"}
        </div>
        <div class="mini">
          <b>統合点数</b>：${stBuild.stations.length} 点<br/>
          <span class="pill">基準(0..総延長) ${stBuild.baseCount} 点</span>
          <span class="pill">追加(主要点+自由) ${stBuild.extraCount} 点</span>
        </div>
        <div class="mini">
          <b>内訳</b><br/>
          平面主要点 ${breakdown.planKey} / 縦断PV ${breakdown.pv} / 縦断曲線点 ${breakdown.vc}<br/>
          追加：平面 ${breakdown.addPlan} / 縦断 ${breakdown.addProf} / 横断 ${breakdown.addCross} / 統合 ${breakdown.addOut}
        </div>
      </div>
      ${stBuild.notes.map(n=>`<div class="warn">⚠ ${n}</div>`).join("")}
      <div class="mini" style="margin-top:8px;">※主要点（TS/SC/CS/ST）・PV・BVC/VPI/EVC・測点表示ピッチのグリッドは自動で含めます（重複は自動排除）</div>
    </div>

    <div class="card">
      <h2>統合追加測点（出力に統合）</h2>
      <div class="grid grid-3">
        <div class="mini">
          入力：追加距離(m) / k+rem（pitch=${pitch}m）<br/>
          区切り：空白・カンマ・改行
        </div>
        <div>
          <label>追加測点 追加入力</label>
          <textarea id="extraTokens_output" placeholder="例：101.527 / 5+1.527 / 0+50.000 など"></textarea>
        </div>
        <div>
          <button class="btn" id="addExtras_output">＋ 追加</button>
          <div style="height:10px;"></div>
          <button class="btn btn-ghost" id="clearExtras_output">統合追加を全クリア</button>
        </div>
      </div>

      ${state.extraStations.output.length ? `
      <div style="overflow:auto; margin-top:10px;">
        <table>
          <thead><tr><th>ID</th><th>測点表示</th><th>追加距離(m)</th><th class="right">削除</th></tr></thead>
          <tbody>
            ${state.extraStations.output.map(x=>`
              <tr>
                <td>${x.id}</td>
                <td>${metersToStaPitch(x.m, pitch, 3)}</td>
                <td><input data-ex-group="output" data-ex-id="${x.id}" type="number" step="0.001" value="${x.m}" /></td>
                <td class="right"><button class="btn btn-ghost" data-ex-group="output" data-ex-del="${x.id}">削除</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : `<div class="mini" style="margin-top:10px;">（まだ統合追加測点はありません）</div>`}
    </div>

    <div class="card">
      <h2>中心線CSV出力</h2>
      <div class="grid grid-3">
        <div class="mini">
          出力点数：<b>${stBuild.stations.length}</b> 点<br/>
          座標小数桁：<b>${d}</b> 桁<br/>
          測点表示：<b>k+rem</b>（pitch=${pitch}m）
        </div>
        <div>
          <button class="btn btn-ok" id="dlCSV" ${stBuild.stations.length ? "" : "disabled"}>CSVダウンロード</button>
          <div class="mini" style="margin-top:8px;">ファイル名：${state.projectName}_中心線.csv</div>
        </div>
        <div class="mini">列：測点 / 追加距離 / N / E / Az / GL（縦断ON時）</div>
      </div>

      <div style="overflow:auto; max-height:420px; margin-top:10px;">
        <table>
          <thead><tr><th>測点</th><th>追加距離(m)</th><th>N</th><th>E</th><th>Az</th><th>GL</th></tr></thead>
          <tbody>
            ${stBuild.stations.slice(0,200).map(s=>{
              const p = evalAlignment(res.segments, s);
              const gl = state.profile.enabled ? evalProfileZ(profModelOut, s) : NaN;
              return `
                <tr>
                  <td>${metersToStaPitch(s, pitch, 3)}</td>
                  <td>${s.toFixed(3)}</td>
                  <td>${p.N.toFixed(d)}</td>
                  <td>${p.E.toFixed(d)}</td>
                  <td>${p.az.toFixed(4)}</td>
                  <td>${Number.isFinite(gl) ? gl.toFixed(3) : ""}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="mini" style="margin-top:8px;">※プレビューは先頭200点まで</div>
    </div>

    <div class="card">
      <h2>平面線形 出力（SIMA / XRF）</h2>
      <div class="grid grid-3">
        <div class="mini">
          <b>拡張子</b>：.sim / .sima（SIMA） / .xrf（RoadGM）<br/>
          .sim は<b>ASCII限定</b>で出力（Shift-JIS環境でも壊れにくくするため）<br/>
          .xrf は UTF-8
        </div>
        <div>
          <button class="btn btn-ok" id="dlPlanSIM" ${stBuild.stations.length ? "" : "disabled"}>SIMA(.sim)ダウンロード</button>
          <div style="height:10px;"></div>
          <button class="btn btn-ok" id="dlPlanXRF" ${stBuild.stations.length ? "" : "disabled"}>XRF(.xrf)ダウンロード</button>
          <div class="mini" style="margin-top:8px;">
            ファイル名：${state.projectName}_plan.sim / ${state.projectName}_plan.xrf
          </div>
        </div>
        <div class="mini">
          出力対象：<b>平面</b>（中心線）<br/>
          中間点：統合測点（基準+主要点+追加）<br/>
          座標：E/N（小数6桁）
        </div>
      </div>
    </div>

    
    </div>
  `;

  bindExtraUI("output", viewOutput, pitch);

  const dlCSV = document.getElementById("dlCSV");
  if (dlCSV) {
    dlCSV.onclick = ()=> {
      const lines = [];
      lines.push(["STA","STA_M","N","E","AZ","GL"].join(","));
      for (const s of stBuild.stations) {
        const p = evalAlignment(res.segments, s);
        const gl = state.profile.enabled ? evalProfileZ(profModelOut, s) : NaN;
        lines.push([
          metersToStaPitch(s, pitch, 3),
          s.toFixed(3),
          p.N.toFixed(d),
          p.E.toFixed(d),
          p.az.toFixed(4),
          Number.isFinite(gl) ? gl.toFixed(3) : ""
        ].join(","));
      }
      downloadText(lines.join("\n"), `${state.projectName}_中心線.csv`, "text/csv;charset=utf-8");
    };
  }
    /* -------- v18: plan export -------- */
  const btnSim = document.getElementById("dlPlanSIM");
  if (btnSim) {
    btnSim.onclick = ()=> {
      try {
        const sim = buildPlanSimaText(state.projectName, workPoints, res.keypoints, stBuild.stations, res.segments);
        downloadText(sim, `${state.projectName}_plan.sim`, "text/plain;charset=utf-8");
      } catch (e) {
        alert("SIMA出力に失敗: " + (e?.message || e));
      }
    };
  }
  const btnXrf = document.getElementById("dlPlanXRF");
  if (btnXrf) {
    btnXrf.onclick = ()=> {
      try {
        const xrf = buildPlanXrfText(state.projectName, workPoints, res.keypoints, stBuild.stations, res.segments);
        downloadText(xrf, `${state.projectName}_plan.xrf`, "application/xml;charset=utf-8");
      } catch (e) {
        alert("XRF出力に失敗: " + (e?.message || e));
      }
    };
  }

  /* -------- v18: design elevation query -------- */
  const qSta = document.getElementById("qSta");
  const qSide = document.getElementById("qSide");
  const qOffset = document.getElementById("qOffset");
  const qOut = document.getElementById("qOut");
  const qWidthPill = document.getElementById("qWidthPill");
  const btnQ = document.getElementById("btnQueryElev");

  const totalLen = res.total;

  const updateWidthPill = () => {
    if (!qWidthPill) return;
    const side = qSide?.value || "center";
    if (side === "center") { qWidthPill.textContent = "端部幅員：0.000 m"; return; }
    try {
      const m = parseStaPitch(qSta?.value || "", pitch);
      if (!Number.isFinite(m)) throw new Error("STA不正");
      const cr = evalCrossDzAtSta(m, side, 0);
      qWidthPill.textContent = `端部幅員：${Number(cr.width||0).toFixed(3)} m`;
    } catch {
      qWidthPill.textContent = "端部幅員：-";
    }
  };

  if (qSta) qSta.oninput = updateWidthPill;
  if (qSide) qSide.onchange = updateWidthPill;

  const segTable = (segs) => {
    if (!segs?.length) return "<div class='mini'>(横断定義なし)</div>";
    const rows = segs.slice().sort((a,b)=>(+a.end)-(+b.end)).map(r=>{
      const end = (+r.end).toFixed(3);
      const g = (+r.slopePct).toFixed(3);
      return `<tr><td class="right">${end}</td><td class="right">${g}</td></tr>`;
    }).join("");
    return `
      <div style="overflow:auto; margin-top:6px;">
        <table>
          <thead><tr><th class="right">区間終点(m)</th><th class="right">勾配(%)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  if (btnQ) {
    btnQ.onclick = ()=> {
      try {
        const mRaw = parseStaPitch(qSta?.value || "", pitch);
        let m = mRaw;
        const side = qSide?.value || "center";
        let off = Number(qOffset?.value || 0);
        if (!Number.isFinite(off) || off < 0) off = 0;

        // clamp to range
        if (m < 0) m = 0;
        if (m > totalLen) m = totalLen;
        if (side === "center") off = 0;

        const staDispPitch = metersToStaPitch(m, pitch, 3);

        const zc = state.profile.enabled ? evalProfileZ(profModelOut, m) : NaN;

        let cr = { dz:0, width:0, source:"中心", prevKey:"", nextKey:"", t:0 };
        if (side !== "center") cr = evalCrossDzAtSta(m, side, off);

        const z = Number.isFinite(zc) ? (zc + cr.dz) : NaN;

        // store query point for cross/plan overlay
        ensureCrossState();
        const xSigned = (side==="right" ? +off : side==="left" ? -off : 0);
        state.cross.ui.queryPoint = { m, staDispPitch, side, off, x: xSigned, dz: cr.dz, zPlan: z };
        // sync cross preview station to this STA so user can see it in simple cross view
        state.cross.ui.previewTok = staDispPitch;
        saveState();

        // show segment info
        let segInfoHtml = "";
        if (side === "center") {
          segInfoHtml = "<div class='mini'>横断：中心（ΔZ=0）</div>";
        } else if (cr.source.startsWith("擦り付け") && cr.prevKey && cr.nextKey) {
          const s0 = state.cross.overrides[cr.prevKey]?.[side]?.segs || [];
          const s1 = state.cross.overrides[cr.nextKey]?.[side]?.segs || [];
          segInfoHtml = `
            <div class="mini">横断：${cr.source}（t=${cr.t.toFixed(3)}）</div>
            <div class="mini">前：${cr.prevKey} / 後：${cr.nextKey}</div>
            <div class="mini"><b>前の横断</b></div>
            ${segTable(s0)}
            <div class="mini" style="margin-top:6px;"><b>後の横断</b></div>
            ${segTable(s1)}
          `;
        } else if (cr.prevKey) {
          const s0 = state.cross.overrides[cr.prevKey]?.[side]?.segs || [];
          segInfoHtml = `<div class="mini">横断：${cr.source}（${cr.prevKey}）</div>${segTable(s0)}`;
        } else if (cr.nextKey) {
          const s1 = state.cross.overrides[cr.nextKey]?.[side]?.segs || [];
          segInfoHtml = `<div class="mini">横断：${cr.source}（${cr.nextKey}）</div>${segTable(s1)}`;
        } else {
          const eff = getEffectiveCrossSegsAt(m, side);
          segInfoHtml = `<div class="mini">横断：${cr.source}</div>${segTable(eff.segs)}`;
        }

        const note = [];
        if (Math.abs(mRaw - m) > 1e-9) note.push(`STAが範囲外のため ${m.toFixed(3)}m に丸めました`);
        if (!Number.isFinite(zc)) note.push("縦断がOFFのため中心標高(GL)が計算できません");
        if (side !== "center" && off > (cr.width||0) + 1e-9) note.push(`指定幅 ${off.toFixed(3)}m は端部幅員 ${Number(cr.width||0).toFixed(3)}m を超えています（外挿でΔZ計算）`);

        qOut.innerHTML = `
          <div class="grid grid-3">
            <div class="mini">
              <b>STA</b>：${staDispPitch}（${m.toFixed(3)}m / pitch=${pitch}m）<br/>
              <b>方向</b>：${side==="right"?"右":side==="left"?"左":"中心"} / <b>幅</b>：${off.toFixed(3)}m
            </div>
            <div class="mini">
              <b>中心標高(GL)</b>：${Number.isFinite(zc)?zc.toFixed(3):"-"}<br/>
              <b>ΔZ(中心→指定幅)</b>：${cr.dz.toFixed(3)}<br/>
              <b>計画標高</b>：${Number.isFinite(z)?z.toFixed(3):"-"}
            </div>
            <div class="mini">
              <b>端部幅員</b>：${Number(cr.width||0).toFixed(3)}m<br/>
              <b>横断判定</b>：${cr.source}
            </div>
          </div>
          ${note.length ? note.map(x=>`<div class="warn">⚠ ${x}</div>`).join("") : ""}
          <div class="sep"></div>
          ${segInfoHtml}
        `;
        updateWidthPill();
      } catch(e) {
        alert("計算に失敗: " + (e?.message || e));
      }
    };
  }

  updateWidthPill();

  /* -------- SAVE -------- */
  viewSave.innerHTML = `
    <div class="card" id="secSave">
      <h2>保存（iPad内 自動保存 + JSON）</h2>
      <div class="grid grid-3">
        <div class="mini">
          <b>自動保存</b>：このiPadのlocalStorageに常時保存中。<br/>
          Safariのタブが落ちても復元しやすいです。<br/>
          ただし端末の整理で消える可能性はあるので、節目でJSON保存がおすすめ。
        </div>
        <div>
          <button class="btn btn-ok" id="saveJSON">JSONを書き出し（バックアップ）</button>
          <div style="height:10px;"></div>
          <input id="loadJSON" type="file" accept="application/json" />
        </div>
        <div>
          <button class="btn btn-ghost" id="clearLocal">iPad内保存を削除（注意）</button>
          <div class="mini" style="margin-top:8px;">※削除すると復元できません</div>
        </div>
      </div>
      <div class="mini" style="margin-top:10px;">
        更新が反映されないとき：<b>sw.js の CACHE_NAME を v18-7（例：road-align-v18-7）</b> に上げると確実です。
      </div>
    </div>
  `;

  /* save bind */
  const saveBtn = document.getElementById("saveJSON");
  if (saveBtn) {
    saveBtn.onclick = ()=>{
      const blob = JSON.stringify(state, null, 2);
      const name = `${state.projectName}_backup.json`;
      downloadText(blob, name, "application/json;charset=utf-8");
    };
  }
  const loadInput = document.getElementById("loadJSON");
  if (loadInput) {
    loadInput.onchange = async (e)=>{
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const obj = JSON.parse(txt);
        if (!obj || typeof obj !== "object") throw new Error("JSONが不正");
        state = normalizeState(Object.assign(state, obj));
        try { window.state = state; } catch (e) {}
        saveState();
        render();
        alert("読み込み完了");
      } catch(err) {
        alert("読み込み失敗: " + (err.message || err));
      } finally {
        e.target.value = "";
      }
    };
  }
  const clearLocalBtn = document.getElementById("clearLocal");
  if (clearLocalBtn) {
    clearLocalBtn.onclick = ()=>{
      if (!confirm("iPad内保存を削除します。よろしい？")) return;
      try { LS.remove(LS_KEY); } catch(e) {}
      alert("削除しました（次回起動は初期値）");
    };
  }

  saveState();
};

// Navigation buttons (jump to section)
document.querySelectorAll("[data-jump]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.getAttribute("data-jump");
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior:"smooth", block:"start" });
  });
});

// Header collapse toggle
(function(){
  const btn = document.getElementById('btnHeaderToggle');
  if (btn) {
    btn.addEventListener('click', ()=>{
      uiState.headerCollapsed = !uiState.headerCollapsed;
      saveUI();
      applyHeaderCollapsed();
    });
  }
  applyHeaderCollapsed();
})();


// version badge
(function(){
  const b = document.getElementById('appVerBadge');
  if (b && window.APP_VERSION) b.textContent = "v" + window.APP_VERSION;
})();

render();


/* Tab JSON export bind */
(function(){
  const b1=document.getElementById("btnPlanJsonExport");
  if (b1) b1.onclick = ()=>{ try{ exportPlanJson(); }catch(e){ alert("平面JSON書き出しエラー："+(e&&e.message?e.message:e)); } };
  const b2=document.getElementById("btnProfileJsonExport");
  if (b2) b2.onclick = ()=>{ try{ exportProfileJson(); }catch(e){ alert("縦断JSON書き出しエラー："+(e&&e.message?e.message:e)); } };
  const b3=document.getElementById("btnCrossJsonExport");
  if (b3) b3.onclick = ()=>{ try{ exportCrossJson(); }catch(e){ alert("横断JSON書き出しエラー："+(e&&e.message?e.message:e)); } };
})();



// ---- filename helper (prompt + timestamp) ----
function _sanitizeFilePart(s){
  return String(s || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "project";
}
function _tsCompact(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function _getDefaultExportBase(){
  try{
    const last = LS.get("lastExportBaseName") || "";
    if(last.trim()) return last.trim();
  }catch(e){}
  return (state && state.projectName) ? String(state.projectName) : "";
}
function buildExportFileName(kind){
  // kind: 'plan' | 'profile' | 'cross' | 'state'
  const defBase = _getDefaultExportBase();
  const input = window.prompt("書き出しファイル名（先頭）を入力してね\n例）現場名_工区名", defBase);
  const base = _sanitizeFilePart((input==null ? defBase : input));
  try{ LS.set("lastExportBaseName", base); }catch(e){}
  return `${base}_${kind}_${_tsCompact()}.json`;
}
