const csvUrl = "data/recordings.csv";

const state = {
  rows: [],
  visible: [],
  selectedFile: "",
  mediaMode: "video",
  audioFile: "",
  selectedDownloads: new Set(),
  selectMode: false,
  detailOpen: false,
};

const youtubeState = {
  apiPromise: null,
  player: null,
  ready: false,
  file: "",
  timer: 0,
  seeking: false,
  playing: false,
};

const els = {
  search: document.querySelector("#search"),
  mediaFilter: document.querySelector("#media-filter"),
  captionFilter: document.querySelector("#caption-filter"),
  sessionFilter: document.querySelector("#session-filter"),
  sort: document.querySelector("#sort"),
  sessionLabel: document.querySelector("#session-label"),
  sessionPlaylist: document.querySelector("#session-playlist"),
  table: document.querySelector("#recording-table"),
  cards: document.querySelector("#card-list"),
  visibleCount: document.querySelector("#visible-count"),
  totalDuration: document.querySelector("#total-duration"),
  videoCount: document.querySelector("#video-count"),
  audioCount: document.querySelector("#audio-count"),
  selectedFile: document.querySelector("#selected-file"),
  selectedCaption: document.querySelector("#selected-caption"),
  selectedLength: document.querySelector("#selected-length"),
  selectedRecorded: document.querySelector("#selected-recorded"),
  selectedSize: document.querySelector("#selected-size"),
  selectedResolution: document.querySelector("#selected-resolution"),
  selectedRotation: document.querySelector("#selected-rotation"),
  selectedAudio: document.querySelector("#selected-audio"),
  selectedDevice: document.querySelector("#selected-device"),
  segmentControls: document.querySelector("#segment-controls"),
  playToggle: document.querySelector("#play-toggle"),
  segmentSeek: document.querySelector("#segment-seek"),
  segmentCurrent: document.querySelector("#segment-current"),
  segmentEnd: document.querySelector("#segment-end"),
  preview: document.querySelector("#preview"),
  videoTab: document.querySelector("#video-tab"),
  audioTab: document.querySelector("#audio-tab"),
  videoLink: document.querySelector("#video-link"),
  copyYoutube: document.querySelector("#copy-youtube"),
  copyPageLink: document.querySelector("#copy-page-link"),
  audioLink: document.querySelector("#audio-link"),
  videoDownload: document.querySelector("#video-download"),
  audioDownload: document.querySelector("#audio-download"),
  selectMode: document.querySelector("#select-mode"),
  selectVisible: document.querySelector("#select-visible"),
  downloadSelected: document.querySelector("#download-selected"),
  selectedCount: document.querySelector("#selected-count"),
  detail: document.querySelector("#detail"),
  expandDetail: document.querySelector("#expand-detail"),
  closeDetail: document.querySelector("#close-detail"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])),
  );
}

