# FluxGraph playback investigation report

**Status: incomplete — the freeze reported in the user's regular Chrome has not been reproduced, and its root cause is not proven.** Do not treat this package as a verified fix.

## Repository and evidence limits

The uploaded `FluxGraph.zip` did not contain a `.git` directory, so there was no repository history or original `git diff` to inspect. The source comparison used a second, untouched extraction of the uploaded ZIP as the baseline. The ZIP also contained `node_modules` without the platform-native optional bindings required by Vite/Rolldown and oxlint.

## Confirmed findings

- In `ParticleRenderer`, a flag labelled as a one-time render log was set to `true` and reset to `false` at the end of every render. The result was two console entries for every particle render, not just the first render. This is a real high-frequency logging defect, but available evidence does **not** prove that it caused the user's freeze.
- The source build initially had an unused `effectiveGlow` variable that caused TypeScript to fail. It was removed along with associated calculations whose result was never used; the particle drawing algorithm remains unchanged.
- `usePipeline` rebound the same video element on every playback-state update. The effect now binds the stable ref once, and `VisualizationPipeline.setVideo` is identity-aware for callers that do replace the element.
- The playback loop uses a generation token to ignore stale callbacks, reschedules after frame processing in `finally`, falls back to RAF if RVFC registration throws, and cancels outstanding work on stop/replacement/disposal.
- Opt-in diagnostics are enabled with `?fluxgraphDebug=1`. They track media lifecycle state/events, scheduler and callback counts, RVFC metadata, pipeline/analyzer/renderer counts and errors, renderer identity, canvas/video CSS geometry, context identity, and a 32×32 canvas fingerprint sampled no more than once every two seconds. Diagnostics use shared ownership so the media controller and pipeline can clean up without prematurely disposing each other's diagnostics.

## Results actually obtained

### Source checks

- `npx tsc -b --pretty false`: **passed** after the changes, including typechecking the new tests.
- A standalone runtime harness that transpiled the current `VisualizationPipeline.ts` and supplied fake video/canvas/renderer dependencies: **passed 8 checks** covering RVFC rescheduling after an injected analysis error, stop/cancel and stale callback rejection, resume, mode switching while playing, paused seeking, video replacement, disposal, and RAF fallback cancellation.
- A separate standalone runtime harness for `PlaybackDiagnostics`: **passed** checks for media event counters, repeated/new presentation metadata, renderer identity, pixel-fingerprint changes, and shared-owner cleanup.
- `npm run build`: TypeScript succeeded, then Vite/Rolldown startup failed because `@rolldown/binding-linux-x64-gnu` and `@rolldown/binding-wasm32-wasi` were missing from the uploaded `node_modules`.
- `npm test`: did not start; Vitest hit the same missing Rolldown binding before running any tests.
- `npm run lint`: did not start because `@oxlint/binding-linux-x64-gnu` / WASM bindings were missing.

The new Vitest tests are present in `src/__tests__/pipelinePlayback.test.ts` and `src/__tests__/playbackDiagnostics.test.ts`, and typecheck successfully, but **Vitest has not executed them in this environment**.

### Browser smoke test — original packaged bundle only

The archive's existing `dist` bundle was exercised in system headless Chromium (`/usr/bin/chromium`) using a locally generated 12-second H.264 motion clip. The updated source could not be bundled because of the native-binding problem above, so this is evidence about the **original packaged bundle**, not the changed source.

- Video time advanced from 0 to 2.209 seconds and then to 4.015 seconds; sampled canvas fingerprints changed from `1529939301` to `14090780`.
- After pause, `currentTime` remained at `4.072248` over the following 700 ms.
- Seeking while paused reached approximately 60% of the 12-second clip (`7.192` seconds); seeking while playing also worked.
- The mode switch to Contours and back to Particles continued to update the sampled canvas.
- Chromium reported no console errors or page errors in this smoke test.
- A separate smoke check of the provided AV1 MP4 also displayed the visualization in Chromium.

These tests do not represent the user's regular Chrome session. They do not prove that the modified source fixes the reported issue, and the user-reported failure was not localized to stages A–F.

## How to capture the missing evidence in Chrome

1. Start the updated source on a machine with working dependencies, and open the page with `?fluxgraphDebug=1`.
2. Upload the affected local video and press Play. Wait 4–6 seconds after it appears frozen.
3. In DevTools Console, run `window.__FLUXGRAPH_DIAGNOSTICS__.snapshot()` and copy the returned object. Also retain the `[FluxGraph:playback-diag]` heartbeat lines before and after Play.
4. Repeat in both Particles and Contours. This evidence is needed to identify the first broken stage in the user's actual environment.

**Definition of done is not met** until continuous canvas changes are verified for at least 5–10 seconds in the user's regular Chrome, in both visualization modes, with pause/resume and seeking confirmed.
