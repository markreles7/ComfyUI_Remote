import fs from 'node:fs';
import { LmStudioClient } from '../src/lm-studio-client.js';
import 'dotenv/config';

const dir = process.env.H3_TUNING_OUTPUT || 'tmp/lm-studio-tuning';
fs.mkdirSync(dir, { recursive: true });
const client = new LmStudioClient({model:process.env.LM_STUDIO_MODEL, baseUrl:process.env.LM_STUDIO_URL, startServer:false});
const cases = [
  {id:'normal',text:'Due adulti parlano in una stanza. Uno dice: Ciao. L’altro ascolta e annuisce. Camera fissa, nessun altro personaggio.',duration:8,actions:['Ciao','nod']},
  {id:'i2v',mode:'image',text:'Image-to-video. Reference descritta, non allegata: due adulti seduti uno di fronte all’altro, mani sulle ginocchia. Questa posa e composizione sono il primo fotogramma esatto. Da questa posa, il primo si alza, poi il secondo lo guarda. Camera fissa, nessun nuovo opening shot.',duration:8,actions:['knee','stand'],reference:true},
  {id:'fight',text:'Due adulti: combattimento molto veloce con schivate, jab, diretti (straight), montanti (uppercut) e proiezioni (throw); nessuno vince. Solo queste mosse, nessun calcio o gomitata. Finale in parità con entrambi in piedi.',duration:12,trigger:'prfight2',actions:['jab','straight','uppercut','throw'],draw:true},
  {id:'finisher',text:'Due adulti combattono corpo a corpo: jab, poi straight, poi Subject 1 esegue una proiezione decisiva (throw) che conclude il combattimento. Subject 1 vince; Subject 2 resta a terra. Nessuna arma, nessun’altra mossa.',duration:12,trigger:'prfight2, prfin1',actions:['jab','straight','throw']},
  {id:'weapon',text:'Un adulto tiene una katana nella mano destra, alza la lama, poi la abbassa lentamente senza colpire nessuno. La mano destra e la geometria della katana restano coerenti. Nessun combattimento corpo a corpo.',duration:8,trigger:'BUNNY',actions:['katana','right']},
  {id:'magic',text:'Un adulto lancia una fireball verso un muro vuoto, poi crea uno scudo magico (magical shield). Nessuna arma fisica, nessun combattimento corpo a corpo, nessun altro personaggio.',duration:10,actions:['fireball','shield']},
  {id:'timeline',text:'Una donna adulta in una stanza: prima si alza dalla sedia, poi cammina verso la porta, poi apre la porta, infine si ferma sulla soglia. Una sola camera fissa e nessun taglio. Distribuisci queste quattro azioni nell’intera durata, in ordine, senza azioni simultanee.',duration:12,actions:['stand','walk','open','threshold'],ordered:true},
  {id:'lexical',text:'Due adulti eseguono nell’ordine jab, straight, uppercut, throw, e poi si separano senza vincitore. Mantieni esattamente queste parole inglesi. Non aggiungere o sostituire con elbow, kick, spinning attack. Camera fissa.',duration:12,trigger:'prfight2',actions:['jab','straight','uppercut','throw'],draw:true,ordered:true},
];
fs.writeFileSync(`${dir}/cases.json`,JSON.stringify(cases,null,2));
const metricNames=['instructionAdherence','userActionPreservation','referenceContinuity','timelineCoherence','hallucinationAvoidance','triggerCorrectness','outputCompleteness','unnecessaryCreativity'];
export function score(c,text,stats,max) {
  const first=text.trim().split('\n')[0].trim();
  const trigger=c.trigger ? first===c.trigger : !/prfight2|prfin1|BUNNY/.test(text);
  const detail=text.split(/detailed_description\s*:/i)[1]?.split(/overall_soundscape\s*:/i)[0]||text;
  const actionPatterns=c.actions.map(a=>c.id==='timeline' ? ({stand:/\b(?:stand(?:s|ing)?(?:\s+up)?|ris(?:e|es|ing))\b/i,walk:/\bwalk(?:s|ing)?\b/i,open:/\bopens?\s+(?:the\s+)?door\b|\b(?:pulls?|pushes?)\s+(?:the\s+)?door\s+open\b/i,threshold:/\bthreshold\b/i}[a]) : a==='throw' ? /\b(?:a|the|hip|shoulder|wrestling|decisive|clean|controlled|powerful)\s+throw\b|\bthrow\s+(?:of|that|motion|completes|executed)|\bthrow(?:s|n|ing)?\s+<Subject/i : new RegExp(`\\b${a}\\w*`,'i'));
  const action=actionPatterns.filter(p=>p.test(detail)).length/c.actions.length;
  const positions=actionPatterns.map(p=>detail.search(p));
  const actionOrder=!c.ordered||positions.every((p,i)=>p>=0&&(!i||p>positions[i-1]));
  const times=[...detail.matchAll(/(?:At\s+)?(\d{2}):(\d{2})\.(\d{3})/gi)].map(m=>+m[1]*60 + +m[2] + +m[3]/1000);
  const timeline=times.length>=2 && times.every((t,i)=>t<=c.duration && (!i||t>=times[i-1])) && times.at(-1)>=c.duration*.9;
  const forbidden=Boolean(c.trigger?.startsWith('prfight2'))&&/\b(?:kicks?|elbow strikes?|spinning attack|hooks?|roundhouse|headbutt)\b/i.test(detail.replace(/[^.!?]*(?:no |without |avoid |never |not )[^.!?]*[.!?]/gi,''));
  const fields=['subject_definitions','summary','retention_analysis','detailed_description','overall_soundscape','non_diegetic_music'];
  const values=Object.fromEntries(fields.map((s,i)=>{const after=text.split(s+':')[1];const body=i===fields.length-1?after:after?.split(new RegExp(fields.slice(i+1).join('|')))[0];return [s,body?.replace(/^\s*:|\[reference generation\]/g,'').trim()];}));
  const complete=fields.every(s=>Boolean(values[s])) && stats.total_output_tokens<max;
  const draw=!c.draw||/draw|stalemate|neither.*win|no winner|without.*winner|neither.*victor|even.*stance|balanced(?:\s+\w+){0,3}\s+stance|evenly matched/i.test(text);
  const reference=!c.reference||(/knee/i.test(detail)&&/start|open|00:00.000/i.test(detail));
  const inventedReference=!c.reference&&/<Picture\s+\d+>/i.test(text);
  const scores=[(trigger+complete+draw+actionOrder)/4*10,action*10,reference?10:0,timeline&&actionOrder?10:0,forbidden||inventedReference?0:10,trigger?10:0,complete?10:0,forbidden?0:10];
  const weights=[3,3,1,1,3,3,1,1];
  return {metrics:Object.fromEntries(metricNames.map((n,i)=>[n,scores[i]])),weighted:scores.reduce((a,v,i)=>a+v*weights[i],0)/16,flags:{trigger,complete,draw,reference,timeline,actionOrder,forbidden,inventedReference},times};
}
async function main() {
const stage=process.argv[2]||'temperature';
if(stage==='rescore') {
 for(const file of fs.readdirSync(dir).filter(f=>/^(?:baseline|temp|contract|nucleus|minp|topk|repeat|final)/.test(f)&&f.endsWith('.json')&&!f.includes('summary'))) {
  const r=JSON.parse(fs.readFileSync(`${dir}/${file}`,'utf8'));
  if(!r.response) continue;
  const c=cases.find(c=>c.id===r.case);
  r.score=score(c,r.response.output.filter(o=>o.type==='message').map(o=>o.content).join('\n'),r.response.stats,r.request.max_output_tokens);
  fs.writeFileSync(`${dir}/${file}`,JSON.stringify(r,null,2));
 }
 const rows=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8'))).filter(r=>r.response);
 const profiles=[...new Set(rows.map(r=>r.profile))];
 const report=profiles.map(name=>{const p=rows.filter(r=>r.profile===name);return {name,count:p.length,score:p.reduce((s,r)=>s+r.score.weighted,0)/p.length,metrics:Object.fromEntries(metricNames.map(n=>[n,p.reduce((s,r)=>s+r.score.metrics[n],0)/p.length])),meanMs:p.reduce((s,r)=>s+r.elapsedMs,0)/p.length,maxInput:Math.max(...p.map(r=>r.response.stats.input_tokens)),maxOutput:Math.max(...p.map(r=>r.response.stats.total_output_tokens))};});
 fs.writeFileSync(`${dir}/all-summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
}
const profiles= stage==='temperature' ? [{name:'baseline',settings:{}},{name:'temp005',settings:{temperature:.05}},{name:'temp025',settings:{temperature:.25}}]
 : fs.existsSync(`${dir}/${stage}-profiles.json`) ? JSON.parse(fs.readFileSync(`${dir}/${stage}-profiles.json`,'utf8'))
 : stage==='final' ? [{name:'final',settings:JSON.parse(fs.readFileSync('config/lm-studio-h3-inference.json','utf8')).sampling}]
 : (()=>{throw new Error(`Missing ${stage}-profiles.json; use final to validate the installed profile.`);})();
const models=await client.models();fs.writeFileSync(`${dir}/models.json`,JSON.stringify(models,null,2));
const loaded=await client.loadModel(false,client.model,{contextLength:16384});
fs.writeFileSync(`${dir}/loaded.json`,JSON.stringify(loaded,null,2));
fs.writeFileSync(`${dir}/loaded-models.json`,JSON.stringify(await client.models(),null,2));
const rawRequest=client.request.bind(client);
client.loadModel=async()=>loaded;
client.unload=async()=>{};
const records=[];
try {
 for(const profile of profiles) for(let repeat=0;repeat<2;repeat++) for(const c of cases) {
  const file=`${dir}/${profile.name}-${repeat}-${c.id}.json`;
  if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file,'utf8'));r.score=score(c,r.response.output.filter(o=>o.type==='message').map(o=>o.content).join('\n'),r.response.stats,r.request.max_output_tokens);fs.writeFileSync(file,JSON.stringify(r,null,2));records.push(r);continue;}
  let request,response;
  client.request=async(path,options,timeout)=>{
   request=JSON.parse(options.body); Object.assign(request,profile.settings);
   response=await rawRequest(path,{...options,body:JSON.stringify(request)},timeout);
   throw new Error('TUNING_FIRST_DRAFT_CAPTURED');
  };
  const begin=Date.now();
  let result;
  try { result=await client.enhance({...c,target:'minimax_h3'}); }
  catch(error) { if(error.message!=='TUNING_FIRST_DRAFT_CAPTURED') throw error; }
  const raw=response.output.filter(o=>o.type==='message').map(o=>o.content).join('\n');
  const record={profile:profile.name,repeat,case:c.id,request,response,result,elapsedMs:Date.now()-begin,score:score(c,raw,response.stats,request.max_output_tokens)};
  fs.writeFileSync(file,JSON.stringify(record,null,2));records.push(record);
  console.log(JSON.stringify({profile:profile.name,repeat,case:c.id,score:record.score.weighted,flags:record.score.flags,tokens:response.stats,elapsedMs:record.elapsedMs}));
 }
} finally { await rawRequest('/api/v1/models/unload',{method:'POST',body:JSON.stringify({instance_id:loaded.instanceId})},60000); }
const summary=profiles.map(p=>{const rows=records.filter(r=>r.profile===p.name);return {name:p.name,settings:p.settings,count:rows.length,score:rows.reduce((s,r)=>s+r.score.weighted,0)/rows.length,metrics:Object.fromEntries(metricNames.map(n=>[n,rows.reduce((s,r)=>s+r.score.metrics[n],0)/rows.length])),meanMs:rows.reduce((s,r)=>s+r.elapsedMs,0)/rows.length,maxInput:Math.max(...rows.map(r=>r.response.stats.input_tokens)),maxOutput:Math.max(...rows.map(r=>r.response.stats.total_output_tokens))};});
fs.writeFileSync(`${dir}/${stage}-summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
await main();
