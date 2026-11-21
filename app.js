'use strict';

/* Chocolat Journal — 依存ライブラリを使わず、写真も端末内のIndexedDBに保存 */
const DB_NAME = 'chocolat_journal_db';
const DB_VERSION = 1;
const DIMENSIONS = [
  ['visual','見た目'], ['aroma','香り'], ['flavor','味わい'],
  ['texture','食感'], ['creativity','独創性'], ['liking','好み']
];
const TAGS = {
  flavor: { label:'🍊 味の系統', values:['フルーティー','柑橘系','ベリー系','ナッツ系','キャラメル系','スパイス系','フローラル系','コーヒー系','お茶系','お酒系','ビター系','ミルキー系','バニラ系','塩味'] },
  aroma: { label:'🌸 香りの系統', values:['カカオ','バニラ','花','柑橘','ベリー','ナッツ','焙煎','スパイス','ウッディ','ハーブ','洋酒'] },
  texture: { label:'🧈 食感', values:['なめらか','とろける','パリッと','サクサク','ザクザク','ねっとり','ふんわり','粒感がある','クリーミー','軽やか'] },
  appearance: { label:'🎨 見た目', values:['球体','半球','キューブ','ドーム型','ハート型','マーブル','グラデーション','転写模様','艶やか','マット','カラフル'] }
};
const DEFAULT_PREFS = { names:['わたし','パートナー'] };
const state = {
  db:null, records:[], brands:[], prefs:structuredClone(DEFAULT_PREFS),
  page:'gallery', detailId:null, backPage:'gallery', brandDetail:null,
  filters:{ query:'', brand:'', flavor:'', aroma:'', texture:'', appearance:'', sort:'newest', favorite:false },
  filtersOpen:false, brandFormOpen:false, brandEditingId:null,
  form:null, crop:null, toastTimer:null, storageProblem:false
};
const $ = (selector,root=document) => root.querySelector(selector);
const $$ = (selector,root=document) => Array.from(root.querySelectorAll(selector));
const escaped = value => String(value ?? '').replace(/[&<>"']/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const norm = value => String(value ?? '').trim();
const unique = arr => [...new Set(arr.filter(Boolean))];
const safeImage = data => typeof data === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) ? data : '';
const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const fmtDate = s => s ? String(s).replaceAll('-','.') : '—';
const personName = idx => norm(state.prefs.names?.[idx]) || `${idx+1}人目`;
const scoreNum = (item, idx, key='liking') => {
  const n = Number(item?.tasters?.[idx]?.scores?.[key]);
  return Number.isFinite(n) && n>=1 && n<=10 ? n : null;
};
const average = vals => vals.length ? vals.reduce((sum,x)=>sum+x,0)/vals.length : null;
const displayNum = v => v===null || v===undefined ? '—' : (Math.round(v*10)/10).toFixed(1).replace(/\.0$/,'');
const uuid = () => globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function toast(message){
  const node=$('#toast'); node.textContent=message; node.classList.add('visible');
  clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>node.classList.remove('visible'),3300);
}
function scrollTop(){window.scrollTo({top:0,behavior:'instant'});}
function defaultTaster(){return {scores:Object.fromEntries(DIMENSIONS.map(([k])=>[k,0])),notes:{first:'',middle:'',last:'',free:''}};}
function emptyForm(editingId=null){return {editingId,tags:Object.fromEntries(Object.keys(TAGS).map(k=>[k,[]])),tasters:[defaultTaster(),defaultTaster()],person:0,photoOriginal:'',photoRound:'',cropConfig:{zoom:1,panX:0,panY:0},prefillBrand:''};}

