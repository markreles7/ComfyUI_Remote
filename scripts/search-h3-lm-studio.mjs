import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir='tmp/lm-studio-tuning';
function run(stage,profiles) {
  if(profiles) fs.writeFileSync(`${dir}/${stage}-profiles.json`,JSON.stringify(profiles,null,2));
  const r=spawnSync(process.execPath,['scripts/tune-h3-lm-studio.mjs',stage],{stdio:'inherit',windowsHide:true});
  if(r.status!==0) throw new Error(`Stage failed: ${stage}`);
  if(stage!=='rescore') run('rescore');
}
function summary(name){return JSON.parse(fs.readFileSync(`${dir}/all-summary.json`,'utf8')).find(r=>r.name===name);}
run('rescore');
const initial=['contract3-005','contract3-015'].map(name=>summary(name));
if(initial.some(r=>r?.count!==16)) throw new Error('Complete contract3 comparisons first.');
let winner=initial.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))[0];
let settings={temperature:winner.name.endsWith('005')?.05:.15};
const steps=[];
run('nucleus',[
 {name:'nucleus1',settings:{...settings,top_p:1}},
 {name:'nucleus09',settings:{...settings,top_p:.9}},
]);
const nucleus=[summary('nucleus1'),summary('nucleus09')];
const selectedNucleus=nucleus[1].score>nucleus[0].score+.1?nucleus[1]:nucleus[0];
// Reject explicit nucleus changes if materially worse than the inherited baseline.
if(selectedNucleus.score>=winner.score-.1){winner=selectedNucleus;settings.top_p=winner.name==='nucleus1'?1:.9;}
steps.push({parameter:'top_p',candidates:nucleus,winner:winner.name,settings:{...settings}});
for(const [stage,param,value] of [['minp','min_p',0]]) {
 const name=`${stage}-neutral`;
 run(stage,[{name,settings:{...settings,[param]:value}}]);
 const candidate=summary(name);
 if(candidate.score>=winner.score-.1){winner=candidate;settings[param]=value;}
 steps.push({parameter:param,candidate,winner:winner.name,settings:{...settings}});
}
run('topk',[{name:'topk40',settings:{...settings,top_k:40}},{name:'topk80',settings:{...settings,top_k:80}}]);
const topk=[summary('topk40'),summary('topk80')];
const selectedTopk=topk[1].score>topk[0].score+.1?topk[1]:topk[0];
winner=selectedTopk;settings.top_k=winner.name==='topk40'?40:80;
steps.push({parameter:'top_k',candidates:topk,winner:winner.name,settings:{...settings},rejectedProbe:{value:0,status:400,reason:'Number must be greater than or equal to 1'}});
run('repeat',[{name:'repeat-neutral',settings:{...settings,repeat_penalty:1}}]);
const repeat=summary('repeat-neutral');
if(repeat.score>=winner.score-.1){winner=repeat;settings.repeat_penalty=1;}
steps.push({parameter:'repeat_penalty',candidate:repeat,winner:winner.name,settings:{...settings}});
// Materialize inherited standard LM Studio defaults before final validation.
// The final API request must be reviewable without relying on hidden defaults.
settings={top_p:.95,top_k:40,min_p:.05,repeat_penalty:1.1,...settings};
fs.writeFileSync(`${dir}/search-decisions.json`,JSON.stringify({settings,winner,steps},null,2));
run('final',[{name:'final',settings}]);
console.log(JSON.stringify({settings,validation:summary('final'),steps},null,2));
