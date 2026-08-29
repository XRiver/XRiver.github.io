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
const catRank = id => CAT_ORDER.indexOf(ITEM[id].cat);

const ITEM = {}; G.items.forEach(it=>ITEM[it.id]=it);
G.items.forEach(it=>ITEM[it.en.toLowerCase()] = ITEM[it.en.toLowerCase()] || it.id);

document.getElementById("ver-tag").textContent = "v" + G.version;

/* ---------------- state ---------------- */
let disabled = new Set();
let focus = null;              // focused item id (focus mode)
let focusStack = [];
let resourceMode = false;
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
  const sortFn = (a,b)=> (catRank(a)-catRank(b)) || ITEM[a].zh.localeCompare(ITEM[b].zh,"zh-Hans-CN");
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
      items.sort((a,b)=> (catRank(a.n)-catRank(b.n)) || (a.b-b.b) || ITEM[a.n].zh.localeCompare(ITEM[b.n].zh,"zh-Hans-CN"));
      layers[l] = items.map(x=>x.n);
    }
  }
  layerIdx; // unused rename guard
  const _ = layerIdx;

  // positions (within a layer, keep the ordered array)
  let maxRows = 0;
  layers.forEach(l=>{ maxRows = Math.max(maxRows, l.length); });
  const pos = {};
  layers.forEach((l, ci)=> l.forEach((id, ri)=>{
    pos[id] = { x: PAD + ci*COLX, y: PAD + ri*(NH+ROWG) };
  }));
  return { pos, w: PAD*2 + layers.length*COLX, h: PAD*2 + maxRows*(NH+ROWG), lay, layers };
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
  const ins = r.in.map(x=>ITEM[x.i].zh+"×"+fmtCount(x.n)).join(" + ");
  const outs = r.out.map(x=>ITEM[x.i].zh+"×"+fmtCount(x.n)).join(" + ");
  const tm = r.t < 0 ? `每循环 ${(-r.t).toFixed(1)}%` : Math.round(r.t*10)/10+" 秒/份";
  return `<span class="bld">${r.b}</span>　${r.zh}（${tm}）<br>${ins} → ${outs}`;
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
  let html = `<div class="tt-name"><img src="${it.icon}" onerror="this.style.visibility='hidden'">${it.zh}<span style="font-size:11px;color:var(--dim2)">${it.en}</span></div>`;
  html += `<div class="tt-line">类别：${it.cat}`;
  if (it.src.length) html += ` · 来源：${it.src.map(s=>s.label).join("、")}`;
  const rc = G.recipes.filter(r=>r.out.some(o=>o.i===it.id));
  if (rc.length){
    const isOff = rc.map(r=>disabled.has(r.id));
    html += `<div class="tt-recipe">${rc.map((r,i)=>recipeTooltip(r)+(isOff[i]?' <span style="color:var(--bad)">(已禁用)</span>':"")).join("<br>")}</div>`;
  } else if (!it.raw) html += `<div class="tt-recipe" style="color:var(--dim2)">暂无生产配方</div>`;
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
  const ins = r.in.map(x=>`<span class="it-chip"><img src="${ITEM[x.i].icon}" alt="">${ITEM[x.i].zh}<span class="cnt">×${fmtCount(x.n)}</span></span>`).join('<span class="arrow">→</span>');
  const outs = r.out.map(o=>`<span class="it-chip"><img src="${ITEM[o.i].icon}" alt="">${ITEM[o.i].zh}<span class="cnt">×${fmtCount(o.n)}</span></span>`).join('<span class="arrow">+</span>');
  const tm = r.t < 0 ? `每循环 ${(-r.t).toFixed(1)}%` : `${Math.round(r.t*10)/10} 秒/份`;
  tip.innerHTML = `<div class="tt-name">${r.zh}<span style="font-size:11px;color:var(--dim2)">${r.en}</span>${off?` <span style="font-size:10px;color:var(--bad)">(已禁用)</span>`:""}</div>
    <div class="tt-line">建筑：${r.b}　·　${tm}</div>
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
    $("#hintbar").textContent = `已高亮「${catFilter}」类型 · 点击图例任意类别可切换 · 再次点击取消 · Esc 清除`;
  } else {
    $("#hintbar").textContent = mode === "focus"
      ? "聚焦模式：只显示该物品的上游依赖树 · 点击节点继续上钻 · 右侧面板可禁用任意上游配方 · Esc 返回全景"
      : "点击物品进入聚焦 · 点击图例高亮某类型 · 滚轮缩放 · 拖拽平移 · 资源模式高亮可合成产物";
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
  vein:   { b: "采矿机",   r: 30, note: "估算·按每脉 30/min" },
  ocean:  { b: "抽水站",   r: 60, note: "估算·60/min" },
  gas:    { b: "轨道采集器", r: 30, note: "估算·约 30/min" },
  tree:   { b: "手动砍伐", r: null, note: "手动·不固定" },
  plant:  { b: "手动采集", r: null, note: "手动·不固定" },
  darkfog:{ b: "黑雾掉落", r: null, note: "掉落·不可控" },
  special:{ b: "特殊建筑", r: null, note: "按需求" },
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
      return { b: r.b, n, note: r.note };
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
    || ITEM[b.itemId].zh.localeCompare(ITEM[a.itemId].zh, "zh-Hans-CN"));
  return rows;
}

/* ---------------- side panel ---------------- */
function recipeRowHTML(r){
  return r.in.map(x=>`<span class="it-chip"><img src="${ITEM[x.i].icon}" alt="">${ITEM[x.i].zh}<span class="cnt">×${fmtCount(x.n)}</span></span>`)
    .join('<span class="arrow">→</span>');
}

function fmtDemand(d){
  if (d % 1 === 0) return String(d);
  return (Math.round(d * 100) / 100) + "";
}
function rowRecipeOptions(itemId, curRecipeId, curRaw){
  let opts = collectSrc(itemId) ? `<option value="raw" ${curRaw?"selected":""}>原生采集</option>` : "";
  opts += possibleRecipes(itemId).map(r=>`<option value="${r.id}" ${!curRaw && r.id===curRecipeId?"selected":""}>${r.zh}（${r.b}）</option>`).join("");
  return opts;
}
function refreshCalc(id){
  const el = $("#calc-list");
  if (!el) return;
  const rows = computeFlow(id, targetRate);
  if (!rows.length){ el.innerHTML = `<div class="rcp-none">无法计算（该物品没有可用的生产配方）</div>`; return; }
  let h = `<div class="calc-table">`;
  rows.forEach(row=>{
    const it = ITEM[row.itemId];
    const curRaw = !row.recipe;
    const sel = row.selectable
      ? `<select class="calc-sel" data-item="${row.itemId}" title="选择该物品的产出方式">${rowRecipeOptions(row.itemId, row.recipe?row.recipe.id:null, curRaw)}</select>` : "";
    h += `<div class="calc-row">
      <span class="calc-it"><img src="${it.icon}" alt="">${it.zh}${sel}</span>
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
  const L = curLayout.lay;
  up.sort((a,b)=> (L[a]-L[b]) || ITEM[a].zh.localeCompare(ITEM[b].zh,"zh-Hans-CN"));

  let h = `<div class="side-head">
    ${(focusStack.length || focus) ? `<button class="side-back" id="side-back" title="返回上一级">← 返回</button>` : ""}
    <img src="${it.icon}" width="40" height="40" onerror="this.style.visibility='hidden'">
    <div class="nm"><div class="zh">${it.zh}</div><div class="en">${it.en}</div></div>
    <button class="side-close" id="side-close">✕</button>
  </div><div class="side-body">`;

  h += `<div class="sect"><div class="stats-bar">
    <div class="stat-pill"><div class="v">${up.length}</div><div class="l">上游原料</div></div>
    <div class="stat-pill"><div class="v">${down}</div><div class="l">下游产物</div></div>
    <div class="stat-pill"><div class="v">${making.length}</div><div class="l">生产配方</div></div>
  </div></div>`;

  if (it.src.length){
    h += `<div class="sect"><h3>直接获取</h3><div class="chips">${
      it.src.map(s=>`<span class="it-chip srcb"><span class="cnt">◆</span>${s.label}</span>`).join("")
    }</div></div>`;
  }

  // production calculator (target rate -> upstream demands + building counts)
  h += `<div class="sect" id="calc-sect"><h3>产线计算</h3>
    <div class="calc-count">目标产出
      <input id="calc-rate" class="calc-rate" type="number" min="1" step="any" value="${targetRate}"> /分钟
      <button class="mini-btn" id="calc-preset" title="快捷设置为 100/min">100</button>
    </div>
    <div id="calc-list"></div>
  </div>`;

  // this item's recipes (toggle)
  h += `<div class="sect"><h3>生产配方</h3>`;
  if (!making.length){
    const src = it.src.map(s=>s.label).join("、") || "特殊途径";
    h += `<div class="rcp-none">无法通过常规配方生产，仅能通过「${src}」获得${it.raw ? "" : "（当前配方已全部禁用）"}</div>`;
  }
  making.forEach(r=>{
    const off = disabled.has(r.id);
    const tm = r.t < 0 ? `<span class="rc-time pct">每循环 ${(-r.t).toFixed(1)}%</span>` : `<span class="rc-time">${Math.round(r.t*10)/10}s/份</span>`;
    h += `<div class="rcp-card ${off?"off":""}" data-rid="${r.id}">
      <div class="rc-top">
        <label class="rc-toggle"><input type="checkbox" ${off?"":"checked"} data-rid="${r.id}">启用</label>
        <span class="rc-name">${r.zh}</span>
        <span class="rc-bld ${BUILDING_CLS[r.b]||""}">${r.b}</span>
        ${tm}
      </div>
      <div class="mchips"><span class="it-chip" style="border-color:transparent;background:transparent">${recipeRowHTML(r)}</span></div>
      <div class="rc-meta">产出：${r.out.map(o=>`<span class="it-chip"><img src="${ITEM[o.i].icon}" alt="">${ITEM[o.i].zh}<span class="cnt">×${fmtCount(o.n)}</span></span>`).join("　")}</div>
    </div>`;
  });
  h += `</div>`;

  if (rawIn.size){
    h += `<div class="sect"><h3>直接原料</h3><div class="chips">${
      [...rawIn].map(i=>`<span class="it-chip"><img src="${ITEM[i].icon}" alt="">${ITEM[i].zh}</span>`).join("")
    }</div></div>`;
  }

  // upstream recipes: toggle any ancestor recipe (feature: prune the highlight)
  // base list on the POTENTIAL upstream (all recipes), so disabled recipes stay visible/revivable
  const potUp = [...upstreamAll(id)].filter(i=>i!==id && hasRecipe(i));
  potUp.sort((a,b)=> (curLayout.lay[a]??99999)-(curLayout.lay[b]??99999) || ITEM[a].zh.localeCompare(ITEM[b].zh,"zh-Hans-CN"));
  if (potUp.length){
    h += `<div class="sect"><h3>上游配方 · 可启用/禁用</h3>
      <div class="upnote">勾选可让某条生产路线启用；取消勾选即可把它从高亮树中剔除，从而缩减上游。</div>
      <div class="upr-list">`;
    potUp.forEach(i=>{
      const rs = G.recipes.filter(r=>r.out.some(o=>o.i===i));
      const lv = curLayout.lay[i];
      h += `<div class="upr"><div class="upr-name"><img src="${ITEM[i].icon}" alt=""><span>${ITEM[i].zh}</span>${lv!==undefined?`<span class="upr-l">L${lv}</span>`:`<span class="upr-l">—</span>`}</div><div class="upr-rs">`;
      rs.forEach(r=>{
        const off = disabled.has(r.id);
        h += `<label class="upr-tog ${off?"off":""}" data-rid="${r.id}"><input type="checkbox" ${off?"":"checked"} data-rid="${r.id}"><span class="upr-zn">${r.zh}</span><span class="upr-b">${r.b}</span></label>`;
      });
      h += `</div></div>`;
    });
    h += `</div></div>`;
  }

  // used in
  h += `<div class="sect"><h3>用于生产</h3>`;
  if (!using.length) h += `<div class="rcp-none">暂无配方使用该物品</div>`;
  using.forEach(r=>{
    const off = disabled.has(r.id);
    const tm = r.t < 0 ? `每循环 ${(-r.t).toFixed(1)}%` : `${Math.round(r.t*10)/10}s`;
    h += `<div class="rcp-card ${off?"off":""}" data-rid="${r.id}">
      <div class="rc-top"><span class="rc-name">${r.zh}</span><span class="rc-bld ${BUILDING_CLS[r.b]||""}">${r.b}</span><span class="rc-time">${tm}</span></div>
      <div class="mchips">${r.in.map(x=>`<span class="it-chip"><img src="${ITEM[x.i].icon}" alt="">${ITEM[x.i].zh}<span class="cnt">×${fmtCount(x.n)}</span></span>`).join('<span class="arrow">→</span>')}<span class="arrow">⇒</span>${r.out.map(o=>`<span class="it-chip"><img src="${ITEM[o.i].icon}" alt="">${ITEM[o.i].zh}<span class="cnt">×${fmtCount(o.n)}</span></span>`).join('<span class="arrow">+</span>')}</div>
    </div>`;
  });
  h += `</div>`;

  // upstream list (click to drill)
  h += `<div class="sect"><h3>上游物品清单</h3>
    <details class="up"><summary>共 ${up.length} 种 · 点击展开（点击某项可上钻聚焦）</summary>
    <div class="subitems" style="margin-top:6px">${
      up.map(i=>`<div class="row drill" data-drill="${i}"><span class="ind">L${L[i]}</span><img src="${ITEM[i].icon}" width="17" height="17" onerror="this.style.visibility='hidden'"><span class="col" style="color:${CAT_COLOR[ITEM[i].cat]}">${ITEM[i].zh}</span>${ITEM[i].src.length?`<span style="font-size:10px;color:var(--dim2)">（${ITEM[i].src.map(s=>s.label).join("、")}）</span>`:""}</div>`).join("")
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
    h += `<div class="rp-group"><div class="gt">${grp}</div><div class="chips">`;
    ids.forEach(id=>{ const it = ITEM[id]; h += `<div class="chip" data-id="${id}"><img src="${it.icon}" alt=""><span class="nm">${it.zh}</span></div>`; });
    h += `</div></div>`;
  }
  $("#rsrc-groups").innerHTML = h;
  refreshResourcePanel();
}
function refreshResourcePanel(){
  $$("#rsrc-groups .chip").forEach(c=>c.classList.toggle("sel", selectedRaws.has(c.dataset.id)));
  const n = resourceMode ? selectedRaws.size : 0;
  $("#rsrc-stats").innerHTML = resourceMode
    ? `已勾选 <b>${selectedRaws.size}</b> 种可采集资源，可向下合成 <b>${(craftableFrom(selectedRaws)||new Set()).size}</b> 种物品（共 ${G.items.length} 种）`
    : "";
  $("#btn-resources").classList.toggle("on", resourceMode);
}
function toggleResourceMode(forced){
  resourceMode = forced !== undefined ? forced : !resourceMode;
  $("#resource-panel").classList.toggle("hidden", !resourceMode);
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
  let h = multi.length ? "" : `<div class="rcp-none">没有多配方物品</div>`;
  multi.forEach(([id, rs])=>{
    const it = ITEM[id], enabled = rs.filter(r=>!disabled.has(r.id)).length;
    h += `<div class="mgr-item">
      <div class="mi-head"><img src="${it.icon}" alt=""><span class="zh">${it.zh}</span><span class="en">${it.en}</span><span class="n">已启用 ${enabled}/${rs.length}</span></div>`;
    rs.forEach(r=>{
      const off = disabled.has(r.id);
      h += `<label data-rid="${r.id}"><input type="checkbox" data-rid="${r.id}" ${off?"":"checked"}>${r.zh}<span class="mb">${r.b}</span><span style="margin-left:auto;color:var(--dim2);font-size:11px">${r.in.map(x=>ITEM[x.i].zh+"×"+fmtCount(x.n)).join("+")} → ${r.out.map(o=>ITEM[o.i].zh+"×"+fmtCount(o.n)).join("+")}</span></label>`;
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
  if (!list.length){ drop.innerHTML = `<div style="padding:9px 12px;color:var(--dim2);font-size:12.5px">没有匹配的物品</div>`; drop.classList.remove("hidden"); return; }
  curIdx = 0; renderDrop();
}
function renderDrop(){
  const n = Math.min(curList.length, 14);
  drop.innerHTML = curList.slice(0,n).map((it,i)=>`
    <div class="sd-item ${i===curIdx?"sel":""}" data-id="${it.id}">
      <img src="${it.icon}" alt="" onerror="this.style.visibility='hidden'">
      <span class="nm"><span class="zh">${it.zh}</span> <span class="en">${it.en}</span></span>
      <span class="ct">${it.cat}</span>
    </div>`).join("") + (curList.length>n ? `<div style="padding:6px 12px;color:var(--dim2);font-size:11px">…还有 ${curList.length-n} 个匹配</div>` : "");
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
  let h = `<div class="t">图例 · 类别 <span class="legend-hint">点击高亮该类型</span></div>`;
  CAT_ORDER.forEach(c=>{
    const n = G.items.filter(it=>it.cat===c).length;
    h += `<div class="row lg-item" data-cat="${c}"><span class="dot" style="background:${CAT_COLOR[c]}"></span>${c}<span class="lg-cnt">${n}</span></div>`;
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

/* ---------------- boot ---------------- */
restore();
curLayout = globalLayout();
buildGraph();
buildLegend();
buildResourcePanel();
updateRecipeBtn();
updateHint();
fitView();
if (resourceMode) $("#resource-panel").classList.remove("hidden");
$("#btn-resources").classList.toggle("on", resourceMode);