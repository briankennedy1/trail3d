import test from 'node:test';
import assert from 'node:assert/strict';
import {routeStartParkingLinks} from '../src/ride-access.js';

test('start flags follow the parking field while other landmarks keep their links',()=>{
  const start={name:'Route start',latitude:39.84,longitude:-120.85,url:'https://www.trailforks.com/ridelog/view/80488775/'};
  const peak={...start,name:'Buzzard Roost Ridge',url:'https://www.peakbagger.com/'};
  const parking='https://maps.app.goo.gl/dMWgUQ9zvk9EmSez5';
  assert.deepEqual(routeStartParkingLinks([start,peak],parking),[{...start,url:parking},peak]);
  assert.match(start.url,/trailforks/); // Do not mutate CMS data.
});

test('unconfigured start and trailhead flags open Google Maps coordinates',()=>{
  for(const name of ['Route start','Route start / finish','Chapman Creek Trailhead']){
    const [point]=routeStartParkingLinks([{name,latitude:39.84,longitude:-120.85,url:'https://www.trailforks.com/'}]);
    assert.equal(point.url,'https://www.google.com/maps/search/?api=1&query=39.84,-120.85');
  }
});

test('existing Google Maps place links are preserved when parking is blank',()=>{
  const point={name:'Route start',latitude:39.84,longitude:-120.85,url:'https://maps.app.goo.gl/dMWgUQ9zvk9EmSez5'};
  assert.deepEqual(routeStartParkingLinks([point],''),[point]);
});
