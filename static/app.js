'use strict';
const $=id=>document.getElementById(id), KEY='qca-atos-v1', ALL='__all__';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('pt-BR'), pct=n=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%', rate=(a,t)=>t?a/t*100:0;
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
let token='__TOKEN__', org={centers:[],stats:{}}, db=[], draft=[], draftId=null, draftExample=false, imageRequired=false, selected=null, previewURL=null, importing=false;
function toast(s){$('toast').textContent=s;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),6500)}
function ccOf(d){return d.ccId?org.centers.find(c=>c.id===d.ccId):null}
function labelCC(d){return d.ccName||d.team}
function labelCell(d){return d.cellId===ALL?'Consolidado do Centro de Custo':d.cellName||'Sem vínculo (versão anterior)'}
function managers(d){return [...new Set([d.ccManager,...(d.cellManagers||[])].filter(Boolean))]}
function validRow(r){return r&&typeof r.ato==='string'&&r.ato.trim()&&norm(r.ato)!=='total'&&['manual','auto','total'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0)&&r.manual+r.auto===r.total}
function overlaps(a,b){if(a.example||b.example||a.month!==b.month)return false;if(a.ccId&&b.ccId)return a.ccId===b.ccId&&(a.cellId===b.cellId||a.cellId===ALL||b.cellId===ALL);return norm(a.team)===norm(b.team)}
function validDB(v){
 if(!Array.isArray(v))return false;
 for(const d of v){
  if(!d||typeof d.id!=='string'||typeof d.team!=='string'||!d.team.trim()||typeof d.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)||!Array.isArray(d.rows)||!d.rows.length||!d.rows.every(validRow))return false;
  if(new Set(d.rows.map(r=>norm(r.ato))).size!==d.rows.length)return false;
  if(d.ccId&&(['ccId','ccName','cellId','cellName','ccManager','director','cluster','vertical'].some(k=>typeof d[k]!=='string')||!d.cellId||!Array.isArray(d.cellManagers)||!d.cellManagers.every(n=>typeof n==='string')))return false;
 }
 return new Set(v.map(d=>d.id)).size===v.length&&!v.some((a,i)=>v.slice(i+1).some(b=>overlaps(a,b)));
}
function persist(next){try{localStorage.setItem(KEY,JSON.stringify(next));db=next;return true}catch{toast('Não foi possível salvar. Faça backup dos dados atuais.');return false}}
function sum(rows){return rows.reduce((s,r)=>({manual:s.manual+r.manual,auto:s.auto+r.auto,total:s.total+r.total}),{manual:0,auto:0,total:0})}
function group(rows,key){const out=new Map;for(const r of rows){const k=r[key];if(!out.has(k))out.set(k,{label:k,manual:0,auto:0,total:0,derived:new Set});const a=out.get(k);for(const x of ['manual','auto','total'])a[x]+=r[x];for(const d of r.derived||[])a.derived.add(d)}return [...out.values()]}
function options(id,values,label){const prev=$(id).value;$(id).innerHTML='<option value="">'+esc(label)+'</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(values.includes(prev))$(id).value=prev}
function optionPairs(id,values,label){const prev=$(id).value;$(id).innerHTML='<option value="">'+esc(label)+'</option>'+values.map(v=>`<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');if(values.some(v=>v.id===prev))$(id).value=prev}
function updateCellFilter(){const cc=org.centers.find(c=>c.name===$('teamFilter').value);const cells=cc?cc.cells:org.centers.flatMap(c=>c.cells.map(v=>({...v,name:c.name+' / '+v.name})));optionPairs('cellFilter',[{id:ALL,name:'Somente consolidados de Centro de Custo'},...cells],'Todas as células / consolidado')}
function refresh(){
 options('teamFilter',[...new Set([...org.centers.map(c=>c.name),...db.map(labelCC)])].sort(),'Todos os Centros de Custo');
 updateCellFilter();options('monthFilter',[...new Set(db.map(d=>d.month))].sort(),'Todos os períodos');
 options('directorFilter',[...new Set([...org.centers.map(c=>c.director),...db.map(d=>d.director)].filter(Boolean))].sort(),'Todas as diretorias');
 options('managerFilter',[...new Set([...org.centers.flatMap(c=>[c.manager,...c.cells.flatMap(s=>s.managers)]),...db.flatMap(managers)].filter(Boolean))].sort(),'Todos os gestores');
 const acts=[...new Set(db.flatMap(d=>d.rows.map(r=>r.ato)))].sort();
 $('actFilters').innerHTML=acts.map(a=>`<label><input type="checkbox" data-act="${esc(a)}" ${!selected||selected.has(a)?'checked':''}> ${esc(a)}</label>`).join('');
 $('actFilters').querySelectorAll('input').forEach(i=>i.onchange=()=>{selected=new Set([...$('actFilters').querySelectorAll('input:checked')].map(x=>x.dataset.act));render()});
 $('datasets').innerHTML=db.length?'<table><thead><tr><th>Centro de Custo</th><th>Célula / abrangência</th><th>Período</th><th>Diretoria</th><th>Ações</th></tr></thead><tbody>'+db.map(d=>`<tr><td>${esc(labelCC(d))}${d.example?' · exemplo':''}</td><td>${esc(labelCell(d))}</td><td>${esc(d.month)}</td><td>${esc(d.director||'Não informada')}</td><td><button data-edit="${esc(d.id)}">Editar</button> <button data-delete="${esc(d.id)}">Excluir</button></td></tr>`).join('')+'</tbody></table>':'<p class="muted">Nenhuma importação salva.</p>';
 $('datasets').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const d=db.find(x=>x.id===b.dataset.edit);openReview(d.rows,null,d.source,null,d)});
 $('datasets').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm('Excluir esta importação? Esta ação não pode ser desfeita sem backup.'))if(persist(db.filter(d=>d.id!==b.dataset.delete)))refresh()});
 render();
}
function bar(r){return `<div class="barrow"><div class="barlabel"><span>${esc(r.label)}</span><strong>${r.total?pct(rate(r.auto,r.total)):'Sem atos'}</strong></div><div class="stack" aria-label="${esc(r.label)}: ${pct(rate(r.auto,r.total))} automatizados"><i style="width:${rate(r.auto,r.total)}%"></i><em style="width:${rate(r.manual,r.total)}%"></em></div><div class="muted" style="margin-top:4px">${fmt(r.auto)} automatizados de ${fmt(r.total)} atos</div></div>`}
function render(){
 const filtered=db.filter(d=>(!$('teamFilter').value||labelCC(d)===$('teamFilter').value)&&(!$('cellFilter').value||d.cellId===$('cellFilter').value)&&(!$('directorFilter').value||d.director===$('directorFilter').value)&&(!$('managerFilter').value||managers(d).includes($('managerFilter').value))&&(!$('monthFilter').value||d.month===$('monthFilter').value));
 const real=filtered.filter(d=>!d.example), used=real.length?real:filtered;
 const rows=used.flatMap(d=>d.rows.map(r=>({...r,team:labelCC(d),month:d.month}))).filter(r=>!selected||selected.has(r.ato));
 $('dashboard').classList.toggle('hidden',!rows.length);$('empty').classList.toggle('hidden',!!rows.length);
 $('subtitle').textContent=($('teamFilter').value||'Todos os Centros de Custo')+' · '+($('monthFilter').value||'Todos os períodos');
 $('emptyTitle').textContent=db.length?'Nenhum dado para os filtros selecionados':'Do print à conversa com os gestores';
 if(!rows.length)return;
 const t=sum(rows),a=group(rows,'ato').sort((x,y)=>rate(y.auto,y.total)-rate(x.auto,x.total));
 $('subtitle').textContent+=(used.every(d=>d.example)?' · EXEMPLO DO PRINT':'')+' · '+a.length+' tipos de ato';
 const detail=[];if($('cellFilter').value)detail.push('Célula: '+$('cellFilter').selectedOptions[0].textContent);
 if($('directorFilter').value)detail.push('Diretoria: '+$('directorFilter').value);if($('managerFilter').value)detail.push('Gestor: '+$('managerFilter').value);
 if(used.length===1){const d=used[0];detail.push(labelCell(d),'Gestor do CC: '+(d.ccManager||'Não informado'),'Diretoria: '+(d.director||'Não informada'));if(d.cellManagers?.length)detail.push('Gestores da célula: '+d.cellManagers.join(', '))}
 $('scopeInfo').textContent=(detail.length?detail.join(' · '):used.length+' importações no recorte.')+' A seleção de uma célula utiliza apenas prints vinculados a ela; consolidados do CC não são rateados.';
 $('kTotal').textContent=fmt(t.total);$('kManual').textContent=fmt(t.manual);$('kAuto').textContent=fmt(t.auto);$('kRate').textContent=t.total?pct(rate(t.auto,t.total)):'—';$('kScope').textContent=new Set(rows.map(r=>r.team)).size+' Centro(s) de Custo no recorte';$('pManual').textContent=pct(rate(t.manual,t.total))+' do total';$('pAuto').textContent=pct(rate(t.auto,t.total))+' do total';
 $('bars').innerHTML=a.map(bar).join('');$('teams').innerHTML=group(rows,'team').sort((x,y)=>rate(y.auto,y.total)-rate(x.auto,x.total)).map(bar).join('');$('months').innerHTML=group(rows,'month').sort((x,y)=>x.label.localeCompare(y.label)).map(bar).join('');
 const manual=[...a].sort((x,y)=>y.manual-x.manual),auto=[...a].sort((x,y)=>y.auto-x.auto),zero=a.filter(r=>!r.auto&&r.total),ins=[];
 if(t.total){ins.push(['Participação da automação',`${fmt(t.auto)} de ${fmt(t.total)} atos foram automatizados (${pct(rate(t.auto,t.total))}).`]);if(t.manual)ins.push(['Maior concentração manual',`${manual[0].label} reúne ${fmt(manual[0].manual)} atos manuais, equivalentes a ${pct(rate(manual[0].manual,t.manual))} do volume manual selecionado.`]);if(t.auto)ins.push(['Maior volume automatizado',`${auto[0].label} concentra ${fmt(auto[0].auto)} atos automatizados (${pct(rate(auto[0].auto,t.auto))} do volume automatizado).`]);if(zero.length)ins.push(['Atos sem automação registrada',`${zero.length} tipos de ato somam ${fmt(sum(zero).total)} ocorrências sem automação registrada neste recorte.`]);}else ins.push(['Sem volume no recorte','Os atos selecionados têm total zero. Não há base para calcular taxa de automação.']);
 $('insights').innerHTML=ins.map(([h,s])=>`<div class="insight"><strong>${esc(h)}</strong>${esc(s)}</div>`).join('');
 const calcLabel={manual:'manual',auto:'automatizado',total:'total'};
 $('detail').innerHTML=a.map(r=>`<tr><td>${esc(r.label)}${r.derived?.size?`<span class="tag calc" style="margin-left:8px" title="Um ou mais atos deste tipo tiveram valor completado por cálculo (Manual + Automatizado = Total), não extraído da imagem"><i class="dot2"></i>calculado: ${[...r.derived].map(k=>esc(calcLabel[k]||k)).join(', ')}</span>`:''}</td><td class="num cell-manual">${fmt(r.manual)}</td><td class="num cell-auto">${fmt(r.auto)}</td><td class="num">${fmt(r.total)}</td><td class="num">${r.total?pct(rate(r.manual,r.total)):'—'}</td><td class="num">${r.total?pct(rate(r.auto,r.total)):'—'}</td><td class="num">${t.total?pct(rate(r.total,t.total)):'—'}</td></tr>`).join('')+`<tr><td><strong>Total do recorte</strong></td><td class="num cell-manual">${fmt(t.manual)}</td><td class="num cell-auto">${fmt(t.auto)}</td><td class="num">${fmt(t.total)}</td><td class="num">${t.total?pct(rate(t.manual,t.total)):'—'}</td><td class="num">${t.total?pct(rate(t.auto,t.total)):'—'}</td><td class="num">${t.total?'100,00%':'—'}</td></tr>`;
}
function setCells(value=''){
 const cc=org.centers.find(c=>c.id===$('ccSelect').value);
 optionPairs('cellSelect',cc?[{id:ALL,name:'Consolidado de todo o Centro de Custo'},...cc.cells]:[],'Selecione a abrangência');
 $('cellSelect').value=value;showOrg();
}
function showOrg(){
 const cc=org.centers.find(c=>c.id===$('ccSelect').value),cell=cc?.cells.find(c=>c.id===$('cellSelect').value);
 if(!cc){$('orgInfo').innerHTML='';$('orgWarning').classList.add('hidden');return}
 const values=[['Gestor do Centro de Custo',cc.manager||'Não informado na base de clusters'],['Diretoria',cc.director||'Não informada na base de clusters'],['Gestores da célula',cell?.managers.join(', ')||($('cellSelect').value===ALL?'Não se aplica ao consolidado do CC':'Selecione uma célula')],['Cluster',cc.cluster||'Não informado'],['Vertical',cc.vertical||'Não informada']];
 $('orgInfo').innerHTML=values.map(([k,v])=>`<div><b>${esc(k)}</b>${esc(v)}</div>`).join('');
 const warnings=[];if(!cc.inCluster)warnings.push('Centro de Custo presente apenas na base de gestores: diretoria, cluster e gestor do CC não foram inferidos.');if(!cc.cells.length)warnings.push('Sem células cadastradas na base enviada. Utilize o consolidado do Centro de Custo.');if(cell?.managers.length>1)warnings.push('A base informa mais de um gestor para esta célula; todos foram preservados.');
 if($('cellSelect').value===ALL)warnings.push('Selecione o consolidado somente se o print representar todo o Centro de Custo. Ele não será somado a prints de células do mesmo CC e mês.');
 $('orgWarning').classList.toggle('hidden',!warnings.length);$('orgWarning').textContent=warnings.join(' ');
}
function openReview(rows,expected,source,img=null,existing=null){
 draft=structuredClone(rows);draftId=existing?.id||null;draftExample=!!existing?.example;imageRequired=!!img;
 optionPairs('ccSelect',org.centers,'Selecione o Centro de Custo');$('ccSelect').value=existing?.ccId||org.centers.find(c=>c.name===$('teamFilter').value)?.id||'';setCells(existing?.cellId||'');
 $('month').value=existing?.month||$('monthFilter').value||'';$('source').value=source||'Preenchimento manual';$('confirmed').checked=false;
 for(const [id,k] of [['eManual','manual'],['eAuto','auto'],['eTotal','total']])$(id).value=expected?.[k]??'';
 $('imageBox').classList.toggle('hidden',!img);$('preview').src=img||'';
 $('reviewNote').textContent='Confira todas as linhas. Selecione o Centro de Custo e a célula que correspondem ao filtro usado no BI. Os dados ainda não entraram no painel.';
 if(existing&&!existing.ccId)$('reviewNote').textContent+=' Este registro antigo ainda não possui vínculo organizacional.';
 drawReview();$('review').showModal();
}
function drawReview(){
 const calcLabel={manual:'Manual',auto:'Automatizado',total:'Total'};
 $('reviewRows').innerHTML=draft.map((r,i)=>`<tr class="${validRow(r)?'':'invalid'}"><td><input aria-label="Ato ${i+1}" class="name" data-i="${i}" data-k="ato" value="${esc(r.ato)}">${r.derived?.length?'<div class="rowCalcFlag" title="Calculado por Manual + Automatizado = Total, não extraído da imagem">⚙ Calculado: '+r.derived.map(k=>esc(calcLabel[k]||k)).join(', ')+'</div>':''}</td>${['manual','auto','total'].map(k=>`<td class="${k!=='total'?'cell-'+k:''} ${r.derived?.includes(k)?'cell-calc':''}"><input aria-label="${k} ${i+1}${r.derived?.includes(k)?' (calculado)':''}" type="number" min="0" step="1" data-i="${i}" data-k="${k}" value="${r[k]??''}"></td>`).join('')}<td><button aria-label="Excluir ato ${i+1}" data-remove="${i}">×</button></td></tr>`).join('');
 $('reviewRows').querySelectorAll('input').forEach(i=>i.oninput=()=>{const row=draft[i.dataset.i];row[i.dataset.k]=i.dataset.k==='ato'?i.value:i.value===''?null:Number(i.value);if(row.derived?.includes(i.dataset.k)){row.derived=row.derived.filter(k=>k!==i.dataset.k);i.closest('td').classList.remove('cell-calc')}i.closest('tr').classList.toggle('invalid',!validRow(row));$('confirmed').checked=false;validate()});
 $('reviewRows').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{draft.splice(+b.dataset.remove,1);$('confirmed').checked=false;drawReview()});validate();
}
function validate(){
 const problems=[];if(!draft.length)problems.push('Adicione ao menos um ato.');const invalid=draft.filter(r=>!validRow(r)).length;if(invalid)problems.push(`${invalid} linha(s) incompleta(s) ou com Manual + Auto diferente de Total.`);
 if(new Set(draft.map(r=>norm(r.ato))).size!==draft.length)problems.push('Há atos com nomes duplicados. Consolide ou corrija.');
 const totals=sum(draft.map(r=>({...r,manual:r.manual??0,auto:r.auto??0,total:r.total??0})));
 for(const [id,k] of [['eManual','manual'],['eAuto','auto'],['eTotal','total']]){const v=$(id).value,label=$(id).parentElement.firstChild.textContent.trim();if(imageRequired&&v==='')problems.push('Preencha '+label+'.');if(v!==''&&(!Number.isSafeInteger(Number(v))||Number(v)<0||Number(v)!==totals[k]))problems.push('A soma não corresponde a '+label+'.')}
 $('validation').className='note '+(problems.length?'error':'success');$('validation').textContent=problems.length?problems.join(' '):`Somas válidas: ${fmt(totals.manual)} manuais + ${fmt(totals.auto)} automatizados = ${fmt(totals.total)} atos. Confira também a fonte.`;return !problems.length;
}
$('save').onclick=()=>{
 if(!validate())return;
 const cc=org.centers.find(c=>c.id===$('ccSelect').value),cell=cc?.cells.find(c=>c.id===$('cellSelect').value),all=$('cellSelect').value===ALL;
 if(!cc||(!all&&!cell))return toast('Selecione um Centro de Custo e uma célula ou o consolidado.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test($('month').value))return toast('Informe o período.');
 if(!$('confirmed').checked)return toast('Marque a confirmação após revisar a fonte.');
 const d={id:draftId||crypto.randomUUID(),team:cc.name+(all?'':' / '+cell.name),month:$('month').value,source:$('source').value,example:draftExample,rows:draft.map(r=>({...r,ato:r.ato.trim()})),ccId:cc.id,ccName:cc.name,cellId:all?ALL:cell.id,cellName:all?'Consolidado do Centro de Custo':cell.name,ccManager:cc.manager,cellManagers:all?[]:[...cell.managers],director:cc.director,cluster:cc.cluster,vertical:cc.vertical};
 if(db.some(x=>x.id!==d.id&&overlaps(x,d)))return toast('Já existe uma importação sobreposta neste CC e mês. Não é possível somar consolidado e células, nem repetir a mesma célula. Edite a importação existente.');
 if(persist([...db.filter(x=>x.id!==d.id),d])){$('review').close();selected=null;refresh();$('teamFilter').value=d.ccName;updateCellFilter();$('cellFilter').value=d.cellId;$('monthFilter').value=d.month;$('directorFilter').value='';$('managerFilter').value='';render();toast('Importação salva com os vínculos organizacionais.');}
};
$('ccSelect').onchange=()=>{setCells();$('confirmed').checked=false};$('cellSelect').onchange=()=>{showOrg();$('confirmed').checked=false};$('month').oninput=()=>{$('confirmed').checked=false};
$('cancel').onclick=()=>$('review').close();$('addRow').onclick=()=>{draft.push({ato:'',manual:null,auto:null,total:null});$('confirmed').checked=false;drawReview()};
$('zeros').onclick=()=>{if(confirm('Calcular os campos ausentes usando Total = Manual + Automatizado? Os valores serão calculados, não lidos da imagem. Confira-os com a fonte.')){let count=0;draft.forEach(r=>{const missing=['manual','auto','total'].filter(k=>r[k]===null);if(missing.length===1){const key=missing[0],value=key==='total'?r.manual+r.auto:r.total-r[key==='manual'?'auto':'manual'];if(Number.isSafeInteger(value)&&value>=0){r[key]=value;r.derived=[...(r.derived||[]),key];count++}}});$('confirmed').checked=false;drawReview();$('reviewNote').textContent=count+' campo(s) completado(s) por cálculo, indicados na tabela. Confira nomes e números antes de confirmar.'}};
['eManual','eAuto','eTotal'].forEach(id=>$(id).oninput=()=>{$('confirmed').checked=false;validate()});
$('newManual').onclick=()=>openReview([{ato:'',manual:null,auto:null,total:null}],null,'Preenchimento manual');$('importBtn').onclick=()=>$('file').click();
async function importFile(f){
 if(!f||importing)return;if(f.size>10000000)return toast('Limite de 10 MB por arquivo.');importing=true;const btn=$('importBtn');btn.disabled=true;btn.textContent='Lendo arquivo…';
 try{
  const data=await new Promise((res,rej)=>{const fr=new FileReader;fr.onload=()=>res(fr.result.split(',')[1]);fr.onerror=rej;fr.readAsDataURL(f)});
  const response=await fetch('/import',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':token},body:JSON.stringify({name:f.name,data})});const result=await response.json();if(!response.ok)throw Error(result.error);
  if(previewURL)URL.revokeObjectURL(previewURL);previewURL=/\.(png|jpe?g|webp)$/i.test(f.name)?URL.createObjectURL(f):null;
  openReview(result.rows,result.expected,f.name,previewURL);$('reviewNote').textContent=result.note+' Selecione o Centro de Custo, a célula / abrangência e o período.';
 }catch(err){toast(err.message||'Falha na leitura. Tente novamente.')}finally{importing=false;btn.disabled=false;btn.textContent='Importar print ou planilha';$('file').value=''}
}
$('file').onchange=e=>importFile(e.target.files[0]);
document.addEventListener('paste',e=>{if($('review').open||!org.centers.length)return;const item=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(item){e.preventDefault();const f=item.getAsFile();if(f)importFile(new File([f],'print-colado.png',{type:f.type}))}});
$('example').onclick=async()=>{try{let d=db.find(d=>d.id==='sample');if(!d){d=await(await fetch('/sample')).json();if(!persist([...db,d]))return;refresh()}$('teamFilter').value=labelCC(d);updateCellFilter();$('cellFilter').value='';$('directorFilter').value='';$('managerFilter').value='';$('monthFilter').value='';selected=null;refresh()}catch{toast('Não foi possível carregar o exemplo.')}};
$('teamFilter').onchange=()=>{updateCellFilter();$('cellFilter').value='';render()};['cellFilter','directorFilter','managerFilter','monthFilter'].forEach(id=>$(id).onchange=render);
function togglePresent(){document.body.classList.toggle('present');if(document.body.classList.contains('present'))document.documentElement.requestFullscreen?.().catch(()=>{});else if(document.fullscreenElement)document.exitFullscreen?.()}
$('present').onclick=togglePresent;document.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('present')});$('print').onclick=()=>window.print();
$('backup').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='qca-atos-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('restore').onclick=()=>$('backupFile').click();$('backupFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>10000000)throw Error('Backup acima de 10 MB.');const data=JSON.parse(await f.text());if(!validDB(data))throw Error('Backup com estrutura, valores ou importações sobrepostas inválidos.');if(confirm('Substituir os dados deste navegador pelo backup selecionado?'))if(persist(data)){selected=null;refresh();toast('Backup restaurado.')}}catch(err){toast(err.message)}finally{e.target.value=''}};
function renderCatalog(){const q=norm($('orgSearch').value);const rows=[];for(const c of org.centers){for(const cell of c.cells.length?c.cells:[{name:'Não informada na base',managers:[]}]){const vals=[c.name,cell.name,c.manager||'Não informado',cell.managers.join(', ')||'Não informado',c.director||'Não informada'];if(!q||norm(vals.join(' ')).includes(q))rows.push('<tr>'+vals.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>')}}$('orgTable').innerHTML=rows.join('')||'<tr><td colspan="5">Nenhum vínculo encontrado.</td></tr>'}
$('orgSearch').oninput=renderCatalog;
async function boot(){
 $('importBtn').disabled=true;$('newManual').disabled=true;
 try{const r=await fetch('/organization');if(!r.ok)throw Error();org=await r.json();if(!Array.isArray(org.centers)||!org.centers.length)throw Error();
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');if(validDB(saved))db=saved;else toast('Dados locais inválidos. Restaure um backup válido.')}catch{toast('Não foi possível ler os dados locais.')}
  $('orgStats').textContent=`${org.stats.centers} Centros de Custo · ${org.stats.cells} vínculos de células · ${org.stats.missingDirector} CCs sem diretoria · ${org.stats.missingCells} CCs sem células. Fontes: ${org.sources.join(' e ')}. Nomes semelhantes não foram unidos automaticamente.`;
  refresh();renderCatalog();$('importBtn').disabled=false;$('newManual').disabled=false;
  const h=await(await fetch('/health')).json();$('status').textContent=h.ocr?'Leitura local de prints disponível, sem Tesseract. Anexe a tabela completa ou cole a imagem com Ctrl+V. A leitura pode levar de alguns segundos a cerca de meio minuto, dependendo do computador e da quantidade de linhas.':'Execute INSTALAR.bat desta versão para habilitar o novo leitor de prints. Não é necessário instalar Tesseract. O preenchimento manual já está disponível.';
 }catch{$('status').textContent='Não foi possível carregar a base organizacional. Feche a versão anterior e abra o INICIAR.bat desta versão.'}
}
boot();
