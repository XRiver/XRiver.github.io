"use strict";
/* =====================================================================
   《戴森球计划 · 合成树助手》
   Layered (Sugiyama-style) graph layout + focus-mode re-layout.
   ===================================================================== */

/* ---------------- data & categories ---------------- */
const G = window.GAME;
const $ = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>[...el.querySelectorAll(s)];

const CAT_ORDER = ["矩阵","矿物资源","基础材料","组件","燃料","武器与单位","戴森球","物流","电力","生产建筑","防御设施","装饰","黑雾掉落"];
const CAT_COLOR = {
  "矿物资源":"#e8b04b","基础材料":"#7fb4e6","组件":"#5ad8c6","矩阵":"#b37feb",
  "燃料":"#fa8c16","武器与单位":"#f759ab","戴森球":"#f8d34a","物流":"#13c2c2",
  "电力":"#73d13d","生产建筑":"#4096ff","防御设施":"#ff7875","装饰":"#9aa7bd","黑雾掉落":"#a06bd6"
};
const RAW_GROUP = {
  "基础矿脉": ["iron-ore","copper-ore","silicon-ore","titanium-ore","stone","coal","crude-oil",
              "fire-ice","kimberlite-ore","fractal-silicon","grating-crystal","stalagmite-crystal",
              "organic-crystal","unipolar-magnet"],
  "海洋与液体": ["water","sulfuric-acid"],
  "气态巨行星": ["hydrogen","deuterium"],
  "树木与植物": ["log","plant-fuel"]
};
const BUILDING_CLS = {"化工厂":"chem","量子化工厂":"chem"};
const GRP_EN = {"基础矿脉":"Basic veins","海洋与液体":"Oceans & fluids","气态巨行星":"Gas giants","树木与植物":"Trees & plants"};
const catRank = id => CAT_ORDER.indexOf(ITEM[id].cat);

const ITEM = {}; G.items.forEach(it=>ITEM[it.id]=it);
G.items.forEach(it=>ITEM[it.en.toLowerCase()] = ITEM[it.en.toLowerCase()] || it.id);

/* ---------------- i18n ---------------- */
let lang = "zh";   // "zh" | "en"
const L = (zh, en) => lang === "zh" ? zh : en;
const CAT_EN = {"矿物资源":"Resources","基础材料":"Materials","组件":"Components","矩阵":"Matrices","燃料":"Fuel","武器与单位":"Weapons & Units","戴森球":"Dyson Sphere","物流":"Logistics","电力":"Power","生产建筑":"Production","防御设施":"Defense","装饰":"Decoration","黑雾掉落":"Dark Fog Drops"};
const BLD_EN = {"电弧熔炉":"Arc Smelter","制造台":"Assembling Machine","原油精炼厂":"Oil Refinery","化工厂":"Chemical Plant","能量枢纽":"Energy Exchanger","微型粒子对撞机":"Miniature Particle Collider","射线接收站":"Ray Receiver","分馏塔":"Fractionator","矩阵研究站":"Matrix Lab","采矿机":"Mining Machine","轨道采集器":"Orbital Collector","抽水站":"Water Pump","原油萃取站":"Oil Extractor","量子化工厂":"Quantum Chemical Plant","制造台Mk.I":"Assembling Machine Mk.I","制造台Mk.II":"Assembling Machine Mk.II","制造台Mk.III":"Assembling Machine Mk.III"};
const SRC_EN = {"vein":"Vein mining","ocean":"Ocean","gas":"Gas giant","tree":"Logging","plant":"Foraging","darkfog":"Dark Fog drop","special":"Special"};
const nameOf   = id => lang === "zh" ? ITEM[id].zh : ITEM[id].en;
const catName  = c  => lang === "zh" ? c  : (CAT_EN[c] || c);
const bldName  = b  => lang === "zh" ? b  : (BLD_EN[b] || b);
const srcLabel = s  => lang === "zh" ? (s.label || "") : (SRC_EN[s.type] || s.label || "");
const recipeName = r => lang === "zh" ? r.zh : (r.en || r.zh);
const itemAlt   = it => lang === "zh" ? it.en : it.zh;
const recipeAlt = r  => lang === "zh" ? r.en : r.zh;


document.getElementById("ver-tag").textContent = "v" + G.version;

/* ---------------- state ---------------- */
let disabled = new Set();
let focus = null;              // focused item id (focus mode)
let focusStack = [];
let resourceMode = false;
let resPanelOpen = true;       // whether the resource-selection panel is expanded
let selectedRaws = new Set();
let catFilter = null;          // category highlight (click legend); global only
let targetRate = 100;          // /min target for the production calculator
const recipeChoice = {};       // itemId -> chosen recipe id (for multi-recipe calc)

/* ---------------- graph set operations ---------------- */
function enabledRecipes(){ return G.recipes.filter(r=>!disabled.has(r.id)); }

function upstreamOf(id){
  const recs = enabledRecipes();
  const hasProducer = {}; for (const r of recs) r.out.forEach(o=>{ hasProducer[o.i] = true; });
  const set = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (set.has(cur)) continue;
    set.add(cur);
    for (const r of recs)
      if (r.out.some(o=>o.i===cur))
        for (const inp of r.in)
          // only follow recipes into inputs that are themselves obtainable (raw source
          // or still producible via an enabled recipe), so disabling a recipe truly prunes
          if (ITEM[inp.i].raw || hasProducer[inp.i]) stack.push(inp.i);
  }
  return set;
}
function upstreamAll(id){
  // upstream ignoring disabled recipes (keeps recipe toggles available & revivable)
  const set = new Set(), stack = [id];
  const hasProducer = {}; for (const r of G.recipes) r.out.forEach(o=>hasProducer[o.i]=true);
  while (stack.length) {
    const cur = stack.pop();
    if (set.has(cur)) continue;
    set.add(cur);
    for (const r of G.recipes)
      if (r.out.some(o=>o.i===cur))
        for (const inp of r.in)
          if (ITEM[inp.i].raw || hasProducer[inp.i]) stack.push(inp.i);
  }
  return set;
}
function hasRecipe(id){ return G.recipes.some(r=>r.out.some(o=>o.i===id)); }
function downstreamOf(id){
  const recs = enabledRecipes();
  const set = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (set.has(cur)) continue;
    set.add(cur);
    for (const r of recs)
      if (r.in.some(inp=>inp.i===cur))
        for (const o of r.out) stack.push(o.i);
  }
  return set;
}
function craftableFrom(seeds){
  const avail = new Set(seeds), er = enabledRecipes();
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const r of er)
      if (r.in.every(inp=>avail.has(inp.i)))
        for (const o of r.out)
          if (!avail.has(o.i)) { avail.add(o.i); changed = true; }
  }
  return avail;
}

/* =====================================================================
   Layered layout (longest-path layering + barycenter crossing reduction)
   ===================================================================== */
const NW = 152, NH = 30, ROWG = 12, COLX = 198, PAD = 40;

function tarjan(nodes, fwd){
  const index = {}, low = {}, on = {}, stack = [], comp = {};
  let idx = 0, compCnt = 0;
  function strongconnect(v){
    index[v] = low[v] = idx++; stack.push(v); on[v] = true;
    fwd[v].forEach(w=>{
      if (index[w] === undefined){ strongconnect(w); low[v] = Math.min(low[v], low[w]); }
      else if (on[w]) low[v] = Math.min(low[v], index[w]);
    });
    if (low[v] === index[v]){
      let w;
      do { w = stack.pop(); on[w] = false; comp[w] = compCnt; } while (w !== v);
      compCnt++;
    }
  }
  nodes.forEach(v=>{ if (index[v] === undefined) strongconnect(v); });
  return { comp, compCnt };
}

