# FluxGraph Studio — implementation and verification report

**Product identity:** FluxGraph Studio — *Turn Media Into Motion.*

## Architecture inspected

The existing video path remains the primary `HTMLVideoElement → FrameAnalyzer → VisualizationPipeline → ParticleRenderer / ContourRenderer → Canvas 2D` workflow. `useVideoPlayback` still owns video play/pause/seek state; `usePipeline` configures the single video pipeline. The prior playback investigation code is retained, including the RVFC/RAF loop guards and optional `?fluxgraphDebug=1` diagnostics. The audio workspace is separate and stays mounted while switching sources so the audio element and its `AudioAnalyzer` connection are not recreated on every mode switch.

No Git metadata was included in the supplied archive. Final source differences were compared against the preceding playback-investigation ZIP rather than a repository Git diff. No user changes were reset or discarded, and no new npm dependencies were added.

## Local audio workspace

`AudioStudio.tsx` adds local audio choose/drag-and-drop, track name and status, loading/decode/playback errors, play/pause/resume, seek, volume, mute, track replacement, and cleanup of object URLs and event listeners. Audio uses a browser-created object URL and is not uploaded to a server. Source replacement pauses the old media, installs the new URL, resets playback UI, and revokes the previous URL. One-shot redraw requests are coalesced into a tracked RAF and canceled on unmount; the continuous playback loop is separately cancellable. The audio element remains connected through `AudioAnalyzer → AudioContext.destination`, so analysis and audible playback use the same decoded source.

`audioVisualizers.ts` provides four Canvas 2D renderers, all fed by real analyser frequency/waveform data:

- **Spectrum Bars** plots compressed frequency-bin magnitudes.
- **Waveform** draws the time-domain signal.
- **Radial Spectrum** plots frequency energy around a circle, modulated by measured overall energy.
- **XY Math Motion** includes the signal trace and parametric curve mappings, grid/axes, ticks, palette, glow, line width, trail persistence, smoothing, sensitivity, frequency influence, and sample density.

The signal mapping is delay embedding of normalized waveform samples:

\[
 x[n] = s[n], \qquad y[n] = s[(n + \Delta) \bmod N]
\]

The displayed readout reports the current delay `Δ` and waveform length `N`. The delay is derived from the selected sample count and clamped to a safe range.

The parametric mapping is:

\[
 x(t)=A_x\sin(F_x t+\phi_x), \qquad
 y(t)=A_y\sin(F_y t+\phi_y)
\]

The renderer and UI use the same `deriveXYParameters` values. Amplitude is derived from bass and treble energy; frequencies respond to midrange/treble energy; phase follows media time only while measured audio volume exceeds a small activity threshold. During silence, phase is zero and the curve stays static. A regression test verifies that the actual point evaluator follows the same equations shown in the readout. Numeric equation UI updates are throttled to about 8 times per second while canvas drawing remains on its single animation-frame loop.

## Video quality profiles

The existing central `QUALITY_PRESETS` registry now supplies these bounded values:

| Profile | Analysis size | Particle density | Particle size | Glow | Contour simplification | Max canvas DPR |
|---|---:|---:|---:|---:|---:|---:|
| Speed | 160×120 | 0.3 | 2.0 | 0.00 | 3.00 | 1.00× |
| Balanced | 320×240 | 0.6 | 1.5 | 0.40 | 1.50 | 1.25× |
| Quality | 480×360 | 1.0 | 1.0 | 0.70 | 0.80 | 1.50× |
| Ultra | 640×480 | 1.0 | 0.9 | 0.82 | 0.45 | 1.75× |
| Max | 800×600 | 1.0 | 0.8 | 0.95 | 0.25 | 2.00× |

Selecting a profile updates the existing analysis, particle renderer, contour renderer, and canvas DPR cap. Max is bounded to a 480,000-pixel analysis mask and the main canvas has a 12-million-pixel backing-store budget. The audio canvas has a separate 6-million-pixel backing-store budget. Device DPR and viewport pixel budgets may reduce the effective DPR below a profile's cap; the renderer does not pretend a lower cap is a higher physical DPR.

## Workspace and accessibility changes

