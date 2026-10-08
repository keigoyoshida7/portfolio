'use strict';

const assetBase = new URL('.', document.currentScript.src);
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
const number = value => Number(value || 0).toLocaleString('en-US');
const sourceAliases = {NextResearch:'Tag1', ideaofintellection:'Tag2', 'Test-Object':'Tag3'};
const sourceLabel = source => sourceAliases[source] || source;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
const canvas = $('map');
const ctx = canvas.getContext('2d', { alpha: false });
const fontFamily = '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, Georgia, serif';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let locale = 'en';
try { const saved = localStorage.getItem('latent-reference-language'); if (saved === 'en' || saved === 'ja') locale = saved; } catch {}
const msg = (key, params = {}) => {
  const messages = window.LatentI18n.messages;
  return String(messages[locale][key] ?? messages.ja[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
};
const clusterLabel = cluster => cluster?.lowEvidence ? msg('clusters.lowEvidence') : cluster?.label || msg('filters.selectedCluster');
const reasonText = reason => locale === 'ja' ? reason : String(reason || '')
  .replaceAll('題名・本文・タグ・参照の共有特徴', msg('reason.features'))
  .replaceAll('共通タグ', msg('reason.tags')).replaceAll('共通参照', msg('reason.references'))
  .replaceAll('原文リンク', msg('reason.originalLink'));
let mapFailed = false, trendsFailure = '';

let data, trends, nodes = [], edges = [], clusters = [], nodeMap = new Map(), clusterMap = new Map();
let width = innerWidth, height = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
let yaw = -.29, pitch = -.13, zoom = 1, panX = 0, panY = 0;
let targetYaw = yaw, targetPitch = pitch, targetZoom = zoom, targetPanX = 0, targetPanY = 0;
let visible = new Set(), projected = [], labelHits = [], selected = null, hovered = null, pinned = false;
let showLabels = true, showLines = true, motion = true, similarity = .25, tagMode = 'OR';
let searchQuery = '', selectedCluster = '', selectedSubgroup = '', selectedTags = new Set(), selectedSources = new Set(['NextResearch', 'ideaofintellection', 'Test-Object']);
let pointers = new Map(), dragState = null, pinchDistance = null, pointerX = -1000, pointerY = -1000;
let pointerInside = false, lastInteraction = 0, needsRender = true, frameTime = 0, lastDraw = 0;
let fullText = false, hoveredSince = 0, hoveredCandidate = null, searchTimer;

function resize() {
  width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); needsRender = true;
}
addEventListener('resize', resize); resize();

function viewCenter() {
  const mobile = width <= 760;
  const left = mobile ? 0 : (width > 1700 ? 310 : width < 1000 ? 232 : 272);
  const right = 25;
  return { x: left + (width - left - right) / 2 + panX, y: height * .52 + panY,
    scale: Math.min(width - left - right, height - 230) * .00186 * zoom };
}

function project(p, center) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = p[0] * cy - p[2] * sy, z0 = p[0] * sy + p[2] * cy;
  const y = p[1] * cp - z0 * sp, z = p[1] * sp + z0 * cp;
  const perspective = 950 / Math.max(150, 950 + z);
  return { x: center.x + x * center.scale * perspective, y: center.y + y * center.scale * perspective,
    z, perspective, scale: center.scale };
}

function filtered(node) {
  if (!selectedSources.has(node.source)) return false;
  if (selectedCluster && String(node.cluster) !== selectedCluster) return false;
  if (selectedSubgroup && node.subgroup !== selectedSubgroup) return false;
  if (selectedTags.size) {
    const has = tag => node.tags.includes(tag);
    if (tagMode === 'AND' ? ![...selectedTags].every(has) : ![...selectedTags].some(has)) return false;
  }
  return !searchQuery || node.search.includes(searchQuery);
}

function updateFilters() {
  visible = new Set(nodes.filter(filtered).map(n => n.id));
  $('visible-count').textContent = number(visible.size);
  $('empty').hidden = visible.size > 0;
  const active = [];
  if (searchQuery) active.push(locale === 'ja' ? `「${$('search').value}」` : `“${$('search').value}”`);
  if (selectedCluster) active.push(clusterLabel(clusterMap.get(selectedCluster)));
  if (selectedSubgroup) active.push(msg('filters.subgroup'));
  if (selectedTags.size) active.push(msg('filters.tags', {count: selectedTags.size, mode: tagMode}));
  if (selectedSources.size !== 3) active.push(msg('filters.sources', {count: selectedSources.size}));
  $('filter-summary').textContent = active.length ? active.join(' / ') : msg('filters.all');
  $('announcement').textContent = msg('announcement.visible', {count: number(visible.size)});
  if (selected && !visible.has(selected.id)) closeDetail();
  renderTags(); renderSearch(); updateConnectionCount(); needsRender = true;
}

