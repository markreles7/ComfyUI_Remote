import fs from 'node:fs';
process.env.HOST='127.0.0.1';
process.env.PORT='3001';
process.env.LM_STUDIO_START_SERVER='false';
const url='http://127.0.0.1:3001';
try {
 await import('../src/server.js');
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){
  try{const r=await fetch(`${url}/api/config`);if(r.ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw new Error('Isolated webapp did not start.');
 const form=new FormData();
 form.set('target','minimax_h3');form.set('duration','8');form.set('mode','text');
 form.set('text','Un adulto tiene una katana nella mano destra, alza la lama e poi la abbassa lentamente, senza colpire nessuno. Camera fissa. Nessun combattimento corpo a corpo. Il video dura esattamente 8 secondi.');
 const response=await fetch(`${url}/api/prompt-assistant/enhance`,{method:'POST',body:form,signal:AbortSignal.timeout(300000)});
 const payload=await response.json();
 fs.writeFileSync('tmp/lm-studio-tuning/webapp-smoke.json',JSON.stringify({status:response.status,payload},null,2));
 if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
 if(!payload.prompt?.startsWith('BUNNY\n'))throw new Error('Weapon trigger missing from webapp result.');
 if(!payload.cleanup?.lmStudioModelUnloaded)throw new Error('Model cleanup failed.');
 console.log(JSON.stringify({status:response.status,model:payload.modelKey,trigger:payload.prompt.split('\n')[0],cleanup:payload.cleanup}));
 process.exitCode=0;
}catch(error){console.error(error);process.exitCode=1;}
// This process owns the isolated test server; leave the existing webapp untouched.
process.exit(process.exitCode||0);