function computeLayoutSet(memberSet){
  const recs = enabledRecipes();          // layout uses enabled recipes
  const ids = [...memberSet];
  const fwd = {}, back = {};
  ids.forEach(id=>{ fwd[id] = new Set(); back[id] = new Set(); });
  for (const r of recs) {
    const outs = r.out.filter(o=>memberSet.has(o.i));
    const ins  = r.in.filter(x=>memberSet.has(x.i));
    for (const o of outs) for (const inp of ins)
      if (o.i !== inp.i){ fwd[inp.i].add(o.i); back[o.i].add(inp.i); }
  }

  const { comp, compCnt } = tarjan(ids, fwd);
  // condensation DAG
  const cEdges = Array.from({length:compCnt}, ()=>new Set());
  const cIn = Array.from({length:compCnt}, ()=>[]);
  const indeg = new Array(compCnt).fill(0);
  ids.forEach(v=>{
    fwd[v].forEach(w=>{
      const cv = comp[v], cw = comp[w];
      if (cv !== cw && !cEdges[cv].has(cw)){ cEdges[cv].add(cw); cIn[cw].push(cv); indeg[cw]++; }
    });
  });
  // Kahn topological order
  const q = []; for (let c=0;c<compCnt;c++) if (indeg[c]===0) q.push(c);
  const topo = []; const din = indeg.slice();
  while (q.length){ const c = q.shift(); topo.push(c); cEdges[c].forEach(n=>{ if (--din[n]===0) q.push(n); }); }
  // longest-path layer per component
  const cl = new Array(compCnt).fill(0);
  for (const c of topo){
    if (!cIn[c].length) { cl[c] = 0; continue; }
    let mx = 0;
    for (const p of cIn[c]) mx = Math.max(mx, cl[p]);
    cl[c] = mx + 1;
  }
  const lay = {}; ids.forEach(id=>{ lay[id] = cl[comp[id]]; });

  // group by layer
  let maxLay = 0; ids.forEach(id=>{ maxLay = Math.max(maxLay, lay[id]); });
  const layers = Array.from({length:maxLay+1}, ()=>[]);
  ids.forEach(id=>layers[lay[id]].push(id));

  const sortByCat = a=>{ const c = catRank(a)-catRank(b2(a)); return c; };
  const sortFn = (a,b)=> (catRank(a)-catRank(b)) || nameOf(a).localeCompare(nameOf(b),"zh-Hans-CN");
  layers.forEach(l=>l.sort(sortFn));

  // barycenter sweeps to reduce edge crossings
  const layerIdx = {}; layers.forEach((l,i)=>l.forEach(n=>layerIdx[n]=i));
  function neighborIn(adj, l){
    const set = new Set(layers[l]); const idx = {}; layers[l].forEach((n,i)=>idx[n]=i);
    let sum=0, c=0;
    return { count:m=>{ sum=0; c=0; adj[m].forEach(n=>{ if (idx[n]!==undefined){ sum+=idx[n]; c++; } }); return c? sum/c : idx[m]; } };
  }
  for (let sweep=0; sweep<6; sweep++){
    const down = sweep%2===0;
    const order = down ? layers.map((_,i)=>i) : layers.map((_,i)=>i).reverse();
    for (const l of order){
      const adjLayer = down ? l-1 : l+1;
      const items = layers[l].map(n=>{
        const adj = down ? back[n] : fwd[n];
        let sum=0, c=0;
        const idx = {};  // index of neighbor within adjacent layer
        if (adjLayer>=0 && adjLayer<layers.length){
          layers[adjLayer].forEach((m,i)=>idx[m]=i);
          adj.forEach(m=>{ if (idx[m]!==undefined){ sum+=idx[m]; c++; } });
        }
        if (c) return { n, b: sum/c };
        return { n, b: (layers[l].indexOf(n)) }; // default current pos
      });
      items.sort((a,b)=> (catRank(a.n)-catRank(b.n)) || (a.b-b.b) || nameOf(a.n).localeCompare(nameOf(b.n),"zh-Hans-CN"));
      layers[l] = items.map(x=>x.n);
    }
  }
  layerIdx; // unused rename guard
  const _ = layerIdx;

  // ---- coordinate assignment: center each node on its upstream (parent) span ----
  const pitch = NH + ROWG;
  const posY = {};
  layers.forEach((l, ci)=> l.forEach((id, ri)=> posY[id] = ri * pitch));  // layer 0 anchored, rest seeded
  function desiredY(l, id, dir){   // dir=true: center on parents (back); dir=false: center on children (fwd)
    const adj = dir ? back[id] : fwd[id];
    let sum = 0, c = 0;
    for (const n of adj) if (posY[n] !== undefined){ sum += posY[n]; c++; }
    let d = c ? sum / c : posY[id];
    if (ITEM[id].cat === "矩阵") d = d * 0.12;   // pull matrices toward the top of their column
    return d;
  }
  function placeLayer(l, dir){
    const L = layers[l]; if (!L.length) return;
    const items = L.map(id=>({ id, d: desiredY(l, id, dir) }))
                    .sort((a,b)=> (a.d - b.d) || (catRank(a.id) - catRank(b.id)));
    const y = new Array(items.length);
    y[0] = items[0].d;
    for (let i=1; i<items.length; i++) y[i] = Math.max(items[i].d, y[i-1] + pitch);
    const md = items.reduce((s,x)=> s + x.d, 0) / items.length;   // mean desired
    const mp = y.reduce((a,b)=> a + b, 0) / items.length;          // mean placed
    let sh = md - mp;                                              // centre the block, but never below 0
    const minY = Math.min(...y);
    if (sh < -minY) sh = -minY;
    items.forEach((x,i)=> posY[x.id] = y[i] + sh);
  }
  for (let iter=0; iter<10; iter++){
    for (let l=1; l<layers.length; l++) placeLayer(l, true);        // children follow parents
    for (let l=layers.length-1; l>=1; l--) placeLayer(l, false);    // refine via children (layer 0 stays anchored)
  }
  // normalize so nothing sits above the canvas
  let minY = Infinity, maxY = 0;
  layers.forEach((l, ci)=> l.forEach(id=>{ if (posY[id] < minY) minY = posY[id]; if (posY[id] > maxY) maxY = posY[id]; }));
  const off = minY < 0 ? -minY : 0;
  const pos = {};
  layers.forEach((l, ci)=> l.forEach(id=>{ pos[id] = { x: PAD + ci*COLX, y: PAD + posY[id] + off }; }));
  return { pos, w: PAD*2 + layers.length*COLX, h: PAD*2 + (maxY + NH), lay, layers };
}

/* ---------------- layouts & mode ---------------- */
let curLayout = null;   // {pos, w, h, lay, layers}
let mode = "global";

function globalLayout(){
  return computeLayoutSet(new Set(G.items.map(it=>it.id)));
}
function focusLayout(id){
  return computeLayoutSet(upstreamOf(id));
}

function currentMemberSet(){
  return mode === "focus" ? new Set([...Object.keys(curLayout.pos)]) : new Set(G.items.map(it=>it.id));
}
function currentEdges(){
  const recs = enabledRecipes(), mem = currentMemberSet();
  const agg = {}, list = [];
  for (const r of recs)
    for (const o of r.out) for (const inp of r.in){
      if (inp.i === o.i || !mem.has(inp.i) || !mem.has(o.i)) continue;
      const k = inp.i + ">" + o.i;
      if (!agg[k]){ agg[k] = { src: inp.i, dst: o.i, recipes: [], x1:0,y1:0,x2:0,y2:0 }; list.push(agg[k]); }
      agg[k].recipes.push(r);
    }
  for (const e of list){
    const a = curLayout.pos[e.src], b = curLayout.pos[e.dst];
    e.x1 = a.x + NW; e.y1 = a.y + NH/2; e.x2 = b.x; e.y2 = b.y + NH/2;
  }
  return list;
}
function edgePath(e){
  const dx = e.x2 - e.x1;
  if (dx <= 0) return `M ${e.x1} ${e.y1} C ${e.x1+22} ${e.y1}, ${e.x1+22} ${e.y2}, ${e.x2} ${e.y2}`;
  const xm = dx*0.45;
  return `M ${e.x1} ${e.y1} C ${e.x1+xm} ${e.y1}, ${e.x2-xm} ${e.y2}, ${e.x2} ${e.y2}`;
}