function updateConnectionCount() {
  $('edge-count').textContent = number(edges.filter(e => visible.has(e.source) && visible.has(e.target) && (e.type === 'link' || e.weight >= similarity)).length);
}

function resetFilters() {
  selectedTags.clear(); searchQuery = ''; selectedCluster = ''; selectedSubgroup = ''; $('subgroup-filter').hidden=true; $('subgroup-filter').value='';
  selectedSources = new Set(['NextResearch', 'ideaofintellection', 'Test-Object']);
  $('search').value = ''; $('tag-search').value = ''; $('cluster-filter').value = '';
  document.querySelectorAll('.source-filter').forEach(x => x.checked = true);
  updateFilters();
}

function toggleTag(tag) {
  if (selectedTags.has(tag)) selectedTags.delete(tag); else selectedTags.add(tag);
  updateFilters();
}

function renderTags() {
  const activeTag=document.activeElement?.dataset?.tag;
  const container = $('tags'), chosen = $('selected-tags'); container.replaceChildren(); chosen.replaceChildren();
  const q = normalize($('tag-search').value);
  const counts = new Map();
  nodes.forEach(n => { if (!selectedSources.has(n.source) || (selectedCluster && String(n.cluster) !== selectedCluster)) return;
    n.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)); });
  const tags = [...counts].filter(([t]) => normalize(t).includes(q)).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  const make = (tag,count,isSelected) => {
    const b = el('button','tag-button',`#${tag}`); b.dataset.tag=tag; b.setAttribute('aria-pressed',String(isSelected));
    b.append(el('small','',number(count))); b.addEventListener('click',() => toggleTag(tag)); return b;
  };
  [...selectedTags].forEach(t => { const b = make(t, counts.get(t) || 0, true); b.title = msg('tags.remove'); chosen.append(b); });
  tags.forEach(([t,c]) => container.append(make(t,c,selectedTags.has(t))));
  if (!tags.length) container.append(el('span','muted',msg('tags.none')));
  if(activeTag)[...container.querySelectorAll('button')].find(b=>b.dataset.tag===activeTag)?.focus({preventScroll:true});
}

function renderSearch() {
  const out = $('search-results'); out.replaceChildren(); out.hidden = !searchQuery;
  if (!searchQuery) return;
  const matches = nodes.filter(n => visible.has(n.id)).sort((a,b) => {
    const av = normalize(a.title).includes(searchQuery), bv = normalize(b.title).includes(searchQuery);
    return Number(bv)-Number(av) || b.degree-a.degree;
  });
  matches.slice(0,24).forEach(n => {
    const b=el('button','search-result',n.title); b.append(el('small','',sourceLabel(n.source)));
    b.addEventListener('click',()=>selectNode(n,true,true)); out.append(b);
  });
  if (!matches.length) out.append(el('p','',msg('search.none')));
  else if (matches.length > 24) out.append(el('p','',msg('search.first',{count:number(matches.length)})));
}

function selectNode(node, pin = false, focus = false) {
  const changed = selected?.id !== node.id;
  selected = node; pinned = pin; if (changed) fullText = false;
  document.body.classList.add('detail-visible'); $('detail').hidden = false;
  if (focus) {
    $('filters').classList.remove('mobile-open'); $('mobile-filters').setAttribute('aria-expanded','false');
    targetPanX=0; targetPanY=0;
    // Turn the chosen reference toward the camera, preserving the whole spatial context.
    targetYaw = Math.atan2(node.position[0], node.position[2]) + Math.PI;
    targetPitch = -.12;
  }
  renderDetail(); if (focus) $('detail').querySelector('h2')?.focus({preventScroll:true}); needsRender = true;
}

function closeDetail() {
  selected = null; hovered = null; pinned = false; hoveredCandidate=null;
  $('detail').hidden = true; $('hover-label').hidden = true;
  document.body.classList.remove('detail-visible'); needsRender = true;
}

