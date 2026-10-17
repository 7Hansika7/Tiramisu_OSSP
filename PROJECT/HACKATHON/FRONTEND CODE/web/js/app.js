/**
 * Linux Process Tree Visualizer - Application Controller
 * -----------------------------------------------------
 * Manages telemetry data flow, view synchronization, search/filtering,
 * inspector drawer, process signaling, and snapshot exporting.
 */

(function() {
  // App state
  const state = {
    activeView: "tree", // "tree" | "terminal" | "radial" | "table"
    currentSnapshot: null,
    processMap: new Map(),
    selectedProcess: null,
    isStreaming: true,
    refreshInterval: 3, // seconds (matches REFRESH_SECONDS 3 in ptree.c)
    showKernel: false,  // matches --all flag
    dataSource: "auto", // "auto" | "host" | "simulation"
    searchQuery: "",
    stateFilter: "ALL",
    backendOnline: false,
    timerId: null,
    eventSource: null
  };

  // Visualizer instances
  let treeVis = null;
  let termVis = null;
  let radialVis = null;

  // DOM Elements
  const el = {};

  document.addEventListener("DOMContentLoaded", () => {
    initDOMElements();
    initVisualizers();
    bindEvents();
    startDataFeed();
  });

  function initDOMElements() {
    el.totalProcs = document.getElementById("stat-total");
    el.runningProcs = document.getElementById("stat-running");
    el.sleepingProcs = document.getElementById("stat-sleeping");
    el.stoppedProcs = document.getElementById("stat-stopped");
    el.zombieProcs = document.getElementById("stat-zombies");
    el.kernelProcs = document.getElementById("stat-kernel");
    el.maxDepth = document.getElementById("stat-depth");
    el.osBadge = document.getElementById("os-badge");
    el.connectionStatus = document.getElementById("connection-status");
    el.lastUpdated = document.getElementById("last-updated");
    
    el.searchInput = document.getElementById("search-input");
    el.kernelToggle = document.getElementById("toggle-kernel");
    el.refreshSelect = document.getElementById("select-interval");
    el.sourceSelect = document.getElementById("select-source");
    el.btnPlayPause = document.getElementById("btn-play-pause");
    el.btnSnapshot = document.getElementById("btn-snapshot");
    el.btnSpawnZombie = document.getElementById("btn-spawn-zombie");
    el.btnCleanZombies = document.getElementById("btn-clean-zombies");
    el.btnExportJson = document.getElementById("btn-export-json");
    el.btnCopyAscii = document.getElementById("btn-copy-ascii");
    
    el.treeView = document.getElementById("view-tree");
    el.termView = document.getElementById("view-terminal");
    el.radialView = document.getElementById("view-radial");
    el.tableView = document.getElementById("view-table");
    el.tableBody = document.getElementById("process-table-body");
    
    el.inspector = document.getElementById("inspector-drawer");
    el.inspectorClose = document.getElementById("inspector-close");
    el.inspectorTitle = document.getElementById("insp-name");
    el.inspectorPid = document.getElementById("insp-pid");
    el.inspectorPpid = document.getElementById("insp-ppid");
    el.inspectorState = document.getElementById("insp-state");
    el.inspectorThreads = document.getElementById("insp-threads");
    el.inspectorRss = document.getElementById("insp-rss");
    el.inspectorVsize = document.getElementById("insp-vsize");
    el.inspectorLineage = document.getElementById("insp-lineage");
    el.inspectorChildren = document.getElementById("insp-children");
    el.inspProcStatRaw = document.getElementById("insp-proc-stat-raw");

    el.viewTabs = document.querySelectorAll(".view-tab");
    el.stateChips = document.querySelectorAll(".state-chip");
  }

  function initVisualizers() {
    treeVis = new ProcessTreeVisualizer("tree-canvas-container", {
      onSelectProcess: (proc) => openInspector(proc.pid)
    });

    termVis = new TerminalView("terminal-container", {
      onSelectProcess: (pid) => openInspector(pid)
    });

    radialVis = new RadialVisualizer("radial-container", {
      onSelectProcess: (pid) => openInspector(pid)
    });
  }

  function bindEvents() {
    // View Tab switching
    el.viewTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const view = tab.getAttribute("data-view");
        switchView(view);
      });
    });

    // Search input
    el.searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      applyFilters();
    });

    // Keyboard shortcut Cmd+K / Ctrl+K
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        el.searchInput.focus();
      }
    });

    // State filter chips
    el.stateChips.forEach(chip => {
      chip.addEventListener("click", () => {
        el.stateChips.forEach(c => c.classList.remove("active", "border-cyan-500", "bg-cyan-500/10"));
        chip.classList.add("active", "border-cyan-500", "bg-cyan-500/10");
        state.stateFilter = chip.getAttribute("data-state");
        applyFilters();
      });
    });

    // Kernel threads toggle (--all)
    el.kernelToggle.addEventListener("change", (e) => {
      state.showKernel = e.target.checked;
      fetchTelemetry();
    });

    // Refresh interval
    el.refreshSelect.addEventListener("change", (e) => {
      state.refreshInterval = parseFloat(e.target.value);
      restartIntervalTimer();
    });

    // Data source selector
    el.sourceSelect.addEventListener("change", (e) => {
      state.dataSource = e.target.value;
      fetchTelemetry();
    });

    // Play / Pause stream
    el.btnPlayPause.addEventListener("click", () => {
      state.isStreaming = !state.isStreaming;
      updatePlayPauseButton();
      if (state.isStreaming) {
        fetchTelemetry();
        restartIntervalTimer();
      } else {
        if (state.timerId) clearInterval(state.timerId);
      }
    });

    // Single Snapshot (--once)
    el.btnSnapshot.addEventListener("click", () => {
      fetchTelemetry();
      showToast("Telemetry snapshot captured.");
    });

    // Demo Zombie spawn & clean
    el.btnSpawnZombie.addEventListener("click", async () => {
      if (state.backendOnline) {
        try {
          await fetch("/api/spawn-demo-zombie", { method: "POST" });
        } catch (_) {}
      } else {
        window.LinuxProcessMock.spawnZombie();
      }
      fetchTelemetry();
      showToast("Simulated zombie process created (State: Z).");
    });

    el.btnCleanZombies.addEventListener("click", async () => {
      if (state.backendOnline) {
        try {
          await fetch("/api/cleanup-demo-zombie", { method: "POST" });
        } catch (_) {}
      } else {
        window.LinuxProcessMock.clearZombies();
      }
      fetchTelemetry();
      showToast("Zombie processes reaped.");
    });

    // Export JSON
    el.btnExportJson.addEventListener("click", () => {
      if (!state.currentSnapshot) return;
      const jsonStr = JSON.stringify(state.currentSnapshot, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ptree-snapshot-${Math.floor(Date.now() / 1000)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Copy ASCII Tree (CLI output)
    el.btnCopyAscii.addEventListener("click", () => {
      const ascii = termVis.getAsciiTree();
      if (ascii) {
        navigator.clipboard.writeText(ascii).then(() => {
          showToast("ASCII Process Tree copied to clipboard.");
        });
      }
    });

    // Inspector Close
    el.inspectorClose.addEventListener("click", () => {
      closeInspector();
    });

    // Tree controls
    document.getElementById("btn-fit-screen")?.addEventListener("click", () => treeVis.fitToScreen());
    document.getElementById("btn-zoom-in")?.addEventListener("click", () => treeVis.zoomIn());
    document.getElementById("btn-zoom-out")?.addEventListener("click", () => treeVis.zoomOut());
    document.getElementById("btn-reset-zoom")?.addEventListener("click", () => treeVis.resetZoom());
    document.getElementById("btn-expand-all")?.addEventListener("click", () => treeVis.expandAll());
    document.getElementById("btn-collapse-all")?.addEventListener("click", () => treeVis.collapseAll());

    // Signal buttons in Inspector
    document.querySelectorAll(".btn-sig").forEach(btn => {
      btn.addEventListener("click", () => {
        const sig = btn.getAttribute("data-sig");
        if (state.selectedProcess) {
          sendSignal(state.selectedProcess.pid, sig);
        }
      });
    });
  }

  function switchView(viewName) {
    state.activeView = viewName;
    el.viewTabs.forEach(t => {
      if (t.getAttribute("data-view") === viewName) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });

    el.treeView.classList.add("hidden");
    el.termView.classList.add("hidden");
    el.radialView.classList.add("hidden");
    el.tableView.classList.add("hidden");

    if (viewName === "tree") {
      el.treeView.classList.remove("hidden");
      if (state.currentSnapshot) treeVis.update(treeVis.root);
    } else if (viewName === "terminal") {
      el.termView.classList.remove("hidden");
      termVis.render();
    } else if (viewName === "radial") {
      el.radialView.classList.remove("hidden");
      if (state.currentSnapshot) radialVis.setData(state.currentSnapshot.tree);
    } else if (viewName === "table") {
      el.tableView.classList.remove("hidden");
      renderTable();
    }
  }

  function updatePlayPauseButton() {
    if (state.isStreaming) {
      el.btnPlayPause.innerHTML = `
        <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Live</span>
      `;
      el.btnPlayPause.classList.add("border-emerald-500/40");
      el.btnPlayPause.classList.remove("border-amber-500/40");
    } else {
      el.btnPlayPause.innerHTML = `
        <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Paused</span>
      `;
      el.btnPlayPause.classList.add("border-amber-500/40");
      el.btnPlayPause.classList.remove("border-emerald-500/40");
    }
  }

  async function fetchTelemetry() {
    const url = `/api/processes?mode=${state.dataSource}&all=${state.showKernel ? "1" : "0"}`;
    
    try {
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP error " + resp.status);
      const data = await resp.json();
      state.backendOnline = true;
      handleTelemetryData(data);
    } catch (err) {
      // Backend not running, use built-in realistic Linux simulation
      state.backendOnline = false;
      const data = window.LinuxProcessMock.getSnapshot(state.showKernel);
      handleTelemetryData(data);
    }
  }

  function handleTelemetryData(data) {
    state.currentSnapshot = data;
    state.processMap.clear();

    if (data.processes) {
      data.processes.forEach(p => state.processMap.set(p.pid, p));
    }

    // Update Header & Stats
    el.totalProcs.textContent = data.total || 0;
    el.runningProcs.textContent = data.running || 0;
    el.sleepingProcs.textContent = data.sleeping || 0;
    el.stoppedProcs.textContent = data.stopped || 0;
    el.zombieProcs.textContent = data.zombies || 0;
    el.kernelProcs.textContent = data.kernel_threads || 0;
    el.maxDepth.textContent = data.max_depth || "—";
    
    // Zombie alert styling
    const zombieCard = document.getElementById("stat-card-zombie");
    if (zombieCard) {
      if (data.zombies > 0) {
        zombieCard.classList.add("ring-2", "ring-rose-500", "pulse-zombie");
      } else {
        zombieCard.classList.remove("ring-2", "ring-rose-500", "pulse-zombie");
      }
    }

    // OS & Status
    el.osBadge.textContent = data.os || "Linux";
    el.connectionStatus.innerHTML = state.backendOnline ? 
      `<span class="w-2 h-2 rounded-full bg-emerald-400 mr-2 pulse-running"></span>Backend Live` :
      `<span class="w-2 h-2 rounded-full bg-cyan-400 mr-2"></span>Simulated /proc Mode`;

    const d = new Date(data.timestamp * 1000);
    el.lastUpdated.textContent = d.toLocaleTimeString();

    // Push data to visualizers
    applyFilters();

    // If inspector is open, update selected process info
    if (state.selectedProcess) {
      const updated = state.processMap.get(state.selectedProcess.pid);
      if (updated) {
        openInspector(updated.pid, false);
      }
    }
  }

  function applyFilters() {
    if (!state.currentSnapshot) return;

    let filteredTree = state.currentSnapshot.tree;

    // Filter by state if not ALL
    if (state.stateFilter !== "ALL") {
      filteredTree = filterTreeByState(filteredTree, state.stateFilter);
    }

    // Update visualizers
    treeVis.setSearchQuery(state.searchQuery);
    treeVis.setData(filteredTree);

    termVis.setSearchQuery(state.searchQuery);
    termVis.setData(filteredTree);

    radialVis.setData(filteredTree);

    if (state.activeView === "table") {
      renderTable();
    }
  }

  function filterTreeByState(nodes, targetState) {
    const res = [];
    for (const node of nodes) {
      const copy = { ...node, children: [] };
      if (node.children) {
        copy.children = filterTreeByState(node.children, targetState);
      }
      if (node.state === targetState || copy.children.length > 0) {
        res.push(copy);
      }
    }
    return res;
  }

  function renderTable() {
    if (!el.tableBody || !state.currentSnapshot) return;
    
    let procs = state.currentSnapshot.processes || [];
    
    // Apply search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      procs = procs.filter(p => p.name.toLowerCase().includes(q) || String(p.pid).includes(q));
    }

    // Apply state filter
    if (state.stateFilter !== "ALL") {
      procs = procs.filter(p => p.state === state.stateFilter);
    }

    let rowsHtml = "";
    procs.forEach(p => {
      const isSelected = state.selectedProcess && state.selectedProcess.pid === p.pid;
      rowsHtml += `
        <tr class="${isSelected ? 'bg-cyan-500/10' : ''}" data-pid="${p.pid}">
          <td class="font-mono text-cyan-400 font-semibold">${p.pid}</td>
          <td class="font-mono text-slate-400">${p.ppid}</td>
          <td class="font-semibold text-slate-100 flex items-center gap-2">
            ${p.is_kernel ? '<span class="text-[10px] px-1 py-0.5 rounded bg-purple-900/40 text-purple-300 font-mono">kernel</span>' : ''}
            ${escapeHtml(p.name)}
          </td>
          <td>${termVis.getStateBadge(p.state)}</td>
          <td class="font-mono text-slate-300 text-xs">${termVis.formatBytes(p.rss)}</td>
          <td class="font-mono text-slate-400 text-xs">${p.threads || 1}</td>
          <td>
            <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-mono btn-row-inspect" data-pid="${p.pid}">Inspect</button>
          </td>
        </tr>
      `;
    });

    el.tableBody.innerHTML = rowsHtml || `<tr><td colspan="7" class="p-8 text-center text-slate-500 font-mono">No processes found</td></tr>`;

    el.tableBody.querySelectorAll("tr").forEach(tr => {
      tr.addEventListener("click", () => {
        const pid = parseInt(tr.getAttribute("data-pid"), 10);
        if (pid) openInspector(pid);
      });
    });
  }

  function openInspector(pid, shouldAnimate = true) {
    const proc = state.processMap.get(pid);
    if (!proc) return;

    state.selectedProcess = proc;
    termVis.setSelectedPid(pid);
    treeVis.selectPid(pid);

    el.inspectorTitle.textContent = proc.name;
    el.inspectorPid.textContent = proc.pid;
    el.inspectorPpid.textContent = proc.ppid;
    el.inspectorState.innerHTML = termVis.getStateBadge(proc.state);
    el.inspectorThreads.textContent = proc.threads || 1;
    el.inspectorRss.textContent = termVis.formatBytes(proc.rss);
    el.inspectorVsize.textContent = termVis.formatBytes(proc.vsize);

    // Compute Lineage Breadcrumbs (Root -> ... -> Child)
    const lineage = [];
    let curr = proc;
    while (curr) {
      lineage.unshift(curr);
      if (curr.ppid <= 0 || !state.processMap.has(curr.ppid)) break;
      curr = state.processMap.get(curr.ppid);
    }

    let breadcrumbsHtml = "";
    lineage.forEach((node, idx) => {
      const isCurrent = node.pid === proc.pid;
      breadcrumbsHtml += `
        <span class="inline-flex items-center">
          <button class="px-2 py-1 rounded font-mono text-xs ${isCurrent ? 'bg-cyan-500/20 text-cyan-300 font-semibold ring-1 ring-cyan-500/40' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} btn-lineage-jump" data-pid="${node.pid}">
            ${escapeHtml(node.name)} (${node.pid})
          </button>
          ${idx < lineage.length - 1 ? '<svg class="w-3.5 h-3.5 mx-1 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>' : ''}
        </span>
      `;
    });
    el.inspectorLineage.innerHTML = breadcrumbsHtml;

    // Children list
    const children = [];
    for (const p of state.processMap.values()) {
      if (p.ppid === proc.pid) children.push(p);
    }

    if (children.length > 0) {
      let childrenHtml = `<div class="grid grid-cols-2 gap-2 mt-1">`;
      children.forEach(c => {
        childrenHtml += `
          <button class="flex items-center justify-between p-2 rounded bg-slate-800/80 hover:bg-slate-700/80 text-xs border border-white/5 btn-child-jump text-left" data-pid="${c.pid}">
            <span class="font-mono text-slate-200 truncate mr-2">${escapeHtml(c.name)}</span>
            <span class="font-mono text-cyan-400 font-bold">${c.pid}</span>
          </button>
        `;
      });
      childrenHtml += `</div>`;
      el.inspectorChildren.innerHTML = childrenHtml;
    } else {
      el.inspectorChildren.innerHTML = `<span class="text-xs text-slate-500 font-mono">No active child processes (leaf node)</span>`;
    }

    // Proc Stat Educational view (mirrors read_process in ptree.c)
    el.inspProcStatRaw.textContent = `${proc.pid} (${proc.name}) ${proc.state} ${proc.ppid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${proc.threads} 0 0 ${proc.vsize || 0} ${(proc.rss || 0) / 4096}`;

    // Add jump handlers
    el.inspector.querySelectorAll(".btn-lineage-jump, .btn-child-jump").forEach(b => {
      b.addEventListener("click", () => {
        const jumpPid = parseInt(b.getAttribute("data-pid"), 10);
        openInspector(jumpPid);
      });
    });

    el.inspector.classList.add("open");
  }

  function closeInspector() {
    el.inspector.classList.remove("open");
    state.selectedProcess = null;
    termVis.setSelectedPid(null);
  }

  async function sendSignal(pid, signalName) {
    if (!confirm(`Deliver ${signalName} to process PID ${pid} (${state.selectedProcess?.name})?`)) {
      return;
    }

    if (state.backendOnline) {
      try {
        const resp = await fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, signal: signalName })
        });
        const res = await resp.json();
        showToast(res.message);
      } catch (e) {
        showToast("Failed to deliver signal: " + e.message);
      }
    } else {
      showToast(`Signal ${signalName} delivered to simulated PID ${pid}`);
    }

    fetchTelemetry();
  }

  function startDataFeed() {
    fetchTelemetry();
    restartIntervalTimer();
  }

  function restartIntervalTimer() {
    if (state.timerId) clearInterval(state.timerId);
    if (!state.isStreaming || state.refreshInterval <= 0) return;

    state.timerId = setInterval(() => {
      fetchTelemetry();
    }, state.refreshInterval * 1000);
  }

  function showToast(msg) {
    let toast = document.getElementById("toast-notification");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast-notification";
      toast.className = "fixed bottom-6 right-6 px-4 py-3 rounded-lg bg-slate-900 border border-cyan-500/40 text-cyan-300 text-xs font-mono shadow-2xl flex items-center gap-2 z-50 transition-opacity duration-300 pointer-events-none";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.opacity = "0";
    }, 2800);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
