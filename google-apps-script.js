function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return jsonResponse({ ok: true, status: 'ok' });
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const sheetName = String(params.sheet || 'Rosters').trim();
  const action = String(params.action || 'read').trim().toLowerCase();

  if (action === 'read') {
    return jsonResponse({ ok: true, sheet: sheetName, rows: getSheetRows(sheetName) });
  }

  return jsonResponse({ ok: false, error: 'Unsupported GET action' });
}

function doPost(e) {
  const payload = safeParse(e && e.postData && e.postData.contents);
  const action = String(payload.action || 'upsert').trim().toLowerCase();
  const sheetName = String(payload.sheet || 'Rosters').trim();

  if (action === 'upsert') {
    const row = writeOwnershipRow(sheetName, payload.player_id, payload.taken === true, payload.updated_at || new Date().toISOString());
    return jsonResponse({ ok: true, sheet: sheetName, row: row });
  }

  if (action === 'read') {
    return jsonResponse({ ok: true, sheet: sheetName, rows: getSheetRows(sheetName) });
  }

  if (action === 'updaterosterslot') {
    return updateRosterSlot(payload);
  }

  if (action === 'updaterow') {
    return updateRosterSlot(payload);
  }

  return jsonResponse({ ok: false, error: 'Unsupported POST action' });
}

function safeParse(str) {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch (error) {
    return {};
  }
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

function getHeaderIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function getSheetRows(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(normalizeHeader);
  const rows = [];

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index];
    });

    rows.push(item);
  }

  return rows;
}

function getTeamRows() {
  const sheet = getSheet('Teams');
  const values = sheet.getDataRange().getValues();
  const rows = [];

  if (!values.length) return rows;

  const headers = values[0].map(normalizeHeader);
  const teamIdIndex = getHeaderIndex(headers, ['team_id', 'teamid', 'id', 'team_id_']);
  const teamNameIndex = getHeaderIndex(headers, ['team_name', 'team_name_', 'team', 'name']);
  const managerIndex = getHeaderIndex(headers, ['manager', 'manager_name', 'owner']);

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const rawTeamName = teamNameIndex !== -1 ? row[teamNameIndex] : row[1];
    if (rawTeamName === undefined || String(rawTeamName).trim() === '') continue;

    const teamId = teamIdIndex !== -1 ? row[teamIdIndex] : i;
    const manager = managerIndex !== -1 ? row[managerIndex] : '';

    rows.push({
      id: Number(teamId) || i,
      name: String(rawTeamName).trim(),
      manager: manager !== undefined && manager !== null ? String(manager).trim() : ''
    });
  }

  return rows.filter((row) => row.name);
}

function getRosterRows() {
  const sheet = getSheet('Rosters');
  const values = sheet.getDataRange().getValues();
  const rows = [];

  if (!values.length) return rows;

  const headers = values[0].map(normalizeHeader);
  const teamIdIndex = getHeaderIndex(headers, ['teamid', 'team_id', 'team_id_', 'team']);
  const teamNameIndex = getHeaderIndex(headers, ['team_name', 'team_name_', 'team']);
  const playerNameIndex = getHeaderIndex(headers, ['player_name', 'player_name_', 'player', 'name']);
  const playerIdIndex = getHeaderIndex(headers, ['sleeper_player_id', 'sleeper_player_id_', 'player_id', 'player_id_', 'player_id_1', 'player_id_2']);
  const positionIndex = getHeaderIndex(headers, ['position', 'pos']);
  const slotIndex = getHeaderIndex(headers, ['slot', 'roster_spot']);
  const statusIndex = getHeaderIndex(headers, ['status']);
  const activeIndex = getHeaderIndex(headers, ['active', 'is_active']);

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const teamValue = teamIdIndex !== -1 ? row[teamIdIndex] : teamNameIndex !== -1 ? row[teamNameIndex] : '';
    const playerName = playerNameIndex !== -1 ? row[playerNameIndex] : '';
    if (!teamValue && !playerName) continue;

    const playerId = playerIdIndex !== -1 ? String(row[playerIdIndex] || '').trim() : '';
    rows.push({
      teamid: teamValue,
      team_name: String(teamValue || '').trim(),
      player_name: String(playerName || '').trim(),
      player: String(playerName || '').trim(),
      sleeper_player_id: playerId,
      player_id: playerId,
      position: positionIndex !== -1 ? String(row[positionIndex] || '').trim() : 'N/A',
      slot: slotIndex !== -1 ? String(row[slotIndex] || '').trim() : '',
      status: statusIndex !== -1 ? String(row[statusIndex] || '').trim() : '',
      active: activeIndex !== -1 ? normalizeBoolean(row[activeIndex]) : false
    });
  }

  return rows.filter((row) => row.player_name || row.player_id || row.player);
}

function normalizeBoolean(value) {
  if (value === true || value === 1 || value === 'TRUE' || value === 'true' || value === 'Yes' || value === 'yes') return true;
  if (value === false || value === 0 || value === 'FALSE' || value === 'false' || value === 'No' || value === 'no') return false;
  return String(value || '').trim().toLowerCase() === 'true';
}