function cleanText(text) {
  return String(text || '').replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g,'$2').replace(/\[([^\]\n]+)\]/g,'$1').replace(/^\s*\[\*+\s*(.*?)\]\s*$/gm,'$1');
}

function renderDetail() {
  if (!selected) return;
  const restoreAction=document.activeElement?.dataset?.action;
  const n=selected, box=$('detail'); box.replaceChildren();
  const top=el('div','detail-top'), actions=el('div','detail-actions');
  top.append(el('span','',msg(pinned ? 'detail.pinned' : 'detail.preview')));
  const pin=el('button','',msg(pinned ? 'detail.unpin' : 'detail.pin')); pin.title=msg('detail.pinTitle');pin.dataset.action='pin';
  pin.addEventListener('click',()=>{pinned=!pinned;renderDetail();});
  const close=el('button','','×'); close.setAttribute('aria-label',msg('detail.close')); close.addEventListener('click',closeDetail);
  actions.append(pin,close);top.append(actions);const title=el('h2','',n.title);title.tabIndex=-1;box.append(top,title,el('div','detail-source',sourceLabel(n.source)));
  const tags=el('div','detail-tags');
  n.tags.slice(0,15).forEach(t=>{const b=el('button','',`#${t}`); b.addEventListener('click',()=>toggleTag(t)); tags.append(b);});box.append(tags);
  const excerpt=cleanText(n.excerpt || '').trim();
  box.append(el('p','detail-excerpt',excerpt || msg('detail.noText')));
  if (n.text && n.text.length > (n.excerpt || '').length + 80) {
    const toggle=el('button','detail-text-toggle',msg(fullText?'detail.hideText':'detail.readText'));
    toggle.dataset.action='full-text';toggle.addEventListener('click',()=>{fullText=!fullText;renderDetail();});box.append(toggle);
    if (fullText) box.append(el('div','full-text',cleanText(n.text)));
  }
  const link=el('a','detail-link',msg('detail.openOriginal'));link.href=n.url;link.target='_blank';link.rel='noopener noreferrer';box.append(link);
  const cluster=clusterMap.get(String(n.cluster));
  const heading=el('h3','',msg('detail.nearby')+(cluster ? ' / '+clusterLabel(cluster) : ''));box.append(heading);
  const neighbors=(n.neighbors || []).filter(v=>nodeMap.has(v.id));
  neighbors.slice(0,8).forEach(v=>{
    const target=nodeMap.get(v.id), b=el('button','neighbor',target.title);
    b.append(el('small','',msg(v.type==='link'?'detail.linked':'detail.similarity',{score:Number(v.weight).toFixed(2),reason:reasonText(v.reason || sourceLabel(target.source))})));
    b.addEventListener('click',()=>{
      if (!visible.has(target.id)) { resetFilters(); }
      selectNode(target,true,true);
    });box.append(b);
  });
  if (!neighbors.length) box.append(el('p','fine-print',msg('detail.noNeighbors')));
  if (n.updated) {
    const date=new Date(Number(n.updated)*1000);if(!Number.isNaN(date.valueOf()))box.append(el('p','fine-print',msg('detail.updated',{date:date.toLocaleDateString(locale==='ja'?'ja-JP':'en-GB')})));
  }
  if(restoreAction)[...box.querySelectorAll('button')].find(b=>b.dataset.action===restoreAction)?.focus({preventScroll:true});
}

function showHover(node, pos) {
  if (!node) {hovered=null;$('hover-label').hidden=true;return;}
  const changed=hovered?.id!==node.id;hovered=node;
  const tip=$('hover-label');if(changed)tip.replaceChildren(document.createTextNode(node.title),el('small','',sourceLabel(node.source)));tip.hidden=false;
  tip.style.left=`${Math.min(width-265,Math.max(12,pos.x+14))}px`;
  tip.style.top=`${Math.max(105,Math.min(height-110,pos.y-23))}px`;
  if (!pinned && selected?.id!==node.id) selectNode(node,false);
}

