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

function youtubeEmbed(row) {
  const start = youtubeStart(row);
  const params = start > 0 ? `?start=${start}` : "";
  return `https://www.youtube.com/embed/${encodeURIComponent(row.youtube_video_id)}${params}`;
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
        src="${escapeHtml(youtubeEmbed(row))}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        title="${escapeHtml(row.file)} YouTube preview">
      </iframe>
    `;
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
