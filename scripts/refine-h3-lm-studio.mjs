import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir='tmp/lm-studio-tuning';
const decision=JSON.parse(fs.readFileSync(`${dir}/search-decisions.json`,'utf8'));
function run(stage,profiles){
 if(profiles) fs.writeFileSync(`${dir}/${stage}-profiles.json`,JSON.stringify(profiles,null,2));
 const r=spawnSync(process.execPath,['scripts/tune-h3-lm-studio.mjs',stage],{stdio:'inherit',windowsHide:true});
 if(r.status!==0)throw new Error(`Stage failed: ${stage}`);
}
function summary(name){return JSON.parse(fs.readFileSync(`${dir}/all-summary.json`,'utf8')).find(r=>r.name===name);}
run('rescore');
let winner=summary('final');
if(winner?.count!==16)throw new Error('Complete final validation first.');
let settings={...decision.settings};
const steps=[];
for(const [stage,name,param,value] of [['repeat-low','repeat-low','repeat_penalty',1.05],['nucleus-refined','final-nucleus09','top_p',.9]]){
 const candidateSettings={...settings,[param]:value};
 run(stage,[{name,settings:candidateSettings}]);run('rescore');
 const candidate=summary(name);
 const accept=param==='repeat_penalty' ? candidate.score>=winner.score-.1 : candidate.score>winner.score+.1;
 if(accept){winner=candidate;settings=candidateSettings;}
 steps.push({parameter:param,candidate,accepted:accept,settings:{...settings}});
}
decision.refinement=steps;decision.settings=settings;decision.validationProfile=winner.name;decision.validatedWinner=winner;
fs.writeFileSync(`${dir}/search-decisions.json`,JSON.stringify(decision,null,2));
console.log(JSON.stringify({settings,winner,steps},null,2));
