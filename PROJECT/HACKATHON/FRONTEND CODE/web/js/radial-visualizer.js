/**
 * Linux Process Tree Visualizer - Radial Sunburst Visualizer
 * ---------------------------------------------------------
 * Renders the process hierarchy radiating from PID 1 / roots outwards
 * using D3 partition layout. Provides an instant bird's-eye view
 * of process distribution and heavy subtrees.
 */

class RadialVisualizer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.onSelectProcess = options.onSelectProcess || (() => {});
    this.svg = null;
    this.g = null;
    this.root = null;
    this.width = 700;
    this.radius = 320;
    this.init();
  }

  init() {
    this.container.innerHTML = "";
    this.width = Math.min(this.container.clientWidth || 700, this.container.clientHeight || 700, 750);
    this.radius = this.width / 2 - 20;

    this.svg = d3.select(this.container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `-${this.width / 2} -${this.width / 2} ${this.width} ${this.width}`)
      .style("font-family", "var(--font-mono)");

    this.g = this.svg.append("g");

    // Center info text
    this.centerText = this.svg.append("g")
      .attr("class", "center-label")
      .attr("text-anchor", "middle");

    this.centerText.append("text")
      .attr("class", "center-title")
      .attr("y", -6)
      .attr("fill", "#f8fafc")
      .attr("font-size", "14px")
      .attr("font-weight", "bold")
      .text("systemd (PID 1)");

    this.centerText.append("text")
      .attr("class", "center-subtitle")
      .attr("y", 16)
      .attr("fill", "#94a3b8")
      .attr("font-size", "11px")
      .text("Root of Hierarchy");
  }

  getStateColor(state) {
    switch (state) {
      case 'R': return '#10b981';
      case 'T': return '#f59e0b';
      case 'Z': return '#ef4444';
      case 'D': return '#06b6d4';
      default:  return '#38bdf8';
    }
  }

  setData(treeData) {
    if (!treeData || treeData.length === 0) {
      this.g.selectAll("*").remove();
      return;
    }

    let rootData;
    if (treeData.length === 1) {
      rootData = treeData[0];
    } else {
      rootData = {
        pid: 0,
        name: "init",
        state: "S",
        children: treeData
      };
    }

    const hierarchy = d3.hierarchy(rootData)
      .sum(d => (d.children && d.children.length > 0 ? 1 : 2))
      .sort((a, b) => b.value - a.value);

    const partition = d3.partition()
      .size([2 * Math.PI, this.radius]);

    const root = partition(hierarchy);
    this.root = root;

    const arc = d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(this.radius / 2)
      .innerRadius(d => d.y0 + 10)
      .outerRadius(d => Math.max(d.y0 + 10, d.y1 - 2));

    this.g.selectAll("*").remove();

    const paths = this.g.selectAll("path")
      .data(root.descendants().filter(d => d.depth > 0))
      .enter().append("path")
      .attr("fill", d => this.getStateColor(d.data.state))
      .attr("fill-opacity", d => 0.4 + (d.depth * 0.12))
      .attr("stroke", "#080b11")
      .attr("stroke-width", "1px")
      .attr("d", arc)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        this.onSelectProcess(d.data.pid);
      })
      .on("mouseenter", (event, d) => {
        d3.select(event.currentTarget)
          .attr("fill-opacity", 1)
          .attr("stroke", "#ffffff")
          .attr("stroke-width", "2px");

        this.centerText.select(".center-title")
          .text(`${d.data.name} (${d.data.pid})`);
        this.centerText.select(".center-subtitle")
          .text(`State: ${d.data.state} | PPID: ${d.data.ppid}`);
      })
      .on("mouseleave", (event, d) => {
        d3.select(event.currentTarget)
          .attr("fill-opacity", 0.4 + (d.depth * 0.12))
          .attr("stroke", "#080b11")
          .attr("stroke-width", "1px");

        if (this.root) {
          this.centerText.select(".center-title").text(`${this.root.data.name} (PID 1)`);
          this.centerText.select(".center-subtitle").text("Root Hierarchy");
        }
      });

    // Labels for prominent arcs
    this.g.selectAll("text")
      .data(root.descendants().filter(d => d.depth > 0 && (d.y0 + d.y1) / 2 * (d.x1 - d.x0) > 16))
      .enter().append("text")
      .attr("transform", d => {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
        const y = (d.y0 + d.y1) / 2;
        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
      })
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("fill", "#ffffff")
      .attr("font-size", "9px")
      .attr("pointer-events", "none")
      .text(d => (d.data.name ? (d.data.name.length > 8 ? d.data.name.slice(0, 7) + "…" : d.data.name) : ""));
  }
}

window.RadialVisualizer = RadialVisualizer;
