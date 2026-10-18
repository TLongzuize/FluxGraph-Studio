# Playback freeze diagnostics

The temporary, low-noise diagnostics are disabled by default. Enable them by adding
`?fluxgraphDebug=1` to the FluxGraph page URL, for example:

```text
http://localhost:5173/FluxGraph/?fluxgraphDebug=1
```

Then open DevTools → Console, upload the affected local video, press Play, and wait at least
4–6 seconds. The diagnostic logger emits video lifecycle events and a heartbeat about every
two seconds while playback is active. It does not log every frame. Canvas readback is limited
to a 32×32 sample at most once every two seconds.

At any point, inspect a structured snapshot with:

```js
window.__FLUXGRAPH_DIAGNOSTICS__.snapshot()
```

To copy a snapshot from the Console:

```js
copy(JSON.stringify(window.__FLUXGRAPH_DIAGNOSTICS__.snapshot(), null, 2))
```

Capture one snapshot just before/after pressing Play and another after the visualization
appears frozen. Keep the heartbeat lines between them, since the deltas help distinguish
where frames stop moving through the system.

## Reading the evidence

- **A — `currentTime-not-advancing`:** the media clock is not advancing. Check the `play` /
  `playing` / `waiting` / `stalled` / `error` events and the video's `readyState` and `error`.
- **B — `currentTime-advances-no-frame-callback`:** the loop is marked running and media time
  advances, but the chosen RVFC/RAF callback has not run. Check scheduler, cancellation, and
  callback-age counters.
- **C — `pipeline-frame-skipped`:** callbacks run but the pipeline does not accept frames. The
  snapshot records `readyState`, pause state, and skip counts.
- **F — `pipeline-loop-not-running-while-video-advances`:** media plays, but the visualization loop
  was never started or was stopped. Inspect loop start/stop counters and React playback state.
- **D — renderer failure or no invocation:** compare `framesReceived`, `analysisSuccesses`,
  `rendererInvocations`, `rendererSuccesses`, and stage-specific error counts.
- **E — `canvas-updating-but-not-visible`:** sampled canvas pixels changed, but the canvas is
  detached, zero-sized, hidden/transparent, or not the top element at its center.
- **`renderer-succeeded-but-canvas-sample-unchanged`:** the renderer ran successfully but the
  sampled output did not change during the last diagnostic interval. This is a clue, not proof
  of decoder failure: the source may contain repeated/near-identical frames, and thresholds can
  map different frames to the same mask.

RVFC metadata (`mediaTime` and `presentedFrames`) is reported independently of `currentTime`;
unchanged `currentTime` alone is never taken as proof that no new frame was decoded. The snapshot
also records renderer mode/instance ID, canvas/context identity, canvas/video CSS geometry, and
sampled-pixel fingerprints.

When finished, remove `?fluxgraphDebug=1` to return to the normal path. Diagnostics are opt-in;
without the query flag, they do not add heartbeat timers, event logging, or canvas readbacks.
