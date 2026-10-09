import {loadCatalog, loadMotion, protocols, illustrationMask, validateMask, maskSegments} from './data.js?v=20261009-hy';
import {MotionViewer} from './viewer.js?v=20260920-edit';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const controllers = new Map();
export function createStudio(root, task, catalog) {
  root.append(document.querySelector('#viewer-template').content.cloneNode(true));
  function namespace(container) {
    container.querySelectorAll('[id]').forEach(element => { element.id = `${task}-${element.id}`; });
    container.querySelectorAll('[for]').forEach(element => { element.htmlFor = `${task}-${element.htmlFor}`; });
  }
  namespace(root);
  const $ = selector => root.querySelector(selector.replace(/#([\w-]+)/g, `#${task}-$1`));
  const ids = catalog.tasks?.[task] ?? catalog.samples.filter(sample => task === 't2m' ? sample.generated : sample.reference).map(sample => sample.id);
  const allSamples = ids.map(id => catalog.samples.find(sample => sample.id === id)).filter(Boolean);
  let samples = allSamples;
  const state = {task, protocol: 'inbetween', sample: null, catalog, motion: null, seconds: 0, duration: 0,
    playing: false, speed: 1, mask: null, onlyKnown: false, editMode: 'split', loading: true, request: 0, illustrative: false, motions: [], visibleModels: []};
  let viewer, visible = false, started = false;
  const structuralLabels = {continuation: 'Continuation', prefix: 'Prefix Filling', inbetween: 'In-betweening', keyframe: 'Keyframe'};
  const structuralProtocols = task === 'structure'
    ? ['continuation', 'prefix', 'inbetween', 'keyframe'].filter(protocol => allSamples.some(sample => sample.structuralProtocol === protocol)) : [];
  if (structuralProtocols.length > 1) {
    const tabs = document.createElement('nav'); tabs.className = 'structural-task-tabs'; tabs.setAttribute('aria-label', 'Structural task');
    for (const protocol of structuralProtocols) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.protocol = protocol;
      button.textContent = structuralLabels[protocol]; button.setAttribute('aria-pressed', protocol === structuralProtocols[0]);
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-pressed') === 'true') return;
        tabs.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', item === button));
        samples = allSamples.filter(sample => sample.structuralProtocol === protocol);
        state.sample = samples[0] ?? null; setPlaying(false); renderPager(); renderInspector();
        if (started && state.sample) selectSample(state.sample);
      });
      tabs.append(button);
    }
    root.querySelector('.case-nav').before(tabs);
    samples = allSamples.filter(sample => sample.structuralProtocol === structuralProtocols[0]);
  }
  function setViewerSeparation(gap) {
    if (typeof viewer?.setSeparation !== 'function') {
      setStatus('Viewer files are out of sync. Reload this page once to load the updated comparison viewer.');
      return false;
    }
    viewer.setSeparation(gap);
    return true;
  }
  function setStatus(message, retry = false) {
    const el = $('#stage-status'); el.replaceChildren(); el.hidden = !message;
    if (message) el.append(document.createTextNode(message));
    if (retry) { const button = document.createElement('button'); button.textContent = 'Try again'; button.onclick = () => selectSample(state.sample); el.append(button); }
  }
  function setPlaying(value) {
    state.playing = value && !state.loading && !!state.motion;
    $('#play').textContent = state.playing ? 'Ⅱ' : '▶';
    $('#play').setAttribute('aria-label', state.playing ? 'Pause motion' : 'Play motion');
  }
  function renderInspector() {
    if (!state.sample) return;
    const sample = state.sample;
    let body = '';
    if (sample.comparison) body += `<div class="comparison-legend">${sample.comparison.models.map((model, index) => `<label class="model-${String.fromCharCode(97 + index)}" style="${model.color ? `color:${escape(model.color)}` : ''}" for="model-visible-${index}"><input id="model-visible-${index}" type="checkbox" ${state.visibleModels[index] !== false ? 'checked' : ''} ${state.loading ? 'disabled' : ''}> ${String.fromCharCode(65 + index)} · ${escape(model.label)}</label>`).join('')}</div><div class="task-block"><label for="separation">Starting gap: <output id="separation-value">${state.separation ?? 3} m</output></label><input type="range" id="separation" min="1" max="8" step="0.25" value="${state.separation ?? 3}"><p class="description">Adjacent starting body centers use this spacing. Original movement and timing are preserved.</p></div>`;
    if (state.task === 't2m') body += `<div><p class="eyebrow">${sample.generated ? 'TEXT PROMPT' : 'REFERENCE DESCRIPTION'}</p><blockquote class="prompt-card">${escape(sample.prompt || 'No prompt supplied for this file.')}</blockquote></div>${sample.generated ? '' : '<div class="empty-output">Viewer sample only. Generated results will replace this reference motion.</div>'}`;
    if (state.task === 'm2t') body = `<div class="caption-result motius-result"><p class="eyebrow">${escape(sample.predictionLabel ?? 'MÖBIUS')}</p>${sample.predictedCaption ? `<blockquote class="prompt-card motius-caption">${escape(sample.predictedCaption)}</blockquote>` : '<div class="empty-output">No MÖBIUS caption connected yet.</div>'}</div>${sample.fixedConditionCaption ? `<div class="caption-result fixed-condition-result"><p class="eyebrow">${escape(sample.fixedConditionLabel ?? 'MOTIUS 0.6B')}</p><blockquote class="prompt-card fixed-condition-caption">${escape(sample.fixedConditionCaption)}</blockquote></div>` : ''}${sample.motiongpt3Caption ? `<div class="caption-result motiongpt-result"><p class="eyebrow">MOTIONGPT3</p><blockquote class="prompt-card motiongpt-caption">${escape(sample.motiongpt3Caption)}</blockquote></div>` : ''}${sample.captionReview ? `<div class="caption-result reference-result"><p class="eyebrow">REFERENCE</p><blockquote class="prompt-card reference-caption">${escape(sample.prompt)}</blockquote></div>` : `<details><summary class="description">Reference description</summary><p class="description">${escape(sample.prompt)}</p></details>`}`;
    if (state.task === 'structure') body = sample.structuralPair
      ? `<div><p class="eyebrow">SOURCE TEXT</p><blockquote class="prompt-card">${escape(sample.prompt)}</blockquote></div><div class="pair-legend"><span><i class="pair-dot known-orange"></i> Known frames</span><span><i class="pair-dot generated-blue"></i> Generated frames</span></div><p class="description">${escape(sample.structuralPair.knownLabel ?? 'Known prefix')}: ${Math.round(sample.structuralPair.knownRatio * 100)}%</p>${sample.structuralProtocol === 'keyframe' ? '<p class="description">Orange keyframe poses remain fixed at their original positions. The animated motion overlaps them when it reaches a known frame.</p>' : ''}<div class="task-actions"><button id="show-full" aria-pressed="${!state.onlyKnown}">Full sequence</button><button id="show-known" aria-pressed="${state.onlyKnown}">Known poses only</button><button id="next-boundary">Next boundary</button></div>`
      : `<div class="task-block"><label for="protocol">Completion task</label><select id="protocol">${Object.entries(protocols).map(([key, value]) => `<option value="${key}" ${key === state.protocol ? 'selected' : ''}>${value.name}</option>`).join('')}</select><p class="description">${protocols[state.protocol].description}</p></div><div class="task-actions"><button id="show-full" aria-pressed="${!state.onlyKnown}">Full sequence</button><button id="show-known" aria-pressed="${state.onlyKnown}">Known poses only</button><button id="next-boundary">Next boundary</button></div><div class="empty-output">${state.illustrative ? 'Mask illustration on a reference sequence. Orange indicates a region to complete, not a generated result.' : 'Blue marks observed frames; orange marks the completion region.'}</div>`;
    if (state.task === 'edit' && sample.comparison) body += `<div><p class="eyebrow">EDIT INSTRUCTION</p><blockquote class="prompt-card">${escape(sample.edit?.instruction)}</blockquote></div><p class="description">Select the methods to compare. Playback shares original seconds and camera.</p>`;
    if (state.task === 'edit' && !sample.comparison) body = `<div><p class="eyebrow">EDIT INSTRUCTION</p>${sample.edit?.instruction ? `<blockquote class="prompt-card">${escape(sample.edit.instruction)}</blockquote>` : '<div class="empty-output">An instruction and its paired output have not been connected yet.</div>'}</div><div class="task-actions"><button id="edit-split" aria-pressed="${state.editMode === 'split'}">Side by side</button><button id="edit-overlay" aria-pressed="${state.editMode === 'overlay'}" ${sample.edit?.output ? '' : 'disabled'}>Overlay</button></div><p class="description">Shared viewpoint. Playback uses original seconds, preserving timing differences.</p>`;
    const technicalDetails = (sample.comparison && !catalog.directoryPreview) || sample.captionReview || sample.structuralPair || sample.editReview ? '' : `<div class="facts"><span>${escape(sample.id)}</span><span>${state.motion ? `${state.motion.meta.frames} frames` : 'Loading'}</span><span>${state.motion ? `${state.motion.meta.fps} fps` : '—'}</span></div><details class="metadata"><summary>Sample details</summary><dl><dt>Source</dt><dd>${escape(sample.sourceDataset)}</dd><dt>Provenance</dt><dd>${escape(sample.provenance)}</dd><dt>Checkpoint</dt><dd>${escape(sample.checkpoint ?? 'Not connected')}</dd><dt>Seed</dt><dd>${escape(sample.seed ?? '—')}</dd>${sample.generation ? `<dt>Weights</dt><dd>${escape(sample.generation.weights)}</dd><dt>Steps / CFG</dt><dd>${sample.generation.num_timesteps} / ${sample.generation.guidance_scale}</dd><dt>Source index</dt><dd>${sample.sourceIndex}</dd>` : ""}</dl></details>`;
    $('#inspector').innerHTML = body + technicalDetails;
    namespace($('#inspector'));
    sample.comparison?.models.forEach((model, index) => $(`#model-visible-${index}`)?.addEventListener('change', event => {
      const next = sample.comparison.models.map((_, itemIndex) => itemIndex === index ? event.target.checked : state.visibleModels[itemIndex] !== false);
      if (!next.some(Boolean)) { event.target.checked = true; return; }
      state.visibleModels = next;
      if (next[index] && !state.motions[index]) { selectSample(sample); return; }
      viewer?.setTrackVisible(index, next[index]);
      if (!state.loading) viewer?.setGhosts($('#ghosts').checked);
      seek(state.seconds); renderInspector();
    }));
    $('#separation')?.addEventListener('input', event => {
      state.separation = Number(event.target.value);
      $('#separation-value').textContent = `${state.separation} m`;
      if (!state.loading) setViewerSeparation(state.separation);
    });
    $('#protocol')?.addEventListener('change', event => { state.protocol = event.target.value; selectSample(state.sample); });
    $('#show-full')?.addEventListener('click', () => { state.onlyKnown = false; applyMask(); renderInspector(); });
    $('#show-known')?.addEventListener('click', () => { state.onlyKnown = true; applyMask(); renderInspector(); });
    $('#next-boundary')?.addEventListener('click', () => {
      if (!state.mask || state.loading) return;
      const boundaries = maskSegments(state.mask).slice(1).map(segment => segment.start);
      const frame = Math.round(state.seconds * state.motion.meta.fps);
      const next = boundaries.find(index => index > frame) ?? boundaries[0] ?? 0;
      setPlaying(false); seek(next / state.motion.meta.fps);
    });
    for (const mode of ['split', 'overlay']) $(`#edit-${mode}`)?.addEventListener('click', () => {
      if (state.loading || (mode === 'overlay' && !sample.edit?.output)) return;
      state.editMode = mode; viewer.setMode(mode);
      $('#split-source').textContent = mode === 'overlay' ? 'Source (gray) + Edited (orange)' : 'Source';
      $('#split-output').hidden = mode !== 'split'; renderInspector();
    });
  }
  function renderPager() {
    const index = samples.findIndex(sample => sample.id === state.sample?.id);
    $('#case-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(samples.length).padStart(2, '0')}`;
    $('#case-select').innerHTML = samples.map((sample, i) => `<option value="${escape(sample.id)}" ${i === index ? 'selected' : ''}>${(sample.comparison && !catalog.directoryPreview) || sample.captionReview || sample.structuralPair || sample.editReview ? String(i + 1).padStart(2, '0') : `${String(i + 1).padStart(2, '0')} · ${escape(sample.label)}`}</option>`).join('');
    $('#previous-case').disabled = index <= 0;
    $('#next-case').disabled = index >= samples.length - 1;
  }
  function applyMask() {
    const reversed = state.task === 'structure' && state.sample?.structuralPair;
    const keyframeAnchors = reversed && state.sample?.structuralProtocol === 'keyframe';
    viewer.setMask(state.mask, state.onlyKnown, keyframeAnchors
      ? {known: 0x3275d1, generated: 0x3275d1}
      : reversed ? {known: 0xe9823f, generated: 0x3275d1} : null);
    if (keyframeAnchors) viewer.setKeyframeAnchors(state.mask);
    else viewer.setGhosts($('#ghosts').checked);
    $('#ghosts').closest('label').hidden = keyframeAnchors;
    $('#mask-legend').hidden = !state.mask;
    $('#mask-legend').classList.toggle('pair-reversed', !!reversed);
    $('#timeline-label').textContent = state.mask ? 'Condition timeline' : 'Motion timeline';
    const track = $('#mask-track'); track.replaceChildren();
    if (state.mask) for (const segment of maskSegments(state.mask)) {
      const item = document.createElement('i'); item.style.width = `${100 * (segment.end - segment.start) / state.mask.length}%`;
      item.style.background = segment.known ? (reversed ? '#e9823f' : '#3275d1') : (reversed ? '#3275d1' : '#e9823f'); track.append(item);
    }
  }
  function seek(seconds) {
    if (!state.motion || state.loading) return;
    state.seconds = Math.max(0, Math.min(state.duration, seconds));
    viewer.setTime(state.seconds);
    $('#scrubber').value = state.seconds;
    const frame = Math.min(state.motion.meta.frames - 1, Math.round(state.seconds * state.motion.meta.fps));
    $('#frame-label').textContent = `${frame + 1} / ${state.motion.meta.frames}`;
    if (state.sample.comparison) $('#frame-label').textContent = state.motions.flatMap((motion, index) => state.visibleModels[index] === false ? [] : [{motion, index}]).map(({motion, index}) => {
      const current = Math.min(motion.meta.frames - 1, Math.round(state.seconds * motion.meta.fps));
      return `${String.fromCharCode(65 + index)} ${current + 1}/${motion.meta.frames}`;
    }).join(' · ');
    $('#time-label').textContent = `${state.seconds.toFixed(2)} / ${state.duration.toFixed(2)} s`;
    $('#scrubber').setAttribute('aria-valuetext', `${state.seconds.toFixed(2)} seconds, frame ${frame + 1}`);
  }
  async function selectSample(sample) {
    const request = ++state.request; state.sample = sample; state.loading = true; state.onlyKnown = false;
    state.editMode = 'split'; state.mask = null; state.motion = null; state.motions = []; state.illustrative = false;
    root.querySelector('.provenance-bar').hidden = false;
    if (sample.comparison && state.visibleModels.length !== sample.comparison.models.length)
      state.visibleModels = sample.comparison.models.map((_, index) => task === 't2m' && !catalog.directoryPreview ? index < 2 : true);
    setPlaying(false); setStatus(catalog.directoryPreview ? 'Loading motion… The first preview converts this file to a mesh.' : 'Loading motion…');
    ['play', 'step-back', 'step-forward', 'scrubber'].forEach(id => $(`#${id}`).disabled = true);
    renderPager(); renderInspector();
    try {
      const task = state.task, structural = sample.structures?.[state.protocol];
      if (task === 'm2t' && sample.captionOnly) {
        state.loading = false; state.duration = 0;
        const exampleNumber = String(samples.findIndex(item => item.id === sample.id) + 1).padStart(2, '0');
        $('#stage-title').textContent = `Example ${exampleNumber} · Caption review`;
        $('#stage-tag').textContent = 'TEXT-ONLY REVIEW';
        root.querySelector('.provenance-bar').hidden = true;
        $('#split-source').hidden = true; $('#split-output').hidden = true; $('#edit-empty').hidden = true;
        renderInspector();
        setStatus('Motion preview is intentionally omitted while selecting M2T samples. Compare the model and reference descriptions on the right.');
        return;
      }
      viewer ??= new MotionViewer($('#motion-canvas'));
      let primaryPath = sample.reference;
      if (task === 't2m' && sample.generated) primaryPath = sample.generated;
      if (task === 'structure' && sample.structuralPair) primaryPath = sample.structuralPair.withText;
      else if (task === 'structure' && structural?.output) primaryPath = structural.output;
      if (task === 'edit' && sample.edit?.source) primaryPath = sample.edit.source;
      const motionPaths = sample.comparison ? sample.comparison.models.map((model, index) => state.visibleModels[index] !== false ? model.motion : null)
        : sample.structuralPair ? [sample.structuralPair.withText, sample.structuralPair.single ? null : sample.structuralPair.withoutText]
        : [primaryPath, task === 'edit' && sample.edit?.output ? sample.edit.output : null];
      const loaded = await Promise.all(motionPaths.map(path => path ? loadMotion(path) : null));
      if (request !== state.request) return;
      const primary = sample.comparison ? loaded.find(Boolean) : loaded[0], edited = sample.comparison ? null : loaded[1];
      state.motion = primary; state.secondary = edited; state.motions = loaded; state.duration = Math.max(...loaded.filter(Boolean).map(motion => motion.duration));
      if (task === 'structure') {
        state.illustrative = !sample.structuralPair && !structural?.output;
        const suppliedMask = sample.structuralPair?.knownMask ?? structural?.knownMask;
        state.mask = state.illustrative ? illustrationMask(state.protocol, primary.meta.frames) : validateMask(suppliedMask, primary.meta.frames);
      }
      viewer.setTracks(sample.comparison ? state.motions : task === 'edit' || sample.structuralPair ? [primary, edited].filter(Boolean) : [primary], sample.comparison ? 'comparison' : task === 'edit' || (sample.structuralPair && !sample.structuralPair.single) ? 'split' : 'single');
      if (sample.comparison?.models.some(model => model.color)) viewer.setTrackColors(sample.comparison.models.map(model => model.color));
      if (sample.comparison) state.visibleModels.forEach((visible, index) => viewer.setTrackVisible(index, visible));
      if (sample.comparison && !setViewerSeparation(state.separation ?? 3)) return;
      root.querySelectorAll('[data-camera]').forEach(button => button.setAttribute('aria-pressed', button.dataset.camera === viewer.preset));
      state.loading = false;
      $('#scrubber').max = state.duration;
      ['play', 'step-back', 'step-forward', 'scrubber'].forEach(id => $(`#${id}`).disabled = false);
      $('#split-source').hidden = (task !== 'edit' && !sample.structuralPair) || sample.structuralPair?.single; $('#split-source').textContent = sample.structuralPair ? 'WITH SOURCE TEXT' : 'Source';
      $('#split-output').hidden = (task !== 'edit' && !sample.structuralPair) || !edited;
      $('#split-output').textContent = sample.structuralPair ? 'WITHOUT SOURCE TEXT' : 'Edited';
      $('#edit-empty').hidden = task !== 'edit' || !!edited || !!sample.comparison;
      if (sample.comparison) { $('#split-source').hidden = true; $('#split-output').hidden = true; }
      const reference = task === 't2m' ? !sample.generated : task === 'structure' ? state.illustrative : task === 'm2t' ? !sample.predictedCaption : !edited;
      $('#stage-title').textContent = task === 'edit' ? 'Motion comparison' : task === 'structure' ? protocols[state.protocol].name : task === 'm2t' ? 'Input motion' : sample.generated ? 'Generated motion' : 'Reference motion';
      $('#stage-tag').textContent = task === 'structure' && state.illustrative ? 'MASK ILLUSTRATION · REFERENCE MOTION' : reference ? 'REFERENCE SAMPLE' : task === 'm2t' ? 'INPUT MOTION' : 'MODEL RESULT';
      $('#provenance-text').textContent = task === 'structure' && state.illustrative ? 'Illustrative masks on training-set data. No structural generation is shown.' : reference ? 'Training-set motion is used to demonstrate the viewer. Model outputs are not connected yet.' : `Generated by ${sample.checkpoint}. Seed ${sample.seed}. Original prompt and motion timing preserved.`;
      $('.reference-badge').textContent = reference ? 'REFERENCE DATA' : 'PRECOMPUTED';
      if (catalog.directoryPreview) {
        $('#stage-title').textContent = sample.fileName;
        $('#stage-tag').textContent = 'MOTION FILE';
        $('.reference-badge').textContent = 'DIRECTORY PREVIEW';
        $('#provenance-text').textContent = `${sample.fileName} · ${primary.meta.frames} frames · ${primary.meta.fps} fps · Original motion timing`;
        if (sample.comparison) {
          $('#stage-title').textContent = `${sample.fileName} · Model comparison`;
          const colorNames = ['BLUE', 'ORANGE', 'PURPLE'];
          $('#stage-tag').textContent = sample.comparison.models.map((model, index) => `${String.fromCharCode(65 + index)}: ${colorNames[index]}`).join(' · ');
          $('#provenance-text').textContent = `${sample.comparison.models.flatMap((model, index) => { const motion = state.motions[index]; return motion ? [`${String.fromCharCode(65 + index)}: ${model.label} · ${motion.meta.frames} frames at ${motion.meta.fps} fps`] : []; }).join(' | ')}. Shared seconds; no duration normalization.`;
        }
      }
      if (sample.comparison && !catalog.directoryPreview) {
        const colorNames = ['BLUE', 'ORANGE', 'PURPLE'];
        const exampleNumber = String(samples.findIndex(item => item.id === sample.id) + 1).padStart(2, '0');
        $('#stage-title').textContent = `Example ${exampleNumber} · Model comparison`;
        $('#stage-tag').textContent = sample.comparison.models.map((model, index) => `${String.fromCharCode(65 + index)}: ${colorNames[index]}`).join(' · ');
        $('.reference-badge').textContent = 'PRECOMPUTED COMPARISON';
        $('#provenance-text').textContent = sample.comparison.models.flatMap((model, index) => { const motion = state.motions[index]; return motion ? [`${String.fromCharCode(65 + index)}: ${model.label} · ${motion.meta.frames} frames at ${motion.meta.fps} fps`] : []; }).join(' | ');
      }
      if (task === 'm2t' && sample.captionReview) {
        const exampleNumber = String(samples.findIndex(item => item.id === sample.id) + 1).padStart(2, '0');
        $('#stage-title').textContent = `Example ${exampleNumber} · Input motion`;
        $('#stage-tag').textContent = 'INPUT MOTION';
        root.querySelector('.provenance-bar').hidden = true;
      }
      if (task === 'structure' && sample.structuralPair) {
        const ratio = Math.round(sample.structuralPair.knownRatio * 100);
        const sourceNumber = sample.hyMmReview ? ` ${String(sample.originalPosition).padStart(2, '0')}` : '';
        $('#stage-title').textContent = `${sample.structuralPair.label ?? 'Continuation'}${sourceNumber} · ${ratio}% ${(sample.structuralPair.knownLabel ?? 'known prefix').toLowerCase()}`;
        $('#stage-tag').textContent = sample.structuralProtocol === 'keyframe' ? 'ORANGE: FIXED KEYFRAMES · BLUE: MOTION' : 'ORANGE: KNOWN · BLUE: GENERATED';
        root.querySelector('.provenance-bar').hidden = true;
      }
      if (task === 'edit' && sample.editReview) {
        const displayNumber = sample.comparison ? samples.findIndex(item => item.id === sample.id) + 1 : sample.originalPosition ?? samples.findIndex(item => item.id === sample.id) + 1;
        $('#stage-title').textContent = `Edit ${String(displayNumber).padStart(2, '0')} · Motion edit`;
        $('#stage-tag').textContent = sample.comparison ? 'SOURCE · MOTIONFIX · MOTIONLAB · OURS' : 'SOURCE ↔ EDITED RESULT';
        root.querySelector('.provenance-bar').hidden = true;
      }
      applyMask(); seek(0); renderInspector(); setStatus('');
      // Deliberately start paused: the user controls playback and reduced-motion preferences are respected.
      viewer.render();
    } catch (error) {
      if (request !== state.request) return;
      state.motion = null; setStatus(error.message || 'The motion could not be loaded.', true);
    }
  }

  $('#play').addEventListener('click', () => { if (!state.playing && state.seconds >= state.duration) seek(0); setPlaying(!state.playing); });
  $('#scrubber').addEventListener('input', event => { setPlaying(false); seek(Number(event.target.value)); });
  $('#speed').addEventListener('change', event => { state.speed = Number(event.target.value); });
  $('#step-back').addEventListener('click', () => { setPlaying(false); seek(state.seconds - 1 / state.motion.meta.fps); });
  $('#step-forward').addEventListener('click', () => { setPlaying(false); seek(state.seconds + 1 / state.motion.meta.fps); });
  $('#ghosts').addEventListener('change', event => { if (!state.loading) viewer.setGhosts(event.target.checked); });
  root.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => {
    viewer?.setView(button.dataset.camera);
    root.querySelectorAll('[data-camera]').forEach(other => other.setAttribute('aria-pressed', other === button));
  }));
  $('#reset-view').addEventListener('click', () => viewer?.setView(viewer.preset));

  $('#case-select').addEventListener('change', event => selectSample(samples.find(sample => sample.id === event.target.value)));
  for (const [id, direction] of [['previous-case', -1], ['next-case', 1]]) {
    $(`#${id}`).addEventListener('click', () => {
      const index = samples.findIndex(sample => sample.id === state.sample?.id);
      const next = samples[index + direction]; if (next) selectSample(next);
    });
  }
  $('#motion-canvas').addEventListener('keydown', event => {
    if (event.code === 'Space') { event.preventDefault(); setPlaying(!state.playing); }
  });
  $('#motion-canvas').addEventListener('webglcontextlost', event => {
    event.preventDefault(); setPlaying(false); setStatus('3D graphics was interrupted. Reload the page to restore this viewer.');
  });
  if (samples.length) { state.sample = samples[0]; renderPager(); renderInspector(); }
  else { setStatus('No examples connected for this task.'); }
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible && !started && samples.length) { started = true; selectSample(state.sample); }
    if (!visible) setPlaying(false);
  }, {threshold: 0});
  observer.observe(root);
  return {
    tick(elapsed) {
      if (!visible || !viewer) return;
      if (state.playing) { const next = state.seconds + elapsed * state.speed; seek(next); if (next >= state.duration) setPlaying(false); }
      viewer.render();
    },
    pause() { setPlaying(false); },
    read() { return {task, sampleId: state.sample?.id ?? null, loading: state.loading, seconds: state.seconds, duration: state.duration, playing: state.playing}; },
    seek(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > state.duration || state.loading || !state.motion) throw new Error('A loaded motion and a valid time are required.');
      setPlaying(false); seek(seconds); viewer.render(); return this.read();
    },
    dispose() { ++state.request; setPlaying(false); observer.disconnect(); viewer?.dispose(); },
  };
}