function openDB(){return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(new Error('IndexedDBを利用できません'));return;}
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains('records'))db.createObjectStore('records',{keyPath:'id'});
    if(!db.objectStoreNames.contains('brands'))db.createObjectStore('brands',{keyPath:'id'});
    if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error || new Error('保存領域の初期化に失敗しました'));
});}
function idb(op,store,keyOrValue){return new Promise((resolve,reject)=>{
  const tx=state.db.transaction(store,op==='getAll'||op==='get'?'readonly':'readwrite');
  const target=tx.objectStore(store);
  let req;
  if(op==='getAll')req=target.getAll();
  if(op==='get')req=target.get(keyOrValue);
  if(op==='put')req=target.put(keyOrValue);
  if(op==='delete')req=target.delete(keyOrValue);
  if(op==='clear')req=target.clear();
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error || new Error('データ保存エラー'));
  tx.onerror=()=>reject(tx.error || new Error('書き込みに失敗しました'));
});}
async function persistRecord(record){await idb('put','records',record); const ix=state.records.findIndex(x=>x.id===record.id);if(ix>=0)state.records[ix]=record;else state.records.push(record);}
async function persistBrand(brand){await idb('put','brands',brand);const ix=state.brands.findIndex(x=>x.id===brand.id);if(ix>=0)state.brands[ix]=brand;else state.brands.push(brand);}
async function persistPrefs(){await idb('put','meta',{key:'prefs',value:state.prefs});}
async function init(){
  try{
    state.db=await openDB();
    const [records,brands,prefs]=await Promise.all([idb('getAll','records'),idb('getAll','brands'),idb('get','meta','prefs')]);
    state.records=records || [];state.brands=brands || [];
    if(prefs?.value && Array.isArray(prefs.value.names))state.prefs={names:[0,1].map(i=>String(prefs.value.names[i]||DEFAULT_PREFS.names[i]).slice(0,30))};
  }catch(e){console.error(e);state.storageProblem=true;}
  render();
  if('serviceWorker' in navigator && /^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
function activePage(){return state.page==='detail'?'gallery':state.page;}
function render(){
  const main=$('#view');
  if(state.storageProblem){
    main.innerHTML=`<div class="empty-state"><div class="empty-icon">!</div><h3>端末内の保存領域が使えません</h3><p>プライベートブラウズやブラウザの設定を確認し、通常のSafariまたはChromeで開き直してください。記録を安全に保存できないため入力機能を停止しています。</p></div>`;
    $$('.nav-item').forEach(n=>n.disabled=true);return;
  }
  const pages={gallery:renderGallery,form:renderForm,detail:renderDetail,brands:renderBrands,insights:renderInsights,settings:renderSettings};
  main.innerHTML=(pages[state.page]||renderGallery)();
  $$('.nav-item').forEach(btn=>btn.classList.toggle('active',btn.dataset.nav===activePage()));
  if(state.page==='insights')requestAnimationFrame(drawRadar);
}
function navigate(page){
  if(state.page==='form' && page!=='form' && !confirm('入力中の内容を破棄して移動しますか？'))return;
  if(page==='form'){startForm();return;}
  state.page=page;
  if(page==='brands')state.brandDetail=null;
  render();scrollTop();
}
function sectionHeader(title,caption=''){return `<div class="section-head"><h2 class="section-title">${escaped(title)}</h2>${caption?`<span class="section-hint">${escaped(caption)}</span>`:''}</div>`;}
function pageHeader(eyebrow,title,caption=''){return `<header class="page-header"><span class="kicker">${escaped(eyebrow)}</span><h1 class="page-title">${escaped(title)}</h1>${caption?`<p class="page-subtitle">${escaped(caption)}</p>`:''}</header>`;}
function art(item,cls='choco-art'){
  const img=safeImage(item.photoRound);
  return `<div class="${cls}">${img?`<img src="${img}" alt="${escaped(item.title)}の写真" loading="lazy">`:`<span ${cls==='choco-art'?'class="choco-placeholder"':''}>✦</span>`}</div>`;
}
function itemCard(item){
  const sc0=scoreNum(item,0),sc1=scoreNum(item,1);
  return `<button type="button" class="choco-card" data-open-item="${escaped(item.id)}" aria-label="${escaped(item.title)}の詳細を開く">${item.favorite?'<span class="fav-corner" aria-label="お気に入り">♥</span>':''}${art(item)}<span class="choco-brand">${escaped(item.brand)}</span><div class="item-title">${escaped(item.title)}</div><div class="choco-meta">${sc0!==null?`<span class="mini-score">♡ ${escaped(personName(0))} ${sc0}</span>`:''}${sc1!==null?`<span class="mini-score">♡ ${escaped(personName(1))} ${sc1}</span>`:''}${sc0===null&&sc1===null?'<span>まだ評価はありません</span>':''}</div></button>`;
}
const sortNewest=(a,b)=>(b.dateTasted||b.createdAt||'').localeCompare(a.dateTasted||a.createdAt||'') || (b.createdAt||'').localeCompare(a.createdAt||'');
function getFiltered(){
  const f=state.filters;
  const words=norm(f.query).toLocaleLowerCase();
  const list=state.records.filter(item=>{
    if(f.brand&&item.brand!==f.brand)return false;
    if(f.favorite&&!item.favorite)return false;
    for(const group of Object.keys(TAGS))if(f[group] && !(item.tags?.[group]||[]).includes(f[group]))return false;
    if(words){const hay=[item.title,item.brand,item.collection,item.store,item.memory,item.tasters?.[0]?.notes?.free,item.tasters?.[1]?.notes?.free,...Object.values(item.tags||{}).flat()].join(' ').toLocaleLowerCase();if(!hay.includes(words))return false;}
    return true;
  });
  const avgLike=item=>average([scoreNum(item,0),scoreNum(item,1)].filter(v=>v!==null)) ?? -1;
  list.sort(f.sort==='name'?((a,b)=>a.title.localeCompare(b.title,'ja')):f.sort==='rating'?((a,b)=>avgLike(b)-avgLike(a)):f.sort==='oldest'?((a,b)=>-sortNewest(a,b)):sortNewest);
  return list;
}
function options(values,selected='',empty='すべて'){return `<option value="">${escaped(empty)}</option>`+values.map(v=>`<option value="${escaped(v)}" ${v===selected?'selected':''}>${escaped(v)}</option>`).join('');}
function renderCatalogResults(items){
  if(!items.length)return `<div class="empty-state"><div class="empty-icon">✦</div><h3>${state.records.length?'条件に合うショコラはありません':'まだ、ショコラの展示がありません'}</h3><p>${state.records.length?'検索条件を変更すると、別の一粒に出会えるかもしれません。':'最初の一粒を登録して、二人だけのショコラ図鑑を作りましょう。写真も円形に整えて保存できます。'}</p>${!state.records.length?'<button type="button" class="button" data-nav="form">＋ 最初の一粒を記録する</button>':'<button type="button" class="button secondary" data-action="clear-filters">検索条件をリセット</button>'}</div>`;
  return `<div class="catalog-grid">${items.map(itemCard).join('')}</div>`;
}
function renderGallery(){
  const totalBrands=unique(state.records.map(x=>x.brand)).length;
  const favoriteCount=state.records.filter(x=>x.favorite).length;
  const list=getFiltered();
  const selectTag=group=>unique([...TAGS[group].values,...state.records.flatMap(x=>x.tags?.[group]||[])]).sort((a,b)=>a.localeCompare(b,'ja'));
  return `<section class="hero"><div class="hero-copy"><div class="hero-eyebrow">A LITTLE WORLD IN EVERY BITE</div><h1>一粒に込められた、<br>小さな世界。</h1><p>味わいと、心に残った時間を。<br>二人で育てるショコラの私設図鑑。</p></div><div class="hero-decoration" aria-hidden="true"><div class="ornament">C<b>✧</b></div></div></section>
    <section class="stat-strip" aria-label="コレクションの統計"><div class="stat-box"><span>集めた一粒</span><div><strong>${state.records.length}</strong><small>粒</small></div></div><div class="stat-box"><span>ブランド</span><div><strong>${totalBrands}</strong><small>軒</small></div></div><div class="stat-box"><span>お気に入り</span><div><strong>${favoriteCount}</strong><small>粒</small></div></div></section>
    ${sectionHeader('ショコラの展示室','COLLECTION')}
    <section class="filter-toolbar"><div class="search-row"><div class="search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" id="search-choco" aria-label="ショコラを検索" placeholder="名前・ブランド・味わいで探す" value="${escaped(state.filters.query)}" autocomplete="off"></div><button class="filter-toggle ${state.filtersOpen?'is-active':''}" type="button" data-action="toggle-filters" aria-expanded="${state.filtersOpen}">絞り込み ${state.filtersOpen?'⌃':'⌄'}</button></div>
    <div class="filter-body" ${state.filtersOpen?'':'hidden'}>
      <label class="filter-field">ブランド<select data-filter="brand">${options(unique(state.records.map(x=>x.brand)).sort((a,b)=>a.localeCompare(b,'ja')),state.filters.brand)}</select></label>
      ${Object.keys(TAGS).map(group=>`<label class="filter-field">${escaped(TAGS[group].label)}<select data-filter="${group}">${options(selectTag(group),state.filters[group])}</select></label>`).join('')}
      <label class="filter-field">並び順<select data-filter="sort"><option value="newest" ${state.filters.sort==='newest'?'selected':''}>最近食べた順</option><option value="oldest" ${state.filters.sort==='oldest'?'selected':''}>古い順</option><option value="rating" ${state.filters.sort==='rating'?'selected':''}>好みの平均が高い順</option><option value="name" ${state.filters.sort==='name'?'selected':''}>名前順</option></select></label>
      <div class="filter-foot"><label class="checkbox"><input type="checkbox" data-filter="favorite" ${state.filters.favorite?'checked':''}> ♥ お気に入りのみ</label><button class="text-button" type="button" data-action="clear-filters">条件をリセット</button></div>
    </div></section>
    <div class="result-count" id="result-count">${list.length} 粒のショコラを表示中</div><div id="catalog-results">${renderCatalogResults(list)}</div>
    <p class="foot-quote">「おいしい」の、その先にある物語を。</p>`;
}
function updateGalleryResults(){const result=$('#catalog-results');if(result){const list=getFiltered();result.innerHTML=renderCatalogResults(list);$('#result-count').textContent=`${list.length} 粒のショコラを表示中`;}}

function startForm(id=null,prefillBrand=''){
  const item=id?state.records.find(x=>x.id===id):null;
  state.form=emptyForm(item?.id||null);
  if(item){
    state.form.tags=Object.fromEntries(Object.keys(TAGS).map(k=>[k,[...(item.tags?.[k]||[])]]));
    state.form.tasters=[0,1].map(i=>({scores:Object.fromEntries(DIMENSIONS.map(([k])=>[k,scoreNum(item,i,k)||0])),notes:{...defaultTaster().notes,...item.tasters?.[i]?.notes}}));
    state.form.photoOriginal=safeImage(item.photoOriginal);state.form.photoRound=safeImage(item.photoRound);
    state.form.cropConfig=item.cropConfig || {zoom:1,panX:0,panY:0};
  }
  state.form.prefillBrand=prefillBrand;
  state.page='form';render();scrollTop();
}
function tagButtons(group){
  const selected=state.form.tags[group]||[];
  const options=unique([...TAGS[group].values,...selected]);
  return `<div class="tag-list">${options.map(tag=>`<button type="button" class="tag-pill ${selected.includes(tag)?'is-selected':''}" data-toggle-tag="${group}" data-tag="${escaped(tag)}" aria-pressed="${selected.includes(tag)}">${escaped(tag)}</button>`).join('')}</div>`;
}
function renderTagSections(){return Object.entries(TAGS).map(([group,meta])=>`<div class="tag-group"><div class="tag-label">${meta.label}<small>複数選択可</small></div>${tagButtons(group)}<div class="tag-add"><input class="small-input" data-custom-tag="${group}" placeholder="独自のタグを追加" maxlength="28" aria-label="${escaped(meta.label)}の独自タグ"><button type="button" class="button secondary small" data-add-tag="${group}">＋ 追加</button></div></div>`).join('');}
function scorePanel(){
  const idx=state.form.person;
  const taster=state.form.tasters[idx];
  return `<div class="taste-tabs" role="tablist" aria-label="評価する人"><button type="button" class="taste-tab ${idx===0?'active':''}" data-person="0" role="tab" aria-selected="${idx===0}"><span class="dot"></span>${escaped(personName(0))}</button><button type="button" class="taste-tab partner ${idx===1?'active':''}" data-person="1" role="tab" aria-selected="${idx===1}"><span class="dot"></span>${escaped(personName(1))}</button></div>
    <p class="score-help">0 は「未評価」、1〜10 が評価点です。二人の点数・感想は個別に保存されます。</p>
    <div>${DIMENSIONS.map(([key,label])=>{const value=taster.scores[key]||0;return `<label class="score-row ${idx===1?'partner':''}"><span class="score-row-label">${label}</span><input type="range" min="0" max="10" step="1" value="${value}" data-score="${key}" aria-label="${label}の評価"><span class="score-value ${!value?'unrated':''}" data-score-value="${key}">${value?`${value}<small style="font-size:10px">/10</small>`:'未評価'}</span></label>`;}).join('')}</div>
    <div class="tasting-notes"><div class="form-section-head"><span class="form-section-number">✧</span><div><h2>テイスティングノート</h2><p>${escaped(personName(idx))}が感じたこと</p></div></div>
      <div class="notes-grid">${[['first','① ファーストノート','口に入れた瞬間の印象'],['middle','② ミドルノート','広がっていく味や香り'],['last','③ ラストノート','余韻や後味'],['free','自由な感想','印象に残ったこと、驚いたことなど']].map(([key,label,ph])=>`<label class="field"><span>${label} <small class="optional">任意</small></span><textarea data-person-note="${key}" rows="2" placeholder="${ph}">${escaped(taster.notes?.[key]||'')}</textarea></label>`).join('')}</div>
    </div>`;
}
function renderForm(){
  const item=state.form?.editingId?state.records.find(x=>x.id===state.form.editingId):null;
  if(!state.form)state.form=emptyForm();
  const brandName=item?.brand||state.form.prefillBrand||'';
  const brandNames=unique([...state.brands.map(x=>x.name),...state.records.map(x=>x.brand)]).sort((a,b)=>a.localeCompare(b,'ja'));
  const collections=unique(state.records.map(x=>x.collection)).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ja'));
  const photo=safeImage(state.form.photoRound);
  return `<div class="form-layout">${pageHeader('NEW TASTING NOTE',item?'ショコラの記録を編集':'新しい一粒を記録','気軽に記録して、あとから少しずつ書き足すこともできます。')}
    <form id="chocolate-form">
      <section class="card form-section"><div class="form-section-head"><span class="form-section-number">01</span><div><h2>一粒の肖像</h2><p>写真を円形に切り抜いて飾りましょう。</p></div></div>
        <div class="photo-layout"><div class="photo-preview" id="photo-preview">${photo?`<img src="${photo}" alt="ショコラの円形写真">`:'<span class="placeholder">✦</span>'}</div><div><p class="photo-description">ショコラの形が伝わる写真を選んでください。指で位置を動かし、拡大してから保存できます。</p><div class="photo-actions"><label class="button secondary small" for="photo-file">📷 写真を選ぶ</label>${state.form.photoOriginal?'<button class="button ghost small" data-action="recrop" type="button">切り抜き直す</button>':''}${photo?'<button class="button ghost small" data-action="remove-photo" type="button">写真を外す</button>':''}</div><input id="photo-file" type="file" accept="image/*" hidden><p class="field-note">元写真も端末内に残るため、後から再調整できます。</p></div></div>
      </section>
      <section class="card form-section"><div class="form-section-head"><span class="form-section-number">02</span><div><h2>ショコラの基本情報</h2><p>ブランド・箱・一粒を関連付けて管理します。</p></div></div>
        <div class="field-grid"><label class="field full"><span>ショコラの名前 <span style="color:#a15a4a">＊</span></span><input type="text" name="title" required maxlength="90" placeholder="例：オランジュ・ノワール" value="${escaped(item?.title||'')}"></label>
          <label class="field"><span>ショコラティエ・ブランド <span style="color:#a15a4a">＊</span></span><input type="text" name="brand" list="brand-suggestions" required maxlength="80" placeholder="ブランド名" value="${escaped(brandName)}"><datalist id="brand-suggestions">${brandNames.map(x=>`<option value="${escaped(x)}"></option>`).join('')}</datalist></label>
          <label class="field"><span>コレクション・箱名 <small class="optional">任意</small></span><input type="text" name="collection" list="collection-suggestions" maxlength="90" placeholder="例：冬のアソート" value="${escaped(item?.collection||'')}"><datalist id="collection-suggestions">${collections.map(x=>`<option value="${escaped(x)}"></option>`).join('')}</datalist></label>
          <label class="field"><span>食べた日</span><input type="date" name="dateTasted" value="${escaped(item?.dateTasted||today())}"></label>
          <label class="field"><span>購入日 <small class="optional">任意</small></span><input type="date" name="datePurchased" value="${escaped(item?.datePurchased||'')}"></label>
          <label class="field"><span>購入店舗 <small class="optional">任意</small></span><input type="text" name="store" maxlength="110" placeholder="例：札幌の百貨店" value="${escaped(item?.store||'')}"></label>
          <label class="field"><span>価格（円） <small class="optional">任意</small></span><input type="number" name="price" min="0" max="99999999" step="1" placeholder="1粒あたり・任意" value="${item?.price??''}"></label>
          <label class="field"><span>カカオ含有率（％） <small class="optional">任意</small></span><input type="number" name="cacao" min="0" max="100" step="0.1" placeholder="分かる場合のみ" value="${item?.cacao??''}"></label>
        </div>
      </section>
      <section class="card form-section"><div class="form-section-head"><span class="form-section-number">03</span><div><h2>この一粒の特徴</h2><p>タグを付けて、後から同じ系統の作品を検索できます。</p></div></div><div id="tag-sections">${renderTagSections()}</div></section>
      <section class="card form-section"><div class="form-section-head"><span class="form-section-number">04</span><div><h2>二人のテイスティング</h2><p>ひとりずつ切り替えて評価します。</p></div></div><div id="rating-panel">${scorePanel()}</div></section>
      <section class="card form-section"><div class="form-section-head"><span class="form-section-number">05</span><div><h2>その日の思い出</h2><p>味だけでなく、一緒に味わった時間も。</p></div></div><label class="field full"><span>二人の思い出 <small class="optional">任意</small></span><textarea name="memory" rows="4" placeholder="どこで買った？ どんな会話をした？ 二人で笑ったことは？">${escaped(item?.memory||'')}</textarea></label>
      <label class="checkbox" style="margin-top:13px"><input name="favorite" type="checkbox" ${item?.favorite?'checked':''}> ♥ お気に入りに登録する</label></section>
      <div class="form-footer"><button type="button" class="button ghost" data-action="cancel-form">キャンセル</button><button type="submit" class="button">${item?'変更を保存':'この一粒を保存する'} →</button></div>
    </form></div>`;
}
function formValues(form){const data=new FormData(form);const get=k=>norm(data.get(k));return {
  title:get('title'),brand:get('brand'),collection:get('collection'),dateTasted:get('dateTasted'),datePurchased:get('datePurchased'),store:get('store'),
  price:get('price')===''?null:Number(get('price')),cacao:get('cacao')===''?null:Number(get('cacao')),
  memory:get('memory'),favorite:data.has('favorite')
};}
async function saveForm(e){
  e.preventDefault();const form=e.target;
  if(!form.reportValidity())return;
  const values=formValues(form);
  if(!values.title||!values.brand){toast('名前とブランド名を入力してください');return;}
  const matching=state.brands.find(x=>x.name.toLocaleLowerCase()===values.brand.toLocaleLowerCase());
  if(matching)values.brand=matching.name;
  const previous=state.form.editingId?state.records.find(x=>x.id===state.form.editingId):null;
  const item={...previous,...values,
    id:previous?.id||uuid(),createdAt:previous?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),
    photoOriginal:state.form.photoOriginal,photoRound:state.form.photoRound,cropConfig:state.form.cropConfig,
    tags:Object.fromEntries(Object.keys(TAGS).map(k=>[k,[...(state.form.tags[k]||[])]])),
    tasters:state.form.tasters.map(t=>({scores:{...t.scores},notes:{...t.notes}}))
  };
  try{
    await persistRecord(item);
    if(!matching && !state.brands.some(x=>x.name.toLocaleLowerCase()===values.brand.toLocaleLowerCase())){
      try{await persistBrand({id:uuid(),name:values.brand,origin:'',description:''});}catch(e){console.warn(e);}
    }
    state.form=null;state.detailId=item.id;state.backPage='gallery';state.page='detail';render();scrollTop();toast(previous?'記録を更新しました':'新しい一粒を図鑑に保存しました');
  }catch(e){console.error(e);toast('保存に失敗しました。端末の空き容量をご確認ください');}
}

function renderRatingsSummary(item,idx){
  const scores=DIMENSIONS.map(([key])=>scoreNum(item,idx,key));const total=average(scores.filter(v=>v!==null));
  return `<div class="person-card"><div class="person-head"><span>${idx===0?'◈':'✿'} ${escaped(personName(idx))}</span><span class="point">${total!==null?`${displayNum(total)} <small style="font-size:10px">/ 10 平均</small>`:'未評価'}</span></div><div class="score-bars">${DIMENSIONS.map(([key,label])=>{const num=scoreNum(item,idx,key);return `<div class="score-bar ${idx===1?'partner':''}"><span>${label}</span><div class="track"><div class="fill" style="width:${num===null?0:num*10}%"></div></div><span style="text-align:right">${num===null?'—':`${num}/10`}</span></div>`;}).join('')}</div></div>`;
}
function renderNoteGroup(item,idx){
  const n=item.tasters?.[idx]?.notes||{};
  const arr=[['first','ファーストノート'],['middle','ミドルノート'],['last','ラストノート'],['free','自由な感想']].filter(([key])=>norm(n[key]));
  return `<div style="margin-bottom:16px"><h3 style="font-size:13px;margin:0 0 8px;color:#78563d">${escaped(personName(idx))}のノート</h3>${arr.length?arr.map(([key,label])=>`<div class="note-block"><div class="note-title">${label}</div><p class="note-content">${escaped(n[key])}</p></div>`).join(''):'<p class="muted" style="font-size:12px">まだ感想はありません。</p>'}</div>`;
}
function renderDetail(){
  const item=state.records.find(x=>x.id===state.detailId);
  if(!item)return `<div class="empty-state"><h3>記録が見つかりません</h3><button class="button" data-nav="gallery">図鑑へ戻る</button></div>`;
  const labels=Object.entries(TAGS).flatMap(([key,meta])=>(item.tags?.[key]||[]).map(tag=>`<span class="badge" title="${escaped(meta.label)}">${escaped(tag)}</span>`)).join('');
  return `<div class="detail-top"><button class="back-button" data-action="back-detail" type="button">← ${state.backPage==='brands'?'ブランドに戻る':'図鑑に戻る'}</button><div class="action-buttons"><button type="button" class="button secondary small" data-action="edit-item">✎ 編集</button><button type="button" class="button ghost small" data-action="delete-item">削除</button></div></div>
    <section class="detail-hero">${art(item,'detail-art')}<div><div class="detail-eyebrow">${escaped(item.brand)}</div><h1>${escaped(item.title)}</h1><div class="detail-date">${fmtDate(item.dateTasted)}${item.collection?` ／ ${escaped(item.collection)}`:''}</div><div class="detail-tags">${labels}</div><button type="button" class="detail-favorite" style="margin-top:13px" data-action="toggle-favorite">${item.favorite?'♥ お気に入り登録済み':'♡ お気に入りに追加'}</button></div></section>
    <div class="detail-column"><div><section class="card detail-card" style="margin-bottom:17px">${sectionHeader('二人の評価','TASTING SCORES')}${renderRatingsSummary(item,0)}${renderRatingsSummary(item,1)}</section>
      <section class="card detail-card">${sectionHeader('ショコラの情報','DETAILS')}<dl class="info-table">${[['ブランド',item.brand],['コレクション',item.collection],['食べた日',fmtDate(item.dateTasted)],['購入日',fmtDate(item.datePurchased)],['購入店舗',item.store],['価格',item.price!==null&&item.price!==undefined?`${Number(item.price).toLocaleString('ja-JP')} 円`:''],['カカオ含有率',item.cacao!==null&&item.cacao!==undefined?`${item.cacao}%`:'']].map(([k,v])=>`<div class="info-pair"><dt>${k}</dt><dd>${escaped(v||'—')}</dd></div>`).join('')}</dl></section></div>
      <div><section class="card detail-card" style="margin-bottom:17px">${sectionHeader('テイスティングノート','TASTING JOURNAL')}${renderNoteGroup(item,0)}<hr class="section-line">${renderNoteGroup(item,1)}</section>
      <section class="card detail-card">${sectionHeader('その日の思い出','OUR MEMORY')}<p class="note-content">${escaped(item.memory||'まだ思い出の記録はありません。')}</p></section></div>
    </div>`;
}
async function toggleFavorite(){const item=state.records.find(x=>x.id===state.detailId);if(!item)return;try{await persistRecord({...item,favorite:!item.favorite,updatedAt:new Date().toISOString()});render();}catch(e){toast('更新に失敗しました');}}
async function deleteItem(){const item=state.records.find(x=>x.id===state.detailId);if(!item)return;
  if(!confirm(`「${item.title}」の記録を写真・評価も含めて削除しますか？\n削除後はバックアップがなければ復元できません。`))return;
  try{await idb('delete','records',item.id);state.records=state.records.filter(x=>x.id!==item.id);state.page='gallery';state.detailId=null;render();scrollTop();toast('一粒の記録を削除しました');}catch(e){toast('削除に失敗しました');}
}

function brandAll(){const names=unique([...state.brands.map(x=>x.name),...state.records.map(x=>x.brand)]).sort((a,b)=>a.localeCompare(b,'ja'));return names.map(name=>state.brands.find(x=>x.name===name)||{id:null,name,origin:'',description:''});}
function renderBrands(){return state.brandDetail?renderBrandDetail():renderBrandList();}
function renderBrandList(){
  const brands=brandAll();const editing=state.brandEditingId?state.brands.find(x=>x.id===state.brandEditingId):null;
  return `${pageHeader('MAISON & CHOCOLATIER','ショコラティエ図鑑','ブランドの物語を、その一粒一粒とともに。')}
    <div class="section-head"><h2 class="section-title">登録ブランド <span class="inline-metric">${brands.length}</span></h2><button type="button" class="button secondary small" data-action="brand-form-toggle">${state.brandFormOpen?'閉じる':'＋ ブランドを追加'}</button></div>
    ${state.brandFormOpen?`<div class="brand-manage card"><form id="brand-form" class="form-section"><div class="form-section-head"><span class="form-section-number">✦</span><div><h2>${editing?'ブランド情報を編集':'新しいブランド'}</h2><p>初めてのブランドはショコラの登録時にも自動で追加されます。</p></div></div><div class="field-grid">
      <label class="field"><span>ブランド名 ＊</span><input name="name" type="text" required maxlength="80" value="${escaped(editing?.name||'')}" placeholder="ブランドの名前"></label>
      <label class="field"><span>国・地域 <small class="optional">任意</small></span><input name="origin" type="text" maxlength="80" value="${escaped(editing?.origin||'')}" placeholder="例：フランス／パリ"></label>
      <label class="field full"><span>ブランド紹介 <small class="optional">任意</small></span><textarea name="description" rows="3" maxlength="1500" placeholder="ショコラティエの特徴や好きなところ">${escaped(editing?.description||'')}</textarea></label></div>
      <div class="form-footer" style="margin:16px 0 0"><button type="button" class="button ghost small" data-action="brand-form-cancel">キャンセル</button><button type="submit" class="button small">${editing?'変更を保存':'ブランドを登録'}</button></div></form></div>`:''}
    ${brands.length?`<div class="brand-list">${brands.map(brand=>{const items=state.records.filter(x=>x.brand===brand.name);const collections=unique(items.map(x=>x.collection).filter(Boolean));return `<button type="button" class="brand-tile" data-open-brand="${escaped(brand.name)}"><div class="brand-cap">CHOCOLATIER</div><div class="brand-name">${escaped(brand.name)}</div><p>${escaped(brand.origin||'産地・地域の記録はまだありません')}</p><div class="brand-tile-stats"><span>◈ ${items.length} 粒</span><span>◈ ${collections.length} コレクション</span></div></button>`;}).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">C</div><h3>ショコラティエの棚は、まだ空です</h3><p>新しい一粒を記録すると、ブランドが自動でこちらに並びます。ブランドだけ先に登録することもできます。</p><button class="button" data-action="brand-form-toggle">＋ 最初のブランドを追加</button></div>`}`;
}
function renderBrandDetail(){
  const brand=brandAll().find(x=>x.name===state.brandDetail);
  if(!brand){state.brandDetail=null;return renderBrandList();}
  const items=state.records.filter(x=>x.brand===brand.name).sort(sortNewest);
  const collections=unique(items.map(x=>x.collection||'コレクション未設定'));
  return `<div class="detail-top"><button type="button" class="back-button" data-action="brand-back">← ブランド一覧へ戻る</button><div class="action-buttons"><button type="button" class="button secondary small" data-action="brand-edit" data-brand-id="${escaped(brand.id||'')}">✎ ブランド情報</button><button type="button" class="button small" data-action="add-to-brand">＋ 一粒を追加</button></div></div>
    <section class="card detail-card" style="background:linear-gradient(130deg,#fffdf9,#f0e4d3);padding:27px"><span class="kicker">MAISON / CHOCOLATIER</span><h1 class="page-title">${escaped(brand.name)}</h1><p class="brand-intro">${escaped(brand.origin||'')} ${brand.description?`<br>${escaped(brand.description).replaceAll('\n','<br>')}`:''}</p><div style="display:flex;gap:17px;margin-top:18px;font-size:13px;color:#815f48">${items.length} 粒の作品 <span>／</span> ${collections.filter(x=>x!=='コレクション未設定').length} コレクション</div></section>
    ${items.length?collections.map(name=>{const list=items.filter(x=>(x.collection||'コレクション未設定')===name);return `<section><div class="collection-head"><h3>${escaped(name)}</h3><small>${list.length} 粒</small></div><div class="catalog-grid">${list.map(itemCard).join('')}</div></section>`;}).join(''):'<div class="empty-state"><h3>まだこのブランドの一粒はありません</h3><p>ブランドに作品を追加して、あなただけのコレクションを育てましょう。</p><button type="button" class="button" data-action="add-to-brand">＋ このブランドの一粒を登録</button></div>'}`;
}
async function saveBrandForm(e){
  e.preventDefault();const data=new FormData(e.target),name=norm(data.get('name')),origin=norm(data.get('origin')),description=norm(data.get('description'));
  if(!name){toast('ブランド名を入力してください');return;}
  const existing=state.brandEditingId?state.brands.find(x=>x.id===state.brandEditingId):null;
  if(state.brands.some(x=>x.id!==existing?.id && x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('同じブランド名がすでに登録されています');return;}
  const brand={id:existing?.id||uuid(),name,origin,description};
  try{
    await persistBrand(brand);
    if(existing && existing.name!==name){
      for(const item of state.records.filter(x=>x.brand===existing.name))await persistRecord({...item,brand:name,updatedAt:new Date().toISOString()});
    }
    state.brandFormOpen=false;state.brandEditingId=null;state.brandDetail=null;render();toast(existing?'ブランド情報を更新しました':'ブランドを登録しました');
  }catch(e){console.error(e);toast('ブランドの保存に失敗しました');}
}
function editBrand(id){state.brandDetail=null;state.brandEditingId=id||null;state.brandFormOpen=true;render();scrollTop();if(!id){$('#brand-form input[name="name"]')?.focus();}}

function insightAvg(idx,key){const scores=state.records.map(i=>scoreNum(i,idx,key)).filter(n=>n!==null);return average(scores);}
function topRank(idx){return state.records.filter(i=>scoreNum(i,idx)!==null).sort((a,b)=>scoreNum(b,idx)-scoreNum(a,idx)||sortNewest(a,b)).slice(0,5);}
function tagTrends(idx){const groups=new Map();for(const i of state.records){const score=scoreNum(i,idx);if(score===null)continue;for(const tag of unique(i.tags?.flavor||[])){const obj=groups.get(tag)||{sum:0,count:0};obj.sum+=score;obj.count++;groups.set(tag,obj);}}return [...groups.entries()].map(([tag,x])=>({tag,avg:x.sum/x.count,count:x.count})).sort((a,b)=>b.count-a.count||b.avg-a.avg).slice(0,6);}
function renderRanking(idx){const ranks=topRank(idx);return ranks.length?`<div class="ranking-list">${ranks.map((item,i)=>`<button type="button" class="rank-row" data-open-item="${escaped(item.id)}" style="border:1px solid #eee2d3;text-align:left;width:100%;cursor:pointer"><span class="rank-index">${i+1}</span><div class="rank-title"><strong>${escaped(item.title)}</strong><span>${escaped(item.brand)}</span></div><span class="rank-score">${scoreNum(item,idx)}</span></button>`).join('')}</div>`:'<p class="muted" style="font-size:12px">「好み」を評価するとランキングが表示されます。</p>';}
function renderInsights(){
  const pair=state.records.filter(i=>scoreNum(i,0)!==null&&scoreNum(i,1)!==null);
  const matching=pair.filter(i=>Math.abs(scoreNum(i,0)-scoreNum(i,1))<=1).length;
  const tagged=state.records.flatMap(x=>x.tags?.flavor||[]);
  const common=Object.entries(tagged.reduce((acc,t)=>(acc[t]=(acc[t]||0)+1,acc),{})).sort((a,b)=>b[1]-a[1]);
  return `${pageHeader('THE TASTE STUDY','好みの研究','二人の感じ方を比べながら、自分たちの「好き」を見つけましょう。')}
    <section class="insight-cards"><div class="card insight-card"><span class="smallcap">評価したショコラ</span><div class="big-number">${state.records.filter(i=>[0,1].some(idx=>scoreNum(i,idx)!==null)).length}<small style="font-size:12px"> 粒</small></div></div><div class="card insight-card"><span class="smallcap">二人とも評価</span><div class="big-number">${pair.length}<small style="font-size:12px"> 粒</small></div></div><div class="card insight-card"><span class="smallcap">好みの近さ ±1点</span><div class="big-number">${pair.length?Math.round(matching/pair.length*100)+'%':'—'}</div></div></section>
    <div class="insight-grid"><section class="card chart-box">${sectionHeader('感性のかたち','6 AXES')}<p class="section-caption">各項目の評価点の平均を重ねて比較します。未評価は平均に含めません。</p><canvas id="radar-chart" width="420" height="420" role="img" aria-label="二人の六項目の評価の比較グラフ"></canvas><div class="legend"><span class="legend-item"><i class="legend-dot"></i>${escaped(personName(0))}</span><span class="legend-item"><i class="legend-dot partner"></i>${escaped(personName(1))}</span></div></section>
    <section class="card chart-box">${sectionHeader('よく出会う味','FLAVOR NOTES')}${common.length?common.slice(0,8).map(([tag,count])=>`<div class="tag-trend"><b>${escaped(tag)}</b><span>${count} 粒</span></div>`).join(''):'<p class="muted" style="font-size:12px;line-height:1.8">ショコラに味のタグを付けると、よく出会う系統がここに表示されます。</p>'}
    <hr class="section-line"><h3 class="serif" style="font-size:16px">二人の好み</h3><p class="section-caption">「好み」の点数だけを比較します。</p><div class="tag-trend"><b>${escaped(personName(0))}</b><span><strong class="inline-metric">${displayNum(insightAvg(0,'liking'))}</strong> /10</span></div><div class="tag-trend"><b>${escaped(personName(1))}</b><span><strong class="inline-metric">${displayNum(insightAvg(1,'liking'))}</strong> /10</span></div></section></div>
    ${sectionHeader('お気に入りの一粒','TOP PICKS')}
    <div class="insight-grid"><section class="card chart-box"><h3 class="serif" style="font-size:16px;margin:0 0 15px">◈ ${escaped(personName(0))}の好み順</h3>${renderRanking(0)}</section><section class="card chart-box"><h3 class="serif" style="font-size:16px;margin:0 0 15px">✿ ${escaped(personName(1))}の好み順</h3>${renderRanking(1)}</section></div>
    ${sectionHeader('味わいの傾向','TASTE PATTERNS')}
    <div class="insight-grid">${[0,1].map(idx=>{const trends=tagTrends(idx);return `<section class="card chart-box"><h3 class="serif" style="font-size:15px">${escaped(personName(idx))}の味の系統</h3><p class="section-caption">タグ別の好み平均点・記録件数</p>${trends.length?trends.map(x=>`<div class="tag-trend"><b>${escaped(x.tag)}</b><span>平均 ${displayNum(x.avg)} /10　(${x.count}粒)</span></div>`).join(''):'<p class="muted" style="font-size:12px">記録が増えると、ここに傾向が並びます。</p>'}</section>`;}).join('')}</div>
    <div class="callout" style="margin-top:18px"><strong>研究ノート</strong><br>${pair.length<3?'二人の評価が3粒以上になると、好みの一致度を少しずつ比べやすくなります。少ない記録から好みを断定しないよう、気長に集めていきましょう。':`二人が共に「好み」を採点した ${pair.length} 粒のうち、${matching} 粒は点数の差が1点以内でした。感じ方が違う作品も、新しい発見として楽しめます。`}</div>`;
}
function drawRadar(){
  const canvas=$('#radar-chart');if(!canvas)return;
  const box=canvas.getBoundingClientRect();const w=Math.min(Math.max(box.width,200),450),h=w;
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const cx=w/2,cy=h/2+3,r=Math.min(w*.315,145),count=DIMENSIONS.length;
  const xy=(index,rad)=>({x:cx+Math.cos(-Math.PI/2+2*Math.PI*index/count)*rad,y:cy+Math.sin(-Math.PI/2+2*Math.PI*index/count)*rad});
  ctx.strokeStyle='#e4d7c8';ctx.lineWidth=1;
  for(let k=1;k<=5;k++){ctx.beginPath();for(let i=0;i<count;i++){const p=xy(i,r*k/5);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.closePath();ctx.stroke();}
  for(let i=0;i<count;i++){const p=xy(i,r);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(p.x,p.y);ctx.stroke();}
  ctx.font=`${w<320?'10':'12'}px 'Hiragino Mincho ProN',sans-serif`;ctx.fillStyle='#786558';ctx.textAlign='center';ctx.textBaseline='middle';
  for(let i=0;i<count;i++){const p=xy(i,r+24);ctx.fillText(DIMENSIONS[i][1],p.x,p.y);}
  [0,1].forEach(idx=>{
    const vals=DIMENSIONS.map(([key])=>insightAvg(idx,key));if(vals.every(v=>v===null))return;
    ctx.beginPath();vals.forEach((value,i)=>{const p=xy(i,r*(value||0)/10);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.closePath();
    ctx.fillStyle=idx===0?'rgba(172,131,73,.16)':'rgba(189,126,119,.17)';ctx.strokeStyle=idx===0?'#ac8553':'#bd817b';ctx.lineWidth=2.5;ctx.fill();ctx.stroke();
    vals.forEach((value,i)=>{if(value===null)return;const p=xy(i,r*value/10);ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill();});
  });
}

function renderSettings(){return `<div class="settings-layout">${pageHeader('YOUR JOURNAL','設定とバックアップ','大切な記録を、安心して積み重ねるために。')}
    <section class="card settings-card"><h2>二人の名前</h2><p>記録画面や研究ページの評価者名を変更できます。データは変更されず、表示名だけが変わります。</p><form id="prefs-form"><div class="field-grid"><label class="field"><span>一人目</span><input type="text" name="name0" maxlength="30" required value="${escaped(personName(0))}"></label><label class="field"><span>二人目</span><input type="text" name="name1" maxlength="30" required value="${escaped(personName(1))}"></label></div><button class="button small" type="submit">名前を保存</button></form></section>
    <section class="card settings-card"><h2>図鑑のバックアップ</h2><p>すべての記録・元写真・円形写真・二人の評価・ブランドを、1つの JSON ファイルに保存できます。機種変更やデータ消失に備え、定期的な保存をおすすめします。</p><div class="settings-buttons"><button class="button" data-action="export-backup" type="button">↓ バックアップを保存</button></div><hr class="section-line"><label class="field"><span>バックアップから復元</span><input id="import-file" type="file" accept=".json,application/json"></label><label class="field" style="margin:11px 0 14px"><span>復元方法</span><select id="import-mode"><option value="merge">統合する（同じ記録IDは上書き）</option><option value="replace">現在の記録をすべて置き換える</option></select></label><button type="button" class="button secondary" data-action="import-backup">↑ ファイルから復元</button><p class="small-print" style="margin-top:12px">ご注意：写真を含むため、記録が増えるとバックアップのファイルサイズも大きくなります。</p></section>
    <section class="card settings-card"><h2>このアプリの保存について</h2><p>現在のバージョンは<strong>端末内保存</strong>です。インターネット接続がなくても、いったん開いた後は原則として利用できます。サーバーへの送信やアカウント登録は行いません。</p><div class="help-card">iPhoneではSafariの共有メニュー →「ホーム画面に追加」でアプリのように使えます。ブラウザの閲覧データ削除や端末の変更で記録が失われる場合があるため、バックアップを残してください。ホーム画面版とSafari版で保存領域が別になる場合もあります。</div></section>
    <section class="card settings-card is-danger"><h2>すべてのデータを初期化</h2><p>全ショコラ・ブランド・写真・評価を削除し、名前も初期状態に戻します。元に戻すにはバックアップが必要です。</p><button type="button" class="danger-link" data-action="reset-all">すべての記録を削除する</button></section>
    <p class="small-print" style="text-align:center">Chocolat Journal v1.0 · Made for the little moments</p></div>`;}
async function savePrefs(e){e.preventDefault();const data=new FormData(e.target);const names=[norm(data.get('name0')),norm(data.get('name1'))];if(names.some(n=>!n)){toast('二人の名前を入力してください');return;}try{state.prefs={names};await persistPrefs();render();toast('二人の名前を保存しました');}catch(e){toast('設定の保存に失敗しました');}}
function exportBackup(){
  const payload={app:'Chocolat Journal',version:1,exportedAt:new Date().toISOString(),prefs:state.prefs,brands:state.brands,records:state.records};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ショコラ研究室_バックアップ_${today().replaceAll('-','')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);toast('バックアップの保存を開始しました');
}
function sanitizeRecord(record){
  if(!record || typeof record!=='object'||!record.id||!norm(record.title)||!norm(record.brand))return null;
  const clean=(s,max=5000)=>String(s??'').slice(0,max);
  const scores=idx=>Object.fromEntries(DIMENSIONS.map(([key])=>{const n=Number(record.tasters?.[idx]?.scores?.[key]);return [key,n>=1&&n<=10&&Number.isFinite(n)?Math.round(n):0];}));
  const notes=idx=>Object.fromEntries(['first','middle','last','free'].map(k=>[k,clean(record.tasters?.[idx]?.notes?.[k],6000)]));
  return {
    id:clean(record.id,90),title:clean(record.title,90),brand:clean(record.brand,80),collection:clean(record.collection,90),
    dateTasted:clean(record.dateTasted,10),datePurchased:clean(record.datePurchased,10),store:clean(record.store,110),
    price:typeof record.price==='number'&&record.price>=0&&Number.isFinite(record.price)?record.price:null,
    cacao:typeof record.cacao==='number'&&record.cacao>=0&&record.cacao<=100?record.cacao:null,
    memory:clean(record.memory,12000),favorite:!!record.favorite,
    photoOriginal:safeImage(record.photoOriginal),photoRound:safeImage(record.photoRound),
    cropConfig:{zoom:Math.max(1,Math.min(3.5,Number(record.cropConfig?.zoom)||1)),panX:Number(record.cropConfig?.panX)||0,panY:Number(record.cropConfig?.panY)||0},
    tasters:[0,1].map(idx=>({scores:scores(idx),notes:notes(idx)})),
    tags:Object.fromEntries(Object.keys(TAGS).map(k=>[k,unique(Array.isArray(record.tags?.[k])?record.tags[k].filter(x=>typeof x==='string').map(x=>x.slice(0,28)).slice(0,60):[])])),
    createdAt:clean(record.createdAt||new Date().toISOString(),50),updatedAt:clean(record.updatedAt||new Date().toISOString(),50)
  };
}

function applyImportAtomic(records,brands,mode,prefs){
  // 置き換え中の容量不足等で古い記録が失われないよう、すべてを単一トランザクションで更新する。
  const existingRecords=mode==='replace'?[]:[...state.records];
  const existingBrands=mode==='replace'?[]:[...state.brands];
  const recordMap=new Map(existingRecords.map(r=>[r.id,r]));
  const brandMap=new Map(existingBrands.map(b=>[b.id,b]));
  const brandByName=new Map(existingBrands.map(b=>[b.name.toLocaleLowerCase(),b.id]));
  for(const r of records)recordMap.set(r.id,r);
  for(const b of brands){
    const key=b.name.toLocaleLowerCase();
    const already=brandByName.get(key);
    const id=already||b.id;
    brandMap.set(id,{...b,id});
    brandByName.set(key,id);
  }
  const nextPrefs=mode==='replace'?prefs:state.prefs;
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(['records','brands','meta'],'readwrite');
    const recStore=tx.objectStore('records'),brandStore=tx.objectStore('brands');
    if(mode==='replace'){recStore.clear();brandStore.clear();}
    for(const r of records)recStore.put(r);
    for(const b of brandMap.values())brandStore.put(b);
    if(mode==='replace')tx.objectStore('meta').put({key:'prefs',value:nextPrefs});
    tx.oncomplete=()=>{
      state.records=[...recordMap.values()];state.brands=[...brandMap.values()];
      if(mode==='replace')state.prefs=nextPrefs;
      resolve();
    };
    tx.onabort=()=>reject(tx.error||new Error('復元処理が中止されました'));
    tx.onerror=()=>reject(tx.error||new Error('復元処理中にエラーが発生しました'));
  });
}

async function importBackup(){
  const input=$('#import-file'),file=input?.files?.[0],mode=$('#import-mode')?.value;
  if(!file){toast('復元するJSONファイルを選んでください');return;}
  if(file.size>250*1024*1024){toast('ファイルが大きすぎます（250MBまで）');return;}
  try{
    const json=JSON.parse(await file.text());
    if(json.app!=='Chocolat Journal'||!Array.isArray(json.records)||!Array.isArray(json.brands)){toast('ショコラ研究室のバックアップファイルではありません');return;}
    const records=json.records.map(sanitizeRecord).filter(Boolean);
    const brands=json.brands.filter(b=>b&&norm(b.name)).map(b=>({id:typeof b.id==='string'&&b.id?b.id:uuid(),name:String(b.name).slice(0,80),origin:String(b.origin||'').slice(0,80),description:String(b.description||'').slice(0,1500)}));
    if(records.length!==json.records.length){toast('不正な記録が含まれているため復元を中止しました');return;}
    const message=mode==='replace'?'現在のデータをすべて削除して、バックアップの内容に置き換えます。よろしいですか？':`${records.length}粒のショコラを現在の図鑑に統合します。同じ記録IDはバックアップの内容に上書きされます。よろしいですか？`;
    if(!confirm(message))return;
    const importedPrefs=json.prefs?.names?.length>=2
      ?{names:json.prefs.names.slice(0,2).map((x,i)=>String(x||DEFAULT_PREFS.names[i]).slice(0,30))}
      :structuredClone(DEFAULT_PREFS);
    await applyImportAtomic(records,brands,mode,importedPrefs);
    render();toast(`${records.length}粒の記録を復元しました`);
  }catch(e){console.error(e);toast('復元に失敗しました。ファイル形式と端末容量を確認してください');}
}
async function resetAll(){if(!confirm('全てのショコラ・写真・ブランド・評価を削除します。実行しますか？'))return;if(!confirm('最後の確認です。バックアップを取っていないデータは元に戻せません。本当に削除しますか？'))return;
  try{await Promise.all([idb('clear','records'),idb('clear','brands'),idb('clear','meta')]);state.records=[];state.brands=[];state.prefs=structuredClone(DEFAULT_PREFS);state.page='gallery';render();scrollTop();toast('すべての記録を初期化しました');}catch(e){toast('初期化に失敗しました');}
}

async function photoSelected(e){
  const file=e.target.files?.[0];if(!file)return; e.target.value='';
  if(!file.type.startsWith('image/')){toast('画像ファイルを選んでください');return;}
  if(file.size>25*1024*1024){toast('写真は25MB以内で選んでください');return;}
  try{
    const src=await readFileData(file),img=await loadImage(src);
    const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    await openCrop(c.toDataURL('image/jpeg',.86));
  }catch(e){console.error(e);toast('この画像は読み込めませんでした。JPEG/PNGをお試しください');}
}
function readFileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('画像読み込みエラー'));reader.readAsDataURL(file);});}
function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('画像の展開に失敗しました'));img.src=src;});}
async function openCrop(src,config=null){
  const img=await loadImage(src);
  const crop={src,img,zoom:Math.max(1,Math.min(3.5,Number(config?.zoom)||1)),panX:Number(config?.panX)||0,panY:Number(config?.panY)||0,pointers:new Map()};
  state.crop=crop;
  $('#overlay-root').innerHTML=`<div class="modal-layer" id="crop-layer"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="crop-title"><div class="modal-header"><h2 id="crop-title">写真を円形に切り抜く</h2><button type="button" class="modal-close" data-action="crop-cancel" aria-label="閉じる">×</button></div><p>写真を指で移動・2本指で拡大できます。円の内側が保存されます。</p><div class="crop-canvas-wrap"><canvas id="crop-canvas" width="400" height="400"></canvas><div class="circle-guide"></div></div><div class="crop-toolbar"><label for="crop-zoom">拡大</label><input id="crop-zoom" type="range" min="100" max="350" step="1" value="${Math.round(crop.zoom*100)}"><span id="crop-zoom-label" style="font-size:12px;color:#715743;min-width:35px">${Math.round(crop.zoom*100)}%</span></div><div class="crop-actions"><button type="button" class="button ghost" data-action="crop-reset">位置を戻す</button><button type="button" class="button" data-action="crop-save">この形で保存</button></div></div></div>`;
  const canvas=$('#crop-canvas');
  canvas.addEventListener('pointerdown',cropDown);canvas.addEventListener('pointermove',cropMove);canvas.addEventListener('pointerup',cropUp);canvas.addEventListener('pointercancel',cropUp);
  canvas.addEventListener('wheel',e=>{e.preventDefault();crop.zoom=Math.max(1,Math.min(3.5,crop.zoom*(e.deltaY>0?.94:1.06)));syncCropZoom();drawCrop();},{passive:false});
  cropClamp();drawCrop();
}
function cropClamp(){
  if(!state.crop)return;const c=state.crop,scale=Math.max(400/c.img.naturalWidth,400/c.img.naturalHeight)*c.zoom;
  const maxX=Math.max(0,(c.img.naturalWidth*scale-400)/2),maxY=Math.max(0,(c.img.naturalHeight*scale-400)/2);
  c.panX=Math.max(-maxX,Math.min(maxX,c.panX));c.panY=Math.max(-maxY,Math.min(maxY,c.panY));
}
function paintCrop(ctx,size){
  const c=state.crop;if(!c)return;
  const base=Math.max(400/c.img.naturalWidth,400/c.img.naturalHeight)*c.zoom;
  const fac=size/400,sw=c.img.naturalWidth*base*fac,sh=c.img.naturalHeight*base*fac;
  ctx.drawImage(c.img,(size-sw)/2+c.panX*fac,(size-sh)/2+c.panY*fac,sw,sh);
}
function drawCrop(){const canvas=$('#crop-canvas'),c=state.crop;if(!canvas||!c)return;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,400,400);paintCrop(ctx,400);}
function syncCropZoom(){const c=state.crop;if(!c)return;$('#crop-zoom').value=Math.round(c.zoom*100);$('#crop-zoom-label').textContent=`${Math.round(c.zoom*100)}%`;}
function cropPosition(e){const box=$('#crop-canvas').getBoundingClientRect();return {x:(e.clientX-box.left)*400/box.width,y:(e.clientY-box.top)*400/box.height};}
function centroid(points){const pts=[...points.values()];return {x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length};}
function spread(points){const pts=[...points.values()];return pts.length<2?null:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);}
function cropDown(e){if(!state.crop)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);state.crop.pointers.set(e.pointerId,cropPosition(e));}
function cropMove(e){const c=state.crop;if(!c||!c.pointers.has(e.pointerId))return;e.preventDefault();
  const old=new Map(c.pointers);const lastCenter=centroid(old),lastSpread=spread(old);
  c.pointers.set(e.pointerId,cropPosition(e));const nowCenter=centroid(c.pointers),nowSpread=spread(c.pointers);
  c.panX+=nowCenter.x-lastCenter.x;c.panY+=nowCenter.y-lastCenter.y;
  if(lastSpread&&nowSpread)c.zoom=Math.max(1,Math.min(3.5,c.zoom*nowSpread/lastSpread));
  cropClamp();syncCropZoom();drawCrop();
}
function cropUp(e){state.crop?.pointers.delete(e.pointerId);}
function cropClose(){$('#overlay-root').innerHTML='';state.crop=null;}
function cropSave(){const c=state.crop;if(!c||!state.form)return;const canvas=document.createElement('canvas');canvas.width=480;canvas.height=480;const ctx=canvas.getContext('2d');ctx.beginPath();ctx.arc(240,240,238,0,Math.PI*2);ctx.clip();paintCrop(ctx,480);
  try{state.form.photoOriginal=c.src;state.form.photoRound=canvas.toDataURL('image/png');state.form.cropConfig={zoom:c.zoom,panX:c.panX,panY:c.panY};cropClose();$('#photo-preview').innerHTML=`<img src="${state.form.photoRound}" alt="円形に切り抜いた写真">`;const actions=$('.photo-actions');if(actions)actions.innerHTML=`<label class="button secondary small" for="photo-file">📷 写真を選ぶ</label><button type="button" class="button ghost small" data-action="recrop">切り抜き直す</button><button type="button" class="button ghost small" data-action="remove-photo">写真を外す</button>`;toast('円形の写真を用意しました');}catch(e){console.error(e);toast('写真を保存できませんでした');}
}

