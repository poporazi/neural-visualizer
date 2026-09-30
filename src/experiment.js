import { InputError, LOGICAL_FUNCTIONS, Neuron, Threshold, enumerateBinaryInputs, formatNumber } from './domain.js';

export class ValidationResult {
  constructor({ status, mismatches, range, explanation }) {
    this.status = status;
    this.mismatches = mismatches;
    this.range = range;
    this.explanation = explanation;
  }
}

function permittedThresholdRange(rows) {
  const zeroClassScores = rows.filter((row) => row.expected === 0).map((row) => row.sum);
  const oneClassScores = rows.filter((row) => row.expected === 1).map((row) => row.sum);
  if (!zeroClassScores.length || !oneClassScores.length) return null;
  return { lower: Math.max(...zeroClassScores), upper: Math.min(...oneClassScores), lowerInclusive: false, upperInclusive: true };
}

export class Experiment {
  constructor({ inputCount, functionId, threshold, weights, bias = 0, mode = 'lab1' }) {
    if (!Number.isInteger(inputCount) || inputCount < 2 || inputCount > 5) throw new InputError('Визуализатор поддерживает от 2 до 5 входов.');
    const logicalFunction = LOGICAL_FUNCTIONS[functionId];
    if (!logicalFunction || functionId === 'XOR') throw new InputError('Выберите AND или OR для лабораторного эксперимента.');
    if (!Array.isArray(weights) || weights.length !== inputCount) throw new InputError('Нужно задать отдельный вес для каждого входа.');

    this.inputCount = inputCount;
    this.function = logicalFunction;
    this.mode = mode;
    this.neuron = new Neuron({ weights, bias, threshold, activation: Threshold });
    this.rows = enumerateBinaryInputs(inputCount).map((inputs, index) => {
      const { sum, output } = this.neuron.calculate(inputs);
      const expected = logicalFunction.calculate(inputs);
      return { index, inputs, sum, output, expected, matches: output === expected };
    });
    const mismatches = this.rows.filter((row) => !row.matches);
    const range = permittedThresholdRange(this.rows);
    const status = mismatches.length === 0 ? 'matched' : 'mismatch';
    const explanation = status === 'matched'
      ? `Все ${this.rows.length} комбинации совпадают с эталоном ${functionId}.`
      : this.describeMismatch(mismatches.length, range);
    this.validation = new ValidationResult({ status, mismatches: mismatches.length, range, explanation });
    this.geometry = {
      inputCount,
      threshold,
      minScore: Math.min(...this.rows.map((row) => row.sum)),
      maxScore: Math.max(...this.rows.map((row) => row.sum)),
      rows: this.rows,
      weights: [...weights],
      bias,
      boundaryCrossesBinaryPoints: this.rows.some((row) => Math.abs(row.sum - threshold) < 1e-10),
    };
  }

  describeMismatch(count, range) {
    const θ = formatNumber(this.neuron.threshold);
    let condition;
    if (this.mode === 'lab1' && this.function.id === 'AND') {
      condition = `${this.inputCount - 1} < θ ≤ ${this.inputCount}`;
    } else if (this.mode === 'lab1' && this.function.id === 'OR') {
      condition = '0 < θ ≤ 1';
    } else if (range && range.lower < range.upper) {
      condition = `${formatNumber(range.lower)} < θ ≤ ${formatNumber(range.upper)}`;
    } else {
      condition = 'при этих весах эталон не разделяется одним порогом';
    }
    return `Нейрон не реализует ${this.function.id} при θ = ${θ}: ${count} ${countWord(count)}. Для этого эксперимента требуется ${condition}.`;
  }
}

export function countWord(count) {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'несовпадений';
  const mod10 = count % 10;
  if (mod10 === 1) return 'несовпадение';
  if (mod10 >= 2 && mod10 <= 4) return 'несовпадения';
  return 'несовпадений';
}

export function buildExperiment(config) {
  return new Experiment(config);
}

/** Two manual, non-training parameter examples for each Lab 2 logic task. */
export function lab2Preset(functionId, inputCount, variant = 0) {
  if (!Number.isInteger(inputCount) || inputCount < 2 || inputCount > 5 || ![0, 1].includes(variant)) {
    throw new InputError('Неизвестный пример параметров ЛР2.');
  }
  if (functionId === 'AND' && variant === 0) return { weights: Array(inputCount).fill(.6), bias: -(inputCount - 1) * .6 - .3, threshold: 0 };
  if (functionId === 'AND') return { weights: Array(inputCount).fill(1), bias: -(inputCount - .5), threshold: 0 };
  if (functionId === 'OR' && variant === 0) return { weights: Array(inputCount).fill(1.5), bias: -1, threshold: 0 };
  if (functionId === 'OR' && variant === 1) return { weights: Array(inputCount).fill(1), bias: -.5, threshold: 0 };
  throw new InputError('Для лабораторного режима доступны AND и OR.');
}
