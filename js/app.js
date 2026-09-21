(() => {
  const TEXT_EXTENSIONS = ["txt", "csv", "tsv", "log", "json", "md"];
  const EXCEL_EXTENSIONS = ["xlsx", "xls"];

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

  const resultPanel = document.getElementById("resultPanel");
  const resultSummary = document.getElementById("resultSummary");
  const textResult = document.getElementById("textResult");
  const maskedTextarea = document.getElementById("maskedTextarea");
  const excelResult = document.getElementById("excelResult");
  const excelPreview = document.getElementById("excelPreview");
  const downloadBtn = document.getElementById("downloadBtn");

  const errorPanel = document.getElementById("errorPanel");
  const errorText = document.getElementById("errorText");

  let selectedFile = null;
  let pendingDownload = null; // { blob, filename }

  function getExtension(name) {
    const idx = name.lastIndexOf(".");
    return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
  }

  function maskText(text) {
    let count = 0;
    const masked = text.replace(RRN_REGEX, (_match, front, sep, genderDigit) => {
      count += 1;
      return `${front}${sep}${genderDigit}******`;
    });
    return { masked, count };
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
    maskedTextarea.value = "";
    excelPreview.innerHTML = "";
    pendingDownload = null;
  }

  function setSelectedFile(file) {
    if (!file) return;
    const ext = getExtension(file.name);
    if (![...TEXT_EXTENSIONS, ...EXCEL_EXTENSIONS].includes(ext)) {
      showError(`지원하지 않는 파일 형식입니다 (.${ext || "확장자 없음"}). TXT, CSV, TSV, LOG, JSON, MD, XLSX, XLS 파일만 지원합니다.`);
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

  function downloadFilenameFor(originalName) {
    const idx = originalName.lastIndexOf(".");
    if (idx === -1) return `masked_${originalName}`;
    return `${originalName.slice(0, idx)}_masked${originalName.slice(idx)}`;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

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
    maskedTextarea.value = masked;
    resultPanel.hidden = false;
  }

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
    resultPanel.hidden = false;
  }

  async function runMasking() {
    if (!selectedFile) return;
    clearError();
    runBtn.disabled = true;
    runBtn.textContent = "처리 중...";

    try {
      const ext = getExtension(selectedFile.name);
      if (EXCEL_EXTENSIONS.includes(ext)) {
        await processExcelFile(selectedFile);
      } else {
        await processTextFile(selectedFile);
      }
    } catch (err) {
      console.error(err);
      showError(`파일을 처리하는 중 오류가 발생했습니다: ${err.message || err}`);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "▶ 실행";
    }
  }

  function downloadResult() {
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
})();
