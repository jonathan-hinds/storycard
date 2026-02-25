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
    upkeepExportBtn: document.getElementById('phase-manager-upkeep-export'),
    upkeepExportOutputEl: document.getElementById('phase-manager-upkeep-export-output'),
  },
});

phaseManager.start();