function drivePreview(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

function driveDownload(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function timestampToSeconds(value) {
  if (!value) return 0;
  const parts = String(value)
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function secondsFromYoutubeUrl(value) {
  if (!value) return 0;
  try {
    const url = new URL(value);
    const timestamp = url.searchParams.get("t") || url.searchParams.get("start");
    if (!timestamp) return 0;
    if (/^\d+$/.test(timestamp)) return Number(timestamp);
    const match = timestamp.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  } catch {
    return 0;
  }
}

function youtubeStart(row) {
  return timestampToSeconds(row.section_start) || secondsFromYoutubeUrl(row.youtube_timestamp_url);
}

function youtubeEnd(row) {
  return timestampToSeconds(row.section_end);
}

function segmentBounds(row) {
  const start = youtubeStart(row);
  const explicitEnd = youtubeEnd(row);
  const duration = Number(row.duration_seconds || 0);
  const end = explicitEnd > start ? explicitEnd : start + duration;
  return {
    start,
    end,
    duration: Math.max(0, end - start),
  };
}

function youtubeEmbed(row, enableApi = false) {
  const start = youtubeStart(row);
  const params = new URLSearchParams();
  if (start > 0) params.set("start", String(start));
  if (enableApi) {
    params.set("enablejsapi", "1");
    params.set("origin", window.location.origin);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `https://www.youtube.com/embed/${encodeURIComponent(row.youtube_video_id)}${suffix}`;
}

function youtubeLink(row) {
  if (row.youtube_timestamp_url) return row.youtube_timestamp_url;
  if (row.youtube_url) return row.youtube_url;
  if (row.youtube_video_id) return `https://www.youtube.com/watch?v=${encodeURIComponent(row.youtube_video_id)}`;
  return "";
}

function playlistUrl(row) {
  if (row.youtube_playlist_url) return row.youtube_playlist_url;
  if (row.youtube_playlist_id) return `https://www.youtube.com/playlist?list=${encodeURIComponent(row.youtube_playlist_id)}`;
  return "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hashForFile(file) {
  return encodeURIComponent(String(file || "").replace(/\.[^.]+$/, ""));
}

function fileFromHash() {
  const value = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!value) return "";
  const normalized = value.toLowerCase();
  const exact = state.rows.find((row) => row.file.toLowerCase() === normalized);
  if (exact) return exact.file;
  const byStem = state.rows.find((row) => row.file.replace(/\.[^.]+$/, "").toLowerCase() === normalized);
  return byStem?.file || "";
}

function setUrlForFile(file) {
  const hash = `#${hashForFile(file)}`;
  if (window.location.hash === hash) return;
  history.replaceState(null, "", hash);
}

function pageLinkForFile(file) {
  const url = new URL(window.location.href);
  url.hash = hashForFile(file);
  return url.toString();
}

function selectedRow() {
  return state.visible.find((item) => item.file === state.selectedFile) || state.visible[0];
}

function formatTotal(seconds) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function updateSegmentLabels(row, offset = 0) {
  const bounds = segmentBounds(row);
  const value = Math.max(0, Math.min(bounds.duration, offset));
  const progress = bounds.duration > 0 ? (value / bounds.duration) * 100 : 0;
  els.segmentSeek.max = String(bounds.duration || 0);
  els.segmentSeek.value = String(value);
  els.segmentSeek.style.setProperty("--seek-progress", `${progress}%`);
  els.segmentCurrent.textContent = formatTotal(value);
  els.segmentEnd.textContent = formatTotal(bounds.duration);
}

function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeState.apiPromise) return youtubeState.apiPromise;
  youtubeState.apiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === "function") previousReady();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return youtubeState.apiPromise;
}

function currentSegmentRow() {
  const row = selectedRow();
  if (!row || row.file !== youtubeState.file) return null;
  return row;
}

function setPlayLabel(playing) {
  youtubeState.playing = playing;
  els.playToggle.textContent = playing ? "Pause" : "Play";
  els.playToggle.setAttribute("aria-label", `${playing ? "Pause" : "Play"} selected video`);
}

function setSegmentControlsReady(ready) {
  els.playToggle.disabled = !ready;
  els.segmentSeek.disabled = !ready;
}

function stopYoutubeTimer() {
  if (!youtubeState.timer) return;
  window.clearInterval(youtubeState.timer);
  youtubeState.timer = 0;
}

function syncYoutubeProgress() {
  const row = currentSegmentRow();
  if (!row || !youtubeState.player || !youtubeState.ready || youtubeState.seeking) return;
  const bounds = segmentBounds(row);
  const absoluteTime = Number(youtubeState.player.getCurrentTime?.() || bounds.start);
  const offset = Math.max(0, Math.min(bounds.duration, absoluteTime - bounds.start));
  updateSegmentLabels(row, offset);

  if (bounds.duration > 0 && absoluteTime >= bounds.end - 0.15) {
    youtubeState.player.pauseVideo?.();
    youtubeState.player.seekTo?.(bounds.end, true);
    updateSegmentLabels(row, bounds.duration);
    setPlayLabel(false);
  }
}

