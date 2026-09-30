import { InputError, enumerateBinaryInputs, formatNumber, parseFiniteNumber } from './domain.js';
import { buildExperiment, lab2Preset } from './experiment.js';
import { clipThresholdLine } from './geometry.js';

const $ = (selector) => document.querySelector(selector);
const functionSelect = $('#functionSelect');
const countSelect = $('#inputCount');
const countSlider = $('#inputCountSlider');
const thresholdInput = $('#thresholdInput');
const thresholdSlider = $('#thresholdSlider');
const weightedControls = $('#weightedControls');
const weightInputs = $('#weightInputs');
const biasEnabled = $('#biasEnabled');
const biasInput = $('#biasInput');
const biasSlider = $('#biasSlider');
let mode = 'lab1';
let weightValues = [1, 1];
let biasValue = 0;
let presetVariant = 0;
let selectedIndex = 0;
let latestExperiment = null;

const logicalName = (id) => id === 'AND' ? 'AND' : 'OR';
const defaultThreshold = (functionId, n) => functionId === 'AND' ? n : 1;
const ordinal = (n) => `${n} ${n === 1 ? 'набор' : n >= 2 && n <= 4 ? 'набора' : 'наборов'}`;
const escapeXML = (value) => String(value).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

function syncRangeBounds(slider, rawValue, baseExtent) {
  try {
    const value = parseFiniteNumber(rawValue, 'Значение');
    const padding = Math.max(baseExtent * .15, Math.abs(value) * .08, 1);
    const lower = Math.min(-baseExtent - padding, value - padding);
    const upper = Math.max(baseExtent + padding, value + padding);
    slider.min = String(Math.max(-Number.MAX_VALUE, lower));
    slider.max = String(Math.min(Number.MAX_VALUE, upper));
    slider.value = String(value);
  } catch {
    // Invalid typed text stays untouched; the numeric field will report the error.
  }
}

function syncThresholdRange() {
  syncRangeBounds(thresholdSlider, thresholdInput.value, Math.max(Number(countSelect.value) + 1, 3));
}

function readSettings() {
  const n = Number(countSelect.value);
  const threshold = parseFiniteNumber(thresholdInput.value, 'Порог θ');
  let weights = Array(n).fill(1);
  let bias = 0;
  if (mode === 'lab2') {
    weights = Array.from({ length: n }, (_, index) => parseFiniteNumber(weightValues[index] ?? 1, `Вес w${index + 1}`));
    if (biasEnabled.checked) bias = parseFiniteNumber(biasInput.value, 'Вес bias');
  }
  return { inputCount: n, functionId: functionSelect.value, threshold, weights, bias, mode };
}

function updateRange(experiment) {
  const range = $('#validRange');
  if (mode === 'lab1') {
    range.textContent = experiment.function.id === 'AND'
      ? `${experiment.inputCount - 1} < θ ≤ ${experiment.inputCount}`
      : '0 < θ ≤ 1';
  } else if (experiment.validation.range && experiment.validation.range.lower < experiment.validation.range.upper) {
    const { lower, upper } = experiment.validation.range;
    range.textContent = `(${formatNumber(lower)}; ${formatNumber(upper)}]`;
  } else {
    range.textContent = 'разделение невозможно';
  }
}

function renderStatus(experiment) {
  const panel = $('#validationPanel');
  panel.className = `validation-panel ${experiment.validation.status === 'matched' ? 'valid' : 'mismatch'}`;
  $('#statusIcon').textContent = experiment.validation.status === 'matched' ? '✓' : '!';
  $('#statusTitle').textContent = experiment.validation.status === 'matched'
    ? `Нейрон реализует ${logicalName(experiment.function.id)}`
    : `Нейрон не реализует ${logicalName(experiment.function.id)}`;
  $('#statusMessage').textContent = experiment.validation.explanation;
  $('#mismatchCount').textContent = `${experiment.validation.mismatches} ${experiment.validation.mismatches === 1 ? 'несовпадение' : 'несовпадений'}`;
  updateRange(experiment);
}

