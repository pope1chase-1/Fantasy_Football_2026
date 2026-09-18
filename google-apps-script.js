function doGet(e) {
  const sheetName = (e && e.parameter && e.parameter.sheet) || 'RosterOwnership';
  const rows = sheetName === 'Teams' ? getTeamRows() : getSheetRows(sheetName);
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
    const rows = sheetName === 'Teams' ? getTeamRows() : getSheetRows(sheetName);
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

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;

    const teamName = row[1];
    if (teamName === undefined || String(teamName).trim() === '') continue;

    rows.push({
      id: i,
      name: String(teamName).trim()
    });
  }

  return rows;
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
