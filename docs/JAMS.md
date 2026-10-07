# Practice jams and comments

The private music workspace can record a microphone part over a reference, retain
that exact backing mix and speed, and replay the take alongside it. This is a
private prototype with local, unverified author labels; accounts and MIDI are not
implemented.

## Record a part

1. Open a song's Practice view. Set the instrument levels and playback speed, and
   seek to the passage you want. An explicitly selected section/range starts at A;
   otherwise recording starts at the current playhead.
2. Open **Jam recording**. Choose your played instrument (a source stem or custom
   name), an optional title and an existing section association. Choosing Piano
   does not automatically mute the backing Piano. **Free jam** records without
   backing alignment; it can still name an instrument or section.
3. Use headphones, press **Enable microphone**, and accept your browser's request.
   Press **Record after 3 seconds**. The countdown precedes capture; it is seconds,
   not a musical count-in. There is no live microphone monitoring.
4. Press **Stop** or Space. One pass is limited to two minutes / 32 MiB. Source,
   seek, speed and mix changes are locked during capture. A backing stall stops
   the take and preserves the finalized mic recording and established prefix.
5. Review, adjust timing with **Earlier/Later** if needed, and **Save privately**.
   A finalized browser draft survives reload when local storage succeeds. If
   storage/save fails, keep the page open and use Download or retry. An unsaved
   draft is never silently replaced by opening another saved jam.

**Play with recorded mix** restores the exact captured source, stem revision,
levels/mute/solo and speed. The mic plays naturally at 1× while backing uses the
recorded practice speed. You can audition different stem levels and use **Reset
recorded mix** to restore the saved settings paused. This does not edit the
capture snapshot. Mic-only playback and downloads remain available when the
backing revision disappears. Timing is estimated, with ±2-second manual
correction; sound, latency and longer-take drift require a real listening check.

Raw mic audio, semantic section association and valid aligned coverage are
separate. Finalization tails remain in the raw file even outside backed coverage.
Codec validation allows a bounded half-second tail beyond the capture limit.

## Notes and links

The **Comments** panel chooses the target independently from what is playing.
Song-wide notes have no timestamp. Verified reference and mic recordings support
point/range comments and optional instruments. Archive recordings currently
support untimed notes: their CSV timing is not an exact audio hash/duration
receipt, so the app does not claim verified timed archive anchors yet. Authored
practice chords/notes remain separate from conversational comments.

Mic timestamps use the mic file's clock; reference timestamps use that exact
reference's clock. A valid aligned mic comment also displays an estimated named
backing timestamp. Links use distinct `jam`, `comment`, `clock` and `at` parameters
and open paused, rather than interpreting a mic timestamp as original song time.
Copying a source practice/section link removes unrelated jam/comment clock data.

## Ownership and persistence

- Catalogue references and archive takes retain their existing IDs and owners.
  `src/jamData.ts` defines typed recording links and immutable capture snapshots.
- `scripts/jam-store.mjs` owns `private-data/jams.sqlite` and UUID-named files in
  `private-data/jam-audio`. These are ignored by Git and excluded from builds.
- `POST api/jams` streams bounded media with URI-encoded `X-Jam-Metadata`; saves
  are retry-safe by capture ID. Decoder/container validation measures actual
  duration/channel/rate/hash. Client paths and arbitrary asset URLs are rejected.
- `GET api/jams`, detail/context/audio (including byte ranges), correction edits
  and `api/jam-comments` serve the private workspace. Writes require its exact
  allowed Origin. Tailscale access is the current trust boundary, not per-user
  authentication or verified attribution.
- The existing durable preview runtime mounts `createJamHandler` beside the
  practice handler at `127.0.0.1:8851`, behind `/vgm-preview/`. Existing Homebrew
  decoder paths work under launchd without relying on interactive shell PATH.
- The storage guard can refuse new uploads; a retained browser draft/download is
  the recovery path. No downloaded separation model or new dependency is needed.

## Deferred

Accounts/membership, MIDI, musical count-in/bar maps, timed archive receipts,
multi-pass loops, speed changes within a take, trimming and guaranteed playable
unfinished crash recovery remain separate work. Shared-context PCM capture is an
upgrade only if real timing/drift cannot be made useful with manual correction.

See `JAM_RECORDING_PLAN.md`, `JAM_MODEL_REVIEW.md` and
`JAM_IMPLEMENTATION_REVIEW.md` for the original request, accepted distinctions and
bounded review evidence. Browser simulation does not establish microphone sound
or physical phone acceptance.
