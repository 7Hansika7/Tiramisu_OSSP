# Linux Process Tree Visualizer

> **A real-time telemetry tool and interactive dashboard that displays the hierarchy of running processes, parent-child relationships, and kernel states.**

---

## 1. Project Overview

The **Linux Process Tree Visualizer** inspects the Linux virtual filesystem (`/proc`), reconstructs the hierarchical process tree starting from `systemd` (PID 1), and renders both a high-performance terminal tree view and a modern, interactive web dashboard in real time.

### Core Features

- **Direct `/proc` Telemetry Engine**: Inspects `/proc/[pid]/stat`, safely parsing process names with spaces or brackets, process states, thread counts, and memory metrics.
- **Hierarchical Tree Construction**: Builds parent-child graphs using DFS traversal, detecting roots (`ppid <= 0` or missing parents) and identifying orphan nodes.
- **Kernel Thread Segregation**: Isolates `kthreadd` (PID 2) and its kernel threads, with support for the `--all` flag to toggle visibility.
- **Interactive Multi-View Dashboard**:
  - **Hierarchy Graph (D3.js)**: Collapsible, zoomable node-link DAG with glowing state accents and ancestor lineage illumination on hover.
  - **Terminal Tree (ptree CLI mirror)**: Authentic Unicode box-drawing tree (`├──`, `└──`, `│   `) with branch collapsing, syntax highlighting, and one-click ASCII copy.
  - **Radial Sunburst Partition**: Concentric hierarchy map displaying process weight and distribution radiating outward from PID 1.
  - **Process Matrix Table**: Sortable and filterable data grid for high-density monitoring.
- **Process Inspector Drawer**:
  - Full ancestor breadcrumb chain (`systemd (1) ➔ gnome-shell (1340) ➔ bash (1585) ➔ ptree (1820)`).
  - Direct children jump navigation.
  - Raw `/proc/<pid>/stat` parser breakdown demonstrating low-level field extraction.
  - POSIX signaling (`SIGTERM`, `SIGKILL`, `SIGSTOP`, `SIGCONT`).
- **Live Zombie Process Demonstration**: Interactive spawner and detector to demonstrate real-time identification of defunct zombie processes (`State: Z`).

---

## 2. Architecture & File Structure

```
HACKATHON/
├── c_core/
│   ├── ptree.c              # Core Linux C visualizer (POSIX /proc, box-drawing tree)
│   ├── ptree_json.c         # C exporter streaming process snapshots in JSON format
│   └── Makefile             # GCC build configuration
├── web/
│   ├── index.html           # Modern dark-mode dashboard (Tailwind, D3, SVG icons)
│   ├── css/
│   │   └── style.css        # Telemetry styling, glassmorphism, animations
│   └── js/
│       ├── app.js           # Main application controller, state, signals, filters
│       ├── tree-visualizer.js   # D3.js collapsible hierarchical node-link graph
│       ├── terminal-view.js # Interactive CLI tree mirror with box-drawing characters
│       ├── radial-visualizer.js # D3.js radial sunburst partition visualizer
│       └── mock-data.js     # Standalone fallback & Ubuntu 24.04 LTS /proc simulator
├── server.py                # Zero-dependency Python telemetry & SSE server
├── start.sh                 # One-click launch script
└── README.md                # Project documentation
```

---

## 3. Quick Start

### Option A: One-Click Launch (Recommended)

Run the automated launcher script from the project root:

```bash
cd HACKATHON
./start.sh
```

This compiles the C core binaries and starts the web visualizer at `http://localhost:8080`, automatically opening your default web browser.

---

### Option B: Native C CLI Tool

To compile and run the native C terminal visualizer:

```bash
cd HACKATHON/c_core
make

# Live visualizer (refreshes every 3 seconds)
./ptree

# Include kernel threads (kthreadd PID 2 and children)
./ptree --all

# Single snapshot and exit
./ptree --once

# Show usage flags
./ptree --help
```

---

### Option C: Standalone Web Interface (Zero Install / Offline)

You can open `web/index.html` directly in any modern browser (Google Chrome, Firefox, Safari, Edge) without running any server:

```bash
open HACKATHON/web/index.html
```

The application automatically detects the environment and activates the built-in realistic Linux `/proc` telemetry simulator.

---

## 4. Technical Details: Linux `/proc` Parsing

In Linux, process information is exposed through `/proc/<pid>/stat`. The second field `comm` (process name) is enclosed in parentheses and may contain spaces or brackets. The implementation uses:

```c
/* Find first '(' and last ')' to safely isolate process name */
char *left  = strchr(buffer, '(');
char *right = strrchr(buffer, ')');

/* Extract state and parent PID from remainder */
sscanf(right + 1, " %c %d", &p->state, &p->ppid);
```

### Process State Mapping

| State Code | Name | Description | Color in UI |
|:---:|:---|:---|:---:|
| **R** | Running / Runnable | Actively executing or in run queue | Emerald Green |
| **S** | Sleeping | Interruptible sleep, waiting for event | Sky Blue |
| **D** | Disk Sleep | Uninterruptible sleep (I/O wait) | Cyan |
| **T** | Stopped | Stopped by job control signal or debugger | Amber Orange |
| **Z** | Zombie | Defunct process, terminated but unread by parent | Crimson Red |

---

## 5. Hackathon Demonstration Highlights

1. **Hierarchy Graph Navigation**: Open the dashboard, click any process node to inspect its lineage chain back to `systemd` (PID 1), and collapse/expand subtrees.
2. **Zombie Detection in Action**: Click **"Spawn Zombie"** in the top navigation. Notice the instant counter increment, the red warning ring on the metric card, and the highlighted `State: Z` defunct process in the tree.
3. **Compare CLI vs Web**: Switch to the **Terminal Tree** tab to verify that the box-drawing output matches the native `./ptree` CLI executable output character for character.
4. **POSIX Process Control**: Open the inspector on any process and dispatch standard POSIX signals (`SIGTERM`, `SIGKILL`, `SIGSTOP`, `SIGCONT`).
