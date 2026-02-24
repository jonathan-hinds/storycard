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
    tuningUpDownEl: document.getElementById('phase-manager-tune-up-down'),
    tuningUpDownValueEl: document.getElementById('phase-manager-tune-up-down-value'),
    tuningLeftRightEl: document.getElementById('phase-manager-tune-left-right'),
    tuningLeftRightValueEl: document.getElementById('phase-manager-tune-left-right-value'),
    tuningNearFarEl: document.getElementById('phase-manager-tune-near-far'),
    tuningNearFarValueEl: document.getElementById('phase-manager-tune-near-far-value'),
    tuningAmbientEl: document.getElementById('phase-manager-tune-ambient'),
    tuningAmbientValueEl: document.getElementById('phase-manager-tune-ambient-value'),
    tuningKeyLightEl: document.getElementById('phase-manager-tune-key-light'),
    tuningKeyLightValueEl: document.getElementById('phase-manager-tune-key-light-value'),
    tuningRoughnessEl: document.getElementById('phase-manager-tune-roughness'),
    tuningRoughnessValueEl: document.getElementById('phase-manager-tune-roughness-value'),
    tuningExportBtn: document.getElementById('phase-manager-export-preview-json'),
    tuningExportOutputEl: document.getElementById('phase-manager-preview-json-output'),
  },
});

phaseManager.start();