function renderTable(experiment) {
  const head = $('#truthTable thead');
  const body = $('#truthTable tbody');
  head.replaceChildren();
  body.replaceChildren();
  const header = document.createElement('tr');
  const labels = Array.from({ length: experiment.inputCount }, (_, i) => `x${subscript(i + 1)}`);
  [...labels, 'S', 'y', 'эталон', 'совп.'].forEach((label) => {
    const th = document.createElement('th'); th.textContent = label; header.append(th);
  });
  head.append(header);
  experiment.rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.className = row.index === selectedIndex ? 'selected' : '';
    tr.tabIndex = 0;
    tr.setAttribute('aria-label', `Строка ${row.index + 1}, ${row.inputs.join(', ')}`);
    row.inputs.forEach((bit) => { const td = document.createElement('td'); td.className = 'bit-cell'; td.textContent = bit; tr.append(td); });
    const sum = document.createElement('td'); sum.textContent = formatNumber(row.sum); tr.append(sum);
    const output = document.createElement('td'); output.textContent = row.output; output.className = row.output ? 'output-one' : 'output-zero'; tr.append(output);
    const expected = document.createElement('td'); expected.textContent = row.expected; tr.append(expected);
    const match = document.createElement('td'); match.textContent = row.matches ? '✓' : '✕'; match.className = row.matches ? 'match-cell' : 'mismatch-cell'; tr.append(match);
    const select = () => { selectedIndex = row.index; renderTable(experiment); renderSteps(experiment); renderDiagram(experiment); };
    tr.addEventListener('click', select);
    tr.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    body.append(tr);
  });
  $('#rowCount').textContent = ordinal(experiment.rows.length);
}

function subscript(value) {
  const digits = '₀₁₂₃₄₅₆₇₈₉';
  return String(value).split('').map((digit) => digits[Number(digit)]).join('');
}

function renderSteps(experiment) {
  const row = experiment.rows[selectedIndex] ?? experiment.rows[0];
  selectedIndex = row.index;
  $('#selectedLabel').textContent = `Строка ${row.index + 1}`;
  const threshold = experiment.neuron.threshold;
  const inputText = row.inputs.map((value, index) => `x${subscript(index + 1)}=${value}`).join(', ');
  const compare = `${formatNumber(row.sum)} ${row.sum >= threshold ? '≥' : '<'} θ (${formatNumber(threshold)})`;
  const steps = [
    ['Входы', inputText],
    ['Сумма S', `${experiment.mode === 'lab2' ? 'Σ(wᵢxᵢ) + b' : 'Σxᵢ'} = ${formatNumber(row.sum)}`],
    ['Сравнение S и θ', compare],
    ['Выход нейрона y', String(row.output)],
    ['Эталон', `${experiment.function.id} = ${row.expected} · ${row.matches ? 'совпадает' : 'не совпадает'}`],
  ];
  $('#calculationSteps').innerHTML = steps.map(([label, value], index) => `<div class="step"><span class="step-number">${index + 1}</span><span class="step-label">${escapeXML(label)}</span><span class="step-value">${escapeXML(value)}</span></div>`).join('');
}

function updateFormula(experiment) {
  const n = experiment.inputCount;
  if (mode === 'lab1') $('#sumFormula').textContent = `S = ${Array.from({ length: n }, (_, i) => `x${subscript(i + 1)}`).join(' + ')}`;
  else {
    const terms = experiment.neuron.weights.map((weight, i) => `${formatNumber(weight)}·x${subscript(i + 1)}`);
    if (experiment.neuron.bias !== 0 || biasEnabled.checked) terms.unshift(`${formatNumber(experiment.neuron.bias)}·1`);
    $('#sumFormula').textContent = `S = ${terms.join(' + ')}`;
  }
}