function startYoutubeTimer() {
  stopYoutubeTimer();
  youtubeState.timer = window.setInterval(syncYoutubeProgress, 250);
}

function teardownYoutubePlayer() {
  stopYoutubeTimer();
  if (youtubeState.player?.destroy) youtubeState.player.destroy();
  youtubeState.player = null;
  youtubeState.ready = false;
  youtubeState.file = "";
  setPlayLabel(false);
  setSegmentControlsReady(false);
}

function setupYoutubePlayer(row) {
  if (!row.youtube_video_id) {
    teardownYoutubePlayer();
    return;
  }
  teardownYoutubePlayer();
  youtubeState.file = row.file;
  updateSegmentLabels(row);
  setSegmentControlsReady(false);

  loadYoutubeApi().then((YT) => {
    const iframe = document.querySelector("#youtube-preview");
    if (!iframe || youtubeState.file !== row.file) return;
    youtubeState.player = new YT.Player(iframe, {
      events: {
        onReady: () => {
          const active = currentSegmentRow();
          if (!active) return;
          const bounds = segmentBounds(active);
          youtubeState.ready = true;
          setSegmentControlsReady(true);
          youtubeState.player.seekTo?.(bounds.start, true);
          updateSegmentLabels(active);
          startYoutubeTimer();
        },
        onStateChange: (event) => {
          setPlayLabel(event.data === YT.PlayerState.PLAYING);
          if (event.data === YT.PlayerState.PLAYING) startYoutubeTimer();
        },
      },
    });
  });
}

function seekWithinSegment(offset, playAfterSeek = youtubeState.playing) {
  const row = currentSegmentRow();
  if (!row || !youtubeState.player || !youtubeState.ready) return;
  const bounds = segmentBounds(row);
  const boundedOffset = Math.max(0, Math.min(bounds.duration, Number(offset || 0)));
  youtubeState.seeking = true;
  youtubeState.player.seekTo?.(bounds.start + boundedOffset, true);
  updateSegmentLabels(row, boundedOffset);
  if (playAfterSeek) youtubeState.player.playVideo?.();
  window.setTimeout(() => {
    youtubeState.seeking = false;
    syncYoutubeProgress();
  }, 350);
}

function seekBy(deltaSeconds) {
  const row = currentSegmentRow();
  if (!row) return;
  seekWithinSegment(Number(els.segmentSeek.value || 0) + deltaSeconds);
}

function toggleYoutubePlayback() {
  const row = currentSegmentRow();
  if (!row || !youtubeState.player || !youtubeState.ready) return;
  const bounds = segmentBounds(row);
  const absoluteTime = Number(youtubeState.player.getCurrentTime?.() || bounds.start);
  if (absoluteTime < bounds.start || absoluteTime >= bounds.end - 0.15) {
    youtubeState.player.seekTo?.(bounds.start, true);
  }
  if (youtubeState.playing) {
    youtubeState.player.pauseVideo?.();
    setPlayLabel(false);
  } else {
    youtubeState.player.playVideo?.();
    setPlayLabel(true);
    startYoutubeTimer();
  }
}

function hasMissingCaption(row) {
  return row.caption.toLowerCase().includes("no embedded caption");
}

