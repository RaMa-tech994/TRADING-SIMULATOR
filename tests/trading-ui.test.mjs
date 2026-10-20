import test from 'node:test';
import assert from 'node:assert/strict';
import {validOrder,prepareOrder,readPending,pendingKey,submitTrade} from '../src/services/trading.mjs';
const id='11111111-1111-4111-8111-111111111111';
const order={symbol:'AAPL',side:'BUY',quantity:2,request_id:id};
function storage(){const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
const response=(o=order)=>({success:true,currency:'USD',request_id:o.request_id,replayed:false,transaction:{...o,id:'22222222-2222-4222-8222-222222222222',price:'100.00',total_amount:'200.00',executed_at:'2026-10-20T10:00:00Z'}});
function client(invoke,user='user-a'){return {auth:{getSession:async()=>({data:{session:{access_token:'jwt',user:{id:user}}}})},functions:{invoke}};}
test('rejects fractional, empty, unsupported and excessive orders',()=>{for(const fields of [{quantity:1.5},{quantity:0},{quantity:2147483648},{symbol:'FAKE'},{side:'OTHER'}])assert.equal(Boolean(validOrder({...order,...fields})),false);});
test('stores complete order and restores same ID after reload or input changes',()=>{const store=storage();assert.deepEqual(prepareOrder(store,'user-a',order,()=>id),order);assert.deepEqual(prepareOrder(store,'user-a',{symbol:'MSFT',side:'SELL',quantity:8},()=>{throw Error('must not create ID')}),order);assert.deepEqual(readPending(store,'user-a'),order);assert.equal(readPending(store,'user-b'),null);});
test('storage failure prevents creation of sendable attempt',()=>{assert.throws(()=>prepareOrder({getItem:()=>null,setItem:()=>{throw Error('blocked')}},'user-a',order,()=>id));});
test('POST contains only allowed fields and authenticated JWT',async()=>{let args;await submitTrade(client(async(...a)=>{args=a;return {data:response()}}),order,'user-a');assert.equal(args[0],'trade');assert.equal(args[1].method,'POST');assert.deepEqual(args[1].body,order);assert.equal(args[1].headers.Authorization,'Bearer jwt');});
test('SELL is submitted with exact quantity and side',async()=>{const sell={...order,side:'SELL'};await submitTrade(client(async(_name,options)=>{assert.deepEqual(options.body,sell);return {data:response(sell)}}),sell,'user-a');});
test('lost response has no automatic retry, same order can be replayed',async()=>{let calls=0;const api=client(async()=>{calls++;if(calls===1)throw Error('secret');return {data:{...response(),replayed:true}}});await assert.rejects(submitTrade(api,order,'user-a'),error=>!error.definitive&&error.message.includes('nežinoma'));assert.equal(calls,1);await submitTrade(api,order,'user-a');assert.equal(calls,2);});
test('malformed success stays uncertain',async()=>{await assert.rejects(submitTrade(client(async()=>({data:{...response(),transaction:{...response().transaction,quantity:999}}})),order,'user-a'),error=>!error.definitive);});
test('insufficient funds is a definite rejection',async()=>{await assert.rejects(submitTrade(client(async()=>({error:{context:new Response(JSON.stringify({error:{code:'INSUFFICIENT_FUNDS'}}),{status:409})}})),order,'user-a'),error=>error.definitive&&error.message.includes('Nepakanka'));});
test('different session user cannot submit old account order',async()=>{let calls=0;await assert.rejects(submitTrade(client(async()=>{calls++},'user-b'),order,'user-a'));assert.equal(calls,0);});
test('corrupt pending state is blocked rather than silently replaced',()=>{const store=storage();store.setItem(pendingKey('user-a'),'bad json');assert.throws(()=>prepareOrder(store,'user-a',order,()=>id));});
