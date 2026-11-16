// A token-radar-01 entry: the best token launch radar (Node 22, standard library only).
//
// The program reads the sealed snapshot at /input/snapshot.json, ranks every protocol that records no
// token by the implied value of the launch it may have (lib/model.ts), writes each row's farm plan
// (lib/plan.ts), writes the ranked board to /output/board.json and the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ to /output, checks what it
// writes against the gate's own rules, and last writes /output/dossier.json with buildDossier from
// vendor/makefun-board.ts, the library the scorer runs byte for byte.
//
// Two runs over the same snapshot write the same bytes: the model sorts by (implied value, slug) and
// reads no clock, no random source and no network.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, calibrate, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { farmPlan } from './lib/plan.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, min: 3, max_bytes: 524_288, long_side: 1440, short_side: 800 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A problem this program refuses to hand in: the reason, printed to stderr before exit 1. */
class EntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryError';
  }
}

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// ------------------------------------------------------------------ the board

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const table = calibrate(snapshot);
const { board, radar } = buildRadar(snapshot, table, farmPlan);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: radar.model_version, as_of: radar.as_of, rows: board }, null, 1)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// ------------------------------------------------------------------ the page and its screenshots

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

// ------------------------------------------------------------------ what the gate will read

/** The two whole numbers in a PNG's IHDR, or null when the bytes are not a whole PNG. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !magic.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The first frame's size in a JPEG, or null when the bytes carry no frame header. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1]!;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]! };
    }
    at += 2 + length;
  }
  return null;
}

/** Every reason the screenshots directory would fail the gate's screenshots row. */
function screenshotIssues(names: string[]): string[] {
  const issues: string[] = [];
  if (names.length < SCREENSHOT_CAPS.min) issues.push(`screenshots/ holds ${names.length} images: the boards wants the board, a detail view and a filtered view`);
  if (names.length > SCREENSHOT_CAPS.max) issues.push(`screenshots/ holds ${names.length} images, over the ${SCREENSHOT_CAPS.max} the gate reads`);
  for (const name of names) {
    if (!PLAIN_NAME.test(name)) {
      issues.push(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
      continue;
    }
    const bytes = readFileSync(join(out, 'screenshots', name));
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) issues.push(`screenshots/${name} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} a screenshot may be`);
    const size = pngSize(bytes) ?? jpegSize(bytes);
    if (size === null) {
      issues.push(`screenshots/${name} is neither a whole PNG nor a whole JPEG`);
      continue;
    }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > SCREENSHOT_CAPS.long_side) issues.push(`screenshots/${name} is ${size.width}x${size.height}: its long side is over ${SCREENSHOT_CAPS.long_side}`);
    if (short < SCREENSHOT_CAPS.short_side) issues.push(`screenshots/${name} is ${size.width}x${size.height}: its short side is under ${SCREENSHOT_CAPS.short_side}`);
  }
  return issues;
}

const shotIssues = screenshotIssues(shots);
if (shotIssues.length > 0) {
  process.stderr.write(`token radar: ${shotIssues.join('\n  ')}\n`);
  process.exit(1);
}

// The dashboard's own files, and the two rules the gate keeps on them: the caps, and no network.
const dashDir = join(out, 'dashboard');
const dashNames = readdirSync(dashDir);
if (!dashNames.includes('index.html')) throw new EntryError('the dashboard has no index.html');
for (const ext of ['.css', '.js']) {
  if (!dashNames.some((n) => n.endsWith(ext))) throw new EntryError(`the dashboard holds no ${ext} file`);
}
const dashBytes = dashNames.reduce((n, name) => n + statSync(join(dashDir, name)).size, 0);
if (dashNames.length > DASHBOARD_CAPS.max_files || dashBytes > DASHBOARD_CAPS.max_bytes) {
  throw new EntryError(`dashboard/ holds ${dashNames.length} files and ${dashBytes} bytes, over the gate's caps`);
}
const NETWORK = /(?:https?|ftp):\/\//i;
for (const name of dashNames) {
  const text = readFileSync(join(dashDir, name), 'utf8');
  const hit = name.endsWith('.css') ? NETWORK.exec(text) : name.endsWith('.js') ? /(?:^|\s)(?:import|export\s+from|require)\s*\(?\s*['"`][^'"`]*:\/\//.exec(text) : /(?:href|src|action|srcset|poster)\s*=\s*["']?\s*(?:https?|ftp):\/\//i.exec(text);
  if (hit !== null) throw new EntryError(`dashboard/${name} names a network address (${hit[0].slice(0, 60)}), which the gate refuses`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: SCREENSHOT_CAPS.max, max_bytes: SCREENSHOT_CAPS.max_bytes }, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossier);

// ------------------------------------------------------------------ what the run reports

const first = board[0]!;
const last = board[board.length - 1]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.counts.pre_token} with no token recorded, ${radar.counts.candidates} launch candidates, ${radar.counts.watchlist} on the watchlist\n` +
    `token radar: ${board.length} rows scored (${radar.counts.watchlist_rows} watchlist, ${radar.counts.early_rows} early, ${radar.counts.below_floor} below the ${snapshot.floor_usd / 1e6}M floor)\n` +
    `token radar: rank 1 ${first.name} at $${first.implied_value_usd.toLocaleString('en-US')} implied, rank ${last.rank} ${last.name} at $${last.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: calibration from ${table.comparables} comparable protocols, all-category multiple ${table.overall}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashNames.length} files, ${dashBytes} bytes), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes)\n`,
);

// Exit 0 with the summary on stdout; a SnapshotError or EntryError above leaves the run failed.
void SnapshotError;