function draw(now) {
  const center=viewCenter();
  ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
  if (!nodes.length) return;
  projected=[];labelHits=[];
  const positions=new Map();
  for (const node of nodes) {
    if(!visible.has(node.id))continue;
    const p=project(node.position,center);p.node=node;
    if(p.x<(width>760?270:8)||p.x>width-8||p.y<96||p.y>height-48)continue;
    projected.push(p);positions.set(node.id,p);
  }
  projected.sort((a,b)=>b.z-a.z);
  const neighbors=new Set(selected ? [selected.id,...selected.neighbors.map(n=>n.id)] : []);
  if (showLines) {
    ctx.lineWidth=.45;
    // Each faint trace corresponds to a real graph edge; no decorative points or edges.
    for(const edge of edges) {
      if(edge.type==='similarity'&&edge.weight<similarity)continue;
      const a=positions.get(edge.source),b=positions.get(edge.target);if(!a||!b)continue;
      const emphasis=selected&&(edge.source===selected.id||edge.target===selected.id);
      const within=a.node.cluster===b.node.cluster;
      const alpha=emphasis ? .50 : selected ? .012 : edge.type==='link' ? (within?.09:.033) : (within?.037:.015);
      if (!emphasis && Math.hypot(a.x-b.x,a.y-b.y)>width*.45) continue;
      ctx.strokeStyle=`rgba(221,221,221,${alpha})`;ctx.lineWidth=emphasis?.65:.4;
      ctx.setLineDash(edge.type==='similarity'?[1,3]:[]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  for(const p of projected) {
    const node=p.node, near=neighbors.has(node.id), active=selected?.id===node.id||hovered?.id===node.id;
    const depth=Math.max(.32,Math.min(1,p.perspective*.7));
    const alpha=active ? 1 : near ? .9 : selected ? .19 : node.lowEvidence ? depth*.56 : depth;
    const importance=Math.min(1,Math.log1p(node.degree||0)/7);
    const radius=active?3.0:(.75+importance*.7)*Math.max(.65,Math.min(1.5,p.perspective));
    ctx.fillStyle=`rgba(239,239,239,${alpha})`;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
    if(active){ctx.strokeStyle='#ddd';ctx.lineWidth=.65;ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.stroke();}
  }
  if(showLabels) {
    const placed=[];
    ctx.font=`10px ${fontFamily}`;ctx.textAlign='left';
    for(const c of clusters.filter(c=>c.visibleCount>0).sort((a,b)=>b.visibleCount-a.visibleCount)) {
      const p=project(c.position,center), text=clusterLabel(c);
      const w=ctx.measureText(text).width;
      const x=p.x-w/2, y=p.y+19;
      if(x<280&&width>760||x<12||x+w>width-30||y<140||y>height-155)continue;
      if(selected&&width>760&&x+w>width-350)continue;
      if(placed.some(r=>Math.abs(r.y-y)<28&&x<r.x+r.w+22&&x+w+22>r.x))continue;
      const focus=selectedCluster===String(c.id);
      ctx.fillStyle=`rgba(0,0,0,${focus?.94:.75})`;ctx.fillRect(x-7,y-10,w+27,18);
      ctx.fillStyle='#fff';ctx.fillText(text,x,y);
      ctx.font='7px Georgia,serif';ctx.fillStyle='#fff';ctx.fillText(String(c.visibleCount),x+w+7,y-2);ctx.font=`10px ${fontFamily}`;
      placed.push({x,y,w});labelHits.push({x:x-7,y:y-13,w:w+30,h:24,cluster:c});
    }
  }
  if(pointerInside&&!dragState){
    const hit=hitNode(pointerX,pointerY);
    if(hit?.node.id!==hoveredCandidate?.node.id){hoveredCandidate=hit;hoveredSince=now;}
    if(hit&&now-hoveredSince>75){showHover(hit.node,hit);canvas.style.cursor='pointer';}
    else if(!hit){showHover(null);canvas.style.cursor=hitLabel(pointerX,pointerY)?'pointer':'grab';}
  }
}

function hitNode(x,y) {
  let hit=null,min=100;
  for(const p of projected){const d=(p.x-x)**2+(p.y-y)**2;if(d<min){min=d;hit=p;}}
  return hit;
}
function hitLabel(x,y){return labelHits.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h);}

function animate(now) {
  const dt=Math.min(40,now-(frameTime||now));frameTime=now;
  if(motion&&!dragState&&now-lastInteraction>1300){targetYaw+=dt*.000012;needsRender=true;}
  const delta=Math.abs(targetYaw-yaw)+Math.abs(targetPitch-pitch)+Math.abs(targetZoom-zoom)+Math.abs(targetPanX-panX)+Math.abs(targetPanY-panY);
  if(delta>.0002){
    const f=reducedMotion?1:Math.min(.30,dt*.013);
    yaw+=(targetYaw-yaw)*f;pitch+=(targetPitch-pitch)*f;zoom+=(targetZoom-zoom)*f;
    panX+=(targetPanX-panX)*f;panY+=(targetPanY-panY)*f;needsRender=true;
  }
  if((needsRender||(pointerInside&&hoveredCandidate&&hoveredCandidate.node.id!==hovered?.id))&&now-lastDraw>25){needsRender=false;draw(now);lastDraw=now;}
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

canvas.addEventListener('pointerdown',e=>{
  canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  lastInteraction=performance.now();pointerInside=true;
  if(pointers.size===1)dragState={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,yaw:targetYaw,pitch:targetPitch,moved:false,shift:e.shiftKey,panX:targetPanX,panY:targetPanY};
  else if(pointers.size===2){const [a,b]=[...pointers.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);if(dragState)dragState.moved=true;}
});
canvas.addEventListener('pointermove',e=>{
  pointerX=e.clientX;pointerY=e.clientY;pointerInside=true;needsRender=true;
  if(!pointers.has(e.pointerId))return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});lastInteraction=performance.now();
  if(pointers.size===2){const[a,b]=[...pointers.values()],dist=Math.hypot(a.x-b.x,a.y-b.y);
    if(pinchDistance)targetZoom=Math.max(.42,Math.min(4,targetZoom*dist/pinchDistance));pinchDistance=dist;return;}
  if(!dragState)return;
  const dx=e.clientX-dragState.startX,dy=e.clientY-dragState.startY;
  if(Math.hypot(dx,dy)>4)dragState.moved=true;
  if(dragState.shift){targetPanX=dragState.panX+dx;targetPanY=dragState.panY+dy;}
  else{targetYaw=dragState.yaw+dx*.005;targetPitch=Math.max(-1.4,Math.min(1.4,dragState.pitch+dy*.005));}
  canvas.style.cursor='grabbing';$('hover-label').hidden=true;
});
function pointerEnd(e) {
  const click=dragState&&!dragState.moved&&pointers.size===1;
  pointers.delete(e.pointerId);
  if(!pointers.size){
    if(click){const hit=hitNode(e.clientX,e.clientY);if(hit)selectNode(hit.node,true);
      else{const label=hitLabel(e.clientX,e.clientY);if(label)chooseCluster(label.cluster.id);else closeDetail();}}
    dragState=null;pinchDistance=null;canvas.style.cursor='grab';
  }else{const[x]=[...pointers.values()];dragState={startX:x.x,startY:x.y,yaw:targetYaw,pitch:targetPitch,moved:true,panX:targetPanX,panY:targetPanY};pinchDistance=null;}
  needsRender=true;
}
canvas.addEventListener('pointerup',pointerEnd);
canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);dragState=null;pinchDistance=null;});
canvas.addEventListener('pointerleave',()=>{if(dragState)return;pointerInside=false;hovered=null;$('hover-label').hidden=true;needsRender=true;});
canvas.addEventListener('wheel',e=>{e.preventDefault();targetZoom=Math.max(.42,Math.min(4,targetZoom*Math.exp(-e.deltaY*.001)));lastInteraction=performance.now();needsRender=true;},{passive:false});
document.querySelectorAll('button,input,select,a,dialog').forEach(x=>x.addEventListener('pointerenter',()=>{pointerInside=false;hovered=null;$('hover-label').hidden=true;}));

