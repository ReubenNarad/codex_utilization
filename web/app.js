const WINDOWS = [
  { key: "1d", label: "1 day" },
  { key: "1w", label: "1 week" },
  { key: "1m", label: "1 month" },
  { key: "3m", label: "3 months" },
  { key: "1y", label: "1 year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const state = {
  selected: "all",
  cache: new Map(),
  chartData: [],
  barRects: [],
  anim: null,
  granularity: "day",
  hoverIndex: null,
};

const elements = {
  windowButtons: document.getElementById("windowButtons"),
  windowLabel: document.getElementById("windowLabel"),
  windowRange: document.getElementById("windowRange"),
  uptimePct: document.getElementById("uptimePct"),
  costUsd: document.getElementById("costUsd"),
  startInput: document.getElementById("startInput"),
  endInput: document.getElementById("endInput"),
  nowBtn: document.getElementById("nowBtn"),
  applyBtn: document.getElementById("applyBtn"),
  rangeBox: document.getElementById("rangeBox"),
  controls: document.getElementById("controls"),
  chart: document.getElementById("chart"),
  chartTitle: document.getElementById("chartTitle"),
  chartSubtitle: document.getElementById("chartSubtitle"),
  loadingIndicator: document.getElementById("loadingIndicator"),
  sourcesCard: document.getElementById("sourcesCard"),
  toggleSources: document.getElementById("toggleSources"),
  toggleSourceForm: document.getElementById("toggleSourceForm"),
  sourceForm: document.getElementById("sourceForm"),
  sourceLabel: document.getElementById("sourceLabel"),
  sourceHost: document.getElementById("sourceHost"),
  sourceUser: document.getElementById("sourceUser"),
  sourcePort: document.getElementById("sourcePort"),
  sourcePassword: document.getElementById("sourcePassword"),
  sourcePath: document.getElementById("sourcePath"),
  sourceCancel: document.getElementById("sourceCancel"),
  sourcesList: document.getElementById("sourcesList"),
  asciiTitle: document.getElementById("asciiTitle"),
};

function formatPct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(3)}%`;
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}b`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