function renderDiagram(experiment) {
  const width = 460;
  const height = 150;
  const rows = experiment.rows;
  const chosen = rows[selectedIndex] ?? rows[0];
  const positions = chosen.inputs.map((_, index) => 20 + index * (110 / Math.max(1, chosen.inputs.length - 1)));
  const pathLines = positions.map((y) => `<path d="M 88 ${y} C 130 ${y}, 132 74, 163 74" fill="none" stroke="#c8d0df" stroke-width="1.5"/>`).join('');
  const inputNodes = chosen.inputs.map((bit, index) => {
    const y = positions[index];
    const label = `x${subscript(index + 1)}`;
    return `<circle cx="35" cy="${y}" r="12" fill="#eff1ff" stroke="#dce2ff"/><text x="35" y="${y + 3}" text-anchor="middle" class="diagram-bit">${bit}</text><text x="5" y="${y + 3}" class="diagram-label">${label}</text><text x="97" y="${(y + 74) / 2 - 2}" class="diagram-weight">w=${formatNumber(experiment.neuron.weights[index])}</text>`;
  }).join('');
  const biasNode = experiment.neuron.bias !== 0 || (mode === 'lab2' && biasEnabled.checked)
    ? `<path d="M 133 128 C 146 128, 148 88, 163 78" fill="none" stroke="#c8d0df" stroke-width="1.5"/><circle cx="124" cy="128" r="8" fill="#eff1ff" stroke="#dce2ff"/><text x="124" y="131" text-anchor="middle" class="diagram-bit">1</text><text x="137" y="141" class="diagram-weight">x₀ · w₀=${formatNumber(experiment.neuron.bias)}</text>` : '';
  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Входы, веса, сумматор, активация с порогом и выход нейрона"><g>${pathLines}${inputNodes}${biasNode}</g><circle cx="174" cy="74" r="14" fill="#fff" stroke="#9eabc0" stroke-width="1.5"/><text x="174" y="78" text-anchor="middle" class="diagram-sum">Σ</text><path d="M 188 74 H 218" stroke="#aab5c7" stroke-width="1.5"/><rect x="218" y="47" width="139" height="54" rx="10" fill="#f6f7fb" stroke="#e4e8f0"/><text x="287" y="68" text-anchor="middle" class="diagram-label">Threshold</text><text x="287" y="85" text-anchor="middle" class="diagram-weight">θ = ${formatNumber(experiment.neuron.threshold)}</text><path d="M 357 74 H 390" stroke="#aab5c7" stroke-width="1.5"/><circle cx="409" cy="74" r="15" fill="${chosen.output ? '#526cf5' : '#fff'}" stroke="#526cf5" stroke-width="1.5"/><text x="409" y="78" text-anchor="middle" class="diagram-output" fill="${chosen.output ? '#fff' : '#526cf5'}">${chosen.output}</text><text x="431" y="78" class="diagram-label">y</text></svg>`;
  $('#neuronDiagram').innerHTML = svg;
}

function chartPoint(row, x, y) {
  const px = x(row.inputs[0]); const py = y(row.inputs[1]);
  const fill = row.output ? '#526cf5' : '#fff';
  const klass = row.output ? 'neuron-one' : 'neuron-zero';
  const mismatchRing = row.expected !== row.output ? `<circle cx="${px}" cy="${py}" r="13" fill="none" stroke="#dc8b35" stroke-width="2" stroke-dasharray="3 2"/>` : '';
  return `${mismatchRing}<circle cx="${px}" cy="${py}" r="8" fill="${fill}" stroke="#526cf5" stroke-width="2"/><text x="${px + 13}" y="${py - 6}" class="point-label">${row.inputs.join('')} · y${row.output}/э${row.expected}</text><title>${row.inputs.join(', ')}: выход ${row.output}, эталон ${row.expected}${row.matches ? '' : ', несовпадение'}</title>`;
}

