import test from 'node:test';
import assert from 'node:assert/strict';
import {entryForSlug,publicSlug} from '../src/entry-slugs.js';
test('public route slugs and old links resolve to the same permanent ride ID',()=>{
 const ride={id:'lower-lakes-basin-loop',slug:'lakes-basin-blue'},aliases={'earlier-name':ride.id};
 for(const url of ['lower-lakes-basin-loop','lakes-basin-blue','earlier-name'])assert.equal(entryForSlug([ride],url,aliases),ride);
 assert.equal(publicSlug(ride),'lakes-basin-blue');
 assert.equal(publicSlug({id:'other'}),'other');
 assert.equal(entryForSlug([],ride.slug,aliases),undefined);
 assert.equal(entryForSlug([ride],'toString',aliases),undefined);
});
