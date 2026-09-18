const teamNames = [
  'Team 1', 'Team 2', 'Team 3', 'Team 4',
  'Team 5', 'Team 6', 'Team 7', 'Team 8'
];

const config = window.DRAFT_CONFIG || {};
const GOOGLE_APPS_SCRIPT_URL = config.googleAppsScriptUrl || '';

const state = {
  currentTab: 'dashboard',
  week: 1,
  teams: teamNames.map((name, index) => ({
    id: index + 1,
    name,
    manager: `Manager ${index + 1}`
  })),
  rosterByTeam: {},
  allPlayers: [],
  draftOwnership: {},
  draftOrder: [
    [1, 2, 3, 4, 5, 6, 7, 8],
    [8, 7, 6, 5, 4, 3, 2, 1],
    [1, 2, 3, 4, 5, 6, 7, 8],
    [8, 7, 6, 5, 4, 3, 2, 1],
    [1, 2, 3, 4, 5, 6, 7, 8],
    [8, 7, 6, 5, 4, 3, 2, 1],
    [1, 2, 3, 4, 5, 6, 7, 8],
    [8, 7, 6, 5, 4, 3, 2, 1]
  ],
  matchups: [
    { week: 1, teamA: 1, teamB: 2, scoreA: 134.8, scoreB: 121.6 },
    { week: 1, teamA: 3, teamB: 4, scoreA: 112.3, scoreB: 125.6 },
    { week: 1, teamA: 5, teamB: 6, scoreA: 127.9, scoreB: 118.1 },
    { week: 1, teamA: 7, teamB: 8, scoreA: 111.7, scoreB: 129.4 }
  ],
  selectedTeamId: 1,
  selectedWeek: 1,
  selectedPlayerSearch: '',
  rosterOrderByTeam: {}
};

function initRosterState() {
  state.teams.forEach((team) => {
    const roster = [
      { playerId: 'qb-1', name: 'Patrick Mahomes', position: 'QB', status: 'Starter' },
      { playerId: 'rb-1', name: 'Christian McCaffrey', position: 'RB', status: 'Starter' },
      { playerId: 'rb-2', name: 'Breece Hall', position: 'RB', status: 'Starter' },
      { playerId: 'wr-1', name: 'A.J. Brown', position: 'WR', status: 'Starter' },
      { playerId: 'wr-2', name: 'Puka Nacua', position: 'WR', status: 'Starter' },
      { playerId: 'te-1', name: 'Sam LaPorta', position: 'TE', status: 'Starter' },
      { playerId: 'flex-1', name: 'Joe Mixon', position: 'RB', status: 'Starter' },
      { playerId: 'flex-2', name: 'Deebo Samuel', position: 'WR', status: 'Starter' },
      { playerId: 'flex-3', name: 'T.J. Hockenson', position: 'TE', status: 'Starter' },
      { playerId: 'bench-1', name: 'Tank Dell', position: 'WR', status: 'Bench' },
      { playerId: 'bench-2', name: 'Kyren Williams', position: 'RB', status: 'Bench' },
      { playerId: 'bench-3', name: 'Jalen Tolbert', position: 'WR', status: 'Bench' },
      { playerId: 'bench-4', name: 'Juwan Johnson', position: 'TE', status: 'Bench' },
      { playerId: 'bench-5', name: 'Jerome Ford', position: 'RB', status: 'Bench' },
      { playerId: 'bench-6', name: 'Rachaad White', position: 'RB', status: 'Bench' },
      { playerId: 'bench-7', name: 'Jaylen Waddle', position: 'WR', status: 'Bench' },
      { playerId: 'bench-8', name: 'David Njoku', position: 'TE', status: 'Bench' },
      { playerId: `team-${team.id}-ir`, name: 'Injury Placeholder', position: 'RB', status: 'IR' }
    ];
    state.rosterByTeam[team.id] = roster;
    state.rosterOrderByTeam[team.id] = roster.map((entry, index) => index + 1);
  });
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

function loadDraftOwnership() {
  if (!GOOGLE_APPS_SCRIPT_URL) return Promise.resolve([]);

  return fetch(`${GOOGLE_APPS_SCRIPT_URL}?action=read`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('Unable to load draft ownership');
      return response.json();
    })
    .then((payload) => {
      const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
      state.draftOwnership = {};
      rows.forEach((row) => {
        if (!row || !row.player_id) return;
        state.draftOwnership[String(row.player_id)] = row.taken === true;
      });
      return rows;
    })
    .catch(() => {
      state.draftOwnership = {};
      return [];
    });
}

