function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ rows: getDraftRows() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const action = payload.action || 'upsert';

  if (action === 'upsert') {
    writeDraftRow(payload.player_id, payload.taken === true, payload.updated_at || new Date().toISOString());
    return ContentService.createTextOutput(JSON.stringify({ ok: true }));
  }

  if (action === 'read') {
    return ContentService.createTextOutput(JSON.stringify({ rows: getDraftRows() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unsupported action' }));
}

function getDraftRows() {
  const sheet = getDraftSheet();
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

function writeDraftRow(playerId, taken, updatedAt) {
  const sheet = getDraftSheet();
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
    return writeDraftRow(playerId, taken, updatedAt);
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

function getDraftSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('DraftOwnership');
  if (!sheet) {
    sheet = ss.insertSheet('DraftOwnership');
    sheet.appendRow(['player_id', 'taken', 'updated_at']);
  }
  return sheet;
}
