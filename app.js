const csvUrl = "data/recordings.csv";

const state = {
  rows: [],
  visible: [],
  selectedFile: "",
  mediaMode: "video",
  audioFile: "",
  selectedDownloads: new Set(),
  selectMode: false,
};

const els = {
  search: document.querySelector("#search"),
  mediaFilter: document.querySelector("#media-filter"),
  captionFilter: document.querySelector("#caption-filter"),
  sort: document.querySelector("#sort"),
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
  audioLink: document.querySelector("#audio-link"),
  videoDownload: document.querySelector("#video-download"),
  audioDownload: document.querySelector("#audio-download"),
  selectMode: document.querySelector("#select-mode"),
  selectVisible: document.querySelector("#select-visible"),
  downloadSelected: document.querySelector("#download-selected"),
  selectedCount: document.querySelector("#selected-count"),
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

  state.visible = state.rows.filter((row) => {
    const haystack = `${row.file} ${row.caption} ${row.device}`.toLowerCase();
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
    return matchesQuery && matchesMedia && matchesCaption;
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
            ${playerMarkup(row)}
          </td>
          <td class="caption-cell">${escapeHtml(row.caption)}</td>
          <td>${escapeHtml(row.length)}</td>
          <td>${mediaTags(row)}</td>
        </tr>
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

  const fileId = state.mediaMode === "video" ? row.video_file_id : row.audio_file_id;
  const label = state.mediaMode === "video" ? "video" : "audio";

  if (!fileId) {
    els.preview.innerHTML = `<div class="empty">No ${label} file is available for this row.</div>`;
    return;
  }

  els.preview.innerHTML = `
    <iframe
      src="${drivePreview(fileId)}"
      allow="autoplay; fullscreen"
      allowfullscreen
      title="${row.file} ${label} preview">
    </iframe>
  `;
}

function renderDetail() {
  const row = state.visible.find((item) => item.file === state.selectedFile) || state.visible[0];

  if (!row) {
    els.selectedFile.textContent = "";
    els.selectedCaption.textContent = "No matching recordings";
    els.selectedLength.textContent = "";
    els.preview.innerHTML = '<div class="empty">Try changing the search or filters.</div>';
    return;
  }

  state.selectedFile = row.file;
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

  els.videoLink.href = row.video_url || "#";
  els.videoLink.textContent = row.video_file_id ? "Open video" : "Open video";
  els.videoLink.classList.toggle("disabled", !row.video_url);
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
}

function render() {
  renderSummary();
  renderList();
  renderDetail();
}

function selectFile(file) {
  state.selectedFile = file;
  state.audioFile = file;
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

[els.search, els.mediaFilter, els.captionFilter, els.sort].forEach((input) => {
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

fetch(csvUrl)
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load ${csvUrl}`);
    return response.text();
  })
  .then((text) => {
    state.rows = parseCsv(text);
    state.selectedFile = state.rows[0]?.file || "";
    state.audioFile = state.selectedFile;
    applyFilters();
  })
  .catch((error) => {
    els.preview.innerHTML = `<div class="empty">${error.message}</div>`;
  });
