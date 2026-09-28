import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrace, sharedStickPoints } from '../src/route-trace.ts';

const points = [[0, 0], [10, 0], [20, 0], [30, 0], [20, 0], [10, 0], [0, 0]];
const distances = [0, 10, 20, 30, 40, 50, 60];
const shared = sharedStickPoints(points);

test('recognizes the shared stick and follows outward pointer movement', () => {
  assert.equal(shared, 3);
  const result = resolveTrace(0, 0.5, distances, shared, 1, null, 8);
  assert.equal(result.leg, 'outbound');
  assert.equal(result.progress, 5 / 60);
});

test('follows inward pointer movement on the same geometry', () => {
  const result = resolveTrace(0, 0.5, distances, shared, 0, null, -8);
  assert.equal(result.leg, 'return');
  assert.equal(result.progress, 55 / 60);
});

test('keeps the selected leg while tracing backward, then resets on the loop', () => {
  const reverse = resolveTrace(1, 0.5, distances, shared, 0.1, 'outbound', -8);
  assert.equal(reverse.progress, 15 / 60);
  assert.equal(reverse.leg, 'outbound');
  assert.deepEqual(resolveTrace(2, 0.5, distances, shared, reverse.progress, reverse.leg, 8),
    { progress: 25 / 60, leg: null });
});

test('mirrored return segments preserve their actual ride distance', () => {
  const result = resolveTrace(5, 0.5, distances, shared, 1, 'return', -8);
  assert.equal(result.progress, 55 / 60);
});

test('a new outward trace at the trailhead can switch from the return leg', () => {
  const result = resolveTrace(0, 0.2, distances, shared, 0.95, 'return', 12);
  assert.equal(result.leg, 'outbound');
  assert.equal(result.progress, 2 / 60);
});
