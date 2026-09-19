const config = window.DRAFT_CONFIG || {};
const GOOGLE_APPS_SCRIPT_URL = config.googleAppsScriptUrl || config.appsScriptUrl || '';

const state = {
  currentTab: 'dashboard',
  week: 1,
  teams: [],
  rosterByTeam: {},
  allPlayers: [],
  draftOwnership: {},
  draftOrder: [],
  matchups: [],
  selectedTeamId: null,
  selectedWeek: 1,
  selectedPlayerSearch: '',
  rosterOrderByTeam: {},
  lastError: null
};

function setDataError(message) {
  state.lastError = message;
  const syncStatus = document.getElementById('sync-status');
  if (syncStatus) {
    syncStatus.textContent = message;
  }
}

function initRosterState() {
  state.rosterByTeam = {};
  state.rosterOrderByTeam = {};
  state.teams.forEach((team) => {
    state.rosterByTeam[team.id] = [];
    state.rosterOrderByTeam[team.id] = [];
  });
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function resolveTeamId(teamReference) {
  if (teamReference === null || teamReference === undefined || teamReference === '') return null;
  const asNumber = Number(teamReference);
  if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
    return asNumber;
  }

  const normalizedReference = String(teamReference).trim().toLowerCase();
  const match = state.teams.find((team) => {
    return team.name.toLowerCase() === normalizedReference || String(team.id) === normalizedReference;
  });

  return match ? match.id : null;
}

function normalizePlayerPayload(data) {
  if (!data || typeof data !== 'object') return [];
  const entries = Object.entries(data).slice(0, 200);
  return entries.map(([id, player]) => {
    const raw = player || {};
    const firstName = raw.first_name || '';
    const lastName = raw.last_name || '';
    return {
      id: String(id),
      fullName: `${firstName} ${lastName}`.trim() || `Player ${id}`,
      position: raw.position || 'N/A',
      team: raw.team || 'FA',
      status: 'Active'
    };
  });
}

function findSleeperPlayerId(entry) {
  const explicitPlayerId = String(entry.sleeperPlayerId || entry.sleeper_player_id || entry.playerId || entry.player_id || '').trim();
  if (explicitPlayerId && /^\d+$/.test(explicitPlayerId)) {
    return explicitPlayerId;
  }

  return '';
}

function debugDataLoad(label, url, payload) {
  console.log(`[DATA DEBUG] ${label}`, {
    url,
    rows: Array.isArray(payload && payload.rows) ? payload.rows.length : Array.isArray(payload) ? payload.length : 'not-array',
    payload
  });
}

function loadTeamsFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    setDataError('No backend URL configured for Google Apps Script.');
    return Promise.resolve(state.teams);
  }

  return fetch(`${GOOGLE_APPS_SCRIPT_URL}?action=read&sheet=Teams`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('Unable to load team names');
      return response.json();
    })
    .then((payload) => {
      debugDataLoad('Teams', `${GOOGLE_APPS_SCRIPT_URL}?action=read&sheet=Teams`, payload);
      const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
      if (!rows.length) {
        state.teams = [];
        state.rosterByTeam = {};
        state.rosterOrderByTeam = {};
        setDataError('Teams sheet returned no data.');
        return state.teams;
      }

      state.teams = rows.map((team, index) => ({
        id: Number(team.id || team.team_id || team.teamId || index + 1),
        name: String(team.name || team.team_name || team.team || `Team ${index + 1}`),
        manager: String(team.manager || team.owner || team.manager_name || '').trim() || 'Manager'
      }));

      const existing = state.rosterByTeam || {};
      state.rosterByTeam = {};
      state.rosterOrderByTeam = {};
      state.teams.forEach((team) => {
        const roster = existing[team.id] && existing[team.id].length ? existing[team.id] : [];
        state.rosterByTeam[team.id] = roster;
        state.rosterOrderByTeam[team.id] = roster.map((entry, index) => index + 1);
      });

      state.selectedTeamId = state.selectedTeamId || state.teams[0]?.id || null;
      return state.teams;
    })
    .catch((error) => {
      state.teams = [];
      state.rosterByTeam = {};
      state.rosterOrderByTeam = {};
      setDataError(error && error.message ? error.message : 'Unable to load Teams from the Google Apps Script backend.');
      return state.teams;
    });
}

