(() => {
  const TEXT_EXTENSIONS = ["txt", "csv", "tsv", "log", "json", "md"];
  const EXCEL_EXTENSIONS = ["xlsx", "xls"];
  const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "bmp", "webp"];
  const PDF_EXTENSIONS = ["pdf"];
  const ALL_EXTENSIONS = [...TEXT_EXTENSIONS, ...EXCEL_EXTENSIONS, ...IMAGE_EXTENSIONS, ...PDF_EXTENSIONS];

  const PDF_RENDER_SCALE = 2;
  const REDACTION_PADDING = 4;

  // Matches a Korean resident registration number: 6-digit birth date,
  // optional separator, then a 7-digit block whose first digit is 1-8
  // (gender/century code). Digit boundaries on both sides keep it from
  // matching the middle of a longer number.
  const RRN_REGEX = /(?<!\d)(\d{6})([-\s]?)([1-8])\d{6}(?!\d)/g;

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const browseBtn = document.getElementById("browseBtn");
  const fileNameEl = document.getElementById("fileName");
  const encodingSelect = document.getElementById("encodingSelect");
  const runBtn = document.getElementById("runBtn");
  const progressText = document.getElementById("progressText");

  const resultPanel = document.getElementById("resultPanel");
  const resultSummary = document.getElementById("resultSummary");
  const textResult = document.getElementById("textResult");
  const maskedTextarea = document.getElementById("maskedTextarea");
  const excelResult = document.getElementById("excelResult");
  const excelPreview = document.getElementById("excelPreview");
  const canvasResult = document.getElementById("canvasResult");
  const canvasResultLabel = document.getElementById("canvasResultLabel");
  const previewCanvas = document.getElementById("previewCanvas");
  const pageNav = document.getElementById("pageNav");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const downloadBtn = document.getElementById("downloadBtn");

  const errorPanel = document.getElementById("errorPanel");
  const errorText = document.getElementById("errorText");

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/pdf.worker.min.js";
  }

  let selectedFile = null;
  let pendingDownload = null; // { blob, filename }
  let maskedPageCanvases = []; // canvases for image/PDF preview navigation
  let currentPageIndex = 0;
  let ocrWorkerPromise = null;
  let progressPrefix = "";

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
    let count = 0;
    const masked = text.replace(RRN_REGEX, (_match, front, sep, genderDigit) => {
      count += 1;
      return `${front}${sep}${genderDigit}******`;
    });
    return { masked, count };
  }

  // Finds every RRN match inside a run of text and returns character
  // offsets, used both for plain-text replacement and for locating the
  // matching region inside an OCR word / PDF text item for redaction.
  function findMatchRanges(text) {
    const matches = [];
    const re = new RegExp(RRN_REGEX.source, "g");
    let m = re.exec(text);
    while (m) {
      matches.push({ start: m.index, end: m.index + m[0].length });
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
  // `lines` is an array of { words: [{ text, bbox }] } grouped by row so
  // that a number OCR/PDF split into two adjacent tokens can still be
  // found by joining them with a space.
  function findRedactionBoxes(lines) {
    const boxes = [];
    lines.forEach((line) => {
      const words = (line.words || []).filter((w) => w.text && w.text.trim().length > 0);
      const consumed = new Set();

      words.forEach((word, idx) => {
        const ranges = findMatchRanges(word.text);
        if (ranges.length > 0) {
          ranges.forEach((r) => {
            boxes.push(interpolateBBox(word.bbox, word.text.length, r.start, r.end));
          });
          consumed.add(idx);
        }
      });

      for (let i = 0; i < words.length - 1; i += 1) {
        if (consumed.has(i) || consumed.has(i + 1)) continue;
        const joined = `${words[i].text} ${words[i + 1].text}`;
        if (findMatchRanges(joined).length > 0) {
          boxes.push(unionBBox(words[i].bbox, words[i + 1].bbox));
          consumed.add(i);
          consumed.add(i + 1);
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

  function setProgress(message) {
    if (!message) {
      progressText.hidden = true;
      progressText.textContent = "";
      return;
    }
    progressText.hidden = false;
    progressText.textContent = message;
  }

  function getOcrWorker() {
    if (!ocrWorkerPromise) {
      setProgress("OCR 엔진 로딩 중...");
      ocrWorkerPromise = Tesseract.createWorker("eng", 1, {
        workerPath: "js/tesseract/worker.min.js",
        corePath: "js/tesseract/core/tesseract-core-lstm.wasm.js",
        langPath: "js/tesseract/lang",
        logger: (m) => {
          if (m.status === "recognizing text") {
            setProgress(`${progressPrefix} 문자 인식 중... ${Math.round(m.progress * 100)}%`);
          } else if (m.status) {
            setProgress(`${progressPrefix} ${m.status}`);
          }
        },
      });
    }
    return ocrWorkerPromise;
  }

  function showError(message) {
    errorPanel.hidden = false;
    errorText.textContent = message;
    resultPanel.hidden = true;
  }

  function clearError() {
    errorPanel.hidden = true;
    errorText.textContent = "";
  }

  function resetResult() {
    resultPanel.hidden = true;
    textResult.hidden = true;
    excelResult.hidden = true;
    canvasResult.hidden = true;
    pageNav.hidden = true;
    maskedTextarea.value = "";
    excelPreview.innerHTML = "";
    maskedPageCanvases = [];
    currentPageIndex = 0;
    pendingDownload = null;
    setProgress(null);
  }

  function setSelectedFile(file) {
    if (!file) return;
    const ext = getExtension(file.name);
    if (!ALL_EXTENSIONS.includes(ext)) {
      showError(
        `지원하지 않는 파일 형식입니다 (.${ext || "확장자 없음"}). ` +
          `TXT, CSV, TSV, LOG, JSON, MD, XLSX, XLS, PDF, PNG, JPG, BMP, WEBP 파일만 지원합니다.`
      );
      selectedFile = null;
      runBtn.disabled = true;
      fileNameEl.textContent = "";
      return;
    }
    clearError();
    resetResult();
    selectedFile = file;
    fileNameEl.textContent = `선택된 파일: ${file.name}`;
    runBtn.disabled = false;
  }

  function downloadFilenameFor(originalName, forcedExt) {
    const idx = originalName.lastIndexOf(".");
    const base = idx === -1 ? originalName : originalName.slice(0, idx);
    const ext = forcedExt || (idx === -1 ? "" : originalName.slice(idx + 1));
    return `${base}_masked.${ext}`;
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

  function showCanvasResult(canvases, label) {
    canvasResultLabel.textContent = label;
    canvasResult.hidden = false;
    textResult.hidden = true;
    excelResult.hidden = true;
    maskedPageCanvases = canvases;
    currentPageIndex = 0;
    renderCurrentPage();
    pageNav.hidden = canvases.length <= 1;
  }

  function renderCurrentPage() {
    const canvas = maskedPageCanvases[currentPageIndex];
    if (!canvas) return;
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    previewCanvas.getContext("2d").drawImage(canvas, 0, 0);
    pageIndicator.textContent = `${currentPageIndex + 1} / ${maskedPageCanvases.length} 페이지`;
    prevPageBtn.disabled = currentPageIndex === 0;
    nextPageBtn.disabled = currentPageIndex === maskedPageCanvases.length - 1;
  }

  // --- Text files ---

  async function processTextFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const encoding = encodingSelect.value;
    const decoder = new TextDecoder(encoding);
    const original = decoder.decode(buffer);
    const { masked, count } = maskText(original);

    const blob = new Blob([masked], { type: "text/plain;charset=utf-8" });
    pendingDownload = { blob, filename: downloadFilenameFor(file.name) };

    resultSummary.textContent =
      count > 0
        ? `총 ${count}건의 주민등록번호를 찾아 마스킹했습니다.`
        : "주민등록번호 패턴을 찾지 못했습니다. (파일에 변경 사항이 없습니다)";
    textResult.hidden = false;
    excelResult.hidden = true;
    canvasResult.hidden = true;
    pageNav.hidden = true;
    maskedTextarea.value = masked;
    resultPanel.hidden = false;
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
    const blob = new Blob([outBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    pendingDownload = { blob, filename: downloadFilenameFor(file.name) };

    resultSummary.textContent =
      totalCount > 0
        ? `총 ${totalCount}건의 주민등록번호를 찾아 마스킹했습니다.`
        : "주민등록번호 패턴을 찾지 못했습니다. (파일에 변경 사항이 없습니다)";

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    excelPreview.innerHTML = firstSheet
      ? XLSX.utils.sheet_to_html(firstSheet, { editable: false })
      : "<p>미리보기를 생성할 수 없습니다.</p>";

    textResult.hidden = true;
    excelResult.hidden = false;
    canvasResult.hidden = true;
    pageNav.hidden = true;
    resultPanel.hidden = false;
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

    progressPrefix = "이미지";
    const worker = await getOcrWorker();
    setProgress(`${progressPrefix} 문자 인식 중...`);
    const { data } = await worker.recognize(canvas);
    const boxes = findRedactionBoxes(data.lines || []);
    boxes.forEach((b) => drawRedactionBox(ctx, b));
    setProgress(null);

    const blob = await canvasToBlob(canvas, "image/png");
    pendingDownload = { blob, filename: downloadFilenameFor(file.name, "png") };

    resultSummary.textContent =
      boxes.length > 0
        ? `총 ${boxes.length}건의 주민등록번호로 추정되는 영역을 찾아 검게 칠했습니다.`
        : "주민등록번호로 추정되는 영역을 찾지 못했습니다. (원본과 동일할 수 있습니다)";
    showCanvasResult([canvas], "마스킹 결과 미리보기");
    resultPanel.hidden = false;
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
      progressPrefix = `${pageNum}/${numPages} 페이지`;
      setProgress(`${progressPrefix} 렌더링 중...`);

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
        setProgress(`${progressPrefix} OCR 처리 중... (스캔된 페이지로 추정)`);
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
    const blob = new Blob([outBytes], { type: "application/pdf" });
    pendingDownload = { blob, filename: downloadFilenameFor(file.name) };

    resultSummary.textContent =
      totalCount > 0
        ? `총 ${totalCount}건의 주민등록번호로 추정되는 영역을 찾아 검게 칠했습니다. ` +
          `(다운로드되는 PDF는 이미지로 재구성되어 가려진 글자가 남아있지 않습니다)`
        : "주민등록번호로 추정되는 영역을 찾지 못했습니다.";
    showCanvasResult(pageCanvases, "마스킹 결과 미리보기");
    resultPanel.hidden = false;
  }

  async function runMasking() {
    if (!selectedFile) return;
    clearError();
    runBtn.disabled = true;
    runBtn.textContent = "처리 중...";

    try {
      const ext = getExtension(selectedFile.name);
      const kind = fileKind(ext);
      if (kind === "excel") {
        await processExcelFile(selectedFile);
      } else if (kind === "image") {
        await processImageFile(selectedFile);
      } else if (kind === "pdf") {
        await processPdfFile(selectedFile);
      } else {
        await processTextFile(selectedFile);
      }
    } catch (err) {
      console.error(err);
      showError(`파일을 처리하는 중 오류가 발생했습니다: ${err.message || err}`);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "▶ 실행";
      setProgress(null);
    }
  }

  async function downloadResult() {
    if (!pendingDownload) return;
    const url = URL.createObjectURL(pendingDownload.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = pendingDownload.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Event wiring ---

  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => setSelectedFile(e.target.files[0]));

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
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    setSelectedFile(file);
  });

  runBtn.addEventListener("click", runMasking);
  downloadBtn.addEventListener("click", downloadResult);
  prevPageBtn.addEventListener("click", () => {
    if (currentPageIndex > 0) {
      currentPageIndex -= 1;
      renderCurrentPage();
    }
  });
  nextPageBtn.addEventListener("click", () => {
    if (currentPageIndex < maskedPageCanvases.length - 1) {
      currentPageIndex += 1;
      renderCurrentPage();
    }
  });
})();
