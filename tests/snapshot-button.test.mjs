import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHistory } from '../src/services/history.mjs';
const id='11111111-1111-4111-8111-111111111111';
const snapshot={id,request_id:id,captured_at:'2026-10-20T16:00:00Z',portfolio_value:'10500.00',total_profit_loss:'500.00'};
function client(invoke,user='user-a'){return {auth:{getSession:async()=>({data:{session:{user:{id:user},access_token:'test-jwt'}}})},functions:{invoke}};}
test('POST sends only request_id, authenticated JWT, and validates success',async()=>{let args;const data=await captureHistory(client(async(...input)=>{args=input;return {data:{success:true,currency:'USD',replayed:false,snapshot}};}),id,'user-a');assert.equal(args[0],'portfolio-history');assert.equal(args[1].method,'POST');assert.deepEqual(args[1].body,{request_id:id});assert.equal(args[1].headers.Authorization,'Bearer test-jwt');assert.equal(data.snapshot.portfolio_value,'10500.00');});
test('lost response is not retried automatically; caller reuses same ID',async()=>{let calls=0;const ids=[];const api=client(async(_name,options)=>{calls++;ids.push(options.body.request_id);if(calls===1)throw Error('private detail');return {data:{success:true,currency:'USD',replayed:true,snapshot}};});await assert.rejects(captureHistory(api,id,'user-a'),/baigtis nežinoma/);assert.equal(calls,1);await captureHistory(api,id,'user-a');assert.deepEqual(ids,[id,id]);});
test('malformed success remains uncertain',async()=>{await assert.rejects(captureHistory(client(async()=>({data:{success:true,currency:'USD',replayed:false,snapshot:{...snapshot,request_id:'wrong'}}})),id,'user-a'),/nepatvirtinta/);});
test('server minute limit gives useful message',async()=>{await assert.rejects(captureHistory(client(async()=>({error:{context:new Response(JSON.stringify({error:{code:'SNAPSHOT_TOO_SOON'}}),{status:429})}})),id,'user-a'),/kartą per minutę/);});
test('account change prevents writing for a different user',async()=>{let called=false;await assert.rejects(captureHistory(client(async()=>{called=true;},'user-b'),id,'user-a'),/Sesija pasikeitė/);assert.equal(called,false);});