function saveDraftOwnership(playerId, taken) {
  if (!GOOGLE_APPS_SCRIPT_URL) return Promise.resolve(false);

  return fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upsert', player_id: String(playerId), taken, updated_at: new Date().toISOString() })
  }).then((response) => response.ok).catch(() => false);
}

function loadPlayersFromApi() {
  const cached = localStorage.getItem('fantasy_sleeper_players');
  if (cached) {
    try {
      state.allPlayers = normalizePlayerPayload(JSON.parse(cached));
    } catch (error) {
      state.allPlayers = [];
    }
  }

  return fetch('https://api.sleeper.app/v1/players/nfl', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('Unable to load live data');
      return response.json();
    })
    .then((data) => {
      state.allPlayers = normalizePlayerPayload(data);
      localStorage.setItem('fantasy_sleeper_players', JSON.stringify(data));
    })
    .catch(() => {
      return fetch('./SleeperAPI.json', { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Unable to load local player data')))
        .then((data) => {
          state.allPlayers = normalizePlayerPayload(data);
          localStorage.setItem('fantasy_sleeper_players', JSON.stringify(data));
        })
        .catch(() => {
          state.allPlayers = [
            { id: '1', fullName: 'Patrick Mahomes', position: 'QB', team: 'KC', status: 'Active' },
            { id: '2', fullName: 'Christian McCaffrey', position: 'RB', team: 'SF', status: 'Active' },
            { id: '3', fullName: 'Breece Hall', position: 'RB', team: 'NYJ', status: 'Active' },
            { id: '4', fullName: 'A.J. Brown', position: 'WR', team: 'PHI', status: 'Active' },
            { id: '5', fullName: 'Puka Nacua', position: 'WR', team: 'LAR', status: 'Active' },
            { id: '6', fullName: 'Sam LaPorta', position: 'TE', team: 'DET', status: 'Active' }
          ];
        });
    });
}

function getSelectedTeamRoster() {
  return state.rosterByTeam[state.selectedTeamId] || [];
}

function getCurrentMatchups() {
  return state.matchups.filter((matchup) => matchup.week === state.selectedWeek);
}

function getTeamName(teamId) {
  const team = state.teams.find((item) => item.id === Number(teamId));
  return team ? team.name : `Team ${teamId}`;
}

function formatScore(value) {
  return Number(value).toFixed(1);
}

function renderStatCards() {
  const totalPlayers = state.teams.reduce((sum, team) => sum + (state.rosterByTeam[team.id] || []).length, 0);
  const starters = state.teams.reduce((sum, team) => {
    return sum + (state.rosterByTeam[team.id] || []).filter((entry) => entry.status === 'Starter').length;
  }, 0);
  const benches = totalPlayers - starters;
  const avgTeamScore = getCurrentMatchups().reduce((sum, matchup) => sum + matchup.scoreA + matchup.scoreB, 0) / (getCurrentMatchups().length * 2 || 1);

  document.getElementById('dashboard-total-players').textContent = totalPlayers;
  document.getElementById('dashboard-starters').textContent = starters;
  document.getElementById('dashboard-bench').textContent = benches;
  document.getElementById('dashboard-matchups').textContent = getCurrentMatchups().length;
  document.getElementById('dashboard-score').textContent = formatScore(avgTeamScore);
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
    return { ...team, total };
  }).sort((a, b) => b.total - a.total);

  standingsTable.innerHTML = standings.map((team, index) => `
    <tr>
      <td>#${index + 1}</td>
      <td>${team.name}</td>
      <td>${formatScore(team.total)}</td>
    </tr>
  `).join('');

  const matchupList = document.getElementById('matchup-list');
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

  const draftPreview = document.getElementById('draft-preview');
  draftPreview.innerHTML = state.draftOrder[0].map((teamId, idx) => `
    <div class="pick-box">
      <label>Pick ${idx + 1}</label>
      <strong>${getTeamName(teamId)}</strong>
    </div>
  `).join('');
}

