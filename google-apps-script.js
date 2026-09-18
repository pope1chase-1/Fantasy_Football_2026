function doGet(e) {
  const sheetName = (e && e.parameter && e.parameter.sheet) || 'RosterOwnership';
  const rows = sheetName === 'Teams' ? getTeamRows() : sheetName === 'Rosters' ? getRosterRows() : getSheetRows(sheetName);
  return ContentService.createTextOutput(JSON.stringify({ rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const action = payload.action || 'upsert';
  const sheetName = payload.sheet || 'RosterOwnership';

  if (action === 'upsert') {
    writeOwnershipRow(sheetName, payload.player_id, payload.taken === true, payload.updated_at || new Date().toISOString());
    return ContentService.createTextOutput(JSON.stringify({ ok: true, sheet: sheetName }));
  }

  if (action === 'read') {
    const rows = sheetName === 'Teams' ? getTeamRows() : sheetName === 'Rosters' ? getRosterRows() : getSheetRows(sheetName);
    return ContentService.createTextOutput(JSON.stringify({ rows: rows }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unsupported action' }));
}

function getSheetRows(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map((value) => String(value || '').trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index];
    });

    rows.push({
      player_id: String(item.player_id || ''),
      taken: String(item.taken || '').toLowerCase() === 'true' || item.taken === true,
      updated_at: item.updated_at || new Date().toISOString()
    });
  }

  return rows.filter((row) => row.player_id);
}

function getTeamRows() {
  const sheet = getSheet('Teams');
  const values = sheet.getDataRange().getValues();
  const rows = [];

  if (!values.length) return rows;

  const headers = values[0].map((value) => String(value || '').trim().toLowerCase());
  const teamIdIndex = headers.findIndex((header) => ['team id', 'id', 'teamid'].includes(header));
  const teamNameIndex = headers.findIndex((header) => ['team name', 'team_name', 'team', 'name'].includes(header));
  const managerIndex = headers.findIndex((header) => ['manager', 'manager name', 'owner'].includes(header));

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const rawTeamName = teamNameIndex !== -1 ? row[teamNameIndex] : row[1];
    if (rawTeamName === undefined || String(rawTeamName).trim() === '') continue;

    const teamId = teamIdIndex !== -1 ? row[teamIdIndex] : i;
    const manager = managerIndex !== -1 ? row[managerIndex] : row[2];

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

  const headers = values[0].map((value) => String(value || '').trim().toLowerCase());
  const teamIndex = headers.indexOf('team') !== -1 ? headers.indexOf('team') : headers.indexOf('team name');
  const teamNameIndex = headers.indexOf('team_name') !== -1 ? headers.indexOf('team_name') : headers.indexOf('team name');
  const playerNameIndex = headers.indexOf('player') !== -1 ? headers.indexOf('player') : headers.indexOf('player name');
  const playerIdIndex = headers.indexOf('player_id') !== -1 ? headers.indexOf('player_id') : headers.indexOf('player id');
  const positionIndex = headers.indexOf('position') !== -1 ? headers.indexOf('position') : headers.indexOf('pos');
  const statusIndex = headers.indexOf('status') !== -1 ? headers.indexOf('status') : headers.indexOf('slot');

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const teamValue = teamNameIndex !== -1 ? row[teamNameIndex] : teamIndex !== -1 ? row[teamIndex] : '';
    const playerName = playerNameIndex !== -1 ? row[playerNameIndex] : row[0];
    if (!teamValue && !playerName) continue;

    rows.push({
      team: String(teamValue || '').trim(),
      team_name: String(teamValue || '').trim(),
      player_name: String(playerName || '').trim(),
      player: String(playerName || '').trim(),
      player_id: playerIdIndex !== -1 ? String(row[playerIdIndex] || '').trim() : String(playerName || '').trim(),
      position: positionIndex !== -1 ? String(row[positionIndex] || '').trim() : 'N/A',
      status: statusIndex !== -1 ? String(row[statusIndex] || '').trim() : 'Bench'
    });
  }

  return rows.filter((row) => row.player_name || row.player_id || row.player);
}

function writeOwnershipRow(sheetName, playerId, taken, updatedAt) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();

  if (!values.length) {
    sheet.appendRow(['player_id', 'taken', 'updated_at']);
  }

  const headers = (values[0] || []).map((value) => String(value || '').trim().toLowerCase());
  const playerIdIndex = headers.indexOf('player_id');
  const takenIndex = headers.indexOf('taken');
  const updatedAtIndex = headers.indexOf('updated_at');

  if (playerIdIndex === -1) {
    sheet.appendRow(['player_id', 'taken', 'updated_at']);
    return writeOwnershipRow(sheetName, playerId, taken, updatedAt);
  }

  let foundRow = -1;
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][playerIdIndex] || '') === String(playerId)) {
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
}

function getSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === 'Teams') {
      sheet.appendRow(['Team ID', 'Team Name', 'Manager']);
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
