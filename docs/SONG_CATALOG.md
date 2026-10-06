# Song catalog and repertoire — first slice

Confirmed request (October 6): retain the rehearsal archive, add left navigation
and a linked song/repertoire list, begin stable identities and a real relational
database. Original tracks, separation, chord analysis and new practice playback
are deferred. This public band archive and the existing private Song Practice
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

Authoring: edit the reviewed SQL, run `npm run catalog`, then `npm run check`.
Build checks source IDs, relations and archive/session coverage. The deployed
JSON intentionally contains only public catalog metadata and recording links.
SQLite is excluded from static builds and Git. Shared repertoire changes require
publishing a new snapshot; a future authenticated backend is a separate decision.

Success scenarios: Yoshi Circuit joins two sessions by ID; You Will Know Our
Names distinguishes two takes on one date; unassigned takes remain visible;
empty repertoire and reference lists are honest; an unrecorded song can be
added without creating a fake take; old URLs retain the selected player.
