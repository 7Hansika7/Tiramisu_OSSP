/**
 * Linux Process Tree Visualizer - Interactive D3 Hierarchical Tree
 * -----------------------------------------------------------------
 * Renders an interactive, zoomable, collapsible process hierarchy.
 * Features:
 * - Left-to-right horizontal hierarchical layout
 * - State-colored node cards with PID, Name, and Threads
 * - Expand/collapse subtree toggle with child count badge
 * - Ancestor path illumination on hover
 * - Smooth camera transitions (fit-to-screen, center on PID)
 */

class ProcessTreeVisualizer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.onSelectProcess = options.onSelectProcess || (() => {});
    this.svg = null;
    this.g = null;
    this.zoom = null;
    this.root = null;
    this.i = 0;
    this.duration = 400;
    this.selectedPid = null;
    this.searchQuery = "";
    this.stateFilter = "ALL";
    this.collapsedNodes = new Set(); // tracks PIDs user collapsed

    this.init();
  }

  init() {
    this.container.innerHTML = "";
    const width = this.container.clientWidth || 1000;
    const height = this.container.clientHeight || 700;

    this.svg = d3.select(this.container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("class", "tree-svg");

    // Defs for glowing filter and markers
    const defs = this.svg.append("defs");
    
    const filter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-20%")
      .attr("y", "-20%")
      .attr("width", "140%")
      .attr("height", "140%");
    filter.append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "blur");
    filter.append("feComposite")
      .attr("in", "SourceGraphic")
      .attr("in2", "blur")
      .attr("operator", "over");

    this.g = this.svg.append("g").attr("class", "tree-content");

    this.zoom = d3.zoom()
      .scaleExtent([0.15, 2.5])
      .on("zoom", (event) => {
        this.g.attr("transform", event.transform);
      });

    this.svg.call(this.zoom);

    // Initial transform: offset from left margin
    this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(80, height / 2).scale(0.85));

    window.addEventListener("resize", () => {
      if (this.root) this.update(this.root);
    });
  }

  setData(treeData) {
    if (!treeData || treeData.length === 0) {
      this.g.selectAll("*").remove();
      return;
    }

    // Wrap multiple roots into a virtual meta-root if necessary
    let rootData;
    if (treeData.length === 1) {
      rootData = treeData[0];
    } else {
      rootData = {
        pid: 0,
        ppid: -1,
        name: "linux-kernel-roots",
        state: "S",
        is_virtual: true,
        children: treeData
      };
    }

    this.root = d3.hierarchy(rootData, d => d.children);
    this.root.x0 = (this.container.clientHeight || 700) / 2;
    this.root.y0 = 80;

    // Apply preserved collapse state
    this.applyCollapseState(this.root);

    this.update(this.root);
  }

  applyCollapseState(d) {
    if (d.children) {
      if (this.collapsedNodes.has(d.data.pid)) {
        d._children = d.children;
        d.children = null;
      } else {
        d.children.forEach(c => this.applyCollapseState(c));
      }
    }
  }

  getStateColor(state) {
    switch (state) {
      case 'R': return '#10b981'; // Green
      case 'T': return '#f59e0b'; // Amber
      case 'Z': return '#ef4444'; // Red
      case 'D': return '#06b6d4'; // Cyan
      case 'K': return '#a855f7'; // Purple
      default:  return '#38bdf8'; // Blue/Sky for 'S', 'I'
    }
  }

  update(source) {
    if (!this.root) return;

    // Tree layout configuration
    const treeLayout = d3.tree()
      .nodeSize([65, 260])
      .separation((a, b) => (a.parent === b.parent ? 1.1 : 1.3));

    const treeData = treeLayout(this.root);
    const nodes = treeData.descendants().filter(d => !d.data.is_virtual);
    const links = treeData.links().filter(d => !d.source.data.is_virtual);

    // Normalize for fixed-depth
    nodes.forEach(d => {
      d.y = d.depth * 250;
    });

    // ----------------- NODES -----------------
    const node = this.g.selectAll("g.node-card")
      .data(nodes, d => d.data.pid || (d.id = ++this.i));

    // Enter any new nodes at the parent's previous position
    const nodeEnter = node.enter().append("g")
      .attr("class", d => `node-card ${d.data.pid === this.selectedPid ? 'selected' : ''}`)
      .attr("transform", () => `translate(${source.y0 || 0},${source.x0 || 0})`)
      .on("click", (event, d) => {
        event.stopPropagation();
        this.selectedPid = d.data.pid;
        this.onSelectProcess(d.data);
        this.update(d);
      });

    // Node Box container (Rect)
    const cardWidth = 200;
    const cardHeight = 46;

    nodeEnter.append("rect")
      .attr("class", "node-box")
      .attr("x", 0)
      .attr("y", -cardHeight / 2)
      .attr("width", cardWidth)
      .attr("height", cardHeight)
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("fill", "#0f172a")
      .attr("stroke", d => this.getStateColor(d.data.state))
      .attr("stroke-width", 1.2);

    // Left state strip
    nodeEnter.append("rect")
      .attr("class", "state-strip")
      .attr("x", 0)
      .attr("y", -cardHeight / 2)
      .attr("width", 5)
      .attr("height", cardHeight)
      .attr("rx", 2)
      .attr("fill", d => this.getStateColor(d.data.state));

    // Process Name text
    nodeEnter.append("text")
      .attr("class", "proc-name")
      .attr("x", 14)
      .attr("y", -cardHeight / 2 + 18)
      .attr("fill", "#f8fafc")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .attr("font-family", "var(--font-mono)")
      .text(d => {
        const name = d.data.name || "unknown";
        return name.length > 16 ? name.substring(0, 15) + "…" : name;
      });

    // PID text
    nodeEnter.append("text")
      .attr("class", "proc-pid")
      .attr("x", 14)
      .attr("y", -cardHeight / 2 + 34)
      .attr("fill", "#94a3b8")
      .attr("font-size", "11px")
      .attr("font-family", "var(--font-mono)")
      .text(d => `PID: ${d.data.pid}`);

    // State Badge Pill background
    nodeEnter.append("rect")
      .attr("class", "state-pill-bg")
      .attr("x", cardWidth - 36)
      .attr("y", -cardHeight / 2 + 8)
      .attr("width", 26)
      .attr("height", 16)
      .attr("rx", 4)
      .attr("fill", d => {
        const c = this.getStateColor(d.data.state);
        return c + "22"; // 15% opacity hex
      })
      .attr("stroke", d => this.getStateColor(d.data.state))
      .attr("stroke-width", 0.8);

    // State Badge Pill text (R, S, T, Z)
    nodeEnter.append("text")
      .attr("class", "state-pill-text")
      .attr("x", cardWidth - 23)
      .attr("y", -cardHeight / 2 + 20)
      .attr("text-anchor", "middle")
      .attr("fill", d => this.getStateColor(d.data.state))
      .attr("font-size", "10px")
      .attr("font-weight", "700")
      .attr("font-family", "var(--font-mono)")
      .text(d => d.data.state || "S");

    // Collapse / Expand toggle button (+ / -) if children exist
    const toggleBtn = nodeEnter.append("g")
      .attr("class", "toggle-btn")
      .attr("transform", `translate(${cardWidth}, 0)`)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        this.toggleNode(d);
      });

    toggleBtn.append("circle")
      .attr("r", 9)
      .attr("fill", "#1e293b")
      .attr("stroke", "rgba(255, 255, 255, 0.25)")
      .attr("stroke-width", 1);

    toggleBtn.append("text")
      .attr("class", "toggle-icon")
      .attr("text-anchor", "middle")
      .attr("dy", "3px")
      .attr("fill", "#38bdf8")
      .attr("font-size", "11px")
      .attr("font-weight", "bold")
      .text(d => (d.children ? "−" : (d._children ? `+${d._children.length}` : "")));

    // Hover effect: highlight lineage
    nodeEnter
      .on("mouseenter", (event, d) => this.highlightLineage(d))
      .on("mouseleave", () => this.clearHighlights());

    // ----------------- TRANSITIONS -----------------
    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(this.duration)
      .attr("transform", d => `translate(${d.y},${d.x})`);

    nodeUpdate.select(".node-box")
      .attr("stroke", d => {
        if (d.data.pid === this.selectedPid) return "#38bdf8";
        if (this.matchesSearch(d)) return "#f59e0b";
        return this.getStateColor(d.data.state);
      })
      .attr("stroke-width", d => (d.data.pid === this.selectedPid ? 2.5 : 1.2));

    nodeUpdate.select(".toggle-btn")
      .style("display", d => (d.children || d._children ? "block" : "none"))
      .select("text.toggle-icon")
      .text(d => {
        if (d.children) return "−";
        if (d._children) return d._children.length > 9 ? "…" : `+${d._children.length}`;
        return "";
      });

    // Remove existing nodes fading out to parent position
    node.exit().transition()
      .duration(this.duration)
      .attr("transform", () => `translate(${source.y},${source.x})`)
      .remove();

    // ----------------- LINKS -----------------
    const link = this.g.selectAll("path.tree-link")
      .data(links, d => d.target.data.pid);

    const linkEnter = link.enter().insert("path", "g")
      .attr("class", "tree-link")
      .attr("d", () => {
        const o = { x: source.x0 || 0, y: (source.y0 || 0) + cardWidth };
        return this.diagonal(o, o);
      });

    linkEnter.merge(link).transition()
      .duration(this.duration)
      .attr("d", d => {
        const s = { x: d.source.x, y: d.source.y + cardWidth };
        const t = { x: d.target.x, y: d.target.y };
        return this.diagonal(s, t);
      });

    link.exit().transition()
      .duration(this.duration)
      .attr("d", () => {
        const o = { x: source.x, y: (source.y || 0) + cardWidth };
        return this.diagonal(o, o);
      })
      .remove();

    // Store old coordinates for next transition
    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }

  diagonal(s, d) {
    return `M ${s.y} ${s.x}
            C ${(s.y + d.y) / 2} ${s.x},
              ${(s.y + d.y) / 2} ${d.x},
              ${d.y} ${d.x}`;
  }

  toggleNode(d) {
    if (d.children) {
      d._children = d.children;
      d.children = null;
      this.collapsedNodes.add(d.data.pid);
    } else {
      d.children = d._children;
      d._children = null;
      this.collapsedNodes.delete(d.data.pid);
    }
    this.update(d);
  }

  expandAll() {
    this.collapsedNodes.clear();
    const expand = (d) => {
      if (d._children) {
        d.children = d._children;
        d._children = null;
      }
      if (d.children) d.children.forEach(expand);
    };
    if (this.root) {
      expand(this.root);
      this.update(this.root);
    }
  }

  collapseAll() {
    const collapse = (d) => {
      if (d.children && d.depth > 1) {
        d._children = d.children;
        d.children = null;
        this.collapsedNodes.add(d.data.pid);
      }
      if (d.children) d.children.forEach(collapse);
      if (d._children) d._children.forEach(collapse);
    };
    if (this.root) {
      collapse(this.root);
      this.update(this.root);
    }
  }

  highlightLineage(d) {
    const ancestorPids = new Set();
    let curr = d;
    while (curr) {
      if (curr.data.pid) ancestorPids.add(curr.data.pid);
      curr = curr.parent;
    }

    this.g.selectAll("g.node-card")
      .classed("dimmed", n => !ancestorPids.has(n.data.pid));

    this.g.selectAll("path.tree-link")
      .classed("highlighted", l => ancestorPids.has(l.target.data.pid))
      .classed("dimmed", l => !ancestorPids.has(l.target.data.pid));
  }

  clearHighlights() {
    this.g.selectAll("g.node-card").classed("dimmed", false);
    this.g.selectAll("path.tree-link")
      .classed("highlighted", false)
      .classed("dimmed", false);
  }

  matchesSearch(d) {
    if (!this.searchQuery) return false;
    const q = this.searchQuery.toLowerCase();
    const nameMatch = d.data.name && d.data.name.toLowerCase().includes(q);
    const pidMatch = String(d.data.pid).includes(q);
    return nameMatch || pidMatch;
  }

  setSearchQuery(q) {
    this.searchQuery = q.trim();
    if (this.root) this.update(this.root);
  }

  selectPid(pid) {
    this.selectedPid = pid;
    if (this.root) {
      // Find node
      const target = this.root.descendants().find(d => d.data.pid === pid);
      if (target) {
        // Expand ancestors
        let curr = target.parent;
        while (curr) {
          if (curr._children) {
            curr.children = curr._children;
            curr._children = null;
          }
          curr = curr.parent;
        }
        this.update(target);
        this.centerOnNode(target);
      }
    }
  }

  centerOnNode(d) {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const transform = d3.zoomIdentity
      .translate(width / 3 - d.y, height / 2 - d.x)
      .scale(1);

    this.svg.transition().duration(600).call(this.zoom.transform, transform);
  }

  fitToScreen() {
    if (!this.root) return;
    const bounds = this.g.node().getBBox();
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (bounds.width === 0 || bounds.height === 0) return;

    const scale = Math.min(width / (bounds.width + 100), height / (bounds.height + 100), 1.2);
    const tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;

    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    this.svg.transition().duration(600).call(this.zoom.transform, transform);
  }

  zoomIn() {
    this.svg.transition().duration(300).call(this.zoom.scaleBy, 1.3);
  }

  zoomOut() {
    this.svg.transition().duration(300).call(this.zoom.scaleBy, 0.77);
  }

  resetZoom() {
    const height = this.container.clientHeight;
    this.svg.transition().duration(500)
      .call(this.zoom.transform, d3.zoomIdentity.translate(80, height / 2).scale(0.85));
  }
}

window.ProcessTreeVisualizer = ProcessTreeVisualizer;