function applyFilters() {
  const query = els.search.value.trim().toLowerCase();
  const media = els.mediaFilter.value;
  const caption = els.captionFilter.value;
  const session = els.sessionFilter.value;

  state.visible = state.rows.filter((row) => {
    const haystack = [
      row.file,
      row.caption,
      row.device,
      row.session_id,
      row.session_label,
      row.tags,
      row.song,
      row.game,
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesMedia =
      media === "all" ||
      (media === "video" && row.has_video === "yes") ||
      (media === "audio" && row.has_audio === "yes") ||
      (media === "audio-only" && row.has_audio === "yes" && row.has_video !== "yes");
    const matchesCaption =
      caption === "all" ||
      (caption === "named" && !hasMissingCaption(row)) ||
      (caption === "missing" && hasMissingCaption(row));
    const matchesSession = session === "all" || row.session_id === session;
    return matchesQuery && matchesMedia && matchesCaption && matchesSession;
  });

  const sorters = {
    newest: (a, b) => b.file.localeCompare(a.file),
    oldest: (a, b) => a.file.localeCompare(b.file),
    longest: (a, b) => Number(b.duration_seconds) - Number(a.duration_seconds),
    shortest: (a, b) => Number(a.duration_seconds) - Number(b.duration_seconds),
    caption: (a, b) => a.caption.localeCompare(b.caption),
  };
  state.visible.sort(sorters[els.sort.value]);
  const visibleFiles = new Set(state.visible.map((row) => row.file));
  state.selectedDownloads.forEach((file) => {
    if (!visibleFiles.has(file)) state.selectedDownloads.delete(file);
  });

  if (!state.visible.some((row) => row.file === state.selectedFile)) {
    state.selectedFile = state.visible[0]?.file || "";
  }

  render();
}

function mediaTags(row) {
  const tags = [];
  if (row.has_video === "yes") tags.push('<span class="tag">video</span>');
  if (row.has_audio === "yes") tags.push('<span class="tag">audio</span>');
  if (row.youtube_video_id) tags.push('<span class="tag youtube">YouTube</span>');
  if (hasMissingCaption(row)) tags.push('<span class="tag missing">no caption</span>');
  return `<div class="media-tags">${tags.join("")}</div>`;
}

function thumbnail(row) {
  return row.thumbnail || `thumbs/${row.file.replace(/\.MOV$/i, "")}.jpg`;
}

function rowForFile(file) {
  return state.rows.find((row) => row.file === file);
}

function audioSource(row) {
  return row.audio_file ? `audio/${row.audio_file}` : "";
}

function mediaDownload(row) {
  return driveDownload(row.video_file_id || row.audio_file_id);
}

function playerMarkup(row) {
  if (state.audioFile !== row.file || row.has_audio !== "yes") return "";
  return `
    <div class="inline-player" data-player="${escapeHtml(row.file)}">
      <audio class="native-audio" controls preload="metadata" src="${escapeHtml(audioSource(row))}"></audio>
      <div class="player-actions">
        <a class="download-link" href="${escapeHtml(driveDownload(row.audio_file_id))}" download target="_blank" rel="noopener">Download audio</a>
      </div>
    </div>
  `;
}

function tablePlayerRow(row) {
  if (state.audioFile !== row.file || row.has_audio !== "yes") return "";
  return `
    <tr class="player-row ${row.file === state.selectedFile ? "active" : ""}">
      <td colspan="5">${playerMarkup(row)}</td>
    </tr>
  `;
}

function renderList() {
  els.table.innerHTML = state.visible
    .map(
      (row) => `
        <tr class="${row.file === state.selectedFile ? "active" : ""}" data-file="${row.file}">
          <td class="select-col">
            ${state.selectMode ? `<input class="select-box" type="checkbox" data-select-file="${escapeHtml(row.file)}" ${state.selectedDownloads.has(row.file) ? "checked" : ""} aria-label="Select ${escapeHtml(row.caption)}">` : ""}
          </td>
          <td>
            <div class="row-file">
              <img class="row-thumb" src="${escapeHtml(thumbnail(row))}" alt="">
              <div>
                <strong>${escapeHtml(row.file)}</strong><br>
                <span class="muted">${escapeHtml(row.recorded_create_date)}</span>
                <div class="row-links">
                  ${row.has_audio === "yes" ? `<button type="button" data-show-player="${escapeHtml(row.file)}">Audio player</button>` : ""}
                  <a href="${escapeHtml(mediaDownload(row))}" download target="_blank" rel="noopener">Download</a>
                </div>
              </div>
            </div>
          </td>
          <td class="caption-cell">${escapeHtml(row.caption)}</td>
          <td>${escapeHtml(row.length)}</td>
          <td>${mediaTags(row)}</td>
        </tr>
        ${tablePlayerRow(row)}
      `,
    )
    .join("");

  els.cards.innerHTML = state.visible
    .map(
      (row) => `
        <article class="recording-card ${row.file === state.selectedFile ? "active" : ""}" data-file="${row.file}">
          ${state.selectMode ? `<input class="select-box card-select" type="checkbox" data-select-file="${escapeHtml(row.file)}" ${state.selectedDownloads.has(row.file) ? "checked" : ""} aria-label="Select ${escapeHtml(row.caption)}">` : ""}
          <img class="card-thumb" src="${escapeHtml(thumbnail(row))}" alt="">
          <div class="card-main">
            <strong>${escapeHtml(row.caption)}</strong>
            <span class="pill">${escapeHtml(row.length)}</span>
          </div>
          <span class="muted">${escapeHtml(row.file)} · ${escapeHtml(row.recorded_create_date)}</span>
          ${mediaTags(row)}
          <div class="card-actions">
            ${row.has_audio === "yes" ? `<button type="button" data-show-player="${escapeHtml(row.file)}">Audio player</button>` : ""}
            <a href="${escapeHtml(mediaDownload(row))}" download target="_blank" rel="noopener">Download</a>
          </div>
          ${playerMarkup(row)}
        </article>
      `,
    )
    .join("");

  renderSelection();
}

function renderPreview(row) {
  els.videoTab.classList.toggle("active", state.mediaMode === "video");
  els.audioTab.classList.toggle("active", state.mediaMode === "audio");

  if (state.mediaMode === "video" && row.youtube_video_id) {
    els.preview.innerHTML = `
      <iframe
        id="youtube-preview"
        src="${escapeHtml(youtubeEmbed(row, true))}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        title="${escapeHtml(row.file)} YouTube preview">
      </iframe>
    `;
    setupYoutubePlayer(row);
    return;
  }

  const fileId = state.mediaMode === "video" ? row.video_file_id : row.audio_file_id;
  const label = state.mediaMode === "video" ? "video" : "audio";

  if (!fileId) {
    els.preview.innerHTML = `<div class="empty">No ${label} file is available for this row.</div>`;
    return;
  }

  els.preview.innerHTML = `
    <iframe
      src="${escapeHtml(drivePreview(fileId))}"
      allow="autoplay"
      allowfullscreen
      title="${escapeHtml(row.file)} ${label} preview">
    </iframe>
  `;
  teardownYoutubePlayer();
}

function renderDetail() {
  const row = selectedRow();

  if (!row) {
    els.detail.classList.remove("has-selection", "open");
    els.selectedFile.textContent = "";
    els.selectedCaption.textContent = "No matching recordings";
    els.selectedLength.textContent = "";
    els.preview.innerHTML = '<div class="empty">Try changing the search or filters.</div>';
    return;
  }

  state.selectedFile = row.file;
  els.detail.classList.add("has-selection");
  els.detail.classList.toggle("open", state.detailOpen);
  if (state.mediaMode === "video" && row.has_video !== "yes") state.mediaMode = "audio";
  const hasSegmentControls = state.mediaMode === "video" && Boolean(row.youtube_video_id);
  els.segmentControls.hidden = !hasSegmentControls;
  if (hasSegmentControls) updateSegmentLabels(row);

  els.selectedFile.textContent = row.file;
  els.selectedCaption.textContent = row.caption;
  els.selectedLength.textContent = row.length;
  els.selectedRecorded.textContent = row.recorded_create_date;
  els.selectedSize.textContent = `${row.size_mb} MB MOV`;
  els.selectedResolution.textContent = row.resolution;
  els.selectedRotation.textContent = `${row.rotation} degrees`;
  els.selectedAudio.textContent = `${row.audio_file || "No audio"} · ${row.audio_size_mb || "0"} MB`;
  els.selectedDevice.textContent = row.device;

  const openVideoUrl = youtubeLink(row) || row.video_url;
  els.videoLink.href = openVideoUrl || "#";
  els.videoLink.textContent = row.youtube_timestamp_url ? "Open YouTube section" : "Open YouTube";
  els.videoLink.classList.toggle("disabled", !openVideoUrl);
  els.copyYoutube.dataset.copyValue = openVideoUrl || "";
  els.copyYoutube.disabled = !openVideoUrl;
  els.copyYoutube.textContent = "Copy YouTube link";
  els.copyPageLink.dataset.copyValue = pageLinkForFile(row.file);
  els.copyPageLink.textContent = "Copy page link";
  els.audioLink.href = row.audio_url || "#";
  els.audioLink.textContent = row.audio_file_id ? "Open audio" : "Open audio";
  els.audioLink.classList.toggle("disabled", !row.audio_url);
  els.videoDownload.href = row.video_file_id ? driveDownload(row.video_file_id) : "#";
  els.videoDownload.classList.toggle("disabled", !row.video_file_id);
  els.audioDownload.href = row.audio_file_id ? driveDownload(row.audio_file_id) : "#";
  els.audioDownload.classList.toggle("disabled", !row.audio_file_id);

  renderPreview(row);
}

function renderSummary() {
  const totalDuration = state.visible.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0);
  els.visibleCount.textContent = state.visible.length;
  els.totalDuration.textContent = formatTotal(totalDuration);
  els.videoCount.textContent = state.visible.filter((row) => row.has_video === "yes").length;
  els.audioCount.textContent = state.visible.filter((row) => row.has_audio === "yes").length;

  const sessionRows = state.rows.filter((row) => row.session_id && row.session_id === els.sessionFilter.value);
  const sessionRow = sessionRows[0];
  const url = sessionRow ? playlistUrl(sessionRow) : "";
  els.sessionLabel.textContent = sessionRow ? sessionRow.session_label || sessionRow.session_id : "All sessions";
  els.sessionPlaylist.href = url || "#";
  els.sessionPlaylist.hidden = !url;
}

