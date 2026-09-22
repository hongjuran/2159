(() => {
  const TEXT_EXTENSIONS = ["txt", "csv", "tsv", "log", "json", "md"];
  const EXCEL_EXTENSIONS = ["xlsx", "xls"];
  const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "bmp", "webp"];
  const PDF_EXTENSIONS = ["pdf"];
  const ALL_EXTENSIONS = [...TEXT_EXTENSIONS, ...EXCEL_EXTENSIONS, ...IMAGE_EXTENSIONS, ...PDF_EXTENSIONS];

  const PDF_RENDER_SCALE = 2;
  const REDACTION_PADDING = 4;

  const DOWNLOAD_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5h4l1.7 2H19.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />' +
    "</svg>";

  // Matches a Korean resident registration number: 6-digit birth date,
  // optional separator (a dash with up to a few spaces on either side —
  // scanned/OCR'd forms often print "721219 - 1328111"), then a 7-digit
  // block whose first digit is 1-8 (gender/century code). Digit
  // boundaries on both sides keep it from matching the middle of a
  // longer number.
  const RRN_REGEX = /(?<!\d)(\d{6})([ \t]{0,3}-?[ \t]{0,3})([1-8])\d{6}(?!\d)/g;

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const browseBtn = document.getElementById("browseBtn");
  const fileNameList = document.getElementById("fileNameList");
  const encodingSelect = document.getElementById("encodingSelect");
  const maskStyleSelect = document.getElementById("maskStyleSelect");
  const runBtn = document.getElementById("runBtn");
  const progressText = document.getElementById("progressText");

  const resultsSection = document.getElementById("resultsSection");
  const resultSummaryAll = document.getElementById("resultSummaryAll");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const resultsList = document.getElementById("resultsList");

  const errorPanel = document.getElementById("errorPanel");
  const errorText = document.getElementById("errorText");

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/pdf.worker.min.js";
  }

  let selectedFiles = [];
  let successfulResults = []; // [{ blob, filename }] for files masked without error
  let ocrWorkerPromise = null;
  let fileProgressLabel = "";

  function getExtension(name) {
    const idx = name.lastIndexOf(".");
    return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
  }

  function fileKind(ext) {
    if (EXCEL_EXTENSIONS.includes(ext)) return "excel";
    if (IMAGE_EXTENSIONS.includes(ext)) return "image";
    if (PDF_EXTENSIONS.includes(ext)) return "pdf";
    if (TEXT_EXTENSIONS.includes(ext)) return "text";
    return null;
  }

  function maskText(text) {
    const fill = maskStyleSelect.value === "block" ? "█".repeat(6) : "*".repeat(6);
    let count = 0;
    const masked = text.replace(RRN_REGEX, (_match, front, sep, genderDigit) => {
      count += 1;
      return `${front}${sep}${genderDigit}${fill}`;
    });
    return { masked, count };
  }

  // Finds every RRN match inside a run of text and returns the character
  // offsets of only the part that should be masked (the trailing 6
  // digits, after the birth date + separator + gender digit that stay
  // visible), used both for plain-text replacement and for locating the
  // matching region inside an OCR word / PDF text item for redaction.
  function findMatchRanges(text) {
    const matches = [];
    const re = new RegExp(RRN_REGEX.source, "g");
    let m = re.exec(text);
    while (m) {
      const maskStart = m.index + m[1].length + m[2].length + m[3].length;
      matches.push({ start: maskStart, end: m.index + m[0].length });
      m = re.exec(text);
    }
    return matches;
  }

  function interpolateBBox(bbox, textLength, start, end) {
    const len = textLength || 1;
    const width = bbox.x1 - bbox.x0;
    return {
      x0: bbox.x0 + (width * start) / len,
      x1: bbox.x0 + (width * end) / len,
      y0: bbox.y0,
      y1: bbox.y1,
    };
  }

  function unionBBox(a, b) {
    return {
      x0: Math.min(a.x0, b.x0),
      x1: Math.max(a.x1, b.x1),
      y0: Math.min(a.y0, b.y0),
      y1: Math.max(a.y1, b.y1),
    };
  }

  // Shared matcher for both OCR word boxes and PDF text-layer boxes.
  // `lines` is an array of { words: [{ text, bbox }] } grouped by row.
  // OCR (and PDFs with printed "721219 - 1328111" style spacing) often
  // splits a number across 2-3 tokens ("721219", "-", "1328111"), so
  // this tries joining windows of 3, then 2, then 1 word. A match found
  // in a window only boxes (and consumes) the specific word(s) whose
  // character range actually overlaps the masked portion of the match —
  // never the whole window — so an unrelated neighboring word (e.g. a
  // name in the next table cell) never gets pulled into the redaction
  // box just because it happened to sit in the same window as a number.
  function findRedactionBoxes(lines) {
    const boxes = [];
    lines.forEach((line) => {
      const words = (line.words || []).filter((w) => w.text && w.text.trim().length > 0);
      const consumed = new Set();

      for (let windowSize = 3; windowSize >= 1; windowSize -= 1) {
        for (let i = 0; i <= words.length - windowSize; i += 1) {
          const idxs = Array.from({ length: windowSize }, (_, k) => i + k);
          if (idxs.some((idx) => consumed.has(idx))) continue;

          let offset = 0;
          const wordOffsets = [];
          idxs.forEach((idx, k) => {
            if (k > 0) offset += 1; // the joining space
            wordOffsets[idx] = offset;
            offset += words[idx].text.length;
          });
          const joined = idxs.map((idx) => words[idx].text).join(" ");
          const ranges = findMatchRanges(joined);
          if (ranges.length === 0) continue;

          ranges.forEach((r) => {
            const wordBoxes = [];
            const contributing = [];
            idxs.forEach((idx) => {
              const wStart = wordOffsets[idx];
              const wEnd = wStart + words[idx].text.length;
              const overlapStart = Math.max(wStart, r.start);
              const overlapEnd = Math.min(wEnd, r.end);
              if (overlapStart >= overlapEnd) return;
              wordBoxes.push(
                interpolateBBox(words[idx].bbox, words[idx].text.length, overlapStart - wStart, overlapEnd - wStart)
              );
              contributing.push(idx);
            });
            if (wordBoxes.length > 0) {
              boxes.push(wordBoxes.reduce(unionBBox));
              contributing.forEach((idx) => consumed.add(idx));
            }
          });
        }
      }
    });
    return boxes;
  }

  function drawRedactionBox(ctx, bbox) {
    ctx.fillStyle = "#000000";
    const x = bbox.x0 - REDACTION_PADDING;
    const y = bbox.y0 - REDACTION_PADDING;
    const w = bbox.x1 - bbox.x0 + REDACTION_PADDING * 2;
    const h = bbox.y1 - bbox.y0 + REDACTION_PADDING * 2;
    ctx.fillRect(x, y, w, h);
  }

  function setProgress(stage) {
    if (!stage) {
      progressText.hidden = true;
      progressText.textContent = "";
      return;
    }
    progressText.hidden = false;
    progressText.textContent = fileProgressLabel ? `${fileProgressLabel} — ${stage}` : stage;
  }

  function getOcrWorker() {
    if (!ocrWorkerPromise) {
      setProgress("OCR 엔진 로딩 중...");
      ocrWorkerPromise = Tesseract.createWorker("kor+eng", 1, {
        workerPath: "js/tesseract/worker.min.js",
        corePath: "js/tesseract/core/tesseract-core-lstm.wasm.js",
        langPath: "js/tesseract/lang",
        logger: (m) => {
          if (m.status === "recognizing text") {
            setProgress(`문자 인식 중... ${Math.round(m.progress * 100)}%`);
          } else if (m.status) {
            setProgress(m.status);
          }
        },
      }).then(async (worker) => {
        // Most scanned Korean forms mix table borders with Korean text;
        // without an explicit page-segmentation mode, layout analysis on
        // a kor+eng model can drop whole regions (e.g. a table's data
        // rows) instead of reading them. PSM 3 (fully automatic) reliably
        // keeps those regions.
        await worker.setParameters({ tessedit_pageseg_mode: "3" });
        return worker;
      });
    }
    return ocrWorkerPromise;
  }

  function showError(message) {
    errorPanel.hidden = false;
    errorText.textContent = message;
  }

  function clearError() {
    errorPanel.hidden = true;
    errorText.textContent = "";
  }

  function resetResults() {
    resultsSection.hidden = true;
    resultsList.innerHTML = "";
    downloadAllBtn.hidden = true;
    successfulResults = [];
    setProgress(null);
  }

  function setSelectedFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const valid = [];
    const invalidNames = [];
    files.forEach((file) => {
      const ext = getExtension(file.name);
      if (ALL_EXTENSIONS.includes(ext)) {
        valid.push(file);
      } else {
        invalidNames.push(file.name);
      }
    });

    clearError();
    resetResults();

    selectedFiles = valid;
    fileNameList.innerHTML = "";
    valid.forEach((file) => {
      const li = document.createElement("li");
      li.textContent = file.name;
      fileNameList.appendChild(li);
    });

    if (invalidNames.length > 0) {
      showError(
        `지원하지 않는 형식이라 제외된 파일: ${invalidNames.join(", ")} ` +
          `(TXT, CSV, TSV, LOG, JSON, MD, XLSX, XLS, PDF, PNG, JPG, BMP, WEBP만 지원합니다.)`
      );
    }

    runBtn.disabled = valid.length === 0;
  }

  function downloadFilenameFor(originalName, forcedExt) {
    const idx = originalName.lastIndexOf(".");
    const base = idx === -1 ? originalName : originalName.slice(0, idx);
    const ext = forcedExt || (idx === -1 ? "" : originalName.slice(idx + 1));
    return `${base}_마스킹.${ext}`;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function canvasToBlob(canvas, type) {
    return new Promise((resolve) => canvas.toBlob(resolve, type));
  }

  async function loadFileAsDrawable(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file);
      } catch (e) {
        // fall through to <img> based loading
      }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function drawableSize(drawable) {
    return {
      width: drawable.width || drawable.naturalWidth,
      height: drawable.height || drawable.naturalHeight,
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Text files ---

  async function processTextFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const encoding = encodingSelect.value;
    const decoder = new TextDecoder(encoding);
    const original = decoder.decode(buffer);
    const { masked, count } = maskText(original);

    return {
      ok: true,
      summary:
        count > 0
          ? `총 ${count}건의 주민등록번호를 찾아 마스킹했습니다.`
          : "주민등록번호 패턴을 찾지 못했습니다. (파일에 변경 사항이 없습니다)",
      blob: new Blob([masked], { type: "text/plain;charset=utf-8" }),
      filename: downloadFilenameFor(file.name),
      preview: { type: "text", text: masked },
    };
  }

  // --- Excel files ---

  async function processExcelFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: "array" });
    let totalCount = 0;

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      Object.keys(sheet).forEach((cellRef) => {
        if (cellRef.startsWith("!")) return;
        const cell = sheet[cellRef];
        if (!cell) return;

        if (cell.t === "s" && typeof cell.v === "string") {
          const { masked, count } = maskText(cell.v);
          if (count > 0) {
            totalCount += count;
            cell.v = masked;
            cell.w = masked;
            cell.h = masked;
          }
          return;
        }

        // Numeric/other cells that render as text matching the pattern
        // (e.g. a 13-digit number formatted with a dash) get converted
        // to a text cell so the mask (with letters like *) can be stored.
        if (typeof cell.w === "string") {
          const { masked, count } = maskText(cell.w);
          if (count > 0) {
            totalCount += count;
            cell.t = "s";
            cell.v = masked;
            cell.w = masked;
            cell.h = masked;
            delete cell.f;
          }
        }
      });
    });

    const outBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

    return {
      ok: true,
      summary:
        totalCount > 0
          ? `총 ${totalCount}건의 주민등록번호를 찾아 마스킹했습니다.`
          : "주민등록번호 패턴을 찾지 못했습니다. (파일에 변경 사항이 없습니다)",
      blob: new Blob([outBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      filename: downloadFilenameFor(file.name),
      preview: {
        type: "excel",
        html: firstSheet ? XLSX.utils.sheet_to_html(firstSheet, { editable: false }) : "<p>미리보기를 생성할 수 없습니다.</p>",
      },
    };
  }

  // --- Image files (OCR-based redaction) ---

  async function processImageFile(file) {
    const drawable = await loadFileAsDrawable(file);
    const { width, height } = drawableSize(drawable);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(drawable, 0, 0, width, height);

    const worker = await getOcrWorker();
    setProgress("문자 인식 중...");
    const { data } = await worker.recognize(canvas);
    const boxes = findRedactionBoxes(data.lines || []);
    boxes.forEach((b) => drawRedactionBox(ctx, b));
    setProgress(null);

    const blob = await canvasToBlob(canvas, "image/png");
    return {
      ok: true,
      summary:
        boxes.length > 0
          ? `총 ${boxes.length}건의 주민등록번호로 추정되는 영역을 마스킹 했습니다.`
          : "주민등록번호로 추정되는 영역을 찾지 못했습니다. (원본과 동일할 수 있습니다)",
      blob,
      filename: downloadFilenameFor(file.name, "png"),
      preview: { type: "canvas", canvases: [canvas], label: "마스킹 결과 미리보기" },
    };
  }

  // --- PDF files ---

  function buildLinesFromPdfTextContent(textContent, viewport) {
    const scale = viewport.scale || 1;
    const tokens = textContent.items
      .filter((it) => it.str && it.str.trim().length > 0)
      .map((it) => {
        const [x0, yBase] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const fontHeight = Math.hypot(it.transform[2], it.transform[3]) * scale || 10 * scale;
        const width = Math.abs(it.width) * scale;
        return {
          text: it.str,
          bbox: {
            x0,
            x1: x0 + width,
            y0: yBase - fontHeight,
            y1: yBase + fontHeight * 0.25,
          },
        };
      });

    const lineGroups = new Map();
    tokens.forEach((t) => {
      const key = Math.round(t.bbox.y0 / 4);
      if (!lineGroups.has(key)) lineGroups.set(key, []);
      lineGroups.get(key).push(t);
    });
    return Array.from(lineGroups.values()).map((words) => {
      words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      return { words };
    });
  }

  async function processPdfFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const pdfDoc = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const numPages = pdfDoc.numPages;
    const outPdf = await PDFLib.PDFDocument.create();
    const pageCanvases = [];
    let totalCount = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
      const pagePrefix = numPages > 1 ? `${pageNum}/${numPages} 페이지 ` : "";
      setProgress(`${pagePrefix}렌더링 중...`);

      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const textContent = await page.getTextContent();
      const hasText = textContent.items.some((it) => it.str && it.str.trim().length > 0);

      let boxes = [];
      if (hasText) {
        const lines = buildLinesFromPdfTextContent(textContent, viewport);
        boxes = findRedactionBoxes(lines);
      } else {
        setProgress(`${pagePrefix}OCR 처리 중... (스캔된 페이지로 추정)`);
        const worker = await getOcrWorker();
        const { data } = await worker.recognize(canvas);
        boxes = findRedactionBoxes(data.lines || []);
      }

      totalCount += boxes.length;
      boxes.forEach((b) => drawRedactionBox(ctx, b));

      const pngBlob = await canvasToBlob(canvas, "image/png");
      const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
      const pngImage = await outPdf.embedPng(pngBytes);
      const pageWidthPt = viewport.width / PDF_RENDER_SCALE;
      const pageHeightPt = viewport.height / PDF_RENDER_SCALE;
      const outPage = outPdf.addPage([pageWidthPt, pageHeightPt]);
      outPage.drawImage(pngImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });

      pageCanvases.push(canvas);
    }
    setProgress(null);

    const outBytes = await outPdf.save();
    return {
      ok: true,
      summary:
        totalCount > 0
          ? `총 ${totalCount}건의 주민등록번호로 추정되는 영역을 마스킹 했습니다.`
          : "주민등록번호로 추정되는 영역을 찾지 못했습니다.",
      note: "*다운로드 되는 PDF는 이미지로 재구성되어 가려진 글자가 남아 있지 않습니다.",
      blob: new Blob([outBytes], { type: "application/pdf" }),
      filename: downloadFilenameFor(file.name),
      preview: { type: "canvas", canvases: pageCanvases, label: "마스킹 결과 미리보기" },
    };
  }

  async function processOneFile(file) {
    const ext = getExtension(file.name);
    const kind = fileKind(ext);
    if (kind === "excel") return processExcelFile(file);
    if (kind === "image") return processImageFile(file);
    if (kind === "pdf") return processPdfFile(file);
    return processTextFile(file);
  }

  // --- Result card rendering ---

  function buildCanvasPreview(container, canvases) {
    const wrap = document.createElement("div");
    wrap.className = "canvas-preview";
    const previewCanvas = document.createElement("canvas");
    wrap.appendChild(previewCanvas);
    container.appendChild(wrap);

    let pageIndex = 0;
    let prevBtn = null;
    let nextBtn = null;
    let indicator = null;

    function render() {
      const c = canvases[pageIndex];
      previewCanvas.width = c.width;
      previewCanvas.height = c.height;
      previewCanvas.getContext("2d").drawImage(c, 0, 0);
      if (indicator) {
        indicator.textContent = `${pageIndex + 1} / ${canvases.length} 페이지`;
        prevBtn.disabled = pageIndex === 0;
        nextBtn.disabled = pageIndex === canvases.length - 1;
      }
    }

    if (canvases.length > 1) {
      const nav = document.createElement("div");
      nav.className = "page-nav";
      prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "page-nav__btn";
      prevBtn.textContent = "◀ 이전";
      indicator = document.createElement("span");
      nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "page-nav__btn";
      nextBtn.textContent = "다음 ▶";
      prevBtn.addEventListener("click", () => {
        if (pageIndex > 0) {
          pageIndex -= 1;
          render();
        }
      });
      nextBtn.addEventListener("click", () => {
        if (pageIndex < canvases.length - 1) {
          pageIndex += 1;
          render();
        }
      });
      nav.appendChild(prevBtn);
      nav.appendChild(indicator);
      nav.appendChild(nextBtn);
      container.appendChild(nav);
    }

    render();
  }

  function buildResultCard(file, result) {
    const details = document.createElement("details");
    details.className = "result-card";
    details.open = true;

    const summary = document.createElement("summary");
    const nameSpan = document.createElement("span");
    nameSpan.className = "result-card__filename";
    nameSpan.textContent = file.name;
    const statusSpan = document.createElement("span");
    statusSpan.className = result.ok ? "result-card__status" : "result-card__status result-card__status--error";
    statusSpan.textContent = result.ok ? result.summary : `오류: ${result.error}`;
    summary.appendChild(nameSpan);
    summary.appendChild(statusSpan);
    if (result.ok && result.note) {
      const noteEl = document.createElement("span");
      noteEl.className = "result-note";
      noteEl.textContent = result.note;
      summary.appendChild(noteEl);
    }
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "result-card__body";

    if (!result.ok) {
      const p = document.createElement("p");
      p.textContent = result.error;
      body.appendChild(p);
      details.appendChild(body);
      return details;
    }

    if (result.preview.type === "text") {
      const label = document.createElement("label");
      label.className = "result-label";
      label.textContent = "마스킹 결과 미리보기";
      const textarea = document.createElement("textarea");
      textarea.className = "masked-textarea";
      textarea.readOnly = true;
      textarea.value = result.preview.text;
      body.appendChild(label);
      body.appendChild(textarea);
    } else if (result.preview.type === "excel") {
      const label = document.createElement("label");
      label.className = "result-label";
      label.textContent = "마스킹 결과 미리보기 (첫 번째 시트)";
      const wrap = document.createElement("div");
      wrap.className = "excel-preview";
      wrap.innerHTML = result.preview.html;
      body.appendChild(label);
      body.appendChild(wrap);
    } else if (result.preview.type === "canvas") {
      const label = document.createElement("label");
      label.className = "result-label";
      label.textContent = result.preview.label;
      body.appendChild(label);
      buildCanvasPreview(body, result.preview.canvases);
    }

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "download-btn";
    downloadBtn.innerHTML = `${DOWNLOAD_ICON_SVG} 산출물 다운로드`;
    downloadBtn.addEventListener("click", () => downloadBlob(result.blob, result.filename));
    body.appendChild(downloadBtn);

    details.appendChild(body);
    return details;
  }

  function updateOverallSummary() {
    const total = selectedFiles.length;
    const okCount = successfulResults.length;
    resultSummaryAll.innerHTML = "";

    const mainLine = document.createElement("div");
    mainLine.textContent =
      total <= 1
        ? okCount === 1
          ? successfulResults[0].summary
          : "이 파일을 처리하지 못했습니다."
        : `총 ${total}개 파일 중 ${okCount}개 마스킹 완료했습니다.`;
    resultSummaryAll.appendChild(mainLine);

    if (total <= 1 && okCount === 1 && successfulResults[0].note) {
      const noteLine = document.createElement("div");
      noteLine.className = "result-note";
      noteLine.textContent = successfulResults[0].note;
      resultSummaryAll.appendChild(noteLine);
    }
  }

  // --- ZIP writer (stored/uncompressed entries — no external dependency) ---

  let crc32Table = null;
  function crc32(bytes) {
    if (!crc32Table) {
      crc32Table = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crc32Table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    entries.forEach((entry) => {
      const nameBytes = encoder.encode(entry.name);
      const data = entry.data;
      const crc = crc32(data);
      const size = data.length;

      const localHeader = new DataView(new ArrayBuffer(30));
      localHeader.setUint32(0, 0x04034b50, true);
      localHeader.setUint16(4, 20, true);
      localHeader.setUint16(6, 0x0800, true); // UTF-8 filename flag
      localHeader.setUint16(8, 0, true);
      localHeader.setUint16(10, 0, true);
      localHeader.setUint16(12, 0x21, true);
      localHeader.setUint32(14, crc, true);
      localHeader.setUint32(18, size, true);
      localHeader.setUint32(22, size, true);
      localHeader.setUint16(26, nameBytes.length, true);
      localHeader.setUint16(28, 0, true);
      localParts.push(new Uint8Array(localHeader.buffer), nameBytes, data);

      const centralHeader = new DataView(new ArrayBuffer(46));
      centralHeader.setUint32(0, 0x02014b50, true);
      centralHeader.setUint16(4, 20, true);
      centralHeader.setUint16(6, 20, true);
      centralHeader.setUint16(8, 0x0800, true); // UTF-8 filename flag
      centralHeader.setUint16(10, 0, true);
      centralHeader.setUint16(12, 0, true);
      centralHeader.setUint16(14, 0x21, true);
      centralHeader.setUint32(16, crc, true);
      centralHeader.setUint32(20, size, true);
      centralHeader.setUint32(24, size, true);
      centralHeader.setUint16(28, nameBytes.length, true);
      centralHeader.setUint16(30, 0, true);
      centralHeader.setUint16(32, 0, true);
      centralHeader.setUint16(34, 0, true);
      centralHeader.setUint16(36, 0, true);
      centralHeader.setUint32(38, 0, true);
      centralHeader.setUint32(42, offset, true);
      centralParts.push(new Uint8Array(centralHeader.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    });

    const centralOffset = offset;
    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

    const endRecord = new DataView(new ArrayBuffer(22));
    endRecord.setUint32(0, 0x06054b50, true);
    endRecord.setUint16(4, 0, true);
    endRecord.setUint16(6, 0, true);
    endRecord.setUint16(8, entries.length, true);
    endRecord.setUint16(10, entries.length, true);
    endRecord.setUint32(12, centralSize, true);
    endRecord.setUint32(16, centralOffset, true);
    endRecord.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, new Uint8Array(endRecord.buffer)], { type: "application/zip" });
  }

  function uniqueZipName(name, used) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const idx = name.lastIndexOf(".");
    const base = idx === -1 ? name : name.slice(0, idx);
    const ext = idx === -1 ? "" : name.slice(idx);
    let n = 2;
    let candidate = `${base}(${n})${ext}`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${base}(${n})${ext}`;
    }
    used.add(candidate);
    return candidate;
  }

  async function downloadAllResults() {
    if (successfulResults.length === 0) return;
    const used = new Set();
    const entries = [];
    for (const r of successfulResults) {
      const data = new Uint8Array(await r.blob.arrayBuffer());
      entries.push({ name: uniqueZipName(r.filename, used), data });
    }
    downloadBlob(buildZip(entries), "마스킹_결과.zip");
  }

  // --- Main run loop ---

  async function runMasking() {
    if (selectedFiles.length === 0) return;
    clearError();
    runBtn.disabled = true;
    runBtn.textContent = "처리 중...";

    resultsList.innerHTML = "";
    resultsSection.hidden = false;
    downloadAllBtn.hidden = true;
    successfulResults = [];

    const total = selectedFiles.length;
    for (let i = 0; i < total; i += 1) {
      const file = selectedFiles[i];
      fileProgressLabel = total > 1 ? `파일 ${i + 1}/${total} (${file.name})` : file.name;

      let result;
      try {
        result = await processOneFile(file);
      } catch (err) {
        console.error(err);
        result = { ok: false, error: err.message || String(err) };
      }

      if (result.ok) successfulResults.push(result);
      resultsList.appendChild(buildResultCard(file, result));
    }

    fileProgressLabel = "";
    setProgress(null);
    updateOverallSummary();
    downloadAllBtn.hidden = successfulResults.length === 0;

    runBtn.disabled = false;
    runBtn.textContent = "▶ 실행";
  }

  // --- Event wiring ---

  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => setSelectedFiles(e.target.files));

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dropzone--active");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dropzone--active");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    setSelectedFiles(e.dataTransfer.files);
  });

  runBtn.addEventListener("click", runMasking);
  downloadAllBtn.addEventListener("click", downloadAllResults);
})();
