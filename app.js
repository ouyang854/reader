import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const DB_NAME = "static-literature-reader";
const DB_VERSION = 1;
const STORE = "papers";

const state = {
  papers: [],
  activeId: null,
  filter: "all",
  db: null,
  renderToken: 0,
};

const els = {
  paperCount: document.querySelector("#paperCount"),
  paperList: document.querySelector("#paperList"),
  importBtn: document.querySelector("#importBtn"),
  importInput: document.querySelector("#importInput"),
  translationInput: document.querySelector("#translationInput"),
  searchInput: document.querySelector("#searchInput"),
  filterBar: document.querySelector("#filterBar"),
  statusPill: document.querySelector("#statusPill"),
  activeTitle: document.querySelector("#activeTitle"),
  activeMeta: document.querySelector("#activeMeta"),
  originalName: document.querySelector("#originalName"),
  translationName: document.querySelector("#translationName"),
  originalViewer: document.querySelector("#originalViewer"),
  translationViewer: document.querySelector("#translationViewer"),
  toggleReadBtn: document.querySelector("#toggleReadBtn"),
  attachTranslationBtn: document.querySelector("#attachTranslationBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importBackupBtn: document.querySelector("#importBackupBtn"),
  backupInput: document.querySelector("#backupInput"),
  deleteBtn: document.querySelector("#deleteBtn"),
  addNoteBtn: document.querySelector("#addNoteBtn"),
  noteLocation: document.querySelector("#noteLocation"),
  noteText: document.querySelector("#noteText"),
  notesList: document.querySelector("#notesList"),
  saveStatus: document.querySelector("#saveStatus"),
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(mode = "readonly") {
  return state.db.transaction(STORE, mode).objectStore(STORE);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allPapers() {
  return requestToPromise(tx().getAll());
}

async function getPaper(id) {
  return requestToPromise(tx().get(id));
}

async function savePaper(paper) {
  paper.updatedAt = new Date().toISOString();
  await requestToPromise(tx("readwrite").put(paper));
}

async function deletePaper(id) {
  await requestToPromise(tx("readwrite").delete(id));
}

function safeId(name, size, modifiedAt) {
  return `${name}-${size}-${modifiedAt}`.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
}

function fmtSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cleanStem(name) {
  return name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[_\-\s()[\]（）【】]+/g, "");
}

function scoreTranslation(pdfName, textName) {
  const pdf = cleanStem(pdfName);
  const text = cleanStem(textName).replace(/academictranslation|translation|translated|中文|译文|翻译/g, "");
  if (!pdf || !text) return 0;
  if (pdf.includes(text) || text.includes(pdf)) return 1;
  const wordsA = new Set(pdfName.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const wordsB = new Set(textName.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const overlap = [...wordsA].filter((word) => wordsB.has(word)).length;
  return overlap / Math.max(1, Math.min(wordsA.size, wordsB.size));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/&lt;div\b[^&]*?text-align\s*:\s*center[^&]*?&gt;/gi, '<div class="math-line">');
  html = html.replace(/&lt;\/div&gt;/gi, "</div>");
  html = html.replace(/&lt;(\/?)(i|em|sub|sup|b|strong)&gt;/gi, "<$1$2>");
  html = html.replace(/&amp;([a-zA-Z][a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);/g, "&$1;");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function renderMarkdown(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let listOpen = false;

  function flushParagraph() {
    if (paragraph.length) out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }
  function closeList() {
    if (listOpen) out.push("</ul>");
    listOpen = false;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      out.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join("");
}

function filteredPapers() {
  const query = els.searchInput.value.trim().toLowerCase();
  return state.papers.filter((paper) => {
    const matched = !query || paper.pdfName.toLowerCase().includes(query) || paper.title.toLowerCase().includes(query);
    if (!matched) return false;
    if (state.filter === "read") return paper.read;
    if (state.filter === "unread") return !paper.read;
    if (state.filter === "translated") return Boolean(paper.translationText);
    if (state.filter === "missing") return !paper.translationText;
    return true;
  });
}

function renderPaperList() {
  els.paperCount.textContent = `${state.papers.length} 个文件`;
  els.paperList.innerHTML = "";
  for (const paper of filteredPapers()) {
    const row = document.createElement("button");
    row.className = `paper-row${paper.id === state.activeId ? " active" : ""}${paper.read ? " read" : ""}`;
    row.innerHTML = `
      <span class="file-icon">PDF</span>
      <span class="file-name"></span>
      <span class="dot"></span>
      <span class="paper-meta">${paper.translationText ? "有译文" : "无译文"} · ${fmtSize(paper.pdfSize)}</span>
    `;
    row.querySelector(".file-name").textContent = paper.pdfName;
    row.addEventListener("click", () => selectPaper(paper.id));
    els.paperList.appendChild(row);
  }
}

function setActiveControls(enabled) {
  els.toggleReadBtn.disabled = !enabled;
  els.attachTranslationBtn.disabled = !enabled;
  els.deleteBtn.disabled = !enabled;
  els.addNoteBtn.disabled = !enabled;
}

function updateHeader(paper) {
  if (!paper) {
    els.statusPill.textContent = "未选择";
    els.statusPill.className = "pill";
    els.activeTitle.textContent = "导入 PDF 后开始阅读";
    els.activeMeta.textContent = "这个版本不需要运行 Python 服务。";
    return;
  }
  els.statusPill.textContent = paper.read ? "已读" : paper.translationText ? "原文 / 译文" : "缺少译文";
  els.statusPill.className = `pill${paper.read ? " done" : paper.translationText ? "" : " warn"}`;
  els.activeTitle.textContent = paper.pdfName;
  els.activeMeta.textContent = `${fmtSize(paper.pdfSize)} · ${paper.importedAt?.replace("T", " ").slice(0, 19) || ""}`;
  els.originalName.textContent = paper.pdfName;
  els.translationName.textContent = paper.translationName || "未导入译文";
  els.toggleReadBtn.textContent = paper.read ? "取消已读" : "标为已读";
}

async function renderPdf(paper) {
  const token = ++state.renderToken;
  els.originalViewer.classList.remove("empty");
  els.originalViewer.innerHTML = '<div class="pdf-pages">正在渲染 PDF...</div>';
  const pagesWrap = document.createElement("div");
  pagesWrap.className = "pdf-pages";
  const bytes = new Uint8Array(await paper.pdfBlob.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  pagesWrap.textContent = "";
  els.originalViewer.innerHTML = "";
  els.originalViewer.appendChild(pagesWrap);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (token !== state.renderToken) return;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });
    const holder = document.createElement("div");
    holder.className = "pdf-page";
    holder.dataset.page = pageNumber;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    holder.appendChild(canvas);
    pagesWrap.appendChild(holder);
    await page.render({ canvasContext: context, viewport }).promise;
  }
}

function renderTranslation(paper) {
  els.translationViewer.innerHTML = "";
  if (!paper.translationText) {
    els.translationViewer.className = "viewer empty";
    els.translationViewer.textContent = "未导入译文。";
    return;
  }
  els.translationViewer.className = "viewer";
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = renderMarkdown(paper.translationText);
  els.translationViewer.appendChild(article);
}

function renderNotes(paper) {
  els.notesList.innerHTML = "";
  const notes = paper?.notes || [];
  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = "还没有批注。";
    els.notesList.appendChild(empty);
    return;
  }
  notes.forEach((note, index) => {
    const card = document.createElement("article");
    card.className = "note-card";
    card.innerHTML = `
      <div class="note-location"></div>
      <div class="note-body"></div>
      <div class="note-actions">
        <button data-action="edit">编辑</button>
        <button data-action="delete">删除</button>
      </div>
    `;
    card.querySelector(".note-location").textContent = note.location || "未写位置";
    card.querySelector(".note-body").textContent = note.body || "";
    card.querySelector('[data-action="edit"]').addEventListener("click", () => {
      els.noteLocation.value = note.location || "";
      els.noteText.value = note.body || "";
      els.addNoteBtn.dataset.editIndex = String(index);
      els.addNoteBtn.textContent = "更新";
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      const current = await getPaper(state.activeId);
      current.notes.splice(index, 1);
      await savePaper(current);
      await refresh();
      await selectPaper(current.id, false);
    });
    els.notesList.appendChild(card);
  });
}

async function selectPaper(id, rerenderList = true) {
  state.activeId = id;
  const paper = await getPaper(id);
  if (!paper) return;
  setActiveControls(true);
  updateHeader(paper);
  renderTranslation(paper);
  renderNotes(paper);
  if (rerenderList) renderPaperList();
  await renderPdf(paper);
}

async function refresh() {
  state.papers = (await allPapers()).sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
  renderPaperList();
}

async function importFiles(files) {
  const fileList = [...files];
  const pdfs = fileList.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
  const texts = fileList.filter((file) => /\.(md|txt)$/i.test(file.name));

  for (const pdf of pdfs) {
    let bestText = null;
    let bestScore = 0;
    for (const text of texts) {
      const score = scoreTranslation(pdf.name, text.name);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }
    const id = safeId(pdf.name, pdf.size, pdf.lastModified);
    const existing = await getPaper(id);
    const paper = existing || {
      id,
      title: pdf.name.replace(/\.pdf$/i, ""),
      read: false,
      notes: [],
      importedAt: new Date().toISOString(),
    };
    paper.pdfName = pdf.name;
    paper.pdfSize = pdf.size;
    paper.pdfBlob = pdf;
    if (bestText && bestScore >= 0.35) {
      paper.translationName = bestText.name;
      paper.translationText = await bestText.text();
    }
    await savePaper(paper);
    state.activeId = id;
  }
  await refresh();
  if (state.activeId) await selectPaper(state.activeId);
}

async function attachTranslation(file) {
  if (!state.activeId || !file) return;
  const paper = await getPaper(state.activeId);
  paper.translationName = file.name;
  paper.translationText = await file.text();
  await savePaper(paper);
  await refresh();
  await selectPaper(paper.id);
}

async function addOrUpdateNote() {
  if (!state.activeId) return;
  const body = els.noteText.value.trim();
  if (!body) return;
  const paper = await getPaper(state.activeId);
  paper.notes = paper.notes || [];
  const note = {
    location: els.noteLocation.value.trim(),
    body,
    updatedAt: new Date().toLocaleString(),
  };
  const editIndex = els.addNoteBtn.dataset.editIndex;
  if (editIndex !== undefined) {
    paper.notes[Number(editIndex)] = note;
    delete els.addNoteBtn.dataset.editIndex;
    els.addNoteBtn.textContent = "添加";
  } else {
    paper.notes.unshift(note);
  }
  els.noteLocation.value = "";
  els.noteText.value = "";
  await savePaper(paper);
  await refresh();
  await selectPaper(paper.id, false);
}

async function toggleRead() {
  if (!state.activeId) return;
  const paper = await getPaper(state.activeId);
  paper.read = !paper.read;
  await savePaper(paper);
  await refresh();
  await selectPaper(paper.id);
}

async function exportBackup() {
  const papers = await allPapers();
  const payload = [];
  for (const paper of papers) {
    payload.push({
      ...paper,
      pdfBlob: Array.from(new Uint8Array(await paper.pdfBlob.arrayBuffer())),
      pdfType: paper.pdfBlob.type || "application/pdf",
    });
  }
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), papers: payload })], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `literature-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  const backup = JSON.parse(await file.text());
  for (const item of backup.papers || []) {
    const pdfBlob = new Blob([new Uint8Array(item.pdfBlob)], { type: item.pdfType || "application/pdf" });
    await savePaper({ ...item, pdfBlob });
  }
  await refresh();
  if (state.papers[0]) await selectPaper(state.papers[0].id);
}

function startResize(event) {
  const mode = event.currentTarget.dataset.resize;
  const startX = event.clientX;
  const libraryWidth = document.querySelector(".library")?.getBoundingClientRect().width || 280;
  const notesWidth = document.querySelector(".notes")?.getBoundingClientRect().width || 300;
  const originalWidth = document.querySelector(".original-panel")?.getBoundingClientRect().width || 500;
  const translationWidth = document.querySelector(".translation-panel")?.getBoundingClientRect().width || 500;

  document.body.classList.add("resizing");
  function move(moveEvent) {
    const dx = moveEvent.clientX - startX;
    if (mode === "library") {
      document.documentElement.style.setProperty("--library-width", `${Math.max(220, Math.min(520, libraryWidth + dx))}px`);
    }
    if (mode === "notes") {
      document.documentElement.style.setProperty("--notes-width", `${Math.max(240, Math.min(520, notesWidth - dx))}px`);
    }
    if (mode === "reader") {
      const total = originalWidth + translationWidth;
      const nextOriginal = Math.max(230, Math.min(total - 230, originalWidth + dx));
      document.documentElement.style.setProperty("--original-ratio", String(nextOriginal));
      document.documentElement.style.setProperty("--translation-ratio", String(total - nextOriginal));
    }
  }
  function stop() {
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function syncScroll(event) {
  if (!event.altKey) return;
  event.preventDefault();
  els.originalViewer.scrollTop += event.deltaY;
  els.translationViewer.scrollTop += event.deltaY;
}

els.importBtn.addEventListener("click", () => els.importInput.click());
els.importInput.addEventListener("change", () => importFiles(els.importInput.files));
els.attachTranslationBtn.addEventListener("click", () => els.translationInput.click());
els.translationInput.addEventListener("change", () => attachTranslation(els.translationInput.files[0]));
els.searchInput.addEventListener("input", renderPaperList);
els.filterBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  els.filterBar.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  renderPaperList();
});
els.addNoteBtn.addEventListener("click", addOrUpdateNote);
els.toggleReadBtn.addEventListener("click", toggleRead);
els.deleteBtn.addEventListener("click", async () => {
  if (!state.activeId || !confirm("删除当前文献及其批注？")) return;
  await deletePaper(state.activeId);
  state.activeId = null;
  setActiveControls(false);
  updateHeader(null);
  els.originalViewer.className = "viewer empty";
  els.originalViewer.textContent = "请选择或导入一篇 PDF。";
  els.translationViewer.className = "viewer empty";
  els.translationViewer.textContent = "未导入译文。";
  renderNotes(null);
  await refresh();
});
els.exportBtn.addEventListener("click", exportBackup);
els.importBackupBtn.addEventListener("click", () => els.backupInput.click());
els.backupInput.addEventListener("change", () => importBackup(els.backupInput.files[0]));
els.originalViewer.addEventListener("wheel", syncScroll, { passive: false });
els.translationViewer.addEventListener("wheel", syncScroll, { passive: false });
document.querySelectorAll(".splitter").forEach((splitter) => splitter.addEventListener("pointerdown", startResize));

state.db = await openDb();
await refresh();
if (state.papers[0]) {
  await selectPaper(state.papers[0].id);
} else {
  setActiveControls(false);
  renderNotes(null);
}