function render() {
  renderSummary();
  renderList();
  renderDetail();
}

function selectFile(file) {
  state.selectedFile = file;
  state.audioFile = file;
  state.detailOpen = false;
  setUrlForFile(file);
  render();
}

function renderSelection() {
  const count = state.selectedDownloads.size;
  const allVisibleSelected = state.visible.length > 0 && state.visible.every((row) => state.selectedDownloads.has(row.file));
  els.selectMode.textContent = state.selectMode ? "Done" : "Select";
  els.selectVisible.textContent = allVisibleSelected ? "Clear shown" : "Select all shown";
  els.selectVisible.hidden = !state.selectMode;
  els.downloadSelected.hidden = !state.selectMode;
  els.selectedCount.hidden = !state.selectMode;
  els.selectedCount.textContent = `${count} selected`;
  els.downloadSelected.disabled = count === 0;
}

function showPlayer(file) {
  const row = rowForFile(file);
  if (!row || row.has_audio !== "yes") return;
  state.audioFile = file;
  state.selectedFile = file;
  state.detailOpen = false;
  setUrlForFile(file);
  render();
}

function downloadSelected() {
  [...state.selectedDownloads]
    .map(rowForFile)
    .filter(Boolean)
    .forEach((row) => {
      const link = document.createElement("a");
      link.href = mediaDownload(row);
      link.target = "_blank";
      link.rel = "noopener";
      link.download = "";
      document.body.append(link);
      link.click();
      link.remove();
    });
}

