import test from 'node:test';
import assert from 'node:assert/strict';
import {groupRideEntries,familyOptions} from '../src/ride-families.js';
import {validateEntry} from './store.mjs';
const hard={id:'mt-elwell',kind:'ride',name:'Mt Elwell',area:'Lakes Basin',status:'published',coordinates:{lat:39.76,lng:-120.62},rideFamily:{id:'mt-elwell',name:'Mt. Elwell',option:'The Hard Way',order:0},shuttle:{enabled:false}};
const easy={...hard,id:'mt-elwell-not-so-easy',rideFamily:{...hard.rideFamily,option:'The Not So Easy Way',order:1}};
test('independent routes group into one family without merging their ride modes',()=>{
 const standalone={...hard,id:'beckwourth',name:'Beckwourth',rideFamily:null};
 const groups=groupRideEntries([easy,standalone,hard]);
 assert.equal(groups.length,2);assert.deepEqual(groups[0].entries.map(e=>e.id),[hard.id,easy.id]);
 assert.equal(groups[0].name,'Mt. Elwell');assert.equal(groups[0].entries[0].shuttle,hard.shuttle);
 assert.deepEqual(familyOptions(hard,[hard,{...easy,status:'draft'},standalone]),[hard]);
 assert.deepEqual(familyOptions(standalone,[hard,standalone]),[]);
 assert.deepEqual(groupRideEntries([easy])[0].entries,[easy]);
});
test('CMS validates and preserves route hierarchy, and allows removing it',()=>{
 assert.deepEqual(validateEntry(hard).rideFamily,hard.rideFamily);
 assert.equal(validateEntry({...hard,rideFamily:null}).rideFamily,null);
 for(const rideFamily of [{...hard.rideFamily,id:'bad/id'},{...hard.rideFamily,option:''},{...hard.rideFamily,order:-1}])assert.throws(()=>validateEntry({...hard,rideFamily}));
});