function render2DChart(experiment) {
  const width = 620; const height = 280;
  const left = 82; const top = 28; const size = 205;
  const dataMin = -.25; const dataMax = 1.25; const span = dataMax - dataMin;
  const x = (value) => left + (value - dataMin) / span * size;
  const y = (value) => top + size - (value - dataMin) / span * size;
  const fixed = experiment.inputCount > 2 ? Array.from({ length: experiment.inputCount - 2 }, () => 0) : [];
  const rows = experiment.rows.filter((row) => row.inputs.slice(2).every((value) => value === 0));
  const weightX = experiment.neuron.weights[0]; const weightY = experiment.neuron.weights[1];
  const otherSum = experiment.neuron.bias + experiment.neuron.weights.slice(2).reduce((sum, weight, index) => sum + weight * fixed[index], 0);
  const target = experiment.neuron.threshold - otherSum;
  const { points: intersections, degenerate } = clipThresholdLine(weightX, weightY, target, dataMin, dataMax);
  const grid = [-.25, 0, .5, 1, 1.25].map((v) => `<line x1="${x(v)}" y1="${top}" x2="${x(v)}" y2="${top + size}" stroke="#edf0f5"/><line x1="${left}" y1="${y(v)}" x2="${left + size}" y2="${y(v)}" stroke="#edf0f5"/>`).join('');
  const boundary = intersections.length >= 2 ? `<line x1="${x(intersections[0][0])}" y1="${y(intersections[0][1])}" x2="${x(intersections[1][0])}" y2="${y(intersections[1][1])}" stroke="#e58b42" stroke-width="2.4"/>` : '';
  const degenerateBoundary = degenerate ? `<rect x="${x(0)}" y="${y(1)}" width="${x(1) - x(0)}" height="${y(0) - y(1)}" fill="none" stroke="#e58b42" stroke-width="2.4" stroke-dasharray="5 3"/>` : '';
  const points = rows.map((row) => chartPoint(row, x, y)).join('');
  const region = `<rect x="${x(0)}" y="${y(1)}" width="${x(1) - x(0)}" height="${y(0) - y(1)}" fill="#f7f8fc" fill-opacity=".72" stroke="#cdd5e2" stroke-dasharray="4 3"/>`;
  $('#chartTitle').textContent = 'Точки и граница решения';
  const weightedEq = `${formatNumber(weightX)}x₁ + ${formatNumber(weightY)}x₂ ${otherSum >= 0 ? '+' : '−'} ${formatNumber(Math.abs(otherSum))} = ${formatNumber(experiment.neuron.threshold)}`;
  $('#chartCaption').textContent = experiment.inputCount === 2
    ? `Прямая задаётся равенством ${weightedEq}. Метка у каждой вершины: выход нейрона y / эталон.`
    : `Срез при x₃…xₙ = ${fixed.length ? fixed.map((v) => v).join(', ') : '—'}. Это срез многомерной границы, не вся гиперплоскость. Метка: y / эталон.`;
  const noArea = experiment.neuron.threshold < experiment.geometry.minScore || experiment.neuron.threshold > experiment.geometry.maxScore;
  const noSlice = !degenerate && intersections.length < 2;
  showChartNotice(degenerate ? 'Вся показанная область лежит на границе S = θ.' : noArea ? `θ = ${formatNumber(experiment.neuron.threshold)} вне диапазона сумм [${formatNumber(experiment.geometry.minScore)}, ${formatNumber(experiment.geometry.maxScore)}]. Входные точки всё равно классифицированы.` : noSlice ? 'Граница не пересекает показанный срез; штриховая рамка отмечает квадрат бинарных значений 0…1. Таблица продолжает показывать классификацию.' : '');
  $('#chartCanvas').innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><rect x="${left}" y="${top}" width="${size}" height="${size}" fill="#fcfcfe" stroke="#dce2eb"/>${region}${grid}${boundary}${degenerateBoundary}${points}<text x="${(x(0) + x(1)) / 2}" y="${top + size + 31}" text-anchor="middle" class="axis-label">x₁</text><text x="${left - 34}" y="${(y(0) + y(1)) / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 ${left - 34} ${(y(0) + y(1)) / 2})">x₂</text><text x="${left - 13}" y="${y(0) + 4}" class="tick-label">0</text><text x="${left - 13}" y="${y(1) + 4}" class="tick-label">1</text><text x="${x(0) - 3}" y="${top + size + 17}" class="tick-label">0</text><text x="${x(1) - 3}" y="${top + size + 17}" class="tick-label">1</text><line x1="390" y1="75" x2="423" y2="75" stroke="#e58b42" stroke-width="2.4"/><text x="432" y="79" class="legend-label">граница S = θ</text><circle cx="406" cy="108" r="6" fill="#526cf5"/><text x="432" y="112" class="legend-label">y нейрона = 1</text><circle cx="406" cy="139" r="6" fill="#fff" stroke="#526cf5" stroke-width="2"/><text x="432" y="143" class="legend-label">y нейрона = 0</text><circle cx="406" cy="170" r="9" fill="none" stroke="#dc8b35" stroke-width="1.7" stroke-dasharray="3 2"/><text x="432" y="174" class="legend-label">эталон отличается</text></svg>`;
}

function render3DChart(experiment) {
  const size = 340; const project = ([x, y, z]) => [115 + 67 * x + 67 * y, 220 - 42 * x + 42 * y - 93 * z];
  const vertices = enumerateBinaryInputs(3);
  const edges = [];
  vertices.forEach((vertex) => vertex.forEach((_, index) => {
    if (vertex[index] === 0) { const next = [...vertex]; next[index] = 1; edges.push([vertex, next]); }
  }));
  const score = (v) => experiment.neuron.bias + v.reduce((sum, bit, i) => sum + bit * experiment.neuron.weights[i], 0);
  const planePoints = [];
  edges.forEach(([a, b]) => {
    const sa = score(a) - experiment.neuron.threshold; const sb = score(b) - experiment.neuron.threshold;
    if (Math.abs(sa) < 1e-9) planePoints.push(a);
    if (sa * sb < 0) { const t = sa / (sa - sb); planePoints.push(a.map((v, i) => v + t * (b[i] - v))); }
  });
  const unique = planePoints.filter((point, i) => planePoints.findIndex((other) => point.every((v, j) => Math.abs(v - other[j]) < 1e-8)) === i);
  if (unique.length > 2) {
    const center = unique.reduce((c, p) => [c[0] + p[0] / unique.length, c[1] + p[1] / unique.length, c[2] + p[2] / unique.length], [0, 0, 0]);
    unique.sort((a, b) => Math.atan2(project(a)[1] - project(center)[1], project(a)[0] - project(center)[0]) - Math.atan2(project(b)[1] - project(center)[1], project(b)[0] - project(center)[0]));
  }
  const lines = edges.map(([a, b]) => { const pa = project(a); const pb = project(b); return `<line x1="${pa[0]}" y1="${pa[1]}" x2="${pb[0]}" y2="${pb[1]}" stroke="#bdc7d6" stroke-width="1.4"/>`; }).join('');
  const plane = unique.length >= 3 ? `<polygon points="${unique.map(project).map((p) => p.join(',')).join(' ')}" fill="#e89b55" fill-opacity=".25" stroke="#de8740" stroke-width="2"/>` : unique.length === 2 ? `<line x1="${project(unique[0])[0]}" y1="${project(unique[0])[1]}" x2="${project(unique[1])[0]}" y2="${project(unique[1])[1]}" stroke="#de8740" stroke-width="2.5"/>` : '';
  const points = experiment.rows.map((row) => { const p = project(row.inputs); const fill = row.output ? '#526cf5' : '#fff'; const outer = row.expected !== row.output ? `<circle cx="${p[0]}" cy="${p[1]}" r="12" fill="none" stroke="#dc8b35" stroke-width="2" stroke-dasharray="3 2"/>` : ''; return `${outer}<circle cx="${p[0]}" cy="${p[1]}" r="7" fill="${fill}" stroke="#526cf5" stroke-width="2"/><text x="${p[0] + 10}" y="${p[1] - 8}" class="point-label">${row.inputs.join('')} · y${row.output}/э${row.expected}</text><title>${row.inputs.join(', ')}: y=${row.output}, эталон=${row.expected}</title>`; }).join('');
  $('#chartTitle').textContent = 'Вершины куба и плоскость';
  $('#chartCaption').textContent = `Сумма: ${experiment.neuron.weights.map((w, i) => `${formatNumber(w)}x${subscript(i + 1)}`).join(' + ')}${experiment.neuron.bias ? ` + ${formatNumber(experiment.neuron.bias)}` : ''} = θ. Подпись у вершины: входы · y нейрона / эталон.`;
  const noArea = experiment.neuron.threshold < experiment.geometry.minScore || experiment.neuron.threshold > experiment.geometry.maxScore;
  showChartNotice(noArea ? `θ = ${formatNumber(experiment.neuron.threshold)} вне диапазона сумм [${formatNumber(experiment.geometry.minScore)}, ${formatNumber(experiment.geometry.maxScore)}]: плоскость не пересекает куб. Таблица продолжает показывать классификацию.` : unique.length < 2 ? 'Плоскость не пересекает объём куба для этого порога.' : '');
  $('#chartCanvas').innerHTML = `<svg viewBox="0 0 620 ${size}" width="620" height="${size}" aria-hidden="true">${lines}${plane}${points}<text x="265" y="272" class="axis-label">x₁</text><text x="268" y="112" class="axis-label">x₂</text><text x="78" y="95" class="axis-label">x₃</text><line x1="390" y1="87" x2="422" y2="87" stroke="#de8740" stroke-width="2.5"/><text x="432" y="91" class="legend-label">плоскость S = θ</text><circle cx="406" cy="121" r="6" fill="#526cf5"/><text x="432" y="125" class="legend-label">y нейрона = 1</text><circle cx="406" cy="153" r="6" fill="#fff" stroke="#526cf5" stroke-width="2"/><text x="432" y="157" class="legend-label">y нейрона = 0</text><circle cx="406" cy="185" r="9" fill="none" stroke="#dc8b35" stroke-width="1.7" stroke-dasharray="3 2"/><text x="432" y="189" class="legend-label">эталон отличается</text></svg>`;
}

function showChartNotice(message) {
  const notice = $('#chartNotice');
  notice.hidden = !message;
  notice.textContent = message;
}

function renderXor() {
  const rows = enumerateBinaryInputs(2).map((inputs) => ({ inputs, expected: Number(inputs[0] !== inputs[1]) }));
  $('#xorDemo').innerHTML = `<svg viewBox="0 0 410 135" width="410" height="135" role="img" aria-label="Четыре точки XOR: единицы по диагонали"><rect x="38" y="12" width="115" height="98" fill="#fcfcfe" stroke="#e5e9f0"/><line x1="38" y1="61" x2="153" y2="61" stroke="#edf0f5"/><line x1="95" y1="12" x2="95" y2="110" stroke="#edf0f5"/>${rows.map((row) => { const x = 47 + row.inputs[0] * 91; const y = 101 - row.inputs[1] * 79; return `<circle cx="${x}" cy="${y}" r="9" fill="${row.expected ? '#526cf5' : '#fff'}" stroke="#526cf5" stroke-width="2"/><text x="${x + 14}" y="${y + 4}" class="point-label">${row.inputs.join('')} · XOR ${row.expected}</text>`; }).join('')}<text x="205" y="48" class="legend-label">● класс 1: 01 и 10</text><text x="205" y="75" class="legend-label">○ класс 0: 00 и 11</text><text x="205" y="103" class="legend-label">Одной прямой недостаточно.</text></svg>`;
}

function renderExperiment() {
  $('#inputError').hidden = true;
  $('#validationPanel').hidden = false;
  $('#workspaceGrid')?.classList.remove('invalid-state');
  try {
    const experiment = buildExperiment(readSettings());
    latestExperiment = experiment;
    selectedIndex = Math.min(selectedIndex, experiment.rows.length - 1);
    renderStatus(experiment);
    renderTable(experiment);
    renderSteps(experiment);
    renderDiagram(experiment);
    updateFormula(experiment);
    if (experiment.inputCount === 3) render3DChart(experiment); else render2DChart(experiment);
  } catch (error) {
    renderInvalid(error);
  }
}

function renderInvalid(error) {
  latestExperiment = null;
  $('#validationPanel').hidden = true;
  const errorPanel = $('#inputError');
  errorPanel.hidden = false;
  errorPanel.textContent = error instanceof InputError ? error.message : 'Не удалось выполнить расчёт. Проверьте введённые значения.';
  $('#truthTable thead').replaceChildren();
  $('#truthTable tbody').replaceChildren();
  $('#rowCount').textContent = '—';
  $('#calculationSteps').textContent = 'Исправьте параметры, чтобы выполнить расчёт.';
  $('#neuronDiagram').replaceChildren();
  $('#chartCanvas').replaceChildren();
  $('#chartCaption').textContent = 'График недоступен, пока параметры не являются конечными числами.';
  showChartNotice('Ошибка ввода: вычисление не выполнено.');
  $('#validRange').textContent = '—';
  $('#sumFormula').textContent = 'S = —';
}

function rebuildWeightInputs(nextCount, preserve = true) {
  const old = preserve ? weightValues : [];
  weightValues = Array.from({ length: nextCount }, (_, i) => old[i] ?? 1);
  weightInputs.replaceChildren();
  weightValues.forEach((value, index) => {
    const label = document.createElement('label');
    label.className = 'weight-field';
    const heading = document.createElement('span');
    heading.textContent = `Вес w${index + 1}`;
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.value = value; input.setAttribute('aria-label', `Вес w${index + 1}`);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.step = 'any'; slider.className = 'range-control'; slider.setAttribute('aria-label', `Ползунок веса w${index + 1}`);
    syncRangeBounds(slider, value, Math.max(2, nextCount));
    input.addEventListener('input', () => {
      weightValues[index] = input.value;
      syncRangeBounds(slider, input.value, Math.max(2, nextCount));
      renderExperiment();
    });
    slider.addEventListener('input', () => {
      input.value = slider.value;
      weightValues[index] = slider.value;
      renderExperiment();
    });
    label.append(heading, input, slider); weightInputs.append(label);
  });
}

function setPreset(nextVariant = null) {
  const n = Number(countSelect.value);
  const task = functionSelect.value;
  if (nextVariant === null) presetVariant = (presetVariant + 1) % 2;
  else presetVariant = nextVariant;
  const preset = lab2Preset(task, n, presetVariant);
  weightValues = preset.weights;
  biasValue = preset.bias;
  rebuildWeightInputs(n, true);
  biasEnabled.checked = true;
  biasInput.value = String(biasValue);
  syncRangeBounds(biasSlider, biasInput.value, Math.max(2, n));
  $('#biasField').hidden = false;
  thresholdInput.value = String(preset.threshold);
  syncThresholdRange();
  $('#presetCaption').textContent = `Пример ${presetVariant === 0 ? 'A' : 'B'} по методичке для ${task === 'AND' ? 'И' : 'ИЛИ'}.`;
  renderExperiment();
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll('.mode-button').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
  });
  weightedControls.hidden = mode !== 'lab2';
  const n = Number(countSelect.value);
  if (mode === 'lab1') {
    thresholdInput.value = String(defaultThreshold(functionSelect.value, n));
  } else {
    rebuildWeightInputs(n, false);
    biasEnabled.checked = false; biasValue = 0; biasInput.value = '0'; $('#biasField').hidden = true;
    thresholdInput.value = '0';
    presetVariant = 1;
    setPreset(0);
  }
  syncThresholdRange();
  countSlider.value = countSelect.value;
  $('#inputCountValue').value = countSelect.value;
  $('#thresholdHelp').textContent = mode === 'lab1' ? 'Можно вводить любое конечное число.' : 'Веса и порог принимают любые конечные числа.';
  $('#compareButton').hidden = mode !== 'lab2';
  renderExperiment();
}

document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
functionSelect.addEventListener('change', () => {
  if (mode === 'lab1') thresholdInput.value = String(defaultThreshold(functionSelect.value, Number(countSelect.value)));
  else setPreset(0);
  syncThresholdRange();
  renderExperiment();
});
countSelect.addEventListener('change', () => {
  countSlider.value = countSelect.value;
  $('#inputCountValue').value = countSelect.value;
  if (mode === 'lab1') thresholdInput.value = String(defaultThreshold(functionSelect.value, Number(countSelect.value)));
  else setPreset(presetVariant);
  syncThresholdRange();
  renderExperiment();
});
countSlider.addEventListener('input', () => {
  countSelect.value = countSlider.value;
  countSelect.dispatchEvent(new Event('change'));
});
thresholdInput.addEventListener('input', () => { syncThresholdRange(); renderExperiment(); });
thresholdSlider.addEventListener('input', () => { thresholdInput.value = thresholdSlider.value; renderExperiment(); });
biasEnabled.addEventListener('change', () => { $('#biasField').hidden = !biasEnabled.checked; renderExperiment(); });
biasInput.addEventListener('input', () => { biasValue = biasInput.value; syncRangeBounds(biasSlider, biasInput.value, Math.max(2, Number(countSelect.value))); renderExperiment(); });
biasSlider.addEventListener('input', () => { biasInput.value = biasSlider.value; biasValue = biasSlider.value; renderExperiment(); });
$('#presetButton').addEventListener('click', setPreset);
$('#compareButton').addEventListener('click', () => {
  if (!latestExperiment) return;
  const n = latestExperiment.inputCount;
  const threshold = defaultThreshold(functionSelect.value, n);
  const baseline = buildExperiment({ inputCount: n, functionId: functionSelect.value, threshold, weights: Array(n).fill(1), bias: 0, mode: 'lab1' });
  const result = $('#comparisonResult');
  result.hidden = false;
  result.classList.toggle('bad', baseline.validation.status !== 'matched');
  result.textContent = `Базовая ЛР1: веса = 1, bias = 0, θ = ${formatNumber(threshold)} — ${baseline.validation.status === 'matched' ? 'эталон реализован' : `${baseline.validation.mismatches} несовпадений`}. Текущая ЛР2: ${latestExperiment.validation.mismatches ? `${latestExperiment.validation.mismatches} несовпадений` : 'эталон реализован'}.`;
});

renderXor();
countSlider.value = countSelect.value;
$('#inputCountValue').value = countSelect.value;
rebuildWeightInputs(2, false);
syncThresholdRange();
renderExperiment();
