#!/usr/bin/env node
/**
 * gpx-to-route.js
 * ───────────────
 * Converts a GPX file to the JS array format needed in index.html.
 *
 * Usage:
 *   node gpx-to-route.js route.gpx
 *
 * Paste the output into the ROUTE_COORDS variable in public/index.html
 */

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node gpx-to-route.js <file.gpx>');
  process.exit(1);
}

const xml = fs.readFileSync(path.resolve(file), 'utf-8');
const coords = [];
const re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
let m;
while ((m = re.exec(xml)) !== null) {
  coords.push([parseFloat(m[1]), parseFloat(m[2])]);
}

if (coords.length === 0) {
  // Try rtept (route points)
  const re2 = /<rtept\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  while ((m = re2.exec(xml)) !== null) {
    coords.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
}

if (coords.length === 0) {
  console.error('No coordinates found in GPX file.');
  process.exit(1);
}

// Thin the points — keep every Nth to reduce file size
const MAX_POINTS = 2000;
const step = Math.max(1, Math.floor(coords.length / MAX_POINTS));
const thinned = coords.filter((_, i) => i % step === 0);

const output = `const ROUTE_COORDS = ${JSON.stringify(thinned)};`;
const outFile = 'route-coords.js';
fs.writeFileSync(outFile, output);

console.log(`✓ ${coords.length} punkter hittade → thinned till ${thinned.length}`);
console.log(`✓ Sparad till: ${outFile}`);
console.log('');
console.log('Kopiera innehållet och ersätt "const ROUTE_COORDS = null;" i public/index.html');
