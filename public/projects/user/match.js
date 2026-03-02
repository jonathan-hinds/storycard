import { PhaseManagerClient } from '/public/phase-manager/index.js';

const USER_SESSION_KEY = 'storycard-user-session';

function loadSession() {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

const session = loadSession();
if (!session) {
  window.location.replace('/public/projects/user/index.html');
} else {
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
      badgeSlotsVisibleInput: document.getElementById('phase-manager-badge-slots-visible'),
      badgeSlotsCountInput: document.getElementById('phase-manager-badge-slots-count-range'),
      badgeSlotsCountNumberInput: document.getElementById('phase-manager-badge-slots-count-number'),
      badgeSlotsCountValueEl: document.getElementById('phase-manager-badge-slots-count-value'),
      badgeSlotsXInput: document.getElementById('phase-manager-badge-slots-x-range'),
      badgeSlotsXNumberInput: document.getElementById('phase-manager-badge-slots-x-number'),
      badgeSlotsXValueEl: document.getElementById('phase-manager-badge-slots-x-value'),
      badgeSlotsYInput: document.getElementById('phase-manager-badge-slots-y-range'),
      badgeSlotsYNumberInput: document.getElementById('phase-manager-badge-slots-y-number'),
      badgeSlotsYValueEl: document.getElementById('phase-manager-badge-slots-y-value'),
      badgeSlotsZInput: document.getElementById('phase-manager-badge-slots-z-range'),
      badgeSlotsZNumberInput: document.getElementById('phase-manager-badge-slots-z-number'),
      badgeSlotsZValueEl: document.getElementById('phase-manager-badge-slots-z-value'),
      badgeSlotsGapInput: document.getElementById('phase-manager-badge-slots-gap-range'),
      badgeSlotsGapNumberInput: document.getElementById('phase-manager-badge-slots-gap-number'),
      badgeSlotsGapValueEl: document.getElementById('phase-manager-badge-slots-gap-value'),
      badgeSlotsSizeInput: document.getElementById('phase-manager-badge-slots-size-range'),
      badgeSlotsSizeNumberInput: document.getElementById('phase-manager-badge-slots-size-number'),
      badgeSlotsSizeValueEl: document.getElementById('phase-manager-badge-slots-size-value'),
      badgeSlotsBevelInput: document.getElementById('phase-manager-badge-slots-bevel-range'),
      badgeSlotsBevelNumberInput: document.getElementById('phase-manager-badge-slots-bevel-number'),
      badgeSlotsBevelValueEl: document.getElementById('phase-manager-badge-slots-bevel-value'),
      badgeSlotsThicknessInput: document.getElementById('phase-manager-badge-slots-thickness-range'),
      badgeSlotsThicknessNumberInput: document.getElementById('phase-manager-badge-slots-thickness-number'),
      badgeSlotsThicknessValueEl: document.getElementById('phase-manager-badge-slots-thickness-value'),
      layoutExportBtn: document.getElementById('phase-manager-layout-export'),
      layoutExportOutputEl: document.getElementById('phase-manager-layout-export-output'),
    },
    options: {
      playerId: session.user.id,
      matchmakingPayload: {
        deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
      },
    },
  });

  phaseManager.start();
}
