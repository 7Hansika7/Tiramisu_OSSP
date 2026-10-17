/**
 * Linux Process Tree Visualizer - Terminal View
 * ---------------------------------------------
 * Directly reproduces the C core (ptree.c) box-drawing algorithm:
 *   ├── and └── with │   indentation
 * Adds interactive features:
 * - Click line to inspect process details
 * - Click branch icon to collapse/expand subtrees
 * - One-click copy of ASCII/Unicode tree to clipboard
 */

class TerminalView {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.onSelectProcess = options.onSelectProcess || (() => {});
    this.collapsedPids = new Set();
    this.treeData = [];
    this.searchQuery = "";
    this.selectedPid = null;
  }

  setData(treeData) {
    this.treeData = treeData || [];
    this.render();
  }

  setSearchQuery(q) {
    this.searchQuery = q.trim().toLowerCase();
    this.render();
  }

  setSelectedPid(pid) {
    this.selectedPid = pid;
    this.render();
  }

  toggleCollapse(pid) {
    if (this.collapsedPids.has(pid)) {
      this.collapsedPids.delete(pid);
    } else {
      this.collapsedPids.add(pid);
    }
    this.render();
  }

  getStateBadge(state) {
    switch (state) {
      case 'R': return `<span class="state-pill state-R">R</span>`;
      case 'T': return `<span class="state-pill state-T">T</span>`;
      case 'Z': return `<span class="state-pill state-Z">Z</span>`;
      case 'D': return `<span class="state-pill state-D">D</span>`;
      default:  return `<span class="state-pill state-S">${state || 'S'}</span>`;
    }
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }

  render() {
    if (!this.container) return;

    if (!this.treeData || this.treeData.length === 0) {
      this.container.innerHTML = `<div class="p-8 text-center text-slate-500 font-mono">No processes matching current filters</div>`;
      return;
    }

    let html = `<div class="terminal-window">`;
    html += `<div class="text-xs text-slate-500 pb-3 border-b border-white/5 mb-3 flex items-center justify-between">
      <span># Linux Process Tree Visualizer (ptree CLI mirror)</span>
      <span class="text-slate-400">Box-drawing hierarchy (POSIX /proc)</span>
    </div>`;

    const lines = [];
    const plainLines = [];

    const traverse = (node, prefix, isLast, isRoot) => {
      const isCollapsed = this.collapsedPids.has(node.pid);
      const hasChildren = node.children && node.children.length > 0;
      
      const branchSymbol = isRoot ? "" : (isLast ? "└── " : "├── ");
      const branchText = isRoot ? "" : (isLast ? "└── " : "├── ");
      const plainPrefix = prefix + branchText;

      const matches = !this.searchQuery || 
        (node.name && node.name.toLowerCase().includes(this.searchQuery)) ||
        String(node.pid).includes(this.searchQuery);

      const isSelected = node.pid === this.selectedPid;

      // HTML line
      let lineHtml = `<div class="term-line ${isSelected ? 'bg-cyan-500/15 ring-1 ring-cyan-500/30' : ''} ${matches ? '' : 'opacity-40'}" data-pid="${node.pid}">`;
      
      // Prefix branches
      lineHtml += `<span class="term-branch">${escapeHtml(prefix + branchSymbol)}</span>`;
      
      // Collapse icon if has children
      if (hasChildren) {
        lineHtml += `<span class="cursor-pointer mr-1.5 px-1 rounded bg-slate-800 text-cyan-400 hover:bg-slate-700 text-xs font-mono font-bold collapse-toggle" data-pid="${node.pid}">${isCollapsed ? `+${node.children.length}` : '−'}</span>`;
      } else {
        lineHtml += `<span class="inline-block w-3.5"></span>`;
      }

      // Name & PID
      lineHtml += `<span class="term-name cursor-pointer hover:underline text-slate-100" data-pid="${node.pid}">${escapeHtml(node.name)}</span>`;
      lineHtml += `<span class="term-meta font-mono">(PID: <span class="text-slate-300 font-semibold">${node.pid}</span>, PPID: <span class="text-slate-400">${node.ppid}</span>, State: ${this.getStateBadge(node.state)})</span>`;
      
      if (node.rss > 0) {
        lineHtml += `<span class="ml-3 text-xs text-slate-500 font-mono">${this.formatBytes(node.rss)}</span>`;
      }

      lineHtml += `</div>`;
      lines.push(lineHtml);

      // Plain text for clipboard (matches original C printf output)
      plainLines.push(`${plainPrefix}${node.name} (PID: ${node.pid}, PPID: ${node.ppid}, State: ${node.state})`);

      if (!isCollapsed && hasChildren) {
        const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
        const total = node.children.length;
        for (let i = 0; i < total; i++) {
          traverse(node.children[i], nextPrefix, i === total - 1, false);
        }
      }
    };

    for (let i = 0; i < this.treeData.length; i++) {
      traverse(this.treeData[i], "", true, true);
    }

    html += lines.join("");
    html += `</div>`;

    this.container.innerHTML = html;
    this.rawAsciiTree = plainLines.join("\n");

    // Event listeners
    this.container.querySelectorAll(".term-line").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("collapse-toggle")) return;
        const pid = parseInt(el.getAttribute("data-pid"), 10);
        this.selectedPid = pid;
        this.onSelectProcess(pid);
        this.render();
      });
    });

    this.container.querySelectorAll(".collapse-toggle").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const pid = parseInt(el.getAttribute("data-pid"), 10);
        this.toggleCollapse(pid);
      });
    });
  }

  getAsciiTree() {
    return this.rawAsciiTree || "";
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.TerminalView = TerminalView;
