#!/usr/bin/env python3
"""
Linux Process Tree Visualizer - Backend Server
----------------------------------------------
Provides real-time process tree telemetry via HTTP REST and SSE (Server-Sent Events).
Supports:
- Direct Linux /proc parsing (matches ptree.c logic)
- Native host process inspection (macOS/BSD/Linux)
- Realistic Linux simulation mode (systemd, kthreadd, zombies, docker)
- Process signaling and tree export
"""

import http.server
import json
import os
import platform
import re
import signal
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse

PORT = 8080
HOST = "127.0.0.1"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

# Global state
SIMULATION_MODE = not os.path.exists("/proc/1/stat")
CURRENT_REFRESH_INTERVAL = 3.0
DEMO_ZOMBIES = []

def parse_proc_stat_line(line):
    """
    Parses a /proc/<pid>/stat line safely handling spaces/parentheses in comm.
    Matches read_process() logic in ptree.c.
    """
    left = line.find('(')
    right = line.rfind(')')
    if left == -1 or right == -1 or right <= left:
        return None
    
    pid_str = line[:left].strip()
    comm = line[left+1:right]
    rest = line[right+1:].strip().split()
    
    if len(rest) < 2:
        return None
        
    try:
        pid = int(pid_str)
        state = rest[0]
        ppid = int(rest[1])
        num_threads = int(rest[17]) if len(rest) > 17 else 1
        vsize = int(rest[20]) if len(rest) > 20 else 0
        rss = int(rest[21]) if len(rest) > 21 else 0
        return {
            "pid": pid,
            "ppid": ppid,
            "name": comm,
            "state": state,
            "threads": num_threads,
            "vsize": vsize,
            "rss": rss * 4096,  # pages to bytes
            "is_kernel": (pid == 2 or ppid == 2)
        }
    except (ValueError, IndexError):
        return None