/* ---------------- svg build ---------------- */
const world = $("#world");
const NS = "http://www.w3.org/2000/svg";

function fmtCount(n){ return n % 1 === 0 ? String(n) : (Math.round(n*100)/100)+""; }
function recipeTooltip(r){
  const ins = r.in.map(x=>nameOf(x.i)+"×"+fmtCount(x.n)).join(" + ");
  const outs = r.out.map(x=>nameOf(x.i)+"×"+fmtCount(x.n)).join(" + ");
  const tm = r.t < 0 ? `${L("每循环","per cycle")} ${(-r.t).toFixed(1)}%` : Math.round(r.t*10)/10 + L(" 秒/份"," s/unit");
  return `<span class="bld">${bldName(r.b)}</span>　${recipeName(r)}（${tm}）<br>${ins} → ${outs}`;
}

function edgeSpanOpacity(e){
  // fade very long-range edges in the overview so they recede into the background
  if (mode !== "global") return 0.85;                 // focus view: keep edges clear
  const s = curLayout.lay[e.src] ?? 0, t = curLayout.lay[e.dst] ?? 0;
  const span = Math.max(0, t - s);
  return span <= 2 ? 0.62 : span <= 4 ? 0.40 : span <= 6 ? 0.22 : 0.13;
}
function buildGraph(){
  const members = new Set(Object.keys(curLayout.pos));
  const edges = currentEdges();

  const eg = document.createElementNS(NS,"g");
  eg.id = "edgesG";
  for (const e of edges){
    const cl = ITEM[e.src].cat;
    const g = document.createElementNS(NS,"g");
    g.setAttribute("class","edge");
    g.style.setProperty("--cat", CAT_COLOR[cl]);
    g.style.setProperty("--spanop", String(edgeSpanOpacity(e)));
    const p = document.createElementNS(NS,"path");
    p.setAttribute("class","path");
    p.setAttribute("d", edgePath(e));
    g.appendChild(p);
    g.__edge = e;
    g.addEventListener("mouseenter", ev=>showEdgeTip(ev, e));
    g.addEventListener("mousemove", moveTip);
    g.addEventListener("mouseleave", hideTip);
    eg.appendChild(g);
  }

  const ng = document.createElementNS(NS,"g");
  ng.id = "nodesG";
  for (const it of G.items){
    const p = curLayout.pos[it.id];
    if (!p) continue;
    const g = document.createElementNS(NS,"g");
    g.setAttribute("class","node");
    g.dataset.id = it.id;
    g.setAttribute("transform", `translate(${p.x} ${p.y})`);
    const body = document.createElementNS(NS,"rect");
    body.setAttribute("class","body");
    body.setAttribute("width", NW); body.setAttribute("height", NH);
    g.appendChild(body);
    const bar = document.createElementNS(NS,"rect");
    bar.setAttribute("x",0); bar.setAttribute("y",2);
    bar.setAttribute("width",4); bar.setAttribute("height",NH-4);
    bar.setAttribute("rx",2); bar.style.fill = CAT_COLOR[it.cat];
    g.appendChild(bar);
    const img = document.createElementNS(NS,"image");
    img.setAttribute("x",8); img.setAttribute("y",4.5);
    img.setAttribute("width",21); img.setAttribute("height",21);
    img.setAttribute("href", it.icon);
    img.setAttribute("preserveAspectRatio","xMidYMid meet");
    img.addEventListener("error", ()=>{
      const r = document.createElementNS(NS,"rect");
      r.setAttribute("x",8); r.setAttribute("y",4.5); r.setAttribute("width",21); r.setAttribute("height",21);
      r.setAttribute("rx",4); r.style.fill = CAT_COLOR[it.cat]+"22"; r.style.stroke = CAT_COLOR[it.cat];
      g.insertBefore(r, img);
      const t2 = document.createElementNS(NS,"text");
      t2.setAttribute("x",18.5); t2.setAttribute("y",19.4); t2.setAttribute("text-anchor","middle");
      t2.setAttribute("font-size","9px"); t2.style.fill = CAT_COLOR[it.cat];
      t2.textContent = it.zh[0];
      g.insertBefore(t2, img);
      img.remove();
    });
    g.appendChild(img);
    const t = document.createElementNS(NS,"text");
    t.setAttribute("class","nm");
    t.setAttribute("x",33); t.setAttribute("y",12.5);
    if (it.zh.length > 6) t.style.fontSize = "10.6px";
    t.textContent = it.zh;
    g.appendChild(t);
    if (it.raw){
      const raw = document.createElementNS(NS,"circle");
      raw.setAttribute("cx",NW-6); raw.setAttribute("cy",6); raw.setAttribute("r",2.6);
      raw.style.fill = it.src.some(s=>s.type==="vein") ? "#69e07c" : (it.src.some(s=>s.type==="darkfog") ? "#b06cff" : "#f5c242");
      g.appendChild(raw);
    }
    g.addEventListener("click", ()=>setFocus(it.id));
    g.addEventListener("mouseenter", ev=>showNodeTip(ev, it));
    g.addEventListener("mousemove", moveTip);
    g.addEventListener("mouseleave", hideTip);
    ng.appendChild(g);
  }

  world.innerHTML = "";
  world.appendChild(eg);
  world.appendChild(ng);
  applyState();
}

/* ---------------- highlight state ---------------- */
let upStream = null, craftable = null;
function computeState(){
  upStream = focus ? upstreamOf(focus) : null;
  craftable = (resourceMode && selectedRaws.size) ? craftableFrom(selectedRaws) : null;
}
function isFull(id){
  if (catFilter) return ITEM[id].cat === catFilter;   // category highlight
  if (mode === "focus"){
    // everything shown is upstream of focus; resource mode may still dim
    if (craftable && !craftable.has(id) && !selectedRaws.has(id)) return false;
    return true;
  }
  if (upStream && !upStream.has(id)) return false;
  if (craftable && !craftable.has(id) && !selectedRaws.has(id)) return false;
  return true;
}
function applyState(){
  computeState();
  $$("#nodesG .node").forEach(g=>{
    const id = g.dataset.id;
    g.classList.toggle("dim", !isFull(id));
    g.classList.toggle("focused", id === focus);
    g.classList.toggle("selraw", resourceMode && selectedRaws.has(id));
  });
  $$("#edgesG .edge").forEach(g=>{
    const e = g.__edge; if (!e) return;
    const both = isFull(e.src) && isFull(e.dst);
    g.classList.toggle("dim", !both);
    g.classList.toggle("flow", both && !!upStream && upStream.has(e.src) && upStream.has(e.dst));
    // category highlight: make the matching connections crisp (ignore span fade)
    const pathEl = g.querySelector(".path");
    if (pathEl && catFilter) pathEl.style.strokeOpacity = both ? "1" : "";
  });
}

