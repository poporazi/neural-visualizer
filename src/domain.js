/** Domain types for a binary McCulloch–Pitts neuron. UI code lives in app.js. */
export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}

export class ActivationFunction {
  constructor({ id, name, formula, calculate }) {
    this.id = id;
    this.name = name;
    this.formula = formula;
    this.calculate = calculate;
  }
}

export const Threshold = new ActivationFunction({
  id: 'threshold',
  name: 'Пороговая функция',
  formula: 'y = 1 при S ≥ θ; y = 0 при S < θ',
  calculate: (sum, threshold) => Number(sum >= threshold),
});

export class Neuron {
  constructor({ weights, bias = 0, activation = Threshold, threshold }) {
    if (!Array.isArray(weights) || weights.length === 0) throw new InputError('Нужен хотя бы один вес.');
    if (!weights.every(Number.isFinite)) throw new InputError('Каждый вес должен быть конечным числом.');
    if (!Number.isFinite(bias)) throw new InputError('Bias должен быть конечным числом.');
    if (!Number.isFinite(threshold)) throw new InputError('Порог θ должен быть конечным числом.');
    this.weights = [...weights];
    this.bias = bias;
    this.activation = activation;
    this.threshold = threshold;
  }

  calculate(inputs) {
    if (!Array.isArray(inputs) || inputs.length !== this.weights.length) throw new InputError('Количество входов не совпадает с количеством весов.');
    if (!inputs.every((value) => value === 0 || value === 1)) throw new InputError('Каждый вход должен быть равен 0 или 1.');
    const sum = inputs.reduce((total, value, index) => total + this.weights[index] * value, this.bias);
    if (!Number.isFinite(sum)) throw new InputError('Взвешенная сумма вышла за диапазон конечных чисел.');
    return { sum, output: this.activation.calculate(sum, this.threshold) };
  }
}

export class LogicalFunction {
  constructor(id, label, calculate) {
    this.id = id;
    this.label = label;
    this.calculate = calculate;
  }
}

export const LOGICAL_FUNCTIONS = Object.freeze({
  AND: new LogicalFunction('AND', 'AND', (inputs) => Number(inputs.every((value) => value === 1))),
  OR: new LogicalFunction('OR', 'OR', (inputs) => Number(inputs.some((value) => value === 1))),
  XOR: new LogicalFunction('XOR', 'XOR', (inputs) => Number(inputs.reduce((sum, value) => sum + value, 0) % 2 === 1)),
});

export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(value);
}

export function parseFiniteNumber(raw, label) {
  const text = String(raw).trim();
  const normalized = text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text;
  if (text === '' || !Number.isFinite(Number(normalized))) {
    throw new InputError(`${label}: введите конечное число.`);
  }
  return Number(normalized);
}

export function enumerateBinaryInputs(inputCount) {
  if (!Number.isInteger(inputCount) || inputCount < 1 || inputCount > 12) throw new InputError('Количество входов должно быть целым числом от 1 до 12.');
  return Array.from({ length: 2 ** inputCount }, (_, index) =>
    Array.from({ length: inputCount }, (_, bit) => (index >> (inputCount - bit - 1)) & 1));
}
