import { readFile, access } from 'node:fs/promises';
import { parseCsv } from '../src/recordings.ts';
const rows = parseCsv(await readFile('data/recordings.csv', 'utf8'));
for (const row of rows) {
  if (row.thumbnail) await access(`dist/${row.thumbnail}`);
  if (row.audio_file) await access(`dist/audio/${row.audio_file}`);
}
console.log(`Verified media paths for ${rows.length} recordings.`);
