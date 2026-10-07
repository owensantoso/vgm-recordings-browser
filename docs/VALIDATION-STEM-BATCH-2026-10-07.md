# Full reference stem batch — 7 October 2026

## Open and use

[Current repertoire](https://macnos.tailafa155.ts.net/vgm-preview/?view=repertoire) · [BOX16 practice](https://macnos.tailafa155.ts.net/vgm-preview/?view=songs&song=vgm-box-16&play=ref%3Abox16-masafumi-takada)

Open a song, choose Audio and press Play. Practice shows six instrument lanes with waveforms, source-time seeking, mute/solo, 0–200% gain and pitch-preserving speed. Before: only Beneath the Mask had a full-source stem set. Now: all 20 identified reference recordings have six full-source stems. Subjective isolation quality remains unreviewed.

## Catalogue and sources

Human list authority: [Video Game Music Links](https://chatgpt.com/c/6ac4b078-be30-83e8-bb0b-2782493463ed). Selected conversation has all four messages and matched native update timestamp. The wider history mirror is partial; this does not establish global history completeness.

Current ordered repertoire: Dire, Dire Docks; When Mother Was There; You Will Know Our Names; Beneath the Mask; Splatoon song (unidentified); Pokémon Silver gym theme (unconfirmed); BOX 16. The two provisional entries have no guessed references. Clarifying their titles or links is the remaining catalogue gate.

Catalogue: 16 song entries (14 identified, two provisional), 20 reference recordings, seven repertoire entries, 22 unchanged archive associations. Original soundtrack sources were added alongside useful existing covers, with source identity and duration preserved. Meta Knight’s Theme and Halberd are separate original cues, not asserted to equal the complete cover medley. Three initially failing downloads recovered from the same public YouTube URLs using the HTTP Live Streaming audio format; no cookies or credentials were needed. All 20 local audio receipts match catalogue references.

## Logic and packaging evidence

Logic Pro 12.3.1, Separate All Stems preset: Vocals, Drums, Bass, Guitar, Piano, Other. Root observed and saved six matching completed regions for 19 new sources; the existing full Beneath the Mask set remains intact. Per-source receipts retain source hash, exact normalized input identity, Logic project/raw paths and hashes, audio frame dimensions, asset hashes, and numerical recombination checks. Summed-stem correlation is timing evidence, not a listening-quality verdict.

Fresh normal-reader validation passed exactly 20 unique full-source sets with contiguous synchronized chunks. Totals:

| Asset | Count | Bytes |
|---|---:|---:|
| Full lossless FLAC stems | 120 | 997,961,775 |
| 30-second playback chunks | 876 in 146 synchronized groups | 1,004,090,144 |
| Waveform JSON | 20 | 3,554,950 |
| Original/reference M4A | 20 | 65,026,130 |
| All runtime files | 1,036 | 2,070,632,999 |

Playable assets are regular internal repository files. Final deployment symlinks resolve into that directory; none depends on T7. Raw inputs and the batch Logic project remain under `/Volumes/T7/Codex-VGM-Stems-2026-10-07/`. No unrelated data was deleted. Physical unplug testing was not performed.

The user's unsaved project was preserved and restored in Logic as `/Users/macintoso/Music/Logic/Untitled 1 - preserved 2026-10-07.logicx`; its original tracks remain present and playback is stopped.

## Verification and delivery

Core checks: 4 passed; TypeScript check passed; domain/catalogue/store/engine checks: 97 passed; React UI: 1 passed; browser: 71 passed; public build and final private build both exited 0. These are successive component checks, not a claim that the earlier combined check succeeded before outdated label assertions and font settling were repaired. Cached seek and genuine buffering geometry assertions retain exact comparisons; the test now awaits font readiness before measuring layout.

Actual private preview: BOX16 and When Mother Was There passed play/pause, paused seeking and resume, mute/solo/gain without restarting source nodes, 0.9×/1× speed toggle, desktop and 375px layouts, no overflow, no console/page errors or failed app requests, and no section/annotation writes. Full served asset checks cover all 20 sources and all 1,036 files, with one newly packaged chunk decoded natively in Chrome.

Durable preview LaunchAgent is running on loopback port 8851. Existing private `/vgm-preview/` Serve route is idempotent; unchanged configuration fingerprint `sha256:fb9443106e955e5d86b802993dafa7981f917b0d0681ca256ecdf11846c6db28`, 69 unrelated handlers preserved. No public media upload, merge or push was performed.

Task-local receipts under `../overnight-stems/`: `batch-receipt.json`, `logic-gui-batch-receipt.json`, `hls-fallback-receipt.json`, `verify-preview-receipt.json`, `verify-all-assets-receipt.json`, `route-final.json`, `private-build-final.log`, `browser-final.log` and per-source staging receipts. They contain local/provenance details and are not published media.

Branch `feat/song-repertoire`, worktree `/Users/macintoso/Documents/Codex/2026-10-06/where-is-my-video-game-music/work/vgm-repertoire` remains dirty with the prior shared-core experiment preserved. Main checkout remains unchanged. Worktree hygiene classifies it PRESERVE; no integration or cleanup was attempted.

## Remaining evidence and deferred work

Owen must identify the exact Splatoon and Pokémon tracks before they can be sourced and separated. Listening quality and physical-phone behavior have not been human accepted. New song sections, chords, keys and tempo were not invented. Easier manual section authoring and shared-core decisions remain separate follow-up work.

## Follow-up: both missing identities completed

The initial two identity gates above are superseded by Owen's later confirmation. Splattack! and the exact Pokémon HeartGold & SoulSilver Champion & Red Battle recording are now in the repertoire, downloaded and split. Fresh `batch-receipt-22.json` verifies all 22 full-source sets: 132 full FLAC files, 954 chunks, 22 waveforms and 22 source audios (1,130 runtime files, 2,287,251,442 bytes). Final private build reports 22 verified audio sources and 22 stem sets. `verify-all-assets-receipt-22.json` records final served completeness; listening quality remains unreviewed. Original 20-source receipts/counts above describe the initial completed batch.

Song-entry correction: opening a paused song now loads its original's practice timeline directly; playback starts only on explicit Play. Browsing another song during playback shows Overview while the current source continues; explicit Practice switches paused. Exact source links and browsing history preserve their source ownership. Full `npm run check` passed, including 74 browser checks. Actual Tailnet Bob-omb cold entry passed at 1440px and 375px with six lanes, paused audio, no gate or overflow; browsing/Practice handoff and both new sources' playback are covered by `work/song-entry-preview-receipt.json`. Source/default copy now says Open in recovery paths and never implies processing.
