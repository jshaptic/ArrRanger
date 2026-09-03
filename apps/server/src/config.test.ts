import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isLowSpace } from './config.js';

const GiB = 1024 ** 3;

/**
 * The rule behind the low-space warning.
 *
 * Pure on purpose: "is this library filling up" is a policy question, and it must give the
 * same answer in the service and in a test without a filesystem in the way.
 */
describe('isLowSpace', () => {
  const floorOnly = { bytes: 50 * GiB, percent: 0 };

  test('the byte floor is the rule that is right at every disk size', () => {
    assert.equal(isLowSpace(20 * GiB, 500 * GiB, floorOnly), true);
    assert.equal(isLowSpace(80 * GiB, 500 * GiB, floorOnly), false);
    // A 50 TB array with 80 GiB free is genuinely nearly full, and the ratio would miss it.
    assert.equal(isLowSpace(20 * GiB, 50_000 * GiB, floorOnly), true);
  });

  test('the ratio is off at zero - the default - however full the disk is', () => {
    const off = { bytes: 0, percent: 0 };
    assert.equal(isLowSpace(1, 500 * GiB, off), false);
  });

  test('the ratio fires independently of the floor when it is turned on', () => {
    const both = { bytes: 50 * GiB, percent: 10 };
    // Well over the byte floor, but only 4% of the array is left.
    assert.equal(isLowSpace(2000 * GiB, 50_000 * GiB, both), true);
    assert.equal(isLowSpace(10_000 * GiB, 50_000 * GiB, both), false);
  });

  test('an unknown or zero total is never a percentage', () => {
    const ratioOnly = { bytes: 0, percent: 10 };
    assert.equal(isLowSpace(5 * GiB, null, ratioOnly), false, 'no total, no ratio');
    assert.equal(isLowSpace(5 * GiB, 0, ratioOnly), false, 'and no division by zero');
  });

  test('a filesystem that did not answer is not reported as low', () => {
    // The same invariant the whole view runs on: unknown is never a problem.
    assert.equal(isLowSpace(null, 500 * GiB, { bytes: 50 * GiB, percent: 10 }), false);
  });
});