function normalizeRosterSpotValue(rawSlot, rawStatus, rawActive, rawPosition) {
  const slotValue = String(rawSlot || '').trim();
  if (slotValue) return slotValue;

  const statusValue = String(rawStatus || '').trim();
  if (statusValue) return statusValue;

  const activeValue = String(rawActive || '').trim().toLowerCase();
  if (activeValue === 'true' || activeValue === 'yes' || activeValue === 'y') return 'Active';
  if (activeValue === 'false' || activeValue === 'no' || activeValue === 'n') return 'Bench';

  const positionValue = String(rawPosition || '').trim();
  if (positionValue) return positionValue;

  return 'Unassigned';
}

function isStarterSlot(slotValue) {
  const normalized = String(slotValue || '').trim().toUpperCase();
  return ['QB', 'RB', 'WR', 'TE', 'FLEX'].includes(normalized);
}

function isBenchSlot(slotValue) {
  const normalized = String(slotValue || '').trim().toUpperCase();
  return ['BN', 'BENCH', 'IR'].includes(normalized);
}

function getRosterSlotCounts(teamId, overrideRoster) {
  const roster = overrideRoster || state.rosterByTeam[teamId] || [];
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, BN: 0, IR: 0, total: 0 };

  roster.forEach((entry) => {
    const slot = String(entry.rosterSpot || entry.slot || entry.status || '').trim().toUpperCase();
    if (!slot) return;

    const normalizedSlot = slot === 'BENCH' ? 'BN' : slot;
    if (Object.prototype.hasOwnProperty.call(counts, normalizedSlot)) {
      counts[normalizedSlot] += 1;
    }
    counts.total += 1;
  });

  return counts;
}

function validateRosterSlotChange(teamId, playerId, nextSlot) {
  const roster = state.rosterByTeam[teamId] || [];
  const target = roster.find((entry) => String(entry.playerId) === String(playerId));
  if (!target) return 'Player not found on the selected team roster.';

  const currentSlot = String(target.rosterSpot || target.slot || target.status || '').trim().toUpperCase();
  const counts = getRosterSlotCounts(teamId, roster);
  const nextCounts = { ...counts };

  if (currentSlot && Object.prototype.hasOwnProperty.call(nextCounts, currentSlot)) {
    nextCounts[currentSlot] = Math.max(0, nextCounts[currentSlot] - 1);
  }

  const normalizedNextSlot = String(nextSlot || '').trim().toUpperCase();
  if (normalizedNextSlot && Object.prototype.hasOwnProperty.call(nextCounts, normalizedNextSlot)) {
    nextCounts[normalizedNextSlot] = (nextCounts[normalizedNextSlot] || 0) + 1;
  }

  const starters = ['QB', 'RB', 'WR', 'TE', 'FLEX'].reduce((sum, key) => sum + (nextCounts[key] || 0), 0);
  if (starters > 9) return 'Total starters cannot exceed 9.';
  if ((nextCounts.QB || 0) > 1) return 'QB starters cannot exceed 1.';
  if ((nextCounts.RB || 0) > 2) return 'RB starters cannot exceed 2.';
  if ((nextCounts.WR || 0) > 2) return 'WR starters cannot exceed 2.';
  if ((nextCounts.TE || 0) > 1) return 'TE starters cannot exceed 1.';
  if ((nextCounts.FLEX || 0) > 3) return 'FLEX starters cannot exceed 3.';
  if ((nextCounts.BN || 0) > 9) return 'Total bench players cannot exceed 9.';
  if ((nextCounts.total || 0) > 18) return 'Total roster size cannot exceed 18.';

  return null;
}

function saveRosterSlotUpdate(teamId, playerId, nextSlot, isActive, nextPosition = null) {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    return Promise.resolve({ ok: false, error: 'No backend URL configured.' });
  }

  const positionValue = nextPosition !== null ? String(nextPosition || '').trim() : '';

  return fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'updateRosterSlot',
      sheet: 'Rosters',
      teamId: Number(teamId),
      playerId: String(playerId),
      slot: String(nextSlot || '').trim(),
      status: String(nextSlot || '').trim(),
      position: positionValue,
      active: Boolean(isActive)
    })
  }).then((response) => {
    if (!response.ok) {
      return { ok: false, error: 'Unable to save roster slot.' };
    }
    return response.json();
  }).then((payload) => {
    if (payload && payload.ok === false) {
      return { ok: false, error: payload.error || 'Unable to save roster slot.' };
    }
    return { ok: true, payload };
  }).catch(() => ({ ok: false, error: 'Unable to save roster slot.' }));
}

function loadRostersFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    setDataError('No backend URL configured for Google Apps Script.');
    return Promise.resolve();
  }

  return fetch(`${GOOGLE_APPS_SCRIPT_URL}?action=read&sheet=Rosters`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('Unable to load roster data');
      return response.json();
    })
    .then((payload) => {
      debugDataLoad('Rosters', `${GOOGLE_APPS_SCRIPT_URL}?action=read&sheet=Rosters`, payload);
      const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
      if (!rows.length) {
        state.rosterByTeam = {};
        state.teams.forEach((team) => {
          state.rosterByTeam[team.id] = [];
          state.rosterOrderByTeam[team.id] = [];
        });
        setDataError('Rosters sheet returned no data.');
        return;
      }

      const teamIdsByName = {};
      state.teams.forEach((team) => {
        teamIdsByName[team.name.toLowerCase()] = team.id;
      });

      const nextRosterByTeam = {};
      state.teams.forEach((team) => {
        nextRosterByTeam[team.id] = [];
      });

      rows.forEach((row) => {
        const rawTeamId = Number(row.teamid || row.team_id || row.teamId || row.team || row['team id'] || '');
        const teamName = String(row.team_name || row.team || row.name || '').trim();
        const playerName = String(row.player_name || row.player || row['player name'] || row.name || '').trim();
        const position = String(row.position || row.pos || row['Position'] || 'N/A').trim();
        const slot = String(row.slot || row.Slot || row['Slot'] || row['roster slot'] || '').trim();
        const rawStatus = String(row.status || row.Status || row['Status'] || '').trim();
        const active = String(row.active || row.is_active || row.isActive || row.Active || row['Active'] || '').trim();
        const rowPlayerId = String(row.sleeper_player_id || row.sleeperPlayerId || row['sleeper player id'] || row.player_id || row.playerId || row['player id'] || '').trim();

        if (!playerName) return;

        const resolvedTeamId = Number.isFinite(rawTeamId) && rawTeamId > 0 ? rawTeamId : (teamIdsByName[teamName.toLowerCase()] || resolveTeamId(teamName) || state.selectedTeamId || state.teams[0]?.id || null);
        if (!resolvedTeamId) return;

        const rawRosterSpot = normalizeRosterSpotValue(slot, rawStatus, active, position);
        const normalizedSlot = String(rawRosterSpot || '').trim();
        const normalizedStatus = String(rawStatus || rawRosterSpot || '').trim() || 'Bench';
        const resolvedPlayerId = /^\d+$/.test(rowPlayerId) ? rowPlayerId : findSleeperPlayerId({
          name: playerName,
          position,
          team: teamName,
          sleeperPlayerId: rowPlayerId,
          playerId: rowPlayerId
        });

        if (!resolvedPlayerId) return;

        const entry = {
          playerId: resolvedPlayerId,
          name: playerName,
          position,
          rosterSpot: normalizedSlot,
          slot: normalizedSlot,
          status: normalizedStatus,
          active: ['true', 'yes', 'y'].includes(active.toLowerCase())
        };

        nextRosterByTeam[resolvedTeamId] = nextRosterByTeam[resolvedTeamId] || [];
        const existingIndex = nextRosterByTeam[resolvedTeamId].findIndex((item) => String(item.playerId) === String(resolvedPlayerId));
        if (existingIndex >= 0) {
          nextRosterByTeam[resolvedTeamId][existingIndex] = entry;
        } else {
          nextRosterByTeam[resolvedTeamId].push(entry);
        }
      });

      state.rosterByTeam = nextRosterByTeam;
      state.teams.forEach((team) => {
        state.rosterOrderByTeam[team.id] = (state.rosterByTeam[team.id] || []).map((entry, index) => index + 1);
      });
    })
    .catch((error) => {
      state.rosterByTeam = {};
      state.teams.forEach((team) => {
        state.rosterByTeam[team.id] = [];
        state.rosterOrderByTeam[team.id] = [];
      });
      setDataError(error && error.message ? error.message : 'Unable to load roster data.');
    });
}

function loadMatchupsFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    setDataError('No backend URL configured for Google Apps Script.');
    return Promise.resolve(state.matchups);
  }

  return fetch(`${GOOGLE_APPS_SCRIPT_URL}?action=read&sheet=Matchups`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('Unable to load matchup data');
      return response.json();
    })
    .then((payload) => {
      debugDataLoad('Matchups', `${GOOGLE_APPS_SCRIPT_URL}?action=read&sheet=Matchups`, payload);
      const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
      if (!rows.length) {
        state.matchups = [];
        return state.matchups;
      }

      const nextMatchups = rows.map((row) => {
        const week = Number(pickFirstDefined(row, ['week', 'Week', 'week_number', 'matchup_week']) || 1);
        const teamAId = pickFirstDefined(row, ['team_a', 'teama_id', 'team_a_id', 'teamaid', 'TeamA', 'teamA', 'team1', 'TeamA_ID', 'teamA_ID']);
        const teamBId = pickFirstDefined(row, ['team_b', 'teamb_id', 'team_b_id', 'teambid', 'TeamB', 'teamB', 'team2', 'TeamB_ID', 'teamB_ID']);
        const scoreA = Number(pickFirstDefined(row, ['score_a', 'scorea', 'ScoreA', 'scoreA', 'team_a_score', 'points_a']) || 0);
        const scoreB = Number(pickFirstDefined(row, ['score_b', 'scoreb', 'ScoreB', 'scoreB', 'team_b_score', 'points_b']) || 0);

        const teamA = resolveTeamId(teamAId);
        const teamB = resolveTeamId(teamBId);
        if (!teamA || !teamB || !Number.isFinite(week)) {
          return null;
        }

        return {
          week,
          teamA,
          teamB,
          scoreA,
          scoreB
        };
      }).filter(Boolean);

      state.matchups = nextMatchups;
      return state.matchups;
    })
    .catch((error) => {
      state.matchups = [];
      setDataError(error && error.message ? error.message : 'Unable to load matchup data.');
      return state.matchups;
    });
}

function getHeadToHeadRecord(teamId) {
  const teamGames = state.matchups.filter((matchup) => matchup.teamA === teamId || matchup.teamB === teamId);
  let wins = 0;
  let losses = 0;

  teamGames.forEach((matchup) => {
    const teamScore = matchup.teamA === teamId ? matchup.scoreA : matchup.scoreB;
    const opponentScore = matchup.teamA === teamId ? matchup.scoreB : matchup.scoreA;
    if (teamScore > opponentScore) wins += 1;
    if (teamScore < opponentScore) losses += 1;
  });

  return { wins, losses, record: `${wins}-${losses}` };
}

function getSelectedTeamRoster() {
  return state.rosterByTeam[state.selectedTeamId] || [];
}