/* ---------------- tooltip ---------------- */
const tip = $("#tooltip");
function showNodeTip(ev, it){
  let html = `<div class="tt-name"><img src="${it.icon}" onerror="this.style.visibility='hidden'">${nameOf(it.id)}<span style="font-size:11px;color:var(--dim2)">${itemAlt(it)}</span></div>`;
  html += `<div class="tt-line">${L("类别","Category")}：${catName(it.cat)}`;
  if (it.src.length) html += ` · ${L("来源","Source")}：${it.src.map(s=>srcLabel(s)).join(L("、",", "))}`;
  const rc = G.recipes.filter(r=>r.out.some(o=>o.i===it.id));
  if (rc.length){
    const isOff = rc.map(r=>disabled.has(r.id));
    html += `<div class="tt-recipe">${rc.map((r,i)=>recipeTooltip(r)+(isOff[i]?' <span style="color:var(--bad)">(${L("已禁用","disabled")})</span>':"")).join("<br>")}</div>`;
  } else if (!it.raw) html += `<div class="tt-recipe" style="color:var(--dim2)">${L("暂无生产配方","No production recipe")}</div>`;
  tip.innerHTML = html;
  tip.classList.remove("hidden");
  moveTip(ev);
}
function showEdgeTip(ev, e){
  tip.innerHTML = `<div class="tt-recipe">${e.recipes.map(r=>recipeTooltip(r)).join("<br><br>")}</div>`;
  tip.classList.remove("hidden");
  moveTip(ev);
}
function moveTip(ev){
  const pad = 14;
  let left = ev.clientX + pad, top = ev.clientY + pad;
  if (left + tip.offsetWidth > window.innerWidth - 16) left = ev.clientX - tip.offsetWidth - pad;
  if (top + tip.offsetHeight > window.innerHeight - 16) top = ev.clientY - tip.offsetHeight - pad;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
function hideTip(){ tip.classList.add("hidden"); }

/* rich recipe tooltip shown when hovering recipe labels in the enable/disable UIs */
function showRecipeTip(ev, r){
  const off = disabled.has(r.id);
  const ins = r.in.map(x=>`<span class="it-chip"><img src="${ITEM[x.i].icon}" alt="">${nameOf(x.i)}<span class="cnt">×${fmtCount(x.n)}</span></span>`).join('<span class="arrow">→</span>');
  const outs = r.out.map(o=>`<span class="it-chip"><img src="${ITEM[o.i].icon}" alt="">${nameOf(o.i)}<span class="cnt">×${fmtCount(o.n)}</span></span>`).join('<span class="arrow">+</span>');
  const tm = r.t < 0 ? `${L("每循环","per cycle")} ${(-r.t).toFixed(1)}%` : `${Math.round(r.t*10)/10} ${L("秒/份","s/unit")}`;
  tip.innerHTML = `<div class="tt-name">${recipeName(r)}<span style="font-size:11px;color:var(--dim2)">${recipeAlt(r)}</span>${off?` <span style="font-size:10px;color:var(--bad)">(已禁用)</span>`:""}</div>
    <div class="tt-line">${L("建筑","Building")}：${bldName(r.b)}　·　${tm}</div>
    <div class="tt-recipe" style="border-top:1px dashed var(--line);margin-top:5px;padding-top:5px">${ins}<span class="arrow">⇒</span>${outs}</div>`;
  tip.classList.remove("hidden");
  moveTip(ev);
}
function attachRecipeHover(el){
  el.addEventListener("mouseenter", ev=>{
    const r = G.recipes.find(x=>x.id === Number(el.dataset.rid));
    if (r) showRecipeTip(ev, r);
  });
  el.addEventListener("mousemove", moveTip);
  el.addEventListener("mouseleave", hideTip);
}

/* ---------------- mode switching & rebuild ---------------- */
function rebuild(){
  // curLayout already computed for the mode by the caller
  buildGraph();
}
function enterGlobal(){
  mode = "global";
  curLayout = globalLayout();
  buildGraph();
  fitView();
  updateHint();
}
function enterFocus(id){
  mode = "focus";
  curLayout = focusLayout(id);
  buildGraph();
  fitFocus();
  updateHint();
}
function setFocus(id){
  if (id === focus){ clearFocus(); return; }
  if (focus != null) focusStack.push(focus);
  if (focus == null) curLayout = null; // drop global layout cache
  if (catFilter) { catFilter = null; refreshLegend(); }   // category highlight is global-only
  focus = id;
  enterFocus(id);
  $("#side").classList.remove("hidden");
  renderSide(id);
}
function clearFocus(){
  if (focus == null) return;
  focus = null; focusStack = []; curLayout = null;
  $("#side").classList.add("hidden");
  enterGlobal();
}
function focusBack(){
  if (focusStack.length){ focus = focusStack.pop(); enterFocus(focus); renderSide(focus); }
  else clearFocus();
}

function toggleRecipe(rid, enable){
  if (enable) disabled.delete(rid); else disabled.add(rid);
  hideTip();                                    // panel/modal re-renders; drop any stale tooltip
  persist();
  if (focus){ enterFocus(focus); renderSide(focus); }
  else if (mode === "global"){ curLayout = globalLayout(); buildGraph(); }
  updateRecipeBtn();
}
function updateHint(){
  if (catFilter) {
    $("#hintbar").textContent = L("已高亮「","Highlighted: ")+catName(catFilter)+L("」类型 · 点击图例任意类别可切换 · 再次点击取消 · Esc 清除","」 · click a legend category to switch · click again to clear · Esc to clear");
  } else {
    $("#hintbar").textContent = mode === "focus"
      ? L("聚焦模式：只显示该物品的上游依赖树 · 点击节点继续上钻 · 右侧面板可禁用任意上游配方 · Esc 返回全景","Focus mode: only this item's upstream tree · click a node to drill up · toggle any upstream recipe in the side panel · Esc to return")
      : L("点击物品进入聚焦 · 点击图例高亮某类型 · 滚轮缩放 · 拖拽平移 · 资源模式高亮可合成产物","Click an item to focus · click legend to highlight a category · scroll to zoom · drag to pan · Resource mode highlights craftable items");
  }
}

/* ---------------- camera ---------------- */
const svg = $("#canvas");
const world2 = $("#world");
let view = { k: 1, tx: 0, ty: 0 };
function applyView(noAnim){
  $("#world").classList.toggle("noanim", !!noAnim);
  $("#world").style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`;
}
function fitDims(w, h, maxScale){
  const vw = svg.clientWidth, vh = svg.clientHeight;
  let k = Math.min((vw-70)/w, (vh-80)/h, maxScale || 1.05);
  k = Math.max(k, 0.04);
  view.k = k;
  view.tx = (vw - w*k)/2;
  view.ty = (vh - h*k)/2;
  applyView(true);
}
function fitView(){ fitDims(curLayout.w, curLayout.h, 0.95); }
function fitFocus(){ fitDims(curLayout.w, curLayout.h, 1.2); }

svg.addEventListener("wheel", ev=>{
  ev.preventDefault();
  const rect = svg.getBoundingClientRect();
  const mx = ev.clientX-rect.left, my = ev.clientY-rect.top;
  const nk = Math.min(Math.max(view.k*Math.pow(1.0015,-ev.deltaY), 0.04), 4.5);
  view.tx = mx - (mx-view.tx)*(nk/view.k);
  view.ty = my - (my-view.ty)*(nk/view.k);
  view.k = nk;
  applyView(true);
}, {passive:false});
let drag = null;
svg.addEventListener("mousedown", ev=>{
  if (ev.button === 0 && ev.target.closest(".node")) return; // left on node: let the node click handle it
  if (ev.button === 0 || ev.button === 1 || ev.button === 2){
    drag = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false, btn: ev.button };
    svg.classList.add("dragging");
    ev.preventDefault();
  }
});
window.addEventListener("mousemove", ev=>{
  if (drag){
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    view.tx = drag.tx + dx; view.ty = drag.ty + dy;
    applyView(true);
  }
});
window.addEventListener("mouseup", ev=>{
  if (drag){
    const wasClick = !drag.moved && drag.btn === 0; // a true (non-dragged) empty click
    drag = null; svg.classList.remove("dragging");
    if (wasClick && focus) clearFocus();
  }
});
svg.addEventListener("contextmenu", ev=>ev.preventDefault());
function zoomBy(f){
  const vw = svg.clientWidth, vh = svg.clientHeight;
  const nk = Math.min(Math.max(view.k*f, 0.04), 4.5);
  view.tx = vw/2 - (vw/2-view.tx)*(nk/view.k);
  view.ty = vh/2 - (vh/2-view.ty)*(nk/view.k);
  view.k = nk; applyView(false);
}
$("#z-in").addEventListener("click", ()=>zoomBy(1.35));
$("#z-out").addEventListener("click", ()=>zoomBy(1/1.35));
$("#z-fit").addEventListener("click", ()=> mode==="focus" ? fitFocus() : fitView());
window.addEventListener("resize", ()=>{ if (view.k <= 0) fitView(); });

/* ---------------- production calculator ---------------- */
const RAW_RATE = {
  vein:   { b: ["采矿机","Mining Machine"],       r: 30, note: ["估算·按每脉 30/min","est. ~30/min per vein"] },
  ocean:  { b: ["抽水站","Water Pump"],            r: 60, note: ["估算·60/min","est. 60/min"] },
  gas:    { b: ["轨道采集器","Orbital Collector"], r: 30, note: ["估算·约 30/min","est. ~30/min"] },
  tree:   { b: ["手动砍伐","Manual chopping"],     r: null, note: ["手动·不固定","manual · varies"] },
  plant:  { b: ["手动采集","Manual foraging"],     r: null, note: ["手动·不固定","manual · varies"] },
  darkfog:{ b: ["黑雾掉落","Dark Fog drop"],       r: null, note: ["掉落·不可控","drop · uncontrollable"] },
  special:{ b: ["特殊建筑","Special building"],    r: null, note: ["按需求","as needed"] },
};
function possibleRecipes(id){ return G.recipes.filter(r=>r.out.some(o=>o.i===id) && !disabled.has(r.id)); }
function collectSrc(id){ return (ITEM[id].src||[]).some(s=>["vein","ocean","gas","tree","plant"].includes(s.type)); }
function chosenRecipe(id){
  const recs = possibleRecipes(id);
  if (recipeChoice[id] && recs.some(r=>r.id===recipeChoice[id])) return recs.find(r=>r.id===recipeChoice[id]);
  if (!recs.length) return null;
  if (collectSrc(id)) return null;      // prefer mining the natural source by default (switchable)
  return recs.slice().sort((a,b)=>a.id-b.id)[0];
}
function rawBuilding(id, demand){
  const src = ITEM[id].src || [];
  for (const s of src){
    const r = RAW_RATE[s.type];
    if (r) {
      const n = r.r ? Math.ceil(demand / r.r) : "—";
      return { b: L(r.b[0], r.b[1]), n, note: L(r.note[0], r.note[1]) };
    }
  }
  return { b: "—", n: "—", note: "" };
}
function computeFlow(rootId, rate){
  const chosen = {};
  const closure = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const n = stack.pop();
    const r = chosenRecipe(n);
    if (r){
      chosen[n] = r;
      r.in.forEach(x=>{ if (!closure.has(x.i)){ closure.add(x.i); stack.push(x.i); } });
    }
  }
  // Kahn topological order of the "consumes" DAG (final product first)
  const indeg = {}, adj = {};
  closure.forEach(n=>{ indeg[n] = 0; adj[n] = []; });
  closure.forEach(n=>{ const r = chosen[n]; if (r) r.in.forEach(x=>{ if (closure.has(x.i)){ adj[n].push(x.i); indeg[x.i]++; } }); });
  const q = [...closure].filter(n=>indeg[n]===0);
  const order = [];
  while (q.length){ const n = q.shift(); order.push(n); adj[n].forEach(m=>{ if (--indeg[m]===0) q.push(m); }); }
  // propagate demand root -> inputs
  const demand = {}; demand[rootId] = rate;
  for (const n of order){
    const r = chosen[n]; if (!r) continue;
    const cx = (r.out.find(o=>o.i===n) || {}).n || 1;
    r.in.forEach(x=>{ demand[x.i] = (demand[x.i] || 0) + demand[n] * (x.n) / cx; });
  }
  // rows
  const rows = [...closure].map(n=>{
    const d = demand[n] || 0;
    const r = chosen[n];
    let bld, note = "";
    if (r){
      const cx = (r.out.find(o=>o.i===n) || {}).n || 1;
      bld = { b: r.b, n: Math.ceil(d * r.t / (cx * 60)) };
    } else {
      bld = rawBuilding(n, d); note = bld.note;
    }
    return { itemId: n, demand: d, bld, note, recipe: r, selectable: collectSrc(n) || possibleRecipes(n).length > 1 };
  });
  rows.sort((a,b)=> (curLayout.lay[a.itemId] ?? 999) - (curLayout.lay[b.itemId] ?? 999)
    || nameOf(b.itemId).localeCompare(nameOf(a.itemId), "zh-Hans-CN"));
  return rows;
}

/* ---------------- side panel ---------------- */
function recipeRowHTML(r){
  return r.in.map(x=>`<span class="it-chip"><img src="${ITEM[x.i].icon}" alt="">${nameOf(x.i)}<span class="cnt">×${fmtCount(x.n)}</span></span>`)
    .join('<span class="arrow">→</span>');
}

function fmtDemand(d){
  if (d % 1 === 0) return String(d);
  return (Math.round(d * 100) / 100) + "";
}
function rowRecipeOptions(itemId, curRecipeId, curRaw){
  let opts = collectSrc(itemId) ? `<option value="raw" ${curRaw?"selected":""}>${L("原生采集","Collect raw")}</option>` : "";
  opts += possibleRecipes(itemId).map(r=>`<option value="${r.id}" ${!curRaw && r.id===curRecipeId?"selected":""}>${recipeName(r)}（${bldName(r.b)}）</option>`).join("");
  return opts;
}
function refreshCalc(id){
  const el = $("#calc-list");
  if (!el) return;
  const rows = computeFlow(id, targetRate);
  if (!rows.length){ el.innerHTML = `<div class="rcp-none">${L("无法计算（该物品没有可用的生产配方）","Cannot compute (no usable production recipe)")}</div>`; return; }
  let h = `<div class="calc-table">`;
  rows.forEach(row=>{
    const it = ITEM[row.itemId];
    const curRaw = !row.recipe;
    const sel = row.selectable
      ? `<select class="calc-sel" data-item="${row.itemId}" title="${L("选择该物品的产出方式","Choose how this item is produced")}">${rowRecipeOptions(row.itemId, row.recipe?row.recipe.id:null, curRaw)}</select>` : "";
    h += `<div class="calc-row">
      <span class="calc-it"><img src="${it.icon}" alt="">${nameOf(it.id)}${sel}</span>
      <span class="calc-dem">${fmtDemand(row.demand)}<span class="calc-unit">/min</span></span>
      <span class="calc-bld">${row.bld.b} × ${row.bld.n}${row.note?`<span class="calc-note"> ${row.note}</span>`:""}</span>
    </div>`;
  });
  h += `</div>`;
  el.innerHTML = h;
  $$("#calc-list .calc-sel", $("#side-content")).forEach(s=>{
    s.addEventListener("change", ()=>{ const v = s.value; if (v==="raw") delete recipeChoice[s.dataset.item]; else recipeChoice[s.dataset.item] = Number(v); refreshCalc(id); });
  });
}

function renderSide(id){
  const it = ITEM[id];
  const making = G.recipes.filter(r=>r.out.some(o=>o.i===id));
  const using  = G.recipes.filter(r=>r.in.some(inp=>inp.i===id));
  const rawIn = new Set();
  making.forEach(r=>{ if (!disabled.has(r.id)) r.in.forEach(x=>rawIn.add(x.i)); });
  const up = [...upstreamOf(id)];
  const down = downstreamOf(id).size - 1;
  const LY = curLayout.lay;
  up.sort((a,b)=> (LY[a]-LY[b]) || nameOf(a).localeCompare(nameOf(b),"zh-Hans-CN"));

  let h = `<div class="side-head">
    ${(focusStack.length || focus) ? `<button class="side-back" id="side-back" title="${L("返回上一级","Back")}">← ${L("返回","Back")}</button>` : ""}
    <img src="${it.icon}" width="40" height="40" onerror="this.style.visibility='hidden'">
    <div class="nm"><div class="zh">${nameOf(it.id)}</div><div class="en">${itemAlt(it)}</div></div>
    <button class="side-close" id="side-close">✕</button>
  </div><div class="side-body">`;

  h += `<div class="sect"><div class="stats-bar">
    <div class="stat-pill"><div class="v">${up.length}</div><div class="l">${L("上游原料","Upstream")}</div></div>
    <div class="stat-pill"><div class="v">${down}</div><div class="l">${L("下游产物","Downstream")}</div></div>
    <div class="stat-pill"><div class="v">${making.length}</div><div class="l">${L("生产配方","Recipes")}</div></div>
  </div></div>`;

  if (it.src.length){
    h += `<div class="sect"><h3>${L("直接获取","Direct sources")}</h3><div class="chips">${
      it.src.map(s=>`<span class="it-chip srcb"><span class="cnt">◆</span>${srcLabel(s)}</span>`).join("")
    }</div></div>`;
  }

  // production calculator (target rate -> upstream demands + building counts)
  h += `<div class="sect" id="calc-sect"><h3>${L("产线计算","Production Calculator")}</h3>
    <div class="calc-count">${L("目标产出","Target output")}
      <input id="calc-rate" class="calc-rate" type="number" min="1" step="any" value="${targetRate}"> ${L("/分钟","/min")}
      <button class="mini-btn" id="calc-preset" title="${L("快捷设置为 100/min","Set to 100/min")}">100</button>
    </div>
    <div id="calc-list"></div>
  </div>`;

  // this item's recipes (toggle)
  h += `<div class="sect"><h3>${L("生产配方","Production recipes")}</h3>`;
  if (!making.length){
    const src = it.src.map(s=>srcLabel(s)).join(L("、",", ")) || L("特殊途径","special");
    h += `<div class="rcp-none">无法通过常规配方生产，仅能通过「${src}」${L("","")}获得${it.raw ? "" : L("（当前配方已全部禁用）"," (all recipes disabled)")}</div>`;
  }
  making.forEach(r=>{
    const off = disabled.has(r.id);
    const tm = r.t < 0 ? `<span class="rc-time pct">${L("每循环","per cycle")} ${(-r.t).toFixed(1)}%</span>` : `<span class="rc-time">${Math.round(r.t*10)/10}${L("s/份","s/unit")}</span>`;
    h += `<div class="rcp-card ${off?"off":""}" data-rid="${r.id}">
      <div class="rc-top">
        <label class="rc-toggle"><input type="checkbox" ${off?"":"checked"} data-rid="${r.id}">${L("启用","Enable")}</label>
        <span class="rc-name">${recipeName(r)}</span>
        <span class="rc-bld ${BUILDING_CLS[r.b]||""}">${bldName(r.b)}</span>
        ${tm}
      </div>
      <div class="mchips"><span class="it-chip" style="border-color:transparent;background:transparent">${recipeRowHTML(r)}</span></div>
      <div class="rc-meta">${L("产出","Output")}：${r.out.map(o=>`<span class="it-chip"><img src="${ITEM[o.i].icon}" alt="">${nameOf(o.i)}<span class="cnt">×${fmtCount(o.n)}</span></span>`).join("　")}</div>
    </div>`;
  });
  h += `</div>`;

  if (rawIn.size){
    h += `<div class="sect"><h3>${L("直接原料","Direct inputs")}</h3><div class="chips">${
      [...rawIn].map(i=>`<span class="it-chip"><img src="${ITEM[i].icon}" alt="">${nameOf(i)}</span>`).join("")
    }</div></div>`;
  }

  // upstream recipes: toggle any ancestor recipe (feature: prune the highlight)
  // base list on the POTENTIAL upstream (all recipes), so disabled recipes stay visible/revivable
  const potUp = [...upstreamAll(id)].filter(i=>i!==id && hasRecipe(i));
  potUp.sort((a,b)=> (curLayout.lay[a]??99999)-(curLayout.lay[b]??99999) || nameOf(a).localeCompare(nameOf(b),"zh-Hans-CN"));
  if (potUp.length){
    h += `<div class="sect"><h3>${L("上游配方 · 可启用/禁用","Upstream recipes · toggle")}</h3>
      <div class="upnote">${L("勾选可让某条生产路线启用；取消勾选即可把它从高亮树中剔除，从而缩减上游。","Check to enable a route; uncheck to remove that branch from the highlighted tree and shrink it.")}</div>
      <div class="upr-list">`;
    potUp.forEach(i=>{
      const rs = G.recipes.filter(r=>r.out.some(o=>o.i===i));
      const lv = curLayout.lay[i];
      h += `<div class="upr"><div class="upr-name"><img src="${ITEM[i].icon}" alt=""><span>${nameOf(i)}</span>${lv!==undefined?`<span class="upr-l">L${lv}</span>`:`<span class="upr-l">—</span>`}</div><div class="upr-rs">`;
      rs.forEach(r=>{
        const off = disabled.has(r.id);
        h += `<label class="upr-tog ${off?"off":""}" data-rid="${r.id}"><input type="checkbox" ${off?"":"checked"} data-rid="${r.id}"><span class="upr-zn">${recipeName(r)}</span><span class="upr-b">${bldName(r.b)}</span></label>`;
      });
      h += `</div></div>`;
    });
    h += `</div></div>`;
  }

  // used in
  h += `<div class="sect"><h3>${L("用于生产","Used in")}</h3>`;
  if (!using.length) h += `<div class="rcp-none">${L("暂无配方使用该物品","No recipe uses this item")}</div>`;
  using.forEach(r=>{
    const off = disabled.has(r.id);
    const tm = r.t < 0 ? `${L("每循环","per cycle")} ${(-r.t).toFixed(1)}%` : `${Math.round(r.t*10)/10}s`;
    h += `<div class="rcp-card ${off?"off":""}" data-rid="${r.id}">
      <div class="rc-top"><span class="rc-name">${recipeName(r)}</span><span class="rc-bld ${BUILDING_CLS[r.b]||""}">${bldName(r.b)}</span><span class="rc-time">${tm}</span></div>
      <div class="mchips">${r.in.map(x=>`<span class="it-chip"><img src="${ITEM[x.i].icon}" alt="">${nameOf(x.i)}<span class="cnt">×${fmtCount(x.n)}</span></span>`).join('<span class="arrow">→</span>')}<span class="arrow">⇒</span>${r.out.map(o=>`<span class="it-chip"><img src="${ITEM[o.i].icon}" alt="">${nameOf(o.i)}<span class="cnt">×${fmtCount(o.n)}</span></span>`).join('<span class="arrow">+</span>')}</div>
    </div>`;
  });
  h += `</div>`;

  // upstream list (click to drill)
  h += `<div class="sect"><h3>${L("上游物品清单","Upstream items")}</h3>
    <details class="up"><summary>${L("共 ","")}${up.length}${L(" 种 · 点击展开（点击某项可上钻聚焦）"," items · expand (click to drill up)")}</summary>
    <div class="subitems" style="margin-top:6px">${
      up.map(i=>`<div class="row drill" data-drill="${i}"><span class="ind">L${LY[i]}</span><img src="${ITEM[i].icon}" width="17" height="17" onerror="this.style.visibility='hidden'"><span class="col" style="color:${CAT_COLOR[ITEM[i].cat]}">${nameOf(i)}</span>${ITEM[i].src.length?`<span style="font-size:10px;color:var(--dim2)">（${ITEM[i].src.map(s=>srcLabel(s)).join("、")}）</span>`:""}</div>`).join("")
    }</div></details></div>`;

  h += `</div>`;
  $("#side-content").innerHTML = h;

  const back = $("#side-back"); if (back) back.addEventListener("click", focusBack);
  $("#side-close").addEventListener("click", clearFocus);
  $$(".rc-toggle input", $("#side-content")).forEach(cb=>cb.addEventListener("change", ()=>toggleRecipe(Number(cb.dataset.rid), cb.checked)));
  $$(".upr-tog input", $("#side-content")).forEach(cb=>cb.addEventListener("change", ()=>toggleRecipe(Number(cb.dataset.rid), cb.checked)));
  $$(".upr-tog", $("#side-content")).forEach(el=>attachRecipeHover(el));
  $$(".rc-name", $("#side-content")).forEach(el=>{
    const card = el.closest(".rcp-card");
    if (card && card.dataset.rid) el.dataset.rid = card.dataset.rid;
    attachRecipeHover(el);
  });
  $$(".rcp-card", $("#side-content")).forEach(c=>{
    if (!c.dataset.rid) return;
    c.addEventListener("click", ev=>{
      if (ev.target.closest("input") || ev.target.closest("label")) return;
      toggleRecipe(Number(c.dataset.rid), disabled.has(Number(c.dataset.rid)));
    });
  });
  $$(".subitems .drill", $("#side-content")).forEach(el=>el.addEventListener("click", ()=>setFocus(el.dataset.drill)));
  const rateInput = $("#calc-rate");
  if (rateInput){
    rateInput.addEventListener("input", ()=>{ targetRate = Math.max(0.1, Number(rateInput.value) || 100); refreshCalc(id); });
    rateInput.addEventListener("change", ()=>{ targetRate = Math.max(0.1, Number(rateInput.value) || 100); refreshCalc(id); });
  }
  const pres = $("#calc-preset"); if (pres) pres.addEventListener("click", ()=>{ targetRate = 100; const ri=$("#calc-rate"); if (ri) ri.value = 100; refreshCalc(id); });
  refreshCalc(id);
}

/* ---------------- resource mode ---------------- */
function buildResourcePanel(){
  let h = "";
  for (const [grp, ids] of Object.entries(RAW_GROUP)){
    h += `<div class="rp-group"><div class="gt">${GRP_EN[grp]?L(grp,GRP_EN[grp]):grp}</div><div class="chips">`;
    ids.forEach(id=>{ const it = ITEM[id]; h += `<div class="chip" data-id="${id}"><img src="${it.icon}" alt=""><span class="nm">${nameOf(it.id)}</span></div>`; });
    h += `</div></div>`;
  }
  $("#rsrc-groups").innerHTML = h;
  refreshResourcePanel();
}
function refreshResourcePanel(){
  $$("#rsrc-groups .chip").forEach(c=>c.classList.toggle("sel", selectedRaws.has(c.dataset.id)));
  $("#rsrc-stats").innerHTML = resourceMode
    ? (lang==="zh" ? `已勾选 <b>${selectedRaws.size}</b> 种可采集资源，可向下合成 <b>${(craftableFrom(selectedRaws)||new Set()).size}</b> 种物品（共 ${G.items.length} 种）` : `Selected <b>${selectedRaws.size}</b> resources → <b>${(craftableFrom(selectedRaws)||new Set()).size}</b> craftable items (of ${G.items.length})`)
    : "";
  $("#btn-resources").classList.toggle("on", resourceMode);
  updateResPanel();
}
function updateResPanel(){
  const panel = $("#resource-panel");
  panel.classList.toggle("hidden", !resPanelOpen);
  const reopen = $("#rsrc-reopen"), rn = $("#rsrc-reopen-n");
  if (resourceMode && !resPanelOpen){
    reopen.classList.remove("hidden");
    if (rn) rn.textContent = selectedRaws.size;
  } else {
    reopen.classList.add("hidden");
  }
}
function setResPanelOpen(open){ resPanelOpen = !!open; updateResPanel(); }
function toggleResourceMode(forced){
  resourceMode = forced !== undefined ? forced : !resourceMode;
  if (resourceMode) resPanelOpen = true; else resPanelOpen = false;
  applyState();
  refreshResourcePanel();
  persist();
}

/* ---------------- recipe manager modal ---------------- */
function updateRecipeBtn(){
  const n = disabled.size, btn = $("#btn-recipes");
  let b = btn.querySelector(".badge");
  if (n){ if (!b){ b = document.createElement("span"); b.className = "badge warn"; btn.appendChild(b); } b.textContent = n; }
  else if (b) b.remove();
}
function openRecipeManager(){
  const body = $("#mgr-body");
  const byItem = {};
  G.recipes.forEach(r=>r.out.forEach(o=>{ (byItem[o.i] = byItem[o.i] || []).push(r); }));
  const multi = Object.entries(byItem).filter(([,rs])=>rs.length >= 2).sort((a,b)=>ITEM[a[0]].zh.localeCompare(ITEM[b[0]].zh,"zh-Hans-CN"));
  let h = multi.length ? "" : `<div class="rcp-none">${L("没有多配方物品","No multi-recipe items")}</div>`;
  multi.forEach(([id, rs])=>{
    const it = ITEM[id], enabled = rs.filter(r=>!disabled.has(r.id)).length;
    h += `<div class="mgr-item">
      <div class="mi-head"><img src="${it.icon}" alt=""><span class="zh">${nameOf(it.id)}</span><span class="en">${itemAlt(it)}</span><span class="n">${L("已启用 ","enabled ")}${enabled}/${rs.length}</span></div>`;
    rs.forEach(r=>{
      const off = disabled.has(r.id);
      h += `<label data-rid="${r.id}"><input type="checkbox" data-rid="${r.id}" ${off?"":"checked"}>${recipeName(r)}<span class="mb">${bldName(r.b)}</span><span style="margin-left:auto;color:var(--dim2);font-size:11px">${r.in.map(x=>nameOf(x.i)+"×"+fmtCount(x.n)).join("+")} → ${r.out.map(o=>nameOf(o.i)+"×"+fmtCount(o.n)).join("+")}</span></label>`;
    });
    h += `</div>`;
  });
  body.innerHTML = h;
  $$("input[data-rid]", body).forEach(cb=>cb.addEventListener("change", ()=>{
    hideTip();
    toggleRecipe(Number(cb.dataset.rid), cb.checked);
    openRecipeManager();
  }));
  $$("label[data-rid]", body).forEach(el=>attachRecipeHover(el));
  $("#modal-recipes").classList.remove("hidden");
}
$("#mgr-restore").addEventListener("click", ()=>{
  disabled.clear(); persist(); updateRecipeBtn();
  if (focus){ enterFocus(focus); renderSide(focus); } else { curLayout = globalLayout(); buildGraph(); }
  openRecipeManager();
});

/* ---------------- persistence ---------------- */
const LS_KEY = "dsp-tree-assistant-v1";
function persist(){
  try { localStorage.setItem(LS_KEY, JSON.stringify({ disabled:[...disabled], raws:[...selectedRaws], res: resourceMode })); } catch(e){}
}
function restore(){
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    (s.disabled||[]).forEach(x=>disabled.add(x));
    (s.raws||[]).forEach(x=>{ if (ITEM[x]) selectedRaws.add(x); });
    if (s.res) resourceMode = true;
  } catch(e){}
}

/* ---------------- search ---------------- */
const searchEl = $("#search"), drop = $("#search-drop");
let curIdx = 0, curList = [];
function doSearch(){
  const q = searchEl.value.trim().toLowerCase();
  if (!q){ drop.classList.add("hidden"); return; }
  const list = G.items.filter(it=> it.zh.toLowerCase().includes(q) || it.en.toLowerCase().includes(q));
  curList = list;
  if (!list.length){ drop.innerHTML = `<div style="padding:9px 12px;color:var(--dim2);font-size:12.5px">${L("没有匹配的物品","No matching items")}</div>`; drop.classList.remove("hidden"); return; }
  curIdx = 0; renderDrop();
}
function renderDrop(){
  const n = Math.min(curList.length, 14);
  drop.innerHTML = curList.slice(0,n).map((it,i)=>`
    <div class="sd-item ${i===curIdx?"sel":""}" data-id="${it.id}">
      <img src="${it.icon}" alt="" onerror="this.style.visibility='hidden'">
      <span class="nm"><span class="zh">${nameOf(it.id)}</span> <span class="en">${itemAlt(it)}</span></span>
      <span class="ct">${catName(it.cat)}</span>
    </div>`).join("") + (curList.length>n ? `<div style="padding:6px 12px;color:var(--dim2);font-size:11px">${L("…还有 ","… ")}${curList.length-n}${L(" 个匹配"," more")}</div>` : "");
  drop.classList.remove("hidden");
  $$(".sd-item", drop).forEach(el=>{
    el.addEventListener("mousedown", ev=>{ ev.preventDefault(); pickItem(el.dataset.id); });
    el.addEventListener("mouseenter", ()=>curIdx = [...drop.querySelectorAll(".sd-item")].indexOf(el));
  });
}
function pickItem(id){
  searchEl.value = ""; drop.classList.add("hidden");
  setFocus(id);
}
searchEl.addEventListener("input", doSearch);
searchEl.addEventListener("keydown", ev=>{
  const items = drop.querySelectorAll(".sd-item");
  if (ev.key === "Escape"){ drop.classList.add("hidden"); searchEl.blur(); }
  else if (ev.key === "ArrowDown"){ curIdx = Math.min(curIdx+1, Math.max(items.length-1,0)); renderDrop(); ev.preventDefault(); }
  else if (ev.key === "ArrowUp"){ curIdx = Math.max(curIdx-1, 0); renderDrop(); ev.preventDefault(); }
  else if (ev.key === "Enter"){ if (curList.length) pickItem(curList[Math.min(curIdx, curList.length-1)].id); }
});
document.addEventListener("click", ev=>{ if (!ev.target.closest(".search-wrap")) drop.classList.add("hidden"); });

/* ---------------- toolbar ---------------- */
$("#btn-resources").addEventListener("click", ()=>toggleResourceMode());
$("#rsrc-all").addEventListener("click", ()=>{
  G.items.forEach(it=>{ if (it.raw && it.src.some(s=>s.type!=="darkfog")) selectedRaws.add(it.id); });
  applyState(); refreshResourcePanel(); persist();
});
$("#rsrc-none").addEventListener("click", ()=>{ selectedRaws.clear(); applyState(); refreshResourcePanel(); persist(); });
$("#rsrc-groups").addEventListener("click", ev=>{
  const c = ev.target.closest(".chip"); if (!c) return;
  const id = c.dataset.id;
  if (selectedRaws.has(id)) selectedRaws.delete(id); else selectedRaws.add(id);
  applyState(); refreshResourcePanel(); persist();
});
$("#rsrc-collapse").addEventListener("click", ()=>setResPanelOpen(false));
$("#rsrc-reopen").addEventListener("click", ()=>setResPanelOpen(true));
$("#btn-recipes").addEventListener("click", openRecipeManager);
$("#btn-help").addEventListener("click", ()=>$("#modal-help").classList.remove("hidden"));
$$(".modal-close").forEach(b=>b.addEventListener("click", ()=>$("#"+b.dataset.close).classList.add("hidden")));
$("#btn-reset").addEventListener("click", ()=>{
  disabled.clear(); selectedRaws.clear(); resourceMode = false; catFilter = null;
  persist(); updateRecipeBtn(); refreshLegend(); clearFocus();
});
window.addEventListener("keydown", ev=>{
  if (ev.key === "Escape" && !drop.classList.contains("hidden")) return;
  if (ev.key === "Escape") clearFocus();
});

/* ---------------- legend (clickable category filter) ---------------- */
function buildLegend(){
  let h = `<div class="t">${L("图例 · 类别","Legend · Category")} <span class="legend-hint">${L("点击高亮该类型","click to highlight")}</span></div>`;
  CAT_ORDER.forEach(c=>{
    const n = G.items.filter(it=>it.cat===c).length;
    h += `<div class="row lg-item" data-cat="${c}"><span class="dot" style="background:${CAT_COLOR[c]}"></span>${catName(c)}<span class="lg-cnt">${n}</span></div>`;
  });
  $("#legend").innerHTML = h;
  $$("#legend .lg-item").forEach(el=>el.addEventListener("click", ()=>{
    const c = el.dataset.cat;
    if (focus) clearFocus();                 // legend operates on the global overview
    catFilter = (catFilter === c) ? null : c;
    refreshLegend();
    applyState();
    updateHint();
  }));
}
function refreshLegend(){
  $$("#legend .lg-item").forEach(el=>el.classList.toggle("on", !!catFilter && el.dataset.cat === catFilter));
}


/* ---------------- language toggle ---------------- */
function buildHelp(){
  const body = $("#help-body"), tt = $("#help-title");
  if (tt) tt.textContent = L("使用说明","How to use");
  if (!body) return;
  body.innerHTML = `
  <div class="help-block"><h3>${L("① 聚焦查看上游 / 下游","① Focus: upstream / downstream")}</h3>
    <p>${L("点击任意物品进入聚焦模式：只保留它的上游依赖树并自动重排放大；右侧面板显示配方、直接原料、用途与上游清单。点空白 / Esc / ← 返回 切回全景。","Click any item to enter focus mode: only its upstream tree is kept and re-laid-out and enlarged; the side panel shows recipes, direct inputs, uses and the upstream list. Click empty space / Esc / Back to return.")}</p></div>
  <div class="help-block"><h3>${L("② 多配方切换 · 缩减上游","② Multi-recipe toggle · shrink upstream")}</h3>
    <p>${L("在「生产配方」或「上游配方」取消勾选即可禁用某条配方，从而按你的路线缩减上游；再次勾选恢复。","Uncheck a recipe in \"Production recipes\" or \"Upstream recipes\" to disable it and shrink the upstream along your chosen route; re-check to restore.")}</p></div>
  <div class="help-block"><h3>${L("③ 资源模式","③ Resource mode")}</h3>
    <p>${L("点击顶栏「资源模式」，勾选当前可采集的基础资源，系统会高亮所有可向下合成的产物；选好后可用「收起」隐藏面板，筛选仍生效。","Click \"Resource Mode\", check the resources you can collect; the app highlights all downstream craftable items. Use \"collapse\" to hide the panel while the filter stays active.")}</p></div>
  <div class="help-block"><h3>${L("④ 名称与图标 · 产线计算","④ Names & icons · production calculator")}</h3>
    <p>${L("每个物品显示图标 + 名称（可中英切换）。聚焦时「产线计算」会按目标产出（默认 100/min）折算每个上游的需求与所需生产/采集建筑数量。","Each item shows an icon + name (switchable ZH/EN). In focus mode the \"Production Calculator\" converts a target rate (default 100/min) into each upstream's demand and the number of buildings needed.")}</p></div>
  <div class="help-block"><h3>${L("操作","Controls")}</h3>
    <ul>${L("<li>滚轮缩放 · 拖拽平移 · 右下角按钮缩放/适应</li><li>搜索框输入中/英文名定位</li><li>数据：游戏 0.10.34（174 物品 / 161 配方）</li>","<li>Scroll to zoom · drag to pan · buttons lower-right</li><li>Search box (ZH/EN) to locate</li><li>Data: game 0.10.34 (174 items / 161 recipes)</li>")}</ul></div>`;
}
function applyLang(){
  document.documentElement.lang = lang;
  const setT = (id, zh, en)=>{ const el = $(id); if (el) el.textContent = L(zh, en); };
  setT("#btn-resources","资源模式","Resource Mode");
  setT("#btn-recipes","配方管理","Recipe Manager");
  setT("#btn-help","帮助","Help");
  setT("#btn-reset","重置视图","Reset View");
  setT("#brand-title","戴森球计划 · 合成树助手","Dyson Sphere Program · Recipe Tree");
  const lt = $("#lang-toggle"); if (lt){ lt.textContent = lang==="zh" ? "EN" : "中"; lt.title = lang==="zh" ? "切换到 English" : "切换到中文"; }
  const se = $("#search"); if (se) se.placeholder = L("搜索物品…（处理器 / quantum）","Search items… (processor / quantum)");
  buildLegend();
  buildResourcePanel();
  buildGraph();
  applyState();
  updateHint();
  updateRecipeBtn();
  buildHelp();
  if (focus) renderSide(focus);
}
function persistLang(){ try { localStorage.setItem("dsp-tree-lang", lang); } catch(e){} }
$("#lang-toggle").addEventListener("click", ()=>{ lang = lang==="zh" ? "en" : "zh"; applyLang(); persistLang(); });

/* ---------------- boot ---------------- */
restore();
try { const pl = localStorage.getItem("dsp-tree-lang"); if (pl==="en"||pl==="zh") lang = pl; } catch(e){}
curLayout = globalLayout();
applyLang();
fitView();
refreshResourcePanel();
persistLang();