def scan_real_linux_proc():
    """Reads /proc directly on Linux systems, matching ptree.c."""
    processes = []
    if not os.path.isdir("/proc"):
        return []

    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        stat_path = os.path.join("/proc", entry, "stat")
        try:
            with open(stat_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                proc_info = parse_proc_stat_line(content)
                if proc_info:
                    processes.append(proc_info)
        except (OSError, IOError):
            continue

    processes.sort(key=lambda p: p["pid"])
    return processes

def scan_host_processes():
    """Fallback scanner for macOS/BSD when /proc is not mounted."""
    try:
        # ps output: pid, ppid, state, rss, vsz, comm
        cmd = ["ps", "-axo", "pid,ppid,state,rss,vsz,comm"]
        output = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
        lines = output.strip().split("\n")[1:]
        processes = []
        for line in lines:
            parts = line.strip().split(None, 5)
            if len(parts) >= 6:
                try:
                    pid = int(parts[0])
                    ppid = int(parts[1])
                    state_raw = parts[2]
                    state = state_raw[0] if state_raw else 'S'
                    # Standardize state to Linux conventions
                    if state in ['U', 'D']: state = 'D'
                    elif state == 'T': state = 'T'
                    elif state == 'Z': state = 'Z'
                    elif state == 'R': state = 'R'
                    else: state = 'S'
                    
                    rss = int(parts[3]) * 1024
                    vsize = int(parts[4]) * 1024
                    name = os.path.basename(parts[5])
                    
                    processes.append({
                        "pid": pid,
                        "ppid": ppid,
                        "name": name,
                        "state": state,
                        "threads": 1,
                        "vsize": vsize,
                        "rss": rss,
                        "is_kernel": (pid == 2 or ppid == 2)
                    })
                except (ValueError, IndexError):
                    continue
        processes.sort(key=lambda p: p["pid"])
        return processes
    except Exception:
        return get_simulated_linux_tree()

# Realistic simulated Ubuntu 24.04 LTS process tree generator
# Used when demonstrating Linux-specific features (systemd, kthreadd, real zombie simulation)
_sim_state = {
    "tick": 0,
    "dynamic_procs": []
}

def get_simulated_linux_tree():
    """Generates an authentic Ubuntu /proc process tree with realistic hierarchies."""
    _sim_state["tick"] += 1
    t = _sim_state["tick"]
    
    # Base core hierarchy
    procs = [
        {"pid": 1, "ppid": 0, "name": "systemd", "state": "S", "threads": 1, "rss": 14200000, "vsize": 168000000, "is_kernel": False},
        {"pid": 2, "ppid": 0, "name": "kthreadd", "state": "S", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        # Kernel threads under kthreadd
        {"pid": 3, "ppid": 2, "name": "rcu_gp", "state": "I", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 4, "ppid": 2, "name": "rcu_par_gp", "state": "I", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 9, "ppid": 2, "name": "kworker/0:0H", "state": "I", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 10, "ppid": 2, "name": "ksoftirqd/0", "state": "S", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 11, "ppid": 2, "name": "kworker/u16:0", "state": "I", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 12, "ppid": 2, "name": "migration/0", "state": "S", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 13, "ppid": 2, "name": "cpuhp/0", "state": "S", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 14, "ppid": 2, "name": "kdevtmpfs", "state": "S", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        {"pid": 15, "ppid": 2, "name": "netns", "state": "I", "threads": 1, "rss": 0, "vsize": 0, "is_kernel": True},
        
        # System daemons under systemd (PID 1)
        {"pid": 284, "ppid": 1, "name": "systemd-journald", "state": "S", "threads": 1, "rss": 22400000, "vsize": 180000000, "is_kernel": False},
        {"pid": 312, "ppid": 1, "name": "systemd-udevd", "state": "S", "threads": 1, "rss": 12800000, "vsize": 94000000, "is_kernel": False},
        {"pid": 450, "ppid": 1, "name": "systemd-oomd", "state": "S", "threads": 1, "rss": 5400000, "vsize": 24000000, "is_kernel": False},
        {"pid": 480, "ppid": 1, "name": "systemd-resolved", "state": "S", "threads": 1, "rss": 18200000, "vsize": 48000000, "is_kernel": False},
        {"pid": 520, "ppid": 1, "name": "systemd-timesyncd", "state": "S", "threads": 1, "rss": 7200000, "vsize": 32000000, "is_kernel": False},
        {"pid": 604, "ppid": 1, "name": "cron", "state": "S", "threads": 1, "rss": 3800000, "vsize": 18000000, "is_kernel": False},
        {"pid": 612, "ppid": 1, "name": "dbus-daemon", "state": "S", "threads": 1, "rss": 8900000, "vsize": 52000000, "is_kernel": False},
        {"pid": 670, "ppid": 1, "name": "networkd-dispatcher", "state": "S", "threads": 2, "rss": 14900000, "vsize": 78000000, "is_kernel": False},
        {"pid": 710, "ppid": 1, "name": "rsyslogd", "state": "S", "threads": 4, "rss": 9800000, "vsize": 260000000, "is_kernel": False},
        {"pid": 745, "ppid": 1, "name": "sshd", "state": "S", "threads": 1, "rss": 7100000, "vsize": 44000000, "is_kernel": False},
        {"pid": 820, "ppid": 1, "name": "dockerd", "state": "S", "threads": 14, "rss": 84500000, "vsize": 1420000000, "is_kernel": False},
        {"pid": 890, "ppid": 820, "name": "containerd", "state": "S", "threads": 22, "rss": 62000000, "vsize": 1250000000, "is_kernel": False},
        {"pid": 1102, "ppid": 890, "name": "containerd-shim", "state": "S", "threads": 8, "rss": 11200000, "vsize": 715000000, "is_kernel": False},
        {"pid": 1125, "ppid": 1102, "name": "nginx", "state": "S", "threads": 1, "rss": 8400000, "vsize": 58000000, "is_kernel": False},
        {"pid": 1126, "ppid": 1125, "name": "nginx-worker", "state": "R" if t % 2 == 0 else "S", "threads": 1, "rss": 14500000, "vsize": 62000000, "is_kernel": False},
        {"pid": 1127, "ppid": 1125, "name": "nginx-worker", "state": "S", "threads": 1, "rss": 14200000, "vsize": 62000000, "is_kernel": False},
        
        # Desktop session tree
        {"pid": 980, "ppid": 1, "name": "gdm3", "state": "S", "threads": 3, "rss": 21000000, "vsize": 180000000, "is_kernel": False},
        {"pid": 1210, "ppid": 980, "name": "gnome-session-b", "state": "S", "threads": 4, "rss": 38000000, "vsize": 390000000, "is_kernel": False},
        {"pid": 1340, "ppid": 1210, "name": "gnome-shell", "state": "R" if t % 3 == 0 else "S", "threads": 16, "rss": 284000000, "vsize": 2800000000, "is_kernel": False},
        {"pid": 1410, "ppid": 1340, "name": "pipewire", "state": "S", "threads": 2, "rss": 12400000, "vsize": 150000000, "is_kernel": False},
        {"pid": 1420, "ppid": 1340, "name": "wireplumber", "state": "S", "threads": 4, "rss": 19600000, "vsize": 220000000, "is_kernel": False},
        {"pid": 1560, "ppid": 1210, "name": "gnome-terminal-", "state": "S", "threads": 5, "rss": 42000000, "vsize": 420000000, "is_kernel": False},
        {"pid": 1585, "ppid": 1560, "name": "bash", "state": "S", "threads": 1, "rss": 6800000, "vsize": 24000000, "is_kernel": False},
        {"pid": 1820, "ppid": 1585, "name": "ptree", "state": "R", "threads": 1, "rss": 4200000, "vsize": 18000000, "is_kernel": False},
        
        # Developer toolchain (e.g., Code / Node / Chrome / GCC)
        {"pid": 2040, "ppid": 1210, "name": "code", "state": "S", "threads": 32, "rss": 184000000, "vsize": 1240000000, "is_kernel": False},
        {"pid": 2088, "ppid": 2040, "name": "code-helper", "state": "S", "threads": 12, "rss": 92000000, "vsize": 840000000, "is_kernel": False},
        {"pid": 2150, "ppid": 2040, "name": "node", "state": "R" if (t % 2 == 1) else "S", "threads": 10, "rss": 115000000, "vsize": 950000000, "is_kernel": False},
        {"pid": 2230, "ppid": 2040, "name": "clangd", "state": "S", "threads": 8, "rss": 140000000, "vsize": 650000000, "is_kernel": False},
        
        # Web Browser with multi-process sandboxing
        {"pid": 2450, "ppid": 1210, "name": "google-chrome", "state": "S", "threads": 38, "rss": 210000000, "vsize": 2400000000, "is_kernel": False},
        {"pid": 2480, "ppid": 2450, "name": "chrome-gpu", "state": "S", "threads": 8, "rss": 88000000, "vsize": 810000000, "is_kernel": False},
        {"pid": 2510, "ppid": 2450, "name": "chrome-render", "state": "R" if t % 4 == 0 else "S", "threads": 14, "rss": 145000000, "vsize": 1100000000, "is_kernel": False},
        {"pid": 2525, "ppid": 2450, "name": "chrome-render", "state": "S", "threads": 12, "rss": 128000000, "vsize": 980000000, "is_kernel": False},
        {"pid": 2530, "ppid": 2450, "name": "chrome-utility", "state": "S", "threads": 6, "rss": 34000000, "vsize": 420000000, "is_kernel": False},
        
        # Database service
        {"pid": 2800, "ppid": 1, "name": "postgres", "state": "S", "threads": 1, "rss": 48000000, "vsize": 380000000, "is_kernel": False},
        {"pid": 2815, "ppid": 2800, "name": "postgres-checkp", "state": "S", "threads": 1, "rss": 18000000, "vsize": 380000000, "is_kernel": False},
        {"pid": 2816, "ppid": 2800, "name": "postgres-writer", "state": "S", "threads": 1, "rss": 24000000, "vsize": 380000000, "is_kernel": False},
        {"pid": 2817, "ppid": 2800, "name": "postgres-wal", "state": "S", "threads": 1, "rss": 22000000, "vsize": 380000000, "is_kernel": False},
        {"pid": 2820, "ppid": 2800, "name": "postgres-worker", "state": "R" if t % 2 == 0 else "S", "threads": 1, "rss": 32000000, "vsize": 382000000, "is_kernel": False},

        # Stopped process (State T) to test state visualization
        {"pid": 3104, "ppid": 1585, "name": "vi", "state": "T", "threads": 1, "rss": 5800000, "vsize": 19000000, "is_kernel": False},
        
        # Authentic Zombie process (State Z)
        {"pid": 3310, "ppid": 1585, "name": "bad_fork_app", "state": "S", "threads": 1, "rss": 3200000, "vsize": 12000000, "is_kernel": False},
        {"pid": 3311, "ppid": 3310, "name": "defunct_worker", "state": "Z", "threads": 0, "rss": 0, "vsize": 0, "is_kernel": False},
    ]

    # Include any dynamically spawned demo zombies
    for z in DEMO_ZOMBIES:
        procs.append(z)

    procs.sort(key=lambda p: p["pid"])
    return procs

def build_process_tree(processes, show_kernel=False):
    """
    Constructs a parent-child tree structure from the flat process list.
    Mirrors ptree.c logic for root detection and kernel thread filtering.
    """
    proc_map = {p["pid"]: dict(p) for p in processes}
    
    # Filter kernel threads if show_kernel is False
    if not show_kernel:
        filtered_map = {}
        for pid, p in proc_map.items():
            if p.get("is_kernel") or pid == 2 or p.get("ppid") == 2:
                continue
            filtered_map[pid] = p
        proc_map = filtered_map

    for p in proc_map.values():
        p["children"] = []

    roots = []
    for pid, p in proc_map.items():
        ppid = p.get("ppid", 0)
        # Root is a process whose parent is <= 0 or missing from map (like PID 1)
        if ppid <= 0 or ppid not in proc_map:
            roots.append(p)
        else:
            proc_map[ppid]["children"].append(p)

    # Sort children by PID
    def sort_children(node):
        node["children"].sort(key=lambda x: x["pid"])
        for child in node["children"]:
            sort_children(child)
    
    for r in roots:
        sort_children(r)

    roots.sort(key=lambda x: x["pid"])
    return roots

def calculate_tree_depth(nodes, current_depth=1):
    if not nodes:
        return 0
    max_d = current_depth
    for node in nodes:
        children = node.get("children", [])
        if children:
            d = calculate_tree_depth(children, current_depth + 1)
            if d > max_d:
                max_d = d
    return max_d

def get_telemetry_snapshot(mode="auto", show_kernel=False):
    """Returns a full snapshot containing process list, tree, and metrics."""
    global SIMULATION_MODE
    
    if mode == "simulation":
        raw_procs = get_simulated_linux_tree()
        active_mode = "simulated_linux"
    elif mode == "host":
        raw_procs = scan_host_processes()
        active_mode = "host"
    else: # auto
        if os.path.exists("/proc/1/stat"):
            raw_procs = scan_real_linux_proc()
            active_mode = "linux_proc"
        else:
            raw_procs = get_simulated_linux_tree()
            active_mode = "simulated_linux"

    running = sum(1 for p in raw_procs if p["state"] == "R")
    stopped = sum(1 for p in raw_procs if p["state"] == "T")
    zombies = sum(1 for p in raw_procs if p["state"] == "Z")
    sleeping = sum(1 for p in raw_procs if p["state"] in ["S", "I", "D"])
    kernel_cnt = sum(1 for p in raw_procs if p.get("is_kernel") or p["pid"] == 2 or p["ppid"] == 2)

    tree = build_process_tree(raw_procs, show_kernel=show_kernel)
    max_depth = calculate_tree_depth(tree)

    return {
        "timestamp": time.time(),
        "mode": active_mode,
        "os": platform.system() + " " + platform.release(),
        "total": len(raw_procs),
        "running": running,
        "stopped": stopped,
        "zombies": zombies,
        "sleeping": sleeping,
        "kernel_threads": kernel_cnt,
        "show_kernel": show_kernel,
        "max_depth": max_depth,
        "processes": raw_procs,
        "tree": tree
    }

class ProcessTreeRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS for local dev
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/processes":
            mode = query.get("mode", ["auto"])[0]
            show_kernel = query.get("all", ["0"])[0] in ["1", "true"]
            snapshot = get_telemetry_snapshot(mode=mode, show_kernel=show_kernel)
            
            data = json.dumps(snapshot).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        elif path == "/api/events":
            # Server-Sent Events (SSE) for live streaming
            mode = query.get("mode", ["auto"])[0]
            show_kernel = query.get("all", ["0"])[0] in ["1", "true"]
            interval = float(query.get("interval", [str(CURRENT_REFRESH_INTERVAL)])[0])

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            try:
                while True:
                    snapshot = get_telemetry_snapshot(mode=mode, show_kernel=show_kernel)
                    payload = f"data: {json.dumps(snapshot)}\n\n"
                    self.wfile.write(payload.encode("utf-8"))
                    self.wfile.flush()
                    time.sleep(interval)
            except (BrokenPipeError, ConnectionResetError):
                return

        elif path == "/api/status":
            info = {
                "server": "Linux Process Tree Visualizer Telemetry Server",
                "version": "2.0.0",
                "os": platform.system(),
                "proc_available": os.path.exists("/proc"),
                "refresh_seconds": CURRENT_REFRESH_INTERVAL
            }
            data = json.dumps(info).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # Default static file handling
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"
        
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}

        if path == "/api/signal":
            pid = payload.get("pid")
            sig_name = payload.get("signal", "SIGTERM")
            
            # If in simulation or simulated process
            sim_pids = [p["pid"] for p in get_simulated_linux_tree()]
            if pid in sim_pids:
                # Handle simulation signal
                res = {"status": "success", "message": f"Signal {sig_name} delivered to simulated process {pid}"}
            else:
                # Real process signal
                try:
                    sig_num = getattr(signal, sig_name, signal.SIGTERM)
                    os.kill(pid, sig_num)
                    res = {"status": "success", "message": f"Signal {sig_name} sent to PID {pid}"}
                except Exception as e:
                    res = {"status": "error", "message": str(e)}

            data = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        elif path == "/api/spawn-demo-zombie":
            # Adds a demo zombie to the simulated list
            new_z_pid = 4000 + len(DEMO_ZOMBIES) * 10
            DEMO_ZOMBIES.append({
                "pid": new_z_pid,
                "ppid": 1585,
                "name": f"zombie_leak_{len(DEMO_ZOMBIES)+1}",
                "state": "Z",
                "threads": 0,
                "rss": 0,
                "vsize": 0,
                "is_kernel": False
            })
            res = {"status": "created", "pid": new_z_pid}
            data = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        elif path == "/api/cleanup-demo-zombie":
            DEMO_ZOMBIES.clear()
            res = {"status": "cleared"}
            data = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        self.send_response(404)
        self.end_headers()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    print("=" * 60)
    print("       LINUX PROCESS TREE VISUALIZER - BACKEND SERVER")
    print("=" * 60)
    print(f"Platform       : {platform.system()} {platform.release()}")
    print(f"Linux /proc    : {'Available (Direct /proc inspection)' if os.path.exists('/proc/1/stat') else 'Not mounted (Simulation + Host fallback active)'}")
    print(f"Web Dashboard  : http://{HOST}:{PORT}")
    print(f"API Endpoint   : http://{HOST}:{PORT}/api/processes")
    print(f"SSE Live Stream: http://{HOST}:{PORT}/api/events")
    print("=" * 60)

    server = ThreadedHTTPServer((HOST, PORT), ProcessTreeRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.shutdown()

if __name__ == "__main__":
    main()