$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchQuery=normalize($('search').value.trim());updateFilters();},100);});
$('tag-search').addEventListener('input',renderTags);
document.querySelectorAll('.source-filter').forEach(x=>x.addEventListener('change',()=>{if(x.checked)selectedSources.add(x.value);else selectedSources.delete(x.value);updateFilters();}));
$('cluster-filter').addEventListener('change',()=>chooseCluster($('cluster-filter').value));
function renderSubgroupOptions() {
  const select=$('subgroup-filter');select.replaceChildren(el('option','',msg('subgroups.all')));select.firstChild.value='';
  const children=(data?.subgroups||[]).filter(c=>String(c.parent)===selectedCluster);
  select.hidden=children.length<2;children.forEach(c=>{const o=el('option','',`${clusterLabel(c).slice(0,36)} (${number(c.count)})`);o.value=c.id;select.append(o);});
  select.value=selectedSubgroup;
}
function renderClusterOptions() {
  const select=$('cluster-filter');const all=el('option','',msg('clusters.all'));all.value='';select.replaceChildren(all);
  clusters.forEach(c=>{const option=el('option','',`${clusterLabel(c)} (${number(c.count)})`);option.value=String(c.id);select.append(option);});
  select.value=selectedCluster;renderSubgroupOptions();
}
function chooseCluster(id){selectedCluster=String(id);selectedSubgroup='';$('cluster-filter').value=selectedCluster;
  renderSubgroupOptions();closeDetail();updateFilters();}