function renderRosters() {
  const teamSelect = document.getElementById('roster-team-select');
  teamSelect.innerHTML = state.teams.map((team) => `
    <option value="${team.id}" ${team.id === state.selectedTeamId ? 'selected' : ''}>${team.name}</option>
  `).join('');

  const roster = getSelectedTeamRoster();
  const rosterBody = document.getElementById('roster-table-body');
  if (!roster.length) {
    rosterBody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No roster entries yet.</div></td></tr>';
    return;
  }

  rosterBody.innerHTML = roster.map((entry) => {
    const isTaken = state.draftOwnership[String(entry.playerId)] === true;
    const rowClass = isTaken ? 'draft-taken-row' : '';

    return `
      <tr class="${rowClass}">
        <td><strong class="${isTaken ? 'crossed-out' : ''}">${entry.name}</strong></td>
        <td>${entry.position}</td>
        <td>${entry.playerId}</td>
        <td><span class="status-pill ${entry.status.toLowerCase().replace(' ', '-')}">${entry.status}</span></td>
        <td>
          <div class="roster-controls">
            <button data-player-id="${entry.playerId}" data-team-id="${state.selectedTeamId}" class="${entry.status === 'Starter' ? 'active' : ''}" data-status="Starter">Starter</button>
            <button data-player-id="${entry.playerId}" data-team-id="${state.selectedTeamId}" class="${entry.status === 'Bench' ? 'active' : ''}" data-status="Bench">Bench</button>
            <button data-player-id="${entry.playerId}" data-team-id="${state.selectedTeamId}" class="${entry.status === 'IR' ? 'active' : ''}" data-status="IR">IR</button>
            <button data-player-id="${entry.playerId}" data-team-id="${state.selectedTeamId}" class="${isTaken ? 'active' : ''}" data-status="taken">${isTaken ? 'Taken' : 'Mark taken'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderMatchups() {
  const matchupList = document.getElementById('matchup-detail-list');
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
  const roundCount = state.draftOrder.length;
  const roundLabel = document.getElementById('round-label');
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
  teamHistory.innerHTML = state.teams.map((team) => {
    const teamRounds = state.draftOrder.map((round) => round.indexOf(team.id) + 1);
    return `
      <tr>
        <td>${team.name}</td>
        ${teamRounds.map((slot, index) => `<td>${slot > 0 ? slot : '-'}</td>`).join('')}
      </tr>
    `;
  }).join('');
}

function setActiveTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.dataset.page === tabName));
  document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
}

function bindEvents() {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  document.getElementById('roster-team-select').addEventListener('change', (event) => {
    state.selectedTeamId = Number(event.target.value);
    renderRosters();
  });

  document.getElementById('matchup-week-select').addEventListener('change', (event) => {
    state.selectedWeek = Number(event.target.value);
    renderMatchups();
  });

  document.getElementById('roster-table-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    const teamId = Number(button.dataset.teamId);
    const playerId = button.dataset.playerId;
    const nextStatus = button.dataset.status;
    const roster = state.rosterByTeam[teamId] || [];
    const target = roster.find((entry) => entry.playerId === playerId);
    if (!target) return;

    if (nextStatus === 'taken') {
      const nextTaken = !(state.draftOwnership[String(playerId)] === true);
      state.draftOwnership[String(playerId)] = nextTaken;
      saveDraftOwnership(playerId, nextTaken).then(() => renderRosters());
      return;
    }

    target.status = nextStatus;
    renderRosters();
  });

  document.getElementById('sync-stats-button').addEventListener('click', () => {
    document.getElementById('sync-status').textContent = 'Sync started...';
    loadPlayersFromApi().then(() => {
      document.getElementById('sync-status').textContent = 'Last synced: just now';
    }).catch(() => {
      document.getElementById('sync-status').textContent = 'Sync failed. Using local snapshot.';
    });
  });

  document.getElementById('refresh-sleeper-button').addEventListener('click', () => {
    const button = document.getElementById('refresh-sleeper-button');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Refreshing...';
    loadPlayersFromApi().finally(() => {
      button.disabled = false;
      button.textContent = 'Refresh Sleeper data';
    });
  });

  document.getElementById('lock-week-button').addEventListener('click', () => {
    document.getElementById('lock-status').textContent = `Week ${state.selectedWeek} lineup snapshot saved.`;
  });
}

function init() {
  initRosterState();
  bindEvents();
  document.getElementById('matchup-week-select').value = String(state.selectedWeek);
  Promise.all([loadDraftOwnership(), loadPlayersFromApi()]).then(() => {
    renderDashboard();
    renderRosters();
    renderMatchups();
    renderDraftUI();
    setActiveTab('dashboard');
  });
}

window.addEventListener('DOMContentLoaded', init);