function pickFirstDefined(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function getCurrentMatchups() {
  return state.matchups.filter((matchup) => matchup.week === state.selectedWeek);
}

function getTeamName(teamId) {
  const team = state.teams.find((item) => item.id === Number(teamId));
  return team ? team.name : `Team ${teamId}`;
}

function formatScore(value) {
  return Number(value || 0).toFixed(1);
}

function renderStatCards() {
  const totalPlayers = state.teams.reduce((sum, team) => sum + (state.rosterByTeam[team.id] || []).length, 0);
  const starters = state.teams.reduce((sum, team) => {
    return sum + (state.rosterByTeam[team.id] || []).filter((entry) => {
      const slot = String(entry.rosterSpot || entry.slot || entry.status || '').trim().toUpperCase();
      const normalizedSlot = slot === 'BENCH' ? 'BN' : slot;
      return isStarterSlot(normalizedSlot);
    }).length;
  }, 0);
  const benches = state.teams.reduce((sum, team) => {
    return sum + (state.rosterByTeam[team.id] || []).filter((entry) => {
      const slot = String(entry.rosterSpot || entry.slot || entry.status || '').trim().toUpperCase();
      const normalizedSlot = slot === 'BENCH' ? 'BN' : slot;
      return isBenchSlot(normalizedSlot);
    }).length;
  }, 0);
  const avgTeamScore = getCurrentMatchups().reduce((sum, matchup) => sum + matchup.scoreA + matchup.scoreB, 0) / (getCurrentMatchups().length * 2 || 1);

  const totalPlayersEl = document.getElementById('dashboard-total-players');
  const startersEl = document.getElementById('dashboard-starters');
  const benchEl = document.getElementById('dashboard-bench');
  const matchupCountEl = document.getElementById('dashboard-matchups');
  const avgScoreEl = document.getElementById('dashboard-score');

  if (totalPlayersEl) totalPlayersEl.textContent = totalPlayers;
  if (startersEl) startersEl.textContent = starters;
  if (benchEl) benchEl.textContent = benches;
  if (matchupCountEl) matchupCountEl.textContent = getCurrentMatchups().length;
  if (avgScoreEl) avgScoreEl.textContent = formatScore(avgTeamScore);
}

function renderDashboard() {
  renderStatCards();

  const standingsTable = document.getElementById('standings-table-body');
  const standings = state.teams.map((team) => {
    const matchupScores = getCurrentMatchups().filter((m) => m.teamA === team.id || m.teamB === team.id);
    const total = matchupScores.reduce((sum, matchup) => {
      if (matchup.teamA === team.id) return sum + matchup.scoreA;
      if (matchup.teamB === team.id) return sum + matchup.scoreB;
      return sum;
    }, 0);
    const h2h = getHeadToHeadRecord(team.id);
    return { ...team, total, h2h };
  }).sort((a, b) => b.total - a.total);

  standingsTable.innerHTML = standings.map((team, index) => `
    <tr>
      <td>#${index + 1}</td>
      <td>${team.name}</td>
      <td>${formatScore(team.total)}</td>
      <td>${team.h2h.record}</td>
    </tr>
  `).join('');

  const matchupList = document.getElementById('matchup-list');
  if (matchupList) {
    matchupList.innerHTML = getCurrentMatchups().map((matchup) => {
      const winner = matchup.scoreA > matchup.scoreB ? matchup.teamA : matchup.teamB;
      return `
        <div class="matchup-item">
          <div>
            <strong>${getTeamName(matchup.teamA)}</strong>
            <span> vs </span>
            <strong>${getTeamName(matchup.teamB)}</strong>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span class="score-tag ${winner === matchup.teamA ? 'winner' : ''}">${formatScore(matchup.scoreA)}</span>
            <span class="score-tag ${winner === matchup.teamB ? 'winner' : ''}">${formatScore(matchup.scoreB)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const leaguePulse = document.getElementById('league-pulse');
  if (leaguePulse) {
    const pulseTeams = standings.slice(0, 3).map((team, index) => ({
      name: team.name,
      score: team.total,
      rank: index + 1
    }));

    leaguePulse.innerHTML = pulseTeams.map((team) => `
      <div class="matchup-item">
        <div>
          <strong>#${team.rank} ${team.name}</strong>
        </div>
        <div class="score-tag winner">${formatScore(team.score)}</div>
      </div>
    `).join('');
  }

  const teamMomentum = document.getElementById('team-momentum');
  if (teamMomentum) {
    teamMomentum.innerHTML = standings.slice(0, 4).map((team, index) => {
      const momentumScore = 120 + (standings.length - index) * 5;
      return `
        <div class="matchup-item">
          <div>
            <strong>${team.name}</strong>
          </div>
          <div class="score-tag ${index === 0 ? 'winner' : ''}">${formatScore(momentumScore)}</div>
        </div>
      `;
    }).join('');
  }
}

function renderRosters() {
  const teamSelect = document.getElementById('roster-team-select');
  if (teamSelect) {
    teamSelect.innerHTML = state.teams.map((team) => `
      <option value="${team.id}" ${team.id === state.selectedTeamId ? 'selected' : ''}>${team.name}</option>
    `).join('');
  }

  const rosterBody = document.getElementById('roster-table-body');
  const roster = getSelectedTeamRoster();
  if (!rosterBody) return;

  if (!roster.length) {
    rosterBody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No roster entries yet.</div></td></tr>';
    return;
  }

  rosterBody.innerHTML = roster.map((entry) => {
    const currentSpot = String(entry.rosterSpot || entry.slot || entry.status || 'Bench');
    const isTaken = state.draftOwnership[String(entry.playerId)] === true;
    const rowClass = isTaken ? 'draft-taken-row' : '';

    return `
      <tr class="${rowClass}">
        <td><strong class="${isTaken ? 'crossed-out' : ''}">${entry.name}</strong></td>
        <td>${entry.position || 'N/A'}</td>
        <td>${entry.playerId}</td>
        <td><span class="status-pill ${currentSpot.toLowerCase().replace(/\s+/g, '-')}">${currentSpot}</span></td>
        <td>
          <div class="roster-controls">
            <select data-player-id="${entry.playerId}" data-team-id="${state.selectedTeamId}" class="slot-select">
              <option value="QB" ${currentSpot === 'QB' ? 'selected' : ''}>QB</option>
              <option value="RB" ${currentSpot === 'RB' ? 'selected' : ''}>RB</option>
              <option value="WR" ${currentSpot === 'WR' ? 'selected' : ''}>WR</option>
              <option value="TE" ${currentSpot === 'TE' ? 'selected' : ''}>TE</option>
              <option value="FLEX" ${currentSpot === 'FLEX' ? 'selected' : ''}>FLEX</option>
              <option value="BN" ${currentSpot === 'BN' || currentSpot === 'Bench' ? 'selected' : ''}>BN</option>
              <option value="IR" ${currentSpot === 'IR' ? 'selected' : ''}>IR</option>
            </select>
            <label class="inline-toggle">
              <input type="checkbox" data-player-id="${entry.playerId}" data-team-id="${state.selectedTeamId}" class="active-toggle" ${Boolean(entry.active) ? 'checked' : ''} />
              Active
            </label>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderMatchups() {
  const matchupList = document.getElementById('matchup-detail-list');
  if (!matchupList) return;

  const weekValue = Number(document.getElementById('matchup-week-select').value || state.selectedWeek);
  const matchups = state.matchups.filter((match) => match.week === weekValue);

  matchupList.innerHTML = matchups.map((matchup) => {
    const teamA = getTeamName(matchup.teamA);
    const teamB = getTeamName(matchup.teamB);
    const winner = matchup.scoreA > matchup.scoreB ? teamA : teamB;
    return `
      <div class="matchup-item">
        <div>
          <strong>${teamA}</strong>
          <span> vs </span>
          <strong>${teamB}</strong>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="score-tag ${winner === teamA ? 'winner' : ''}">${formatScore(matchup.scoreA)}</span>
          <span class="score-tag ${winner === teamB ? 'winner' : ''}">${formatScore(matchup.scoreB)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderDraftUI() {
  const draftGrid = document.getElementById('draft-grid');
  const roundLabel = document.getElementById('round-label');
  if (!draftGrid || !roundLabel) return;

  const roundCount = state.draftOrder.length;
  roundLabel.textContent = `Draft rounds: ${roundCount}`;

  draftGrid.innerHTML = state.draftOrder.map((round, roundIndex) => `
    <div class="pick-box">
      <label>Round ${roundIndex + 1}</label>
      ${round.map((teamId, pickIdx) => `
        <div style="margin-top: 8px;">
          <strong>P${pickIdx + 1}:</strong> ${getTeamName(teamId)}
        </div>
      `).join('')}
    </div>
  `).join('');

  const teamHistory = document.getElementById('team-history-body');
  if (teamHistory) {
    teamHistory.innerHTML = state.teams.map((team) => {
      const teamRounds = state.draftOrder.map((round) => round.indexOf(team.id) + 1);
      return `
        <tr>
          <td>${team.name}</td>
          ${teamRounds.map((slot) => `<td>${slot > 0 ? slot : '-'}</td>`).join('')}
        </tr>
      `;
    }).join('');
  }
}

function setActiveTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.dataset.page === tabName));
  document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
}

function bindEvents() {
  const rosterSelect = document.getElementById('roster-team-select');
  if (rosterSelect) {
    rosterSelect.addEventListener('change', (event) => {
      state.selectedTeamId = Number(event.target.value);
      renderRosters();
    });
  }

  const matchupWeekSelect = document.getElementById('matchup-week-select');
  if (matchupWeekSelect) {
    matchupWeekSelect.addEventListener('change', (event) => {
      state.selectedWeek = Number(event.target.value);
      renderMatchups();
      renderDashboard();
    });
  }

  const rosterBody = document.getElementById('roster-table-body');
  if (rosterBody) {
    rosterBody.addEventListener('change', (event) => {
      const slotTarget = event.target.closest('.slot-select');
      if (slotTarget) {
        const teamId = Number(slotTarget.dataset.teamId);
        const playerId = slotTarget.dataset.playerId;
        const nextSlot = slotTarget.value;
        const validationError = validateRosterSlotChange(teamId, playerId, nextSlot);
        if (validationError) {
          setDataError(validationError);
          renderRosters();
          return;
        }

        const currentEntry = state.rosterByTeam[teamId]?.find((entry) => String(entry.playerId) === String(playerId));
        const nextActive = Boolean(currentEntry && currentEntry.active);
        saveRosterSlotUpdate(teamId, playerId, nextSlot, nextActive).then((result) => {
          if (!result.ok) {
            setDataError(result.error || 'Unable to save roster slot.');
            renderRosters();
            return;
          }

          if (currentEntry) {
            currentEntry.rosterSpot = nextSlot;
            currentEntry.slot = nextSlot;
            currentEntry.status = nextSlot;
          }
          setDataError('Roster updated.');
          renderRosters();
        });
        return;
      }

      const activeTarget = event.target.closest('.active-toggle');
      if (activeTarget) {
        const teamId = Number(activeTarget.dataset.teamId);
        const playerId = activeTarget.dataset.playerId;
        const currentEntry = state.rosterByTeam[teamId]?.find((entry) => String(entry.playerId) === String(playerId));
        if (!currentEntry) return;

        currentEntry.active = activeTarget.checked;
        saveRosterSlotUpdate(teamId, playerId, currentEntry.rosterSpot || currentEntry.slot || currentEntry.status || 'BN', currentEntry.active).then((result) => {
          if (!result.ok) {
            setDataError(result.error || 'Unable to save active flag.');
            renderRosters();
            return;
          }
          setDataError('Active flag updated.');
          renderRosters();
        });
      }
    });
  }

  const navTabs = document.querySelectorAll('.nav-tab');
  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  const syncButton = document.getElementById('sync-stats-button');
  if (syncButton) {
    syncButton.addEventListener('click', () => {
      document.getElementById('sync-status').textContent = 'Sync started...';
      fetch('https://api.sleeper.app/v1/players/nfl', { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Sync failed')))
        .then((data) => {
          state.allPlayers = normalizePlayerPayload(data);
          localStorage.setItem('fantasy_sleeper_players', JSON.stringify(data));
          document.getElementById('sync-status').textContent = 'Last synced: just now';
        })
        .catch(() => {
          document.getElementById('sync-status').textContent = 'Sync failed. Using local snapshot.';
        });
    });
  }

  const refreshButton = document.getElementById('refresh-sleeper-button');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      const status = document.getElementById('sync-status');
      refreshButton.disabled = true;
      refreshButton.textContent = 'Refreshing...';
      if (status) status.textContent = 'Refreshing live Sleeper data...';

      fetch('https://api.sleeper.app/v1/players/nfl', { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Refresh failed')))
        .then((data) => {
          state.allPlayers = normalizePlayerPayload(data);
          localStorage.setItem('fantasy_sleeper_players', JSON.stringify(data));
          if (status) status.textContent = 'Live Sleeper data refreshed in this browser session.';
        })
        .catch(() => {
          if (status) status.textContent = 'Refresh failed. Using the local snapshot instead.';
        })
        .finally(() => {
          refreshButton.disabled = false;
          refreshButton.textContent = 'Refresh Sleeper data';
        });
    });
  }

  const lockButton = document.getElementById('lock-week-button');
  if (lockButton) {
    lockButton.addEventListener('click', () => {
      const lockStatus = document.getElementById('lock-status');
      if (lockStatus) lockStatus.textContent = `Week ${state.selectedWeek} lineup snapshot saved.`;
    });
  }
}

function init() {
  initRosterState();
  bindEvents();

  const matchupWeekSelect = document.getElementById('matchup-week-select');
  if (matchupWeekSelect) {
    matchupWeekSelect.value = String(state.selectedWeek);
  }

  const startup = [
    loadTeamsFromSheet(),
    loadMatchupsFromSheet(),
    loadRostersFromSheet()
  ];

  Promise.all(startup).then(() => {
    renderDashboard();
    renderRosters();
    renderMatchups();
    renderDraftUI();
    setActiveTab('dashboard');
  });
}

window.addEventListener('DOMContentLoaded', init);