The application is branded as **FluxGraph Studio** and uses a restrained dark studio palette with cyan/violet/magenta accents, responsive audio controls, styled mode/preset selection, and reduced-motion-aware transitions. Video-only controls are hidden in Audio workspace and vice versa. The initial video drop-zone no longer covers the header source switch. Video timeline seeking supports click/drag and keyboard Arrow, PageUp/PageDown, Home, and End keys. Media status is announced politely to assistive technology.

## Automated checks

- `node_modules/.bin/tsc -b --pretty false` — **passed**.
- A standalone Node harness using the installed TypeScript compiler API executed **6/6 regression assertion groups**: delay embedding and wrap, silence-static phase, frequency-band response, setting response, parametric-equation correspondence, and bounded five-preset parameters.
- New Vitest tests were added to `src/__tests__/audioVisualizers.test.ts`; `src/__tests__/audioAndPresets.test.ts` was extended for Ultra/Max.
- `npm test` — **could not start**: Vitest/Rolldown requires a missing platform-native binding (`@rolldown/binding-linux-x64-gnu`; WASI fallback also absent).
- `npm run lint` — **could not start**: Oxlint requires missing platform-native bindings (`@oxlint/binding-linux-x64-gnu`; WASI fallback also absent).
- `npm run build` — the TypeScript build step passed, then Vite failed at startup for the missing Rolldown native binding. This is an environment/dependency-package issue, not a TypeScript diagnostic.
- `npm ci` was attempted to restore platform dependencies, but the environment could not reach `registry.npmjs.org` (DNS/network failure). The submitted source ZIP excludes `node_modules`; run `npm ci` in an online development environment before using Vite/Vitest/Oxlint.

## Browser checks actually performed

A temporary test harness transpiled the current TypeScript/TSX source with the installed TypeScript compiler API and injected it into the system Chromium browser. This is a browser execution of the modified source, but **not** the official Vite production bundle.

Using a generated 14-second local WAV containing changing multi-frequency audio:

- Audio playback advanced from approximately 1.25s to 2.26s while sampled XY canvas pixels changed.
- Spectrum Bars, Waveform, Radial Spectrum, and XY Math Motion each changed their sampled canvas pixels while audio played.
- The XY signal formula and parametric equations appeared in the UI; the parametric readout showed live values.
- Pointer seeking moved to approximately 8.12s; after pause the playback clock and sampled canvas hash both stayed stable; resume advanced playback again.
- At 1280px width, the audio workspace had no horizontal overflow. At 390px mobile width it also had no horizontal overflow; the content correctly uses vertical scrolling.

Using the supplied local MP4 (decoded as 480×360, duration about 219.2 seconds):

- Play advanced the video clock from about 1.13s to 2.48s and sampled canvas pixels changed.
- Seeking while playing succeeded (to about 157.93s); seeking while paused succeeded (to about 61.37s); ArrowRight then moved to about 63.56s while remaining paused.
- Speed, Balanced, Quality, Ultra, and Max each became the selected profile in turn; Max exposed the `MAX DETAIL` workspace label.
- Contours continued changing sampled canvas pixels during playback; switching back to Particles continued from the current time. Video → Audio paused the video, and Audio → Video followed by Play resumed at about 67.53s.
- Switching Video → Audio paused the video and left the audio track paused; switching back to Video and pressing Play resumed video.
- No browser console errors or page errors were captured.

A separate Max-profile playback check at **2× device scale** produced a 2000×1100 canvas with DPR 2. The source clock advanced from about 2.58s to 5.29s and the sampled center canvas pixels changed; no page errors were recorded.

## Remaining limitations

- These checks ran in system **headless Chromium**, not the user's regular interactive Chrome session and not a deployed production build.
- Vitest, Oxlint, and the official Vite production build still need to be rerun after dependencies are correctly installed on a machine with working registry access.
- Browser-specific format support remains dependent on the user's browser codecs; formats such as M4A/AAC/FLAC are offered to the file picker but may be unsupported by a particular browser and then use the error UI.

The implementation is present in source and the audio/video interactions above were observed in Chromium. The build/test-runner limitation and regular-Chrome verification remain explicitly unverified rather than being reported as passed.
