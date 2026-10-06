# Song catalog and repertoire — first slice

Confirmed request (October 6): retain the rehearsal archive, add a linked
song/repertoire list and stable identities in a real relational database.
The later redesign request adds per-song YouTube listening references and optional
musical metadata. Local listening audio and source-bound A/B practice now extend this catalog;
named original sections, chord charts and stem processing are documented in
[PRACTICE.md](PRACTICE.md).
This public band archive and the existing private Song Practice
Workbench have separate ownership; a future explicit ID mapping may connect them.
No private Workbench records or source media are imported.

`data/catalog.sql` owns reviewed song identities, recording associations,
references and repertoire membership. The existing CSV still owns take metadata
and media URLs. `scripts/catalog.mjs` materializes an actual SQLite database,
checks foreign keys and exact archive coverage, and generates `data/catalog.json`
for read-only static hosting. SQLite is a rebuildable relational projection of
the reviewed SQL and CSV; neither SQLite nor JSON is an independently editable
authority. This keeps Git diffs useful and adds no backend to GitHub Pages.

Song IDs are permanent keys, not regenerated from titles. Recording filenames
and their legacy links remain unchanged. Unknown identity is a nullable link,
with the original caption retained for identification; uncertain names are not
promoted to canonical songs. A song can have zero takes. Credits remain null
until evidenced. Original/cover/chart references are separate from rehearsal
media. Repertoire membership is explicit, never inferred from recording history.
There is no shared-edit button or browser-local imitation of database writes.

`songs.reference_key` and `songs.reference_bpm` describe the catalog's reference
version; `recordings.played_key` and `recordings.played_bpm` describe that exact
rehearsal take. All four fields are nullable. Unknown played values never inherit
the song values: a transposed or slower take is legitimate. Keys are descriptive
text (for example, `D minor`); beats per minute (BPM) are positive finite numbers.
No real keys or tempos have been inferred or filled in. A reference version's
metadata is not asserted to describe every linked cover or arrangement.

Fourteen YouTube listening references cover all thirteen identified songs;
original soundtrack uploads, covers and other game arrangements are labeled
separately. Fan uploaders are not credited as performing artists. The Yoshi
Circuit reference is the Mario Kart World arrangement, not the original Double
Dash recording. Source provenance and that edition caveat live in
[REFERENCE_SOURCES.md](REFERENCE_SOURCES.md). A linked listening reference does
not establish which arrangement the band played. The generated version-3 JSON
adds `youtube_id` derived only from recognized YouTube hostnames and exact video
IDs; malformed video URLs fail generation. Other HTTP(S) chart links remain
valid with a null video ID. Link metadata checks do not prove playback or embed
availability in every region.

## Private reference audio

Public SQL remains the identity/relationship authority. Local listening files
are optional private assets owned by an ignored `reference-audio/manifest.json`
receipt, keyed by existing reference IDs. No asset table or private filename is
added to the reviewed SQL. Public `data/catalog.json` always projects
`audio_file`, `duration_seconds` and `audio_format` as null on each reference;
finding an audio directory does not activate those files in a public build.

The private receipt has this shape:

```json
{
  "version": 1,
  "checked_at": "2026-10-06T12:00:00Z",
  "assets": [{
    "reference_id": "gourmet-race-soundtrack",
    "youtube_id": "Se1uh3PS78Y",
    "audio_file": "gourmet-race-soundtrack.m4a",
    "duration_seconds": 42.5,
    "audio_format": "m4a",
    "bytes": 1234,
    "sha256": "<64 hexadecimal characters from the measured file>"
  }]
}
```

These numbers are illustrative, not evidence of a real download. The downloader
owns measuring duration/format with its media probe and recording source identity,
byte count and SHA-256 hash. The materializer independently checks reference and
YouTube IDs, a safe audio basename, matching extension/format, positive finite
duration, a positive integer byte count, a contained regular file (no symlinks),
and exact size/hash. It does not run the media probe again. Supported extensions
are m4a, mp3, wav, flac, opus, ogg, webm and aac. Source URLs and classifications
remain attached to their reference IDs.

`buildPrivateCatalog(catalog, receipt, audioRoot, { warn })` returns a new
projection without mutating the public catalog. Only verified present files
receive local audio values. Missing files produce a warning and retain null
fields plus the online listening source; malformed or tampered receipts fail.
Receipt availability alone never proves a missing file can play.

From the repository root, materialize the optional private projection with:

```sh
npm run catalog -- --audio-receipt reference-audio/manifest.json --audio-root reference-audio
```

This writes only ignored `.catalog-build/catalog.private.json`; it never replaces
committed `data/catalog.json`. Normal `npm run catalog` continues to generate the
public snapshot and rebuildable SQLite database. A private build must explicitly
select the private projection and link its verified audio assets. A public build
must use the public projection and omit private audio. Downloading audio does not
authorize publishing those files. Keys and tempos remain independently unknown;
audio duration is measured playback length, not musical tempo.

Authoring: edit the reviewed SQL, run `npm run catalog`, then `npm run check`.
Build checks source IDs, relations and archive/session coverage. The deployed
JSON intentionally contains only public catalog metadata and recording links.
SQLite is excluded from static builds and Git. Shared repertoire changes require
publishing a new snapshot; a future authenticated backend is a separate decision.

Success scenarios: Yoshi Circuit joins two sessions by ID; You Will Know Our
Names distinguishes two takes on one date; unassigned takes remain visible;
empty repertoire and unknown metadata are honest; an unrecorded song can be
added without creating a fake take; old URLs retain the selected player.