/* 画面内アクション */
document.addEventListener('click',async event=>{
  const button=event.target.closest('button,[data-open-item],[data-open-brand],[data-toggle-tag]');
  if(!button)return;
  const nav=button.dataset.nav;
  if(nav){navigate(nav);return;}
  if(button.dataset.openItem){state.backPage=state.page==='brands'?'brands':'gallery';state.detailId=button.dataset.openItem;state.page='detail';render();scrollTop();return;}
  if(button.dataset.openBrand){state.brandDetail=button.dataset.openBrand;render();scrollTop();return;}
  if(button.dataset.toggleTag){const group=button.dataset.toggleTag,tag=button.dataset.tag;if(!state.form?.tags[group])return;const arr=state.form.tags[group],i=arr.indexOf(tag);if(i>=0)arr.splice(i,1);else arr.push(tag);button.classList.toggle('is-selected',i<0);button.setAttribute('aria-pressed',i<0);return;}
  if(button.dataset.person!==undefined && state.form){state.form.person=Number(button.dataset.person);$('#rating-panel').innerHTML=scorePanel();return;}
  if(button.dataset.addTag){const group=button.dataset.addTag,input=$(`[data-custom-tag="${group}"]`),tag=norm(input?.value);if(!tag)return;if(tag.length>28){toast('タグは28文字以内にしてください');return;}if(!state.form.tags[group].includes(tag))state.form.tags[group].push(tag);$('#tag-sections').innerHTML=renderTagSections();return;}
  switch(button.dataset.action){
    case 'toggle-filters':state.filtersOpen=!state.filtersOpen;render();break;
    case 'clear-filters':state.filters={query:'',brand:'',flavor:'',aroma:'',texture:'',appearance:'',sort:'newest',favorite:false};render();break;
    case 'cancel-form':navigate('gallery');break;
    case 'recrop':if(state.form?.photoOriginal)openCrop(state.form.photoOriginal,state.form.cropConfig).catch(()=>toast('写真を開けませんでした'));break;
    case 'remove-photo':if(state.form&&confirm('登録予定の写真を外しますか？')){state.form.photoOriginal='';state.form.photoRound='';state.form.cropConfig={zoom:1,panX:0,panY:0};$('#photo-preview').innerHTML='<span class="placeholder">✦</span>';renderPhotoActions();}break;
    case 'back-detail':if(state.backPage==='brands'){state.page='brands';}else state.page='gallery';render();scrollTop();break;
    case 'edit-item':startForm(state.detailId);break;
    case 'delete-item':await deleteItem();break;
    case 'toggle-favorite':await toggleFavorite();break;
    case 'brand-form-toggle':state.brandFormOpen=!state.brandFormOpen;state.brandEditingId=null;render();break;
    case 'brand-form-cancel':state.brandFormOpen=false;state.brandEditingId=null;render();break;
    case 'brand-back':state.brandDetail=null;render();scrollTop();break;
    case 'brand-edit':editBrand(button.dataset.brandId);break;
    case 'add-to-brand':startForm(null,state.brandDetail);break;
    case 'export-backup':exportBackup();break;
    case 'import-backup':await importBackup();break;
    case 'reset-all':await resetAll();break;
    case 'crop-cancel':cropClose();break;
    case 'crop-reset':if(state.crop){state.crop.zoom=1;state.crop.panX=0;state.crop.panY=0;syncCropZoom();drawCrop();}break;
    case 'crop-save':cropSave();break;
  }
});
function renderPhotoActions(){const actions=$('.photo-actions');if(actions)actions.innerHTML='<label class="button secondary small" for="photo-file">📷 写真を選ぶ</label>';}
document.addEventListener('submit',e=>{
  if(e.target.id==='chocolate-form')saveForm(e);
  else if(e.target.id==='brand-form')saveBrandForm(e);
  else if(e.target.id==='prefs-form')savePrefs(e);
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='search-choco'){state.filters.query=t.value;updateGalleryResults();return;}
  if(t.dataset.score&&state.form){const n=Number(t.value),key=t.dataset.score;state.form.tasters[state.form.person].scores[key]=n;const label=$(`[data-score-value="${key}"]`);if(label){label.classList.toggle('unrated',n===0);label.innerHTML=n?`${n}<small style="font-size:10px">/10</small>`:'未評価';}return;}
  if(t.dataset.personNote&&state.form){state.form.tasters[state.form.person].notes[t.dataset.personNote]=t.value;return;}
  if(t.id==='crop-zoom'&&state.crop){state.crop.zoom=Number(t.value)/100;cropClamp();syncCropZoom();drawCrop();return;}
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset.filter){state.filters[t.dataset.filter]=t.type==='checkbox'?t.checked:t.value;render();return;}
  if(t.id==='photo-file')photoSelected(e);
});
document.addEventListener('keydown',e=>{
  if(e.target?.id==='go-home'&&['Enter',' '].includes(e.key)){e.preventDefault();navigate('gallery');}
  if(e.key==='Escape'&&state.crop){cropClose();}
  if(e.key==='Enter'&&e.target?.dataset.customTag){e.preventDefault();$(`[data-add-tag="${e.target.dataset.customTag}"]`)?.click();}
});
$('#go-home')?.addEventListener('click',()=>navigate('gallery'));
window.addEventListener('resize',()=>{if(state.page==='insights')drawRadar();});
init();
