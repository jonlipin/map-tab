// Builds Map Tab's shipped map reveal data from the game's own database tables.
//
//   node tools/overlays-from-csv.js <WorldMapOverlay.csv> <WorldMapOverlayTile.csv> [UiMap.csv UiMapXMapArt.csv] [--dump harvest.lua]
//
// The two required tables come from the client (wago.tools exports them per build as CSV):
//   WorldMapOverlay      ID, UiMapArtID, TextureWidth, TextureHeight, OffsetX, OffsetY, ...
//   WorldMapOverlayTile  ID, RowIndex, ColIndex, LayerIndex, FileDataID, WorldMapOverlayID
// The optional pair gives each map art id a zone name for the comments:
//   UiMap                ID, Name_lang, ...
//   UiMapXMapArt         ID, PhaseID, UiMapArtID, UiMapID
//
// Output is Data/MapOverlays.lua, in exactly the shape Reveal.lua reads:
//   ns.Reveal.DATA[artID] = { ["width:height:offsetX:offsetY"] = "fileDataID, fileDataID, ..." }
// with the tiles in row-major order, which is how the game's exploration provider (and Reveal.lua)
// walks them: tile (row, col) is fileDataIDs[row * columns + col + 1].
//
// --dump takes a harvest pasted out of "/maptab mapdata dump" in game and cross-checks every
// key and file id in it against the table, so the numbers here are known to match what the client
// hands out before anything ships.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const dumpIndex = args.indexOf('--dump');
const dumpPath = dumpIndex >= 0 ? args[dumpIndex + 1] : null;
if (files.length < 2) {
  console.error('usage: node tools/overlays-from-csv.js WorldMapOverlay.csv WorldMapOverlayTile.csv [UiMap.csv UiMapXMapArt.csv] [--dump harvest.lua]');
  process.exit(1);
}