function registerViewerTools() {
  if (!document.modelContext?.registerTool) return;
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
  const definitions = [
    {name: 'read_motion_viewer', description: 'Read playback state for each of the four independent task viewers.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      annotations: {readOnlyHint: true, untrustedContentHint: true}, execute: () => [...controllers.values()].map(viewer => viewer.read())},
    {name: 'seek_motion_viewer', description: 'Pause a task viewer and seek within the original motion time.',
      inputSchema: {type: 'object', properties: {task: {type: 'string', enum: ['t2m', 'm2t', 'structure', 'edit']}, seconds: {type: 'number', minimum: 0}}, required: ['task', 'seconds'], additionalProperties: false},
      annotations: {readOnlyHint: false, untrustedContentHint: false}, execute: input => {
        if (!input || Object.keys(input).some(key => !['task', 'seconds'].includes(key)) || !controllers.has(input.task)) throw new Error('A valid task and time are required.');
        return controllers.get(input.task).seek(input.seconds);
      }},
  ];
  for (const tool of definitions) { try { Promise.resolve(document.modelContext.registerTool(tool, {signal: lifecycle.signal})).catch(() => {}); } catch {} }
}

async function initialize() {
  try {
    const catalog = await loadCatalog();
    document.querySelectorAll('.studio[data-task]').forEach(root => controllers.set(root.dataset.task, createStudio(root, root.dataset.task, catalog)));
    let last = performance.now(), animation;
    function tick(now) {
      const elapsed = Math.min((now - last) / 1000, .1); last = now;
      if (!document.hidden) controllers.forEach(controller => controller.tick(elapsed));
      animation = requestAnimationFrame(tick);
    }
    animation = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', () => { if (document.hidden) controllers.forEach(controller => controller.pause()); });
    window.addEventListener('pagehide', event => {
      controllers.forEach(controller => controller.pause());
      if (!event.persisted) { cancelAnimationFrame(animation); controllers.forEach(controller => controller.dispose()); }
    });
    const observer = new IntersectionObserver(entries => {
      const current = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (current) document.querySelectorAll('.section-nav a').forEach(link => {
        if (link.hash === `#${current.target.id}`) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
      });
    }, {rootMargin: '-90px 0px -35% 0px', threshold: [0, .2, .5]});
    document.querySelectorAll('.task-section').forEach(section => observer.observe(section));
    if (['#t2m', '#m2t', '#structure', '#edit'].includes(location.hash)) requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
    registerViewerTools();
  } catch (error) {
    document.querySelectorAll('.studio').forEach(root => { root.textContent = `Could not load the demo: ${error.message}`; });
  }
}
if (!document.documentElement.hasAttribute('data-directory-viewer')) initialize();
