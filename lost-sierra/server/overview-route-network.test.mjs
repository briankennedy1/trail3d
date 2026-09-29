import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOverviewRouteNetwork,canonicalRoutePositions} from '../src/overview-route-network.js';

const path = points => points.flatMap(([x,z]) => [x,1,z]);
const straight = (from,to,step=0.025,z=0) => {
  const points=[];
  const count=Math.round(Math.abs(to-from)/step);
  for(let i=0;i<=count;i++)points.push([from+(to-from)*i/count,z]);
  return path(points);
};
const reverse = positions => {
  const result=[];
  for(let i=positions.length-3;i>=0;i-=3)result.push(...positions.slice(i,i+3));
  return result;
};
const length = run => {
  let distance=0;
  for(let i=3;i<run.positions.length;i+=3)
    distance+=Math.hypot(run.positions[i]-run.positions[i-3],run.positions[i+2]-run.positions[i-1]);
  return distance;
};

test('two and three routes share one canonical path, regardless of source direction or order',()=>{
  const forward=straight(0,.2),backward=reverse(forward);
  assert.deepEqual(canonicalRoutePositions(forward),canonicalRoutePositions(backward));
  const routes=[{id:'c',positions:backward},{id:'a',positions:forward},{id:'b',positions:backward}];
  const original=JSON.stringify(routes);
  const network=buildOverviewRouteNetwork(routes);
  assert.deepEqual(network.map(run=>run.ids),[['a','b','c']]);
  assert.ok(Math.abs(length(network[0])-.2)<1e-6);
  assert.deepEqual(buildOverviewRouteNetwork([...routes].reverse()),network);
  assert.deepEqual(buildOverviewRouteNetwork(routes.map(route=>({...route,positions:reverse(route.positions)}))),network);
  assert.equal(JSON.stringify(routes),original,'the input coordinates are unchanged');
});

test('small GPS offsets share a path; separate parallel trails stay separate',()=>{
  const a=straight(0,.3);
  const noisy=path(Array.from({length:16},(_,i)=>[i*.02,.008+(i%3-1)*.002]));
  const nearby=buildOverviewRouteNetwork([{id:'a',positions:a},{id:'b',positions:noisy}]);
  const shared=nearby.filter(run=>run.ids.length===2).reduce((sum,run)=>sum+length(run),0);
  assert.ok(shared>.25,`expected most of the 300 m route to match, got ${shared*1000} m`);
  const separate=buildOverviewRouteNetwork([{id:'a',positions:a},{id:'b',positions:straight(0,.3,.025,.02)}]);
  assert.deepEqual(separate.map(run=>run.ids),[['a'],['b']]);
});

test('a hidden middle route cannot hide a farther third route',()=>{
  const routes=[
    {id:'a',positions:straight(0,.2,.025,0)},
    {id:'b',positions:straight(0,.2,.025,.009)},
    {id:'c',positions:straight(0,.2,.025,.018)},
  ];
  const runs=buildOverviewRouteNetwork(routes);
  assert.deepEqual(runs.map(run=>run.ids),[['a','b'],['b','c']]);
  assert.ok(runs.every(run=>Math.abs(length(run)-.2)<1e-6));
  assert.ok(runs.some(run=>run.ids.includes('c')),'the third route is still drawn');
});

test('stripe phase continues through unique and shared sections of a source route',()=>{
  const routes=[{id:'a',positions:straight(0,.2)},{id:'b',positions:straight(.05,.15)}];
  const runs=buildOverviewRouteNetwork(routes).filter(run=>run.sourceId==='a').sort((a,b)=>a.phaseKm-b.phaseKm);
  assert.ok(runs.some(run=>run.ids.length===1));
  assert.ok(runs.some(run=>run.ids.length===2));
  assert.equal(runs[0].phaseKm,0);
  for(let i=1;i<runs.length;i++)
    assert.ok(Math.abs(runs[i].phaseKm-runs[i-1].phaseKm-length(runs[i-1]))<1e-6);
});

test('branches keep distinct single-route portions',()=>{
  const main=straight(0,.2);
  const branch=path([[0,0],[.025,0],[.05,0],[.075,0],[.1,0],[.1,.025],[.1,.05],[.1,.075],[.1,.1]]);
  const runs=buildOverviewRouteNetwork([{id:'main',positions:main},{id:'branch',positions:branch}]);
  const shared=runs.filter(run=>run.ids.length===2).reduce((sum,run)=>sum+length(run),0);
  assert.ok(shared>.06&&shared<.14,`shared stem should end near the fork, got ${shared*1000} m`);
  assert.ok(runs.some(run=>run.ids.join()==='main'&&length(run)>.07));
  assert.ok(runs.some(run=>run.ids.join()==='branch'&&length(run)>.07));
});

test('perpendicular crossings do not form shared paths',()=>{
  const east=straight(0,.2);
  const north=path(Array.from({length:9},(_,i)=>[.1,i*.025-.1]));
  const runs=buildOverviewRouteNetwork([{id:'east',positions:east},{id:'north',positions:north}]);
  assert.deepEqual(runs.map(run=>run.ids),[['east'],['north']]);
});

test('out-and-back portions of one route are drawn once without stripes',()=>{
  const outbound=straight(0,.2);
  const outAndBack=[...outbound,...reverse(outbound).slice(3)];
  const runs=buildOverviewRouteNetwork([{id:'loop',positions:outAndBack}]);
  assert.ok(runs.every(run=>run.ids.join()==='loop'));
  const drawn=runs.reduce((sum,run)=>sum+length(run),0);
  assert.ok(Math.abs(drawn-.2)<.02,`expected 200 m, got ${drawn*1000} m`);
});

test('network recomputes only the requested route subset',()=>{
  const shared=straight(0,.2);
  const other=straight(0,.2,.025,.1);
  const routes=[{id:'a',positions:shared},{id:'b',positions:reverse(shared)},{id:'c',positions:other}];
  assert.deepEqual(buildOverviewRouteNetwork(routes).map(run=>run.ids),[['a','b'],['c']]);
  assert.deepEqual(buildOverviewRouteNetwork(routes.filter(route=>route.id!=='a')).map(run=>run.ids),[['b'],['c']]);
});

test('nearby switchbacks within a single ride remain separate',()=>{
  const positions=[...straight(0,.2),...straight(.2,0,.025,.01)];
  const runs=buildOverviewRouteNetwork([{id:'switchbacks',positions}]);
  assert.ok(runs.reduce((sum,run)=>sum+length(run),0)>.39);
});