function writeOwnershipRow(sheetName, playerId, taken, updatedAt) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();

  if (!values.length) {
    sheet.appendRow(['player_id', 'taken', 'updated_at']);
  }

  const headers = (sheet.getDataRange().getValues()[0] || []).map(normalizeHeader);
  const playerIdIndex = getHeaderIndex(headers, ['player_id']);
  const takenIndex = getHeaderIndex(headers, ['taken']);
  const updatedAtIndex = getHeaderIndex(headers, ['updated_at']);

  if (playerIdIndex === -1) {
    sheet.appendRow(['player_id', 'taken', 'updated_at']);
    return writeOwnershipRow(sheetName, playerId, taken, updatedAt);
  }

  const allRows = sheet.getDataRange().getValues();
  let foundRow = -1;
  for (let i = 1; i < allRows.length; i += 1) {
    if (String(allRows[i][playerIdIndex] || '') === String(playerId)) {
      foundRow = i;
      break;
    }
  }

  const row = [];
  while (row.length < Math.max(headers.length, 3)) row.push('');
  row[playerIdIndex] = String(playerId);
  row[takenIndex] = taken ? 'TRUE' : 'FALSE';
  row[updatedAtIndex] = updatedAt;

  if (foundRow >= 0) {
    sheet.getRange(foundRow + 1, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { player_id: String(playerId), taken: taken ? 'TRUE' : 'FALSE', updated_at: updatedAt };
}

function updateRosterSlot(payload) {
  const sheet = getSheet('Rosters');
  const values = sheet.getDataRange().getValues();

  if (!values.length) {
    sheet.appendRow(['TeamID', 'Player Name', 'Sleeper Player ID', 'Position', 'Slot', 'Status', 'Active', 'Weekly Points']);
  }

  const headers = (sheet.getDataRange().getValues()[0] || []).map(normalizeHeader);
  const teamIdIndex = getHeaderIndex(headers, ['teamid', 'team_id', 'team_id_']);
  const playerNameIndex = getHeaderIndex(headers, ['player_name', 'player', 'name']);
  const sleeperIdIndex = getHeaderIndex(headers, ['sleeper_player_id', 'sleeper_player_id_', 'player_id', 'player_id_']);
  const positionIndex = getHeaderIndex(headers, ['position', 'pos']);
  const slotIndex = getHeaderIndex(headers, ['slot', 'roster_spot']);
  const statusIndex = getHeaderIndex(headers, ['status']);
  const activeIndex = getHeaderIndex(headers, ['active', 'is_active']);

  const teamId = String(payload.teamId || payload.team_id || payload.teamid || '').trim();
  const playerId = String(payload.playerId || payload.player_id || payload.sleeperPlayerId || payload.sleeper_player_id || '').trim();
  const playerName = String(payload.playerName || payload.player_name || '').trim();
  const nextSlot = String(payload.slot || payload.status || '').trim() || 'BN';
  const nextStatus = String(payload.status || payload.slot || '').trim() || nextSlot;
  const nextPosition = String(payload.position || '').trim();
  const activeValue = normalizeBoolean(payload.active);

  const rowValues = sheet.getDataRange().getValues();
  let foundRow = -1;

  for (let i = 1; i < rowValues.length; i += 1) {
    const row = rowValues[i];
    const rowTeam = teamIdIndex !== -1 ? String(row[teamIdIndex] || '').trim() : '';
    const rowPlayerId = sleeperIdIndex !== -1 ? String(row[sleeperIdIndex] || '').trim() : '';
    if (teamId && rowTeam === teamId && rowPlayerId === playerId) {
      foundRow = i;
      break;
    }
    if (!teamId && rowPlayerId === playerId) {
      foundRow = i;
      break;
    }
  }

  const row = [];
  while (row.length < Math.max(headers.length, 8)) row.push('');

  if (teamIdIndex !== -1) row[teamIdIndex] = teamId;
  if (playerNameIndex !== -1) row[playerNameIndex] = playerName || (foundRow !== -1 ? rowValues[foundRow][playerNameIndex] || '' : '');
  if (sleeperIdIndex !== -1) row[sleeperIdIndex] = playerId;
  if (positionIndex !== -1) row[positionIndex] = nextPosition || (foundRow !== -1 ? rowValues[foundRow][positionIndex] || '' : '');
  if (slotIndex !== -1) row[slotIndex] = nextSlot;
  if (statusIndex !== -1) row[statusIndex] = nextStatus;
  if (activeIndex !== -1) row[activeIndex] = activeValue ? 'TRUE' : 'FALSE';

  if (foundRow >= 0) {
    sheet.getRange(foundRow + 1, 1, 1, row.length).setValues([row]);
    return jsonResponse({ ok: true, updated: true, row });
  }

  const newRow = [];
  while (newRow.length < Math.max(headers.length, 8)) newRow.push('');
  if (teamIdIndex !== -1) newRow[teamIdIndex] = teamId;
  if (playerNameIndex !== -1) newRow[playerNameIndex] = playerName;
  if (sleeperIdIndex !== -1) newRow[sleeperIdIndex] = playerId;
  if (positionIndex !== -1) newRow[positionIndex] = nextPosition;
  if (slotIndex !== -1) newRow[slotIndex] = nextSlot;
  if (statusIndex !== -1) newRow[statusIndex] = nextStatus;
  if (activeIndex !== -1) newRow[activeIndex] = activeValue ? 'TRUE' : 'FALSE';

  sheet.appendRow(newRow);
  return jsonResponse({ ok: true, updated: true, created: true, row: newRow });
}

function getSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    if (sheetName === 'Teams') {
      sheet.appendRow(['TeamID', 'Team Name', 'Manager']);
    } else if (sheetName === 'Rosters') {
      sheet.appendRow(['TeamID', 'Player Name', 'Sleeper Player ID', 'Position', 'Slot', 'Status', 'Active', 'Weekly Points']);
    } else if (sheetName === 'Matchups') {
      sheet.appendRow(['Week', 'Team A', 'Team B', 'Score A', 'Score B']);
    } else {
      sheet.appendRow(['player_id', 'taken', 'updated_at']);
    }
  }

  return sheet;
}

function getDraftRows() {
  return getSheetRows('DraftOwnership');
}

function writeDraftRow(playerId, taken, updatedAt) {
  return writeOwnershipRow('DraftOwnership', playerId, taken, updatedAt);
}
