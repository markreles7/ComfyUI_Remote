import fs from 'node:fs';
import 'dotenv/config';
import { LmStudioClient } from '../src/lm-studio-client.js';
const trace=[];
const client=new LmStudioClient({model:process.env.LM_STUDIO_MODEL,baseUrl:process.env.LM_STUDIO_URL,startServer:false,
 fetchImpl:async(url,options)=>{
  const response=await fetch(url,options);
  const request=options.body?JSON.parse(options.body):null;
  const payload=await response.clone().json();
  trace.push({path:new URL(url).pathname,request,payload});return response;
 }});
try{
 const result=await client.enhance({target:'minimax_h3',duration:12,mode:'text',plaguekindStage:'final',
  text:'Una donna adulta è seduta in una stanza. Prima si alza, poi cammina verso la porta chiusa, poi apre la porta, infine si ferma sulla soglia. Un solo shot, camera fissa, nessun altro evento o personaggio, nessun dialogo, nessuna musica. Durata 12 secondi. Usa tutte le sei sezioni H3 con contenuto completo.'});
 fs.writeFileSync('tmp/lm-studio-tuning/complex-smoke.json',JSON.stringify({result,trace},null,2));
 const load=trace.find(t=>t.path==='/api/v1/models/load');
 const chats=trace.filter(t=>t.path==='/api/v1/chat');
 if(load?.request.context_length!==32768)throw new Error('Expected 32K final context.');
 if(chats.some(t=>t.request.max_output_tokens!==4096))throw new Error('Expected 4096 final output budget.');
 if(chats.some(t=>t.payload.stats?.total_output_tokens>=4096))throw new Error('Final output reached its cap.');
 console.log(JSON.stringify({context:load.request.context_length,chats:chats.length,outputTokens:chats.map(t=>t.payload.stats?.total_output_tokens),model:result.modelKey,unloadError:result.unloadError}));
}catch(error){fs.writeFileSync('tmp/lm-studio-tuning/complex-smoke.json',JSON.stringify({error:error.message,trace},null,2));throw error;}
