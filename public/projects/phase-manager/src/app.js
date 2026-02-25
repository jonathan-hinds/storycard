import { PhaseManagerClient } from '/public/phase-manager/index.js';

const phaseManager = new PhaseManagerClient({
  elements: {
    canvas: document.getElementById('phase-manager-canvas'),
    statusEl: document.getElementById('phase-manager-status'),
    matchmakingBtn: document.getElementById('phase-manager-matchmaking'),
    readyBtn: document.getElementById('phase-manager-ready'),
    resetBtn: document.getElementById('phase-manager-reset'),
    overlayEl: document.getElementById('phase-manager-turn-overlay'),
    matchLabelEl: document.getElementById('phase-manager-match-label'),
    playerSummaryEl: document.getElementById('phase-manager-player-summary'),
    opponentSummaryEl: document.getElementById('phase-manager-opponent-summary'),
    queueSummaryEl: document.getElementById('phase-manager-queue-summary'),
    upkeepXInput: document.getElementById('phase-manager-upkeep-x'),
    upkeepYInput: document.getElementById('phase-manager-upkeep-y'),
    upkeepZInput: document.getElementById('phase-manager-upkeep-z'),
    upkeepWidthInput: document.getElementById('phase-manager-upkeep-width'),
    upkeepHeightInput: document.getElementById('phase-manager-upkeep-height'),
    upkeepTextXInput: document.getElementById('phase-manager-upkeep-text-x'),
    upkeepTextYInput: document.getElementById('phase-manager-upkeep-text-y'),
    upkeepBackgroundSelect: document.getElementById('phase-manager-upkeep-background'),
    upkeepXValueEl: document.getElementById('phase-manager-upkeep-x-value'),
    upkeepYValueEl: document.getElementById('phase-manager-upkeep-y-value'),
    upkeepZValueEl: document.getElementById('phase-manager-upkeep-z-value'),
    upkeepWidthValueEl: document.getElementById('phase-manager-upkeep-width-value'),
    upkeepHeightValueEl: document.getElementById('phase-manager-upkeep-height-value'),
    upkeepTextXValueEl: document.getElementById('phase-manager-upkeep-text-x-value'),
    upkeepTextYValueEl: document.getElementById('phase-manager-upkeep-text-y-value'),
    upkeepExportBtn: document.getElementById('phase-manager-upkeep-export'),
    upkeepExportOutputEl: document.getElementById('phase-manager-upkeep-export-output'),
  },
});

phaseManager.start();