$('subgroup-filter').addEventListener('change',()=>{selectedSubgroup=$('subgroup-filter').value;closeDetail();updateFilters();});
$('tag-mode').addEventListener('click',()=>{tagMode=tagMode==='OR'?'AND':'OR';updateTagMode();updateFilters();});
$('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',resetFilters);
$('toggle-labels').addEventListener('click',e=>{showLabels=!showLabels;e.currentTarget.setAttribute('aria-pressed',String(showLabels));needsRender=true;});
$('toggle-lines').addEventListener('click',e=>{showLines=!showLines;e.currentTarget.setAttribute('aria-pressed',String(showLines));needsRender=true;});
$('toggle-motion').addEventListener('click',e=>{motion=!motion;e.currentTarget.setAttribute('aria-pressed',String(motion));needsRender=true;});
$('similarity').addEventListener('input',()=>{similarity=Number($('similarity').value);$('similarity-value').textContent=similarity.toFixed(2);updateConnectionCount();needsRender=true;});
$('zoom-in').addEventListener('click',()=>{targetZoom=Math.min(4,targetZoom*1.25);needsRender=true;});
$('zoom-out').addEventListener('click',()=>{targetZoom=Math.max(.42,targetZoom/1.25);needsRender=true;});
$('reset-camera').addEventListener('click',()=>{targetYaw=-.29;targetPitch=-.13;targetZoom=1;targetPanX=0;targetPanY=0;closeDetail();needsRender=true;});
$('mobile-filters').addEventListener('click',()=>{const open=$('filters').classList.toggle('mobile-open');$('mobile-filters').setAttribute('aria-expanded',String(open));});
$('about-open').addEventListener('click',()=>$('about').showModal());$('about-close').addEventListener('click',()=>$('about').close());
$('trends-open').addEventListener('click',()=>$('trends').showModal());$('trends-close').addEventListener('click',()=>$('trends').close());
for(const id of ['about','trends'])$(id).addEventListener('click',e=>{if(e.target===$(id)){const r=$(id).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$(id).close();}});
addEventListener('keydown',e=>{
  if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){
    e.preventDefault();if(width<=760){$('filters').classList.add('mobile-open');$('mobile-filters').setAttribute('aria-expanded','true');}$('search').focus();
  }
  if(e.key==='Escape'&&!$('about').open&&!$('trends').open){closeDetail();$('filters').classList.remove('mobile-open');$('mobile-filters').setAttribute('aria-expanded','false');}
});

function updateTagMode() {
  $('tag-mode').textContent=tagMode;
  $('tag-mode').setAttribute('aria-label',msg('tags.condition',{mode:tagMode,condition:msg(tagMode==='OR'?'tags.any':'tags.all')}));
}

function renderAbout() {
  $('method-details').replaceChildren(el('p','',msg('about.method1')),el('p','',msg('about.method2')));
  if (!data) return;
  const date=new Date(data.metadata?.capturedAt||data.metadata?.generatedAt||'2026-10-08');
  $('snapshot-date').textContent=msg('snapshot.label',{date:Number.isNaN(date.valueOf())?'2026.10.08':date.toLocaleDateString('sv-SE').replaceAll('-','.')});
  $('snapshot-info').textContent=msg('snapshot.info',{count:number(nodes.length)});
}