function fallbackCopy(value) {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

async function copyButtonValue(button) {
  const value = button.dataset.copyValue;
  if (!value) return;
  const label = button.textContent;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else fallbackCopy(value);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = label;
  }, 1200);
}

function populateSessionFilter() {
  const sessions = new Map();
  state.rows.forEach((row) => {
    if (!row.session_id) return;
    sessions.set(row.session_id, row.session_label || row.session_id);
  });
  els.sessionFilter.innerHTML = [
    '<option value="all">All sessions</option>',
    ...[...sessions.entries()].map(
      ([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`,
    ),
  ].join("");
  if (sessions.size === 1) {
    els.sessionFilter.value = [...sessions.keys()][0];
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-select-file]")) {
    event.stopPropagation();
    return;
  }

  const playerButton = event.target.closest("[data-show-player]");
  if (playerButton) {
    event.stopPropagation();
    showPlayer(playerButton.dataset.showPlayer);
    return;
  }

  const row = event.target.closest("[data-file]");
  if (row) selectFile(row.dataset.file);
});

document.addEventListener("input", (event) => {
  const checkbox = event.target.closest("[data-select-file]");
  if (checkbox) {
    if (checkbox.checked) state.selectedDownloads.add(checkbox.dataset.selectFile);
    else state.selectedDownloads.delete(checkbox.dataset.selectFile);
    renderList();
    return;
  }
});

[els.search, els.mediaFilter, els.captionFilter, els.sessionFilter, els.sort].forEach((input) => {
  input.addEventListener("input", applyFilters);
});

els.videoTab.addEventListener("click", () => {
  state.mediaMode = "video";
  renderDetail();
});

els.audioTab.addEventListener("click", () => {
  state.mediaMode = "audio";
  renderDetail();
});

els.selectMode.addEventListener("click", () => {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) state.selectedDownloads.clear();
  renderList();
});

els.selectVisible.addEventListener("click", () => {
  const allVisibleSelected = state.visible.every((row) => state.selectedDownloads.has(row.file));
  state.visible.forEach((row) => {
    if (allVisibleSelected) state.selectedDownloads.delete(row.file);
    else state.selectedDownloads.add(row.file);
  });
  renderList();
});

els.downloadSelected.addEventListener("click", downloadSelected);

els.playToggle.addEventListener("click", toggleYoutubePlayback);

els.segmentSeek.addEventListener("input", () => {
  youtubeState.seeking = true;
  const row = currentSegmentRow();
  if (row) updateSegmentLabels(row, Number(els.segmentSeek.value));
});

els.segmentSeek.addEventListener("change", () => {
  youtubeState.seeking = false;
  seekWithinSegment(Number(els.segmentSeek.value));
});

function handleKeyboardShortcuts(event) {
  const target = event.target?.closest ? event.target : document.activeElement;
  const field = target?.closest?.("input, textarea, select");
  if (field && field !== els.segmentSeek) return;
  if (target?.closest?.("button, a")) return;
  const row = currentSegmentRow();
  if (!row || els.segmentControls.hidden) return;
  if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    toggleYoutubePlayback();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekBy(-5);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    seekBy(5);
  }
}

document.addEventListener("keydown", handleKeyboardShortcuts, true);

els.copyYoutube.addEventListener("click", () => {
  copyButtonValue(els.copyYoutube);
});

els.copyPageLink.addEventListener("click", () => {
  copyButtonValue(els.copyPageLink);
});

els.expandDetail.addEventListener("click", () => {
  state.detailOpen = true;
  els.detail.classList.add("open");
});

els.closeDetail.addEventListener("click", () => {
  state.detailOpen = false;
  els.detail.classList.remove("open");
});

window.addEventListener("hashchange", () => {
  const file = fileFromHash();
  if (!file) return;
  state.selectedFile = file;
  state.audioFile = file;
  state.detailOpen = false;
  applyFilters();
});

fetch(csvUrl)
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load ${csvUrl}`);
    return response.text();
  })
  .then((text) => {
    state.rows = parseCsv(text);
    const hashedFile = fileFromHash();
    state.selectedFile = hashedFile || state.rows[0]?.file || "";
    state.audioFile = state.selectedFile;
    state.detailOpen = false;
    populateSessionFilter();
    applyFilters();
  })
  .catch((error) => {
    els.preview.innerHTML = `<div class="empty">${error.message}</div>`;
  });
