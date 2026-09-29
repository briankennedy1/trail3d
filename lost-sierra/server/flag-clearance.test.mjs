import test from 'node:test';
import assert from 'node:assert/strict';
import {flagClearanceHeight} from '../../src/flag-clearance.ts';

test('flag labels rise over slopes and intervening terrain without lifting flat-ground flags',()=>{
 const anchor={x:0,y:0,z:0},toward={x:0,y:.6,z:.8};
 const flat=flagClearanceHeight(anchor,6,1.97,0,toward,()=>0,20,.2);
 assert.equal(flat,3.2);
 const slope=flagClearanceHeight(anchor,6,1.97,0,toward,(x,z)=>z>=0&&z<1?x*2:0,20,.2);
 assert.ok(slope>14,'The full banner clears steep ground beneath its far end');
 const ridge=flagClearanceHeight(anchor,6,1.97,0,toward,(_,z)=>z>4&&z<6?12:0,20,.2);
 assert.ok(ridge>10,'A foreground ridge must not hide the banner');
 const overhead=flagClearanceHeight(anchor,6,1.97,0,{x:0,y:1,z:0},()=>0,20,.2);
 assert.equal(overhead,3.2);
});
