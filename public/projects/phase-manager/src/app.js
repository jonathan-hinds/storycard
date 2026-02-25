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
    upkeepPlaneXInput: document.getElementById('upkeep-plane-x'),
    upkeepPlaneYInput: document.getElementById('upkeep-plane-y'),
    upkeepPlaneZInput: document.getElementById('upkeep-plane-z'),
    upkeepBackgroundSelect: document.getElementById('upkeep-background-asset'),
    upkeepNumberXInput: document.getElementById('upkeep-number-x'),
    upkeepNumberYInput: document.getElementById('upkeep-number-y'),
    upkeepExportBtn: document.getElementById('upkeep-export-json'),
    upkeepExportOutput: document.getElementById('upkeep-export-output'),
  },
});

phaseManager.start();