function setLanguage(next, persist=true) {
  if (next !== 'ja' && next !== 'en') return;
  locale=next;
  if (persist) { try {localStorage.setItem('latent-reference-language',locale);} catch {} }
  document.documentElement.lang=locale;
  document.title='Latent of References | Keigo Yoshida | 吉田慧悟';
  document.querySelector('meta[name="description"]').content=msg('static.description');
  for (const binding of window.LatentI18n.static) {
    document.querySelectorAll(binding.selector).forEach(node=>{
      if(binding.attribute)node.setAttribute(binding.attribute,msg(binding.key));else node.textContent=msg(binding.key);
    });
  }
  document.querySelectorAll('[data-locale]').forEach(button=>{button.setAttribute('aria-pressed',String(locale===button.dataset.locale));button.setAttribute('aria-label',msg(button.dataset.locale==='ja'?'static.jpAria':'static.enAria'));});
  document.querySelectorAll('.dialog-language-switch').forEach(group=>group.setAttribute('aria-label',msg('static.languageAria')));
  updateTagMode();renderClusterOptions();renderAbout();
  const detailScroll=$('detail').scrollTop,trendsScroll=$('trends').scrollTop;
  if(nodes.length)updateFilters();
  if(selected)renderDetail();
  if(trends)renderTrends();else if(trendsFailure)$('trends-content').replaceChildren(el('p','',msg(trendsFailure)));
  if(mapFailed){$('loading').replaceChildren(el('span','',msg('error.map')));$('announcement').textContent=msg('error.mapAnnouncement');}
  $('detail').scrollTop=detailScroll;$('trends').scrollTop=trendsScroll;
  needsRender=true;
}
document.querySelectorAll('[data-locale]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.locale)));

function renderTrends() {
  if(!trends)return;
  const box=$('trends-content');box.replaceChildren();
  const topThemes=(trends.themes||[]).filter(theme=>!theme.lowEvidence).slice(0,3).map(theme=>msg('trends.themeShare',{label:clusterLabel(clusterMap.get(String(theme.cluster))),share:(Number(theme.share)*100).toFixed(1)})).join(locale==='ja'?'、':', ');
  box.append(el('p','trend-summary',msg('trends.summary',{count:number(trends.metadata?.total||nodes.length),groups:number(trends.metadata?.clusterCount||clusters.length),themes:topThemes,bridges:number(trends.metadata?.bridgeCount||0)})));
  const sourceStats=el('div','source-bars');(trends.sources||[]).forEach(s=>{const div=el('div','source-stat');div.append(el('span','',sourceLabel(s.name)),el('strong','',number(s.count)));sourceStats.append(div);});box.append(sourceStats);
  const themes=el('section','trend-section');themes.append(el('h3','',msg('trends.themes')),el('p','trend-subtitle',msg('trends.themesSubtitle')));
  const meaningfulThemes=(trends.themes||[]).filter(t=>!t.lowEvidence);
  const max=Math.max(1,...meaningfulThemes.map(t=>t.count));
  meaningfulThemes.slice(0,10).forEach(t=>{
    const b=el('button','theme-row'),heading=el('span','theme-row-heading');
    const share=Number(t.share)>1?Number(t.share):Number(t.share)*100;
    heading.append(el('span','',clusterLabel(clusterMap.get(String(t.cluster)))),el('small','',`${number(t.count)} / ${share.toFixed(1)}%`));
    const bar=el('span','theme-bar'),fill=el('i');fill.style.width=`${t.count/max*100}%`;bar.append(fill);
    const representativeTitles=(clusterMap.get(String(t.cluster))?.representatives||[]).map(id=>nodeMap.get(id)?.title).filter(Boolean);
    b.append(heading,bar,el('span','theme-terms',(representativeTitles.length?representativeTitles.slice(0,3):(t.terms||[]).slice(0,5)).join(' · ')));
    if(t.sources){const values=(trends.sources||[]).map(s=>`${sourceLabel(s.name)} ${((t.sources[s.name]||0)/Math.max(1,s.count)*100).toFixed(1)}%`);b.append(el('span','source-percent',values.join(' · ')+' / '+msg('trends.themeShareSuffix')));}
    b.addEventListener('click',()=>{$('trends').close();resetFilters();chooseCluster(t.cluster);});themes.append(b);
  });box.append(themes);
  const bridges=el('section','trend-section');bridges.append(el('h3','',msg('trends.bridges')),el('p','trend-subtitle',msg('trends.bridgesSubtitle')));
  (trends.bridges||[]).slice(0,6).forEach(b=>{const button=el('button','bridge-row',b.title);button.append(el('small','',msg('trends.connections',{clusters:number(b.clusterCount),connections:number(b.degree)})));
    button.addEventListener('click',()=>{$('trends').close();resetFilters();const node=nodeMap.get(b.id);if(node)selectNode(node,true,true);});bridges.append(button);});box.append(bridges);
  if(trends.tags?.length){const section=el('section','trend-section');section.append(el('h3','',msg('trends.tags')));const tags=el('div','trends-tags');
    trends.tags.slice(0,20).forEach(t=>{const b=el('button','',`#${t.tag} · ${number(t.count)}`);b.addEventListener('click',()=>{$('trends').close();resetFilters();toggleTag(t.tag);});tags.append(b);});section.append(tags);box.append(section);}
  if(trends.activity?.length){const section=el('section','trend-section');section.append(el('h3','',msg('trends.activity')),el('p','trend-subtitle',msg('trends.activitySubtitle')));
    const activity=trends.activity.slice(-48),maxCount=Math.max(1,...activity.map(v=>v.count)),chart=el('div','activity-chart');chart.setAttribute('role','img');chart.setAttribute('aria-label',msg('trends.activityAria'));
    activity.forEach(v=>{const bar=el('div','activity-month');bar.style.height=`${Math.max(1,v.count/maxCount*88)}px`;bar.title=msg('trends.activityMonth',{month:v.month,count:number(v.count)});bar.tabIndex=0;bar.setAttribute('aria-label',bar.title);chart.append(bar);});
    const axis=el('div','activity-axis');axis.append(el('span','',activity[0].month),el('span','',activity.at(-1).month));section.append(chart,axis);box.append(section);}
  for(const key of ['trends.noteThemes','trends.noteLowEvidence'])box.append(el('p','fine-print trends-note',msg(key)));
}

async function init() {
  try {
    const response=await fetch(new URL('mapping.json', assetBase));if(!response.ok)throw new Error(`HTTP ${response.status}`);data=await response.json();
    nodes=data.nodes||[];edges=data.edges||[];clusters=data.clusters||[];
    if(!nodes.length)throw new Error(msg('error.emptyArchive'));
    const radii=nodes.map(n=>Math.hypot(...n.position)).sort((a,b)=>a-b);
    const radius=radii[Math.floor(radii.length*.94)] || 1;const scale=345/Math.max(1,radius);
    for(const n of nodes){n.position=n.position.map(v=>v*scale);n.tags=n.tags||[];n.neighbors=n.neighbors||[];n.search=normalize(`${n.title}\n${n.text||n.excerpt||''}\n${n.tags.join(' ')}`);nodeMap.set(n.id,n);}
    for(const c of clusters){c.position=(c.position||[0,0,0]).map(v=>v*scale);c.visibleCount=c.count;clusterMap.set(String(c.id),c);}
    renderClusterOptions();
    const counts={};nodes.forEach(n=>counts[n.source]=(counts[n.source]||0)+1);
    $('next-count').textContent=number(counts.NextResearch);$('idea-count').textContent=number(counts.ideaofintellection);$('test-count').textContent=number(counts['Test-Object']);
    $('total-count').textContent=number(nodes.length);$('cluster-count').textContent=number(clusters.length);
    renderAbout();
    $('loading').hidden=true;updateFilters();
    // Cluster labels always reflect the visible subset, without recomputing the established layout.
    const originalFilterHandler=()=>{for(const c of clusters)c.visibleCount=0;for(const n of nodes)if(visible.has(n.id)){const c=clusterMap.get(String(n.cluster));if(c)c.visibleCount++;}};
    originalFilterHandler();
    const obs=new MutationObserver(()=>{originalFilterHandler();needsRender=true;});obs.observe($('visible-count'),{childList:true});
    try{const r=await fetch(new URL('trends.json', assetBase));if(r.ok){trends=await r.json();renderTrends();}else{trendsFailure='error.trendsReload';$('trends-content').replaceChildren(el('p','',msg(trendsFailure)));}}catch{trendsFailure='error.trends';$('trends-content').replaceChildren(el('p','',msg(trendsFailure)));}
    window.latentMap={getState:()=>({locale,cluster:selectedCluster,fullText,nodes:nodes.length,edges:edges.length,clusters:clusters.length,visible:visible.size,selected:selected?.id||null,pinned,sources:[...selectedSources],tags:[...selectedTags],query:searchQuery,subgroup:selectedSubgroup,zoom:targetZoom}),getProjectedNodes:()=>projected.map(p=>({id:p.node.id,title:p.node.title,x:p.x,y:p.y})),select:id=>{const n=nodeMap.get(id);if(n)selectNode(n,true);}};
  } catch(error) {
    mapFailed=true;$('loading').replaceChildren(el('span','',msg('error.map')));
    $('announcement').textContent=msg('error.mapAnnouncement');console.error('Latent of References:',error);
  }
}
setLanguage(locale,false);
init();