// A small CSV reader: quoted fields with commas and doubled quotes, CRLF or LF.
function readCSV(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(h => h.trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

const overlays = readCSV(files[0]);
const tiles = readCSV(files[1]);
const need = (rows, cols, name) => cols.forEach(c => { if (!(c in rows[0])) throw new Error(`${name} has no column ${c}: got ${Object.keys(rows[0]).join(', ')}`); });
need(overlays, ['ID', 'UiMapArtID', 'TextureWidth', 'TextureHeight', 'OffsetX', 'OffsetY'], files[0]);
need(tiles, ['RowIndex', 'ColIndex', 'LayerIndex', 'FileDataID', 'WorldMapOverlayID'], files[1]);

// Zone names, when the optional tables are given.
const artNames = new Map();
if (files.length >= 4) {
  const uiMap = readCSV(files[2]);
  const xArt = readCSV(files[3]);
  need(uiMap, ['ID', 'Name_lang'], files[2]);
  need(xArt, ['UiMapArtID', 'UiMapID'], files[3]);
  const mapName = new Map(uiMap.map(m => [m.ID, m.Name_lang]));
  for (const x of xArt) {
    const name = mapName.get(x.UiMapID);
    if (name && !artNames.has(x.UiMapArtID)) artNames.set(x.UiMapArtID, name);
  }
}

// Tiles grouped per overlay, layer 0 only (higher layers are phased variants the map does not
// draw by default), ordered by row then column.
const tilesByOverlay = new Map();
for (const t of tiles) {
  if (t.LayerIndex !== '0') continue;
  const list = tilesByOverlay.get(t.WorldMapOverlayID) || [];
  list.push({ row: +t.RowIndex, col: +t.ColIndex, file: +t.FileDataID });
  tilesByOverlay.set(t.WorldMapOverlayID, list);
}

const data = new Map();       // artID -> Map(key -> ids)
const problems = [];
let overlayCount = 0, tileCount = 0;
for (const o of overlays) {
  const w = +o.TextureWidth, h = +o.TextureHeight, x = +o.OffsetX, y = +o.OffsetY;
  if (!(w > 0 && h > 0)) continue;
  const list = tilesByOverlay.get(o.ID);
  if (!list || !list.length) { problems.push(`overlay ${o.ID} (art ${o.UiMapArtID}) has no tiles`); continue; }
  const columns = Math.ceil(w / 256), rowsN = Math.ceil(h / 256);
  if (list.length !== columns * rowsN) {
    problems.push(`overlay ${o.ID} (art ${o.UiMapArtID}) ${w}x${h} wants ${columns * rowsN} tiles, table has ${list.length}`);
  }
  list.sort((a, b) => a.row - b.row || a.col - b.col);
  const ids = list.map(t => t.file);
  const key = `${w}:${h}:${x}:${y}`;
  const perArt = data.get(o.UiMapArtID) || new Map();
  if (perArt.has(key) && perArt.get(key) !== ids.join(', ')) problems.push(`art ${o.UiMapArtID} has two overlays at ${key} with different tiles`);
  perArt.set(key, ids.join(', '));
  data.set(o.UiMapArtID, perArt);
  overlayCount++;
  tileCount += ids.length;
}

// Cross-check against an in-game harvest, if one was pasted out.
if (dumpPath) {
  const dump = fs.readFileSync(dumpPath, 'utf8');
  let art = null, checked = 0, missing = [], differ = [];
  for (const line of dump.split('\n')) {
    const head = line.match(/^\s*\[(\d+)\]\s*=\s*\{/);
    if (head) { art = head[1]; continue; }
    const entry = line.match(/^\s*\["([^"]+)"\]\s*=\s*"([^"]*)"/);
    if (entry && art) {
      checked++;
      const table = data.get(art);
      if (!table || !table.has(entry[1])) missing.push(`art ${art} ${entry[1]}`);
      else if (table.get(entry[1]) !== entry[2]) differ.push(`art ${art} ${entry[1]}: game says ${entry[2]}, table says ${table.get(entry[1])}`);
    }
  }
  console.log(`cross-check against ${path.basename(dumpPath)}: ${checked} harvested overlays, ${missing.length} not in the table, ${differ.length} with different tiles`);
  missing.forEach(m => console.log('  missing: ' + m));
  differ.forEach(d => console.log('  differs: ' + d));
}

// Write the Lua.
const outDir = path.join(__dirname, '..', 'Data');
fs.mkdirSync(outDir, { recursive: true });
const artIDs = [...data.keys()].sort((a, b) => +a - +b);
const lines = [];
lines.push('-- Map Tab');
lines.push('-- Data/MapOverlays.lua: every exploration overlay each map has, keyed by map art id, read by');
lines.push('-- Reveal.lua to draw the areas a character has not explored.');
lines.push('--');
lines.push(`-- Generated by tools/overlays-from-csv.js from the game client's own WorldMapOverlay and`);
lines.push(`-- WorldMapOverlayTile tables, build 1.60.1.70009: ${artIDs.length} maps, ${overlayCount} overlays, ${tileCount} tiles.`);
lines.push('-- The numbers describe Blizzard\'s map data; the textures themselves are in the client.');
lines.push('');
lines.push('local ADDON, ns = ...');
lines.push('');
lines.push('ns.Reveal = ns.Reveal or {}');
lines.push('ns.Reveal.DATA = {');
for (const art of artIDs) {
  const name = artNames.get(art);
  lines.push(`\t[${art}] = {${name ? ` -- ${name.replace(/[\r\n]/g, ' ')}` : ''}`);
  const keys = [...data.get(art).keys()].sort((a, b) => {
    const [aw, ah, ax, ay] = a.split(':').map(Number), [bw, bh, bx, by] = b.split(':').map(Number);
    return ay - by || ax - bx || aw - bw || ah - bh;
  });
  for (const key of keys) lines.push(`\t\t["${key}"] = "${data.get(art).get(key)}",`);
  lines.push('\t},');
}
lines.push('}');
lines.push('');
const outFile = path.join(outDir, 'MapOverlays.lua');
fs.writeFileSync(outFile, lines.join('\n'));

console.log(`wrote ${path.relative(process.cwd(), outFile)}: ${artIDs.length} maps, ${overlayCount} overlays, ${tileCount} tiles, ${artNames.size ? 'with' : 'without'} zone names`);
if (problems.length) {
  console.log(`${problems.length} oddities in the tables (kept as they are, listed so they can be checked):`);
  problems.slice(0, 40).forEach(p => console.log('  ' + p));
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
}
