export function createHiddenButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.hidden = true;
  return button;
}

export function createHiddenOutput() {
  const output = document.createElement('output');
  output.hidden = true;
  return output;
}

export function createHiddenInput(type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.hidden = true;
  return input;
}

export function createPhaseManagerElements({ canvas, overlayEl }) {
  return {
    canvas,
    overlayEl,
    matchmakingBtn: createHiddenButton(),
    readyBtn: createHiddenButton(),
    resetBtn: createHiddenButton(),
    statusEl: document.createElement('p'),
    matchLabelEl: document.createElement('p'),
    playerSummaryEl: document.createElement('p'),
    opponentSummaryEl: document.createElement('p'),
    queueSummaryEl: document.createElement('p'),
    badgeSlotsVisibleInput: createHiddenInput('checkbox'),
    badgeSlotsCountInput: createHiddenInput('range'),
    badgeSlotsCountNumberInput: createHiddenInput('number'),
    badgeSlotsCountValueEl: createHiddenOutput(),
    badgeSlotsXInput: createHiddenInput('range'),
    badgeSlotsXNumberInput: createHiddenInput('number'),
    badgeSlotsXValueEl: createHiddenOutput(),
    badgeSlotsYInput: createHiddenInput('range'),
    badgeSlotsYNumberInput: createHiddenInput('number'),
    badgeSlotsYValueEl: createHiddenOutput(),
    badgeSlotsZInput: createHiddenInput('range'),
    badgeSlotsZNumberInput: createHiddenInput('number'),
    badgeSlotsZValueEl: createHiddenOutput(),
    badgeSlotsGapInput: createHiddenInput('range'),
    badgeSlotsGapNumberInput: createHiddenInput('number'),
    badgeSlotsGapValueEl: createHiddenOutput(),
    badgeSlotsSizeInput: createHiddenInput('range'),
    badgeSlotsSizeNumberInput: createHiddenInput('number'),
    badgeSlotsSizeValueEl: createHiddenOutput(),
    badgeSlotsBevelInput: createHiddenInput('range'),
    badgeSlotsBevelNumberInput: createHiddenInput('number'),
    badgeSlotsBevelValueEl: createHiddenOutput(),
    badgeSlotsThicknessInput: createHiddenInput('range'),
    badgeSlotsThicknessNumberInput: createHiddenInput('number'),
    badgeSlotsThicknessValueEl: createHiddenOutput(),
    layoutExportBtn: createHiddenButton(),
    layoutExportOutputEl: createHiddenOutput(),
  };
}
