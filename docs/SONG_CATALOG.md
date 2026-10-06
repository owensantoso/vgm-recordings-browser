# Song catalog and repertoire — first slice

Confirmed request (October 6): retain the rehearsal archive, add a linked
song/repertoire list and stable identities in a real relational database.
The later redesign request adds per-song YouTube listening references and optional
musical metadata. Separation, chord analysis and deeper practice tools are deferred.
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
not establish which arrangement the band played. The generated version-2 JSON
adds `youtube_id` derived only from recognized YouTube hostnames and exact video
IDs; malformed video URLs fail generation. Other HTTP(S) chart links remain
valid with a null video ID. Link metadata checks do not prove playback or embed
availability in every region.

Authoring: edit the reviewed SQL, run `npm run catalog`, then `npm run check`.
Build checks source IDs, relations and archive/session coverage. The deployed
JSON intentionally contains only public catalog metadata and recording links.
SQLite is excluded from static builds and Git. Shared repertoire changes require
publishing a new snapshot; a future authenticated backend is a separate decision.

Success scenarios: Yoshi Circuit joins two sessions by ID; You Will Know Our
Names distinguishes two takes on one date; unassigned takes remain visible;
empty repertoire and unknown metadata are honest; an unrecorded song can be
added without creating a fake take; old URLs retain the selected player.