function getLinearTicks(maxTokens) {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return [0];
  const roughStep = maxTokens / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
  const normalized = roughStep / magnitude;
  let step = magnitude;
  if (normalized >= 5) step = 5 * magnitude;
  else if (normalized >= 2) step = 2 * magnitude;
  const ticks = [];
  for (let value = 0; value <= maxTokens + step * 0.5; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function formatRange(startIso, endIso) {
  if (!startIso || !endIso) return "--";
  const start = new Date(startIso);
  const end = new Date(endIso);
  const options = { year: "numeric", month: "short", day: "numeric" };
  const timeOptions = { hour: "2-digit", minute: "2-digit" };
  return `${start.toLocaleDateString(undefined, options)} ${start.toLocaleTimeString(
    undefined,
    timeOptions
  )} -> ${end.toLocaleDateString(undefined, options)} ${end.toLocaleTimeString(
    undefined,
    timeOptions
  )}`;
}

async function fetchUptime({ window, start, end, granularity }) {
  const params = new URLSearchParams();
  if (window) params.set("window", window);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (granularity) params.set("granularity", granularity);
  const response = await fetch(`/api/uptime?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch uptime");
  }
  return response.json();
}

async function fetchSources() {
  const response = await fetch("/api/sources");
  if (!response.ok) {
    throw new Error("Failed to load sources");
  }
  return response.json();
}

async function createSource(payload) {
  const response = await fetch("/api/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to create source");
  }
  return data;
}

async function syncSource(id) {
  const response = await fetch(`/api/sources/${id}/sync`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Sync failed");
  }
  return data;
}

async function deleteSource(id) {
  const response = await fetch(`/api/sources/${id}`, { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to disconnect source");
  }
  return data;
}

function setActiveButton(key) {
  document.querySelectorAll(".button-row button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.window === key);
  });
}

function updateHeader(data, label) {
  elements.windowLabel.textContent = label;
  if (data && data.window_start && data.window_end) {
    elements.windowRange.textContent = formatRange(data.window_start, data.window_end);
  } else {
    elements.windowRange.textContent = "Pick a range";
  }
}

function updateChartMeta(data) {
  const label = data.granularity || "day";
  elements.chartTitle.textContent = `Tokens by ${label}`;
  elements.chartSubtitle.textContent = "";
}

function updateStats(data) {
  elements.uptimePct.textContent = formatPct(data.percent_any_instance);
  if (data.cost_total_usd != null) {
    const value = data.cost_total_usd;
    elements.costUsd.textContent = data.cost_partial ? `~$${value.toFixed(2)}` : `$${value.toFixed(2)}`;
  } else {
    elements.costUsd.textContent = "--";
  }
}

function setLoading(isLoading) {
  elements.loadingIndicator.classList.toggle("active", Boolean(isLoading));
}

function setSelectedWindow(key) {
  state.selected = key;
  setActiveButton(key);
  const label = WINDOWS.find((w) => w.key === key)?.label ?? key;
  const cached = state.cache.get(key);
  setRangeBoxVisible(key === "custom");
  if (key === "custom" && !cached) {
    updateHeader(null, label);
    elements.uptimePct.textContent = "--";
    elements.costUsd.textContent = "--";
    state.chartData = [];
    drawChart();
    setLoading(false);
    return;
  }
  if (cached) {
    updateHeader(cached, label);
    updateStats(cached);
    updateChartMeta(cached);
    state.chartData = cached.token_buckets || [];
    state.granularity = cached.granularity || "day";
    drawChart();
    setLoading(false);
    return;
  }
  setLoading(true);
  fetchUptime({ window: key })
    .then((data) => {
      state.cache.set(key, data);
      updateHeader(data, label);
      updateStats(data);
      updateChartMeta(data);
      state.chartData = data.token_buckets || [];
      state.granularity = data.granularity || "day";
      drawChart();
    })
    .catch((err) => {
      elements.uptimePct.textContent = `Error: ${err.message}`;
    })
    .finally(() => {
      setLoading(false);
    });
}

function setupButtons() {
  WINDOWS.forEach((window) => {
    const btn = document.createElement("button");
    btn.textContent = window.label;
    btn.dataset.window = window.key;
    btn.addEventListener("click", () => {
      setSelectedWindow(window.key);
    });
    elements.windowButtons.appendChild(btn);
  });
  setActiveButton(state.selected);
}

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function applyCustomRange() {
  const start = elements.startInput.value;
  const end = elements.endInput.value;
  if (!start || !end) return;
  setLoading(true);
  fetchUptime({ start, end })
    .then((data) => {
      state.cache.set("custom", data);
      state.selected = "custom";
      setActiveButton("custom");
      updateHeader(data, "Custom");
      updateStats(data);
      updateChartMeta(data);
      state.chartData = data.token_buckets || [];
      state.granularity = data.granularity || "day";
      drawChart();
      setRangeBoxVisible(true);
    })
    .catch((err) => {
      elements.uptimePct.textContent = `Error: ${err.message}`;
    })
    .finally(() => {
      setLoading(false);
    });
}

function setupCustomRange() {
  const now = new Date();
  elements.endInput.value = toLocalInputValue(now);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  elements.startInput.value = toLocalInputValue(weekAgo);

  elements.nowBtn.addEventListener("click", () => {
    elements.endInput.value = toLocalInputValue(new Date());
  });
  elements.applyBtn.addEventListener("click", applyCustomRange);
}

function setRangeBoxVisible(visible) {
  elements.rangeBox.classList.toggle("visible", visible);
  elements.controls.classList.toggle("show-range", visible);
}

function drawChart() {
  const ctx = elements.chart.getContext("2d");
  const { width, height } = elements.chart.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  elements.chart.width = width * ratio;
  elements.chart.height = height * ratio;
  ctx.scale(ratio, ratio);

  ctx.clearRect(0, 0, width, height);

  const theme = getChartTheme();
  const padding = { top: 28, right: 24, bottom: 50, left: 72 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  ctx.save();
  ctx.translate(padding.left, padding.top);

  const entries = state.chartData.length ? state.chartData : [];
  let barGap = 10;
  let barWidth = chartWidth;
  if (entries.length > 1) {
    const minBarWidth = 3;
    const targetWidth = (chartWidth * 0.7) / entries.length;
    barWidth = Math.max(minBarWidth, targetWidth);
    barGap = (chartWidth - barWidth * entries.length) / (entries.length - 1);
    if (barGap < 1) {
      barGap = 1;
      barWidth = Math.max(
        minBarWidth,
        (chartWidth - barGap * (entries.length - 1)) / entries.length
      );
    } else if (barGap > 10) {
      barGap = 10;
      barWidth = (chartWidth - barGap * (entries.length - 1)) / entries.length;
    }
  }

  const maxTokens = Math.max(0, ...entries.map((entry) => entry.tokens || 0));
  const maxValue = maxTokens === 0 ? 1 : maxTokens;
  state.barRects = [];

  const labelEvery = entries.length > 18 ? Math.ceil(entries.length / 12) : 1;

  const ticks = getLinearTicks(maxTokens);
  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.label;
  ctx.font = theme.axisFont;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ticks.forEach((value) => {
    const y = chartHeight - (value / maxValue) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartWidth, y);
    ctx.stroke();
    ctx.fillText(formatTokens(value), -8, y);
  });

  entries.forEach((entry, index) => {
    const tokens = entry.tokens || 0;
    const x = index * (barWidth + barGap);
    const heightPx = (tokens / maxValue) * chartHeight;
    const y = chartHeight - heightPx;

    ctx.fillStyle = theme.bar;
    ctx.shadowColor = theme.barGlow;
    ctx.shadowBlur = 6;
    ctx.fillRect(x, y, barWidth, heightPx);

    ctx.shadowBlur = 0;
    if (index % labelEvery === 0) {
      ctx.fillStyle = theme.label;
      ctx.font = theme.axisFont;
      ctx.textAlign = "center";
      ctx.fillText(formatBucketLabel(entry, state.granularity), x + barWidth / 2, chartHeight + 24);
    }

    if (state.hoverIndex === index) {
      ctx.fillStyle = theme.hover;
      ctx.font = theme.hoverFont;
      ctx.textAlign = "center";
      ctx.fillText(formatTokens(tokens), x + barWidth / 2, y - 10);
    }

    state.barRects.push({
      index,
      x: padding.left + x,
      y: padding.top + y,
      width: barWidth,
      height: heightPx,
    });
  });

  ctx.restore();
}

function getChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    grid: value("--chart-grid", "rgba(120, 255, 150, 0.15)"),
    label: value("--chart-label", "rgba(185, 255, 170, 0.7)"),
    bar: value("--chart-bar", "rgba(82, 255, 124, 0.7)"),
    barGlow: value("--chart-bar-glow", "rgba(82, 255, 124, 0.35)"),
    hover: value("--chart-hover", "rgba(220, 255, 210, 0.9)"),
    axisFont: value("--chart-axis-font", "14px 'Courier New', Courier, ui-monospace, monospace"),
    hoverFont: value("--chart-hover-font", "700 16px 'Courier New', Courier, ui-monospace, monospace"),
  };
}

function formatBucketLabel(entry, granularity) {
  const date = new Date(entry.bucket_start);
  if (granularity === "hour") {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (granularity === "month") {
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
  }
  if (granularity === "week") {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function setupChartInteraction() {
  elements.chart.addEventListener("mousemove", (event) => {
    const rect = elements.chart.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = state.barRects.find(
      (bar) => x >= bar.x && x <= bar.x + bar.width && y >= bar.y && y <= bar.y + bar.height
    );
    const nextIndex = hit ? hit.index : null;
    if (state.hoverIndex !== nextIndex) {
      state.hoverIndex = nextIndex;
      drawChart();
    }
  });
  elements.chart.addEventListener("mouseleave", () => {
    if (state.hoverIndex !== null) {
      state.hoverIndex = null;
      drawChart();
    }
  });
  window.addEventListener("resize", () => {
    drawChart();
  });
}

function setSourceFormVisible(visible) {
  elements.sourceForm.classList.toggle("visible", visible);
}

function setSourcesCollapsed(collapsed) {
  elements.sourcesCard.classList.toggle("collapsed", collapsed);
  elements.toggleSources.textContent = collapsed ? "Expand" : "Collapse";
  if (collapsed) {
    setSourceFormVisible(false);
  }
}

function isSourcesCollapsed() {
  return elements.sourcesCard.classList.contains("collapsed");
}

function renderSources(sources) {
  elements.sourcesList.innerHTML = "";
  if (!sources.length) {
    const empty = document.createElement("div");
    empty.className = "source-item";
    empty.textContent = "No remote sources yet.";
    elements.sourcesList.appendChild(empty);
    return;
  }

  sources.forEach((source) => {
    const item = document.createElement("div");
    item.className = "source-item";

    const meta = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = source.label || `${source.user}@${source.host}`;
    const detail = document.createElement("small");
    const last = source.last_sync ? new Date(source.last_sync).toLocaleString() : "Never synced";
    const status = source.last_error ? `Error: ${source.last_error}` : "OK";
    detail.textContent = `${source.user}@${source.host} • ${last} • ${status}`;
    meta.appendChild(title);
    meta.appendChild(detail);

    const actions = document.createElement("div");
    actions.className = "source-actions-inline";
    const syncBtn = document.createElement("button");
    syncBtn.className = "ghost";
    syncBtn.textContent = "Sync now";
    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost source-remove";
    removeBtn.textContent = "x";
    removeBtn.title = "Disconnect source";
    removeBtn.setAttribute("aria-label", "Disconnect source");

    const setBusy = (busy) => {
      syncBtn.disabled = busy;
      removeBtn.disabled = busy;
    };

    syncBtn.addEventListener("click", async () => {
      syncBtn.textContent = "Syncing...";
      setBusy(true);
      try {
        await syncSource(source.id);
        await refreshSources();
        state.cache.clear();
        setSelectedWindow(state.selected);
      } catch (err) {
        alert(err.message);
      } finally {
        syncBtn.textContent = "Sync now";
        setBusy(false);
      }
    });
    removeBtn.addEventListener("click", async () => {
      const label = source.label || `${source.user}@${source.host}`;
      if (!window.confirm(`Disconnect ${label}?`)) return;
      removeBtn.textContent = "...";
      setBusy(true);
      try {
        await deleteSource(source.id);
        await refreshSources();
        state.cache.clear();
        setSelectedWindow(state.selected);
      } catch (err) {
        alert(err.message);
      } finally {
        removeBtn.textContent = "x";
        setBusy(false);
      }
    });

    actions.appendChild(syncBtn);
    actions.appendChild(removeBtn);

    item.appendChild(meta);
    item.appendChild(actions);
    elements.sourcesList.appendChild(item);
  });
}

async function refreshSources() {
  try {
    const data = await fetchSources();
    renderSources(data.sources || []);
  } catch (err) {
    elements.sourcesList.innerHTML = `<div class="source-item">Error: ${err.message}</div>`;
  }
}

function setupSources() {
  setSourcesCollapsed(true);
  elements.toggleSources.addEventListener("click", () => {
    setSourcesCollapsed(!isSourcesCollapsed());
  });
  elements.toggleSourceForm.addEventListener("click", () => {
    if (isSourcesCollapsed()) {
      setSourcesCollapsed(false);
      setSourceFormVisible(true);
      return;
    }
    setSourceFormVisible(!elements.sourceForm.classList.contains("visible"));
  });
  elements.sourceCancel.addEventListener("click", () => {
    setSourceFormVisible(false);
  });
  elements.sourceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      label: elements.sourceLabel.value.trim(),
      host: elements.sourceHost.value.trim(),
      user: elements.sourceUser.value.trim(),
      port: elements.sourcePort.value.trim(),
      password: elements.sourcePassword.value,
      path: elements.sourcePath.value.trim() || "~/.codex/sessions",
    };
    try {
      await createSource(payload);
      elements.sourcePassword.value = "";
      setSourceFormVisible(false);
      await refreshSources();
      state.cache.clear();
      setSelectedWindow(state.selected);
    } catch (err) {
      alert(err.message);
    }
  });
  refreshSources();
}

setupAsciiTitle();
setupButtons();
setupCustomRange();
setupChartInteraction();
setupSources();
setSelectedWindow(state.selected);

function setupAsciiTitle() {
  const target = elements.asciiTitle;
  if (!target) return;

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const symbolNoise = ["!", "@", "#", "$", "%", "^", "-", "_", "=", "+", ":", ";", "[", "]", "{", "}", "\\", "|"];
  const font = {
    A: [" ### ", "#   #", "#####", "#   #", "#   #"],
    C: [" ####", "#    ", "#    ", "#    ", " ####"],
    D: ["#### ", "#   #", "#   #", "#   #", "#### "],
    E: ["#####", "#    ", "#### ", "#    ", "#####"],
    I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
    L: ["#    ", "#    ", "#    ", "#    ", "#####"],
    N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
    O: [" ### ", "#   #", "#   #", "#   #", " ### "],
    T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
    U: ["#   #", "#   #", "#   #", "#   #", " ### "],
    X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
    Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
    " ": ["     ", "     ", "     ", "     ", "     "],
  };

  function randomLetter() {
    return alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  function randomSymbolChar() {
    return symbolNoise[Math.floor(Math.random() * symbolNoise.length)];
  }

  function renderWordMask(word) {
    const letters = word.toUpperCase().split("");
    const rows = Array.from({ length: 5 }, () => "");
    letters.forEach((letter, idx) => {
      const glyph = font[letter] || font[" "];
      rows.forEach((row, i) => {
        rows[i] += glyph[i];
        if (idx < letters.length - 1) rows[i] += " ";
      });
    });
    return rows;
  }

  function scaleMask(rows, scaleX = 2, scaleY = 2) {
    const out = [];
    rows.forEach((row) => {
      const expanded = row
        .split("")
        .map((char) => char.repeat(scaleX))
        .join("");
      for (let i = 0; i < scaleY; i += 1) {
        out.push(expanded);
      }
    });
    return out;
  }

  const maskRows = scaleMask(renderWordMask("Codex Utilization"), 2, 2);
  const height = maskRows.length;
  const width = Math.max(...maskRows.map((row) => row.length));
  const cells = [];
  const finalGrid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const isMask = (maskRows[row][col] || " ") !== " ";
      const stableChar = isMask ? randomLetter() : " ";
      finalGrid[row][col] = stableChar;
      cells.push({
        row,
        col,
        isMask,
        stableChar,
        threshold: Math.random(),
        band: 0.16 + Math.random() * 0.1,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }
  let rafId = null;

  function render(progress) {
    const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));

    cells.forEach((cell) => {
      const local = (progress - (cell.threshold - cell.band * 0.5)) / cell.band;
      const settle = Math.max(0, Math.min(1, local));
      const pulse =
        0.5 + 0.5 * Math.sin(progress * 26 + cell.row * 1.7 + cell.col * 0.33 + cell.phase);

      if (settle <= 0) {
        grid[cell.row][cell.col] = randomSymbolChar();
        return;
      }

      if (cell.isMask) {
        const shimmerChance = (1 - settle) * (0.78 + 0.18 * pulse);
        if (Math.random() < shimmerChance) {
          grid[cell.row][cell.col] = randomSymbolChar();
        } else {
          grid[cell.row][cell.col] = cell.stableChar;
        }
        if (Math.random() < (1 - settle) * 0.1) {
          grid[cell.row][cell.col] = " ";
        }
        return;
      }

      if (settle < 0.2) {
        grid[cell.row][cell.col] = randomSymbolChar();
        return;
      }

      const shimmerChance = (1 - settle) * (0.84 + 0.12 * pulse);
      grid[cell.row][cell.col] = Math.random() < shimmerChance ? randomSymbolChar() : " ";
    });

    target.textContent = grid.map((row) => row.join("")).join("\n");
  }

  function finalize() {
    target.textContent = finalGrid.map((row) => row.join("")).join("\n");
  }

  function start() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (prefersReduced.matches) {
      finalize();
      return;
    }
    const duration = 950;
    const frameInterval = 1000 / 36;
    let startTime = null;
    let lastRenderTime = 0;

    function tick(time) {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;
      const progress = Math.min(1, elapsed / duration);
      if (time - lastRenderTime >= frameInterval || progress >= 1) {
        render(progress);
        lastRenderTime = time;
      }
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        finalize();
        rafId = null;
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  prefersReduced.addEventListener("change", start);
  start();
}
