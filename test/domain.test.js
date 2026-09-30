import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, Neuron, LOGICAL_FUNCTIONS, enumerateBinaryInputs, parseFiniteNumber } from '../src/domain.js';
import { buildExperiment, lab2Preset } from '../src/experiment.js';
import { clipThresholdLine } from '../src/geometry.js';

const unitExperiment = (functionId, n, threshold) => buildExperiment({
  inputCount: n,
  functionId,
  threshold,
  weights: Array(n).fill(1),
  bias: 0,
  mode: 'lab1',
});

test('full binary enumeration yields exactly 2^n unique vectors', () => {
  for (let n = 2; n <= 5; n += 1) {
    const inputs = enumerateBinaryInputs(n);
    assert.equal(inputs.length, 2 ** n);
    assert.equal(new Set(inputs.map((row) => row.join(''))).size, 2 ** n);
    assert.ok(inputs.every((row) => row.length === n && row.every((bit) => bit === 0 || bit === 1)));
  }
});

test('AND/OR boundary inclusion follows S >= theta', () => {
  assert.equal(unitExperiment('AND', 2, 1).validation.mismatches, 2, 'AND excludes theta=1');
  assert.equal(unitExperiment('AND', 2, 1.00001).validation.mismatches, 0);
  assert.equal(unitExperiment('AND', 2, 2).validation.mismatches, 0, 'AND includes theta=n');
  assert.equal(unitExperiment('AND', 2, 2.01).validation.mismatches, 1);
  assert.equal(unitExperiment('OR', 2, 0).validation.mismatches, 1, 'OR excludes theta=0');
  assert.equal(unitExperiment('OR', 2, 0.5).validation.mismatches, 0);
  assert.equal(unitExperiment('OR', 2, 1).validation.mismatches, 0, 'OR includes theta=1');
  assert.equal(unitExperiment('OR', 2, 1.01).validation.mismatches, 2);
});

test('generalized threshold ranges hold for n=2 and n=3', () => {
  for (const n of [2, 3]) {
    const and = unitExperiment('AND', n, n);
    assert.deepEqual(and.validation.range, { lower: n - 1, upper: n, lowerInclusive: false, upperInclusive: true });
    const or = unitExperiment('OR', n, 1);
    assert.deepEqual(or.validation.range, { lower: 0, upper: 1, lowerInclusive: false, upperInclusive: true });
  }
});

test('fractional, negative, and above-range thresholds are computed without clamping', () => {
  const fractional = unitExperiment('AND', 2, 1.5);
  assert.equal(fractional.validation.status, 'matched');
  const negative = unitExperiment('OR', 2, -0.25);
  assert.equal(negative.validation.status, 'mismatch');
  assert.ok(negative.rows.every((row) => row.output === 1));
  const above = unitExperiment('AND', 2, 3);
  assert.equal(above.validation.status, 'mismatch');
  assert.ok(above.rows.every((row) => row.output === 0));
});

test('input parser accepts decimal comma and rejects blank, NaN, and infinities', () => {
  assert.equal(parseFiniteNumber('1,25', 'θ'), 1.25);
  for (const invalid of ['', 'NaN', 'Infinity', '-Infinity', 'abc']) {
    assert.throws(() => parseFiniteNumber(invalid, 'θ'), InputError);
  }
  assert.throws(() => new Neuron({ weights: [1], threshold: Number.NaN }), InputError);
  assert.throws(() => new Neuron({ weights: [Number.POSITIVE_INFINITY], threshold: 1 }), InputError);
});

test('neuron validates binary input and keeps reference logic outside the model', () => {
  const neuron = new Neuron({ weights: [1, 1], threshold: 1 });
  assert.deepEqual(neuron.calculate([1, 0]), { sum: 1, output: 1 });
  assert.throws(() => neuron.calculate([0, 2]), InputError);
  assert.equal(LOGICAL_FUNCTIONS.AND.calculate([1, 0]), 0);
  assert.equal(LOGICAL_FUNCTIONS.OR.calculate([1, 0]), 1);
});

test('weighted mode computes arbitrary weights and optional bias independently', () => {
  const and = buildExperiment({ inputCount: 2, functionId: 'AND', threshold: 0, weights: [.6, .6], bias: -.9, mode: 'lab2' });
  assert.equal(and.validation.status, 'matched');
  and.rows.forEach((row, index) => assert.ok(Math.abs(row.sum - [-.9, -.3, -.3, .3][index]) < 1e-12));
  const or = buildExperiment({ inputCount: 2, functionId: 'OR', threshold: 0, weights: [1.5, 1.5], bias: -1, mode: 'lab2' });
  assert.equal(or.validation.status, 'matched');
  or.rows.forEach((row, index) => assert.ok(Math.abs(row.sum - [-1, .5, .5, 2][index]) < 1e-12));
  assert.ok(Math.abs(and.validation.range.lower - -.3) < 1e-12);
  assert.ok(Math.abs(and.validation.range.upper - .3) < 1e-12);
  assert.equal(and.validation.range.lowerInclusive, false);
  assert.equal(and.validation.range.upperInclusive, true);
});

test('both documented manual parameter examples implement AND and OR for n=2 and n=3', () => {
  for (const n of [2, 3]) {
    for (const functionId of ['AND', 'OR']) {
      for (const variant of [0, 1]) {
        const preset = lab2Preset(functionId, n, variant);
        const experiment = buildExperiment({ inputCount: n, functionId, ...preset, mode: 'lab2' });
        assert.equal(experiment.validation.status, 'matched', `${functionId}, variant ${variant}, n=${n}`);
      }
    }
  }
});

test('XOR has no feasible single threshold interval', () => {
  const rows = enumerateBinaryInputs(2).map((inputs) => ({ inputs, expected: LOGICAL_FUNCTIONS.XOR.calculate(inputs) }));
  const negatives = rows.filter((row) => row.expected === 0).map((row) => row.inputs.reduce((sum, value) => sum + value, 0));
  const positives = rows.filter((row) => row.expected === 1).map((row) => row.inputs.reduce((sum, value) => sum + value, 0));
  assert.ok(Math.max(...negatives) >= Math.min(...positives));
  assert.deepEqual(rows.map((row) => row.expected), [0, 1, 1, 0]);
});

test('each UI view receives one shared experiment with complete row and geometry data', () => {
  const experiment = unitExperiment('OR', 3, 1);
  assert.equal(experiment.rows.length, 8);
  assert.equal(experiment.geometry.rows, experiment.rows);
  assert.equal(experiment.validation.mismatches, experiment.rows.filter((row) => !row.matches).length);
  assert.ok(experiment.rows.every((row) => Number.isFinite(row.sum) && (row.output === 0 || row.output === 1)));
});

test('2D threshold line stays visible at and around the binary-square boundaries', () => {
  const atTwo = clipThresholdLine(1, 1, 2);
  assert.equal(atTwo.points.length, 2);
  assert.deepEqual(atTwo.points, [[1.25, .75], [.75, 1.25]]);
  const atOne = clipThresholdLine(1, 1, 1);
  assert.deepEqual(atOne.points, [[-.25, 1.25], [1.25, -.25]]);
  const atZero = clipThresholdLine(1, 1, 0);
  assert.deepEqual(atZero.points, [[-.25, .25], [.25, -.25]]);
  assert.equal(clipThresholdLine(1, 1, 4).points.length, 0);
  assert.equal(clipThresholdLine(0, 0, 0).degenerate, true);
});
