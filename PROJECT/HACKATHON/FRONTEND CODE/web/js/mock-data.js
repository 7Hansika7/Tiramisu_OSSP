/**
 * Linux Process Tree Visualizer - Standalone Fallback & Simulation Generator
 * Provides realistic Linux process trees (Ubuntu 24.04 LTS /proc format)
 * with systemd (PID 1), kthreadd (PID 2), daemons, developer tools, and zombies.
 */

window.LinuxProcessMock = (function() {
  let tick = 0;
  let dynamicZombies = [];

  function generateProcesses() {
    tick++;
    const t = tick;

    const base = [
      { pid: 1, ppid: 0, name: "systemd", state: "S", threads: 1, rss: 14200000, vsize: 168000000, is_kernel: false },
      { pid: 2, ppid: 0, name: "kthreadd", state: "S", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      
      // Kernel Threads (under kthreadd PID 2)
      { pid: 3, ppid: 2, name: "rcu_gp", state: "I", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 4, ppid: 2, name: "rcu_par_gp", state: "I", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 9, ppid: 2, name: "kworker/0:0H", state: "I", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 10, ppid: 2, name: "ksoftirqd/0", state: "S", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 11, ppid: 2, name: "kworker/u16:0", state: "I", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 12, ppid: 2, name: "migration/0", state: "S", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 13, ppid: 2, name: "cpuhp/0", state: "S", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 14, ppid: 2, name: "kdevtmpfs", state: "S", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      { pid: 15, ppid: 2, name: "netns", state: "I", threads: 1, rss: 0, vsize: 0, is_kernel: true },
      
      // System Daemons (under systemd PID 1)
      { pid: 284, ppid: 1, name: "systemd-journald", state: "S", threads: 1, rss: 22400000, vsize: 180000000, is_kernel: false },
      { pid: 312, ppid: 1, name: "systemd-udevd", state: "S", threads: 1, rss: 12800000, vsize: 94000000, is_kernel: false },
      { pid: 450, ppid: 1, name: "systemd-oomd", state: "S", threads: 1, rss: 5400000, vsize: 24000000, is_kernel: false },
      { pid: 480, ppid: 1, name: "systemd-resolved", state: "S", threads: 1, rss: 18200000, vsize: 48000000, is_kernel: false },
      { pid: 520, ppid: 1, name: "systemd-timesyncd", state: "S", threads: 1, rss: 7200000, vsize: 32000000, is_kernel: false },
      { pid: 604, ppid: 1, name: "cron", state: "S", threads: 1, rss: 3800000, vsize: 18000000, is_kernel: false },
      { pid: 612, ppid: 1, name: "dbus-daemon", state: "S", threads: 1, rss: 8900000, vsize: 52000000, is_kernel: false },
      { pid: 670, ppid: 1, name: "networkd-dispatcher", state: "S", threads: 2, rss: 14900000, vsize: 78000000, is_kernel: false },
      { pid: 710, ppid: 1, name: "rsyslogd", state: "S", threads: 4, rss: 9800000, vsize: 260000000, is_kernel: false },
      { pid: 745, ppid: 1, name: "sshd", state: "S", threads: 1, rss: 7100000, vsize: 44000000, is_kernel: false },
      
      // Containers subtree
      { pid: 820, ppid: 1, name: "dockerd", state: "S", threads: 14, rss: 84500000, vsize: 1420000000, is_kernel: false },
      { pid: 890, ppid: 820, name: "containerd", state: "S", threads: 22, rss: 62000000, vsize: 1250000000, is_kernel: false },
      { pid: 1102, ppid: 890, name: "containerd-shim", state: "S", threads: 8, rss: 11200000, vsize: 715000000, is_kernel: false },
      { pid: 1125, ppid: 1102, name: "nginx", state: "S", threads: 1, rss: 8400000, vsize: 58000000, is_kernel: false },
      { pid: 1126, ppid: 1125, name: "nginx-worker", state: (t % 2 === 0 ? "R" : "S"), threads: 1, rss: 14500000, vsize: 62000000, is_kernel: false },
      { pid: 1127, ppid: 1125, name: "nginx-worker", state: "S", threads: 1, rss: 14200000, vsize: 62000000, is_kernel: false },

      // Desktop Environment subtree
      { pid: 980, ppid: 1, name: "gdm3", state: "S", threads: 3, rss: 21000000, vsize: 180000000, is_kernel: false },
      { pid: 1210, ppid: 980, name: "gnome-session-b", state: "S", threads: 4, rss: 38000000, vsize: 390000000, is_kernel: false },
      { pid: 1340, ppid: 1210, name: "gnome-shell", state: (t % 3 === 0 ? "R" : "S"), threads: 16, rss: 284000000, vsize: 2800000000, is_kernel: false },
      { pid: 1410, ppid: 1340, name: "pipewire", state: "S", threads: 2, rss: 12400000, vsize: 150000000, is_kernel: false },
      { pid: 1420, ppid: 1340, name: "wireplumber", state: "S", threads: 4, rss: 19600000, vsize: 220000000, is_kernel: false },
      { pid: 1560, ppid: 1210, name: "gnome-terminal-", state: "S", threads: 5, rss: 42000000, vsize: 420000000, is_kernel: false },
      { pid: 1585, ppid: 1560, name: "bash", state: "S", threads: 1, rss: 6800000, vsize: 24000000, is_kernel: false },
      { pid: 1820, ppid: 1585, name: "ptree", state: "R", threads: 1, rss: 4200000, vsize: 18000000, is_kernel: false },

      // Developer Tools
      { pid: 2040, ppid: 1210, name: "code", state: "S", threads: 32, rss: 184000000, vsize: 1240000000, is_kernel: false },
      { pid: 2088, ppid: 2040, name: "code-helper", state: "S", threads: 12, rss: 92000000, vsize: 840000000, is_kernel: false },
      { pid: 2150, ppid: 2040, name: "node", state: (t % 2 === 1 ? "R" : "S"), threads: 10, rss: 115000000, vsize: 950000000, is_kernel: false },
      { pid: 2230, ppid: 2040, name: "clangd", state: "S", threads: 8, rss: 140000000, vsize: 650000000, is_kernel: false },

      // Chrome Browser Processes
      { pid: 2450, ppid: 1210, name: "google-chrome", state: "S", threads: 38, rss: 210000000, vsize: 2400000000, is_kernel: false },
      { pid: 2480, ppid: 2450, name: "chrome-gpu", state: "S", threads: 8, rss: 88000000, vsize: 810000000, is_kernel: false },
      { pid: 2510, ppid: 2450, name: "chrome-render", state: (t % 4 === 0 ? "R" : "S"), threads: 14, rss: 145000000, vsize: 1100000000, is_kernel: false },
      { pid: 2525, ppid: 2450, name: "chrome-render", state: "S", threads: 12, rss: 128000000, vsize: 980000000, is_kernel: false },
      { pid: 2530, ppid: 2450, name: "chrome-utility", state: "S", threads: 6, rss: 34000000, vsize: 420000000, is_kernel: false },

      // PostgreSQL database server
      { pid: 2800, ppid: 1, name: "postgres", state: "S", threads: 1, rss: 48000000, vsize: 380000000, is_kernel: false },
      { pid: 2815, ppid: 2800, name: "postgres-checkp", state: "S", threads: 1, rss: 18000000, vsize: 380000000, is_kernel: false },
      { pid: 2816, ppid: 2800, name: "postgres-writer", state: "S", threads: 1, rss: 24000000, vsize: 380000000, is_kernel: false },
      { pid: 2817, ppid: 2800, name: "postgres-wal", state: "S", threads: 1, rss: 22000000, vsize: 380000000, is_kernel: false },
      { pid: 2820, ppid: 2800, name: "postgres-worker", state: (t % 2 === 0 ? "R" : "S"), threads: 1, rss: 32000000, vsize: 382000000, is_kernel: false },

      // Stopped Process (State T)
      { pid: 3104, ppid: 1585, name: "vi", state: "T", threads: 1, rss: 5800000, vsize: 19000000, is_kernel: false },

      // Zombie Process (State Z)
      { pid: 3310, ppid: 1585, name: "bad_fork_app", state: "S", threads: 1, rss: 3200000, vsize: 12000000, is_kernel: false },
      { pid: 3311, ppid: 3310, name: "defunct_worker", state: "Z", threads: 0, rss: 0, vsize: 0, is_kernel: false }
    ];

    return [...base, ...dynamicZombies].sort((a, b) => a.pid - b.pid);
  }

  function buildTree(processes, showKernel = false) {
    const procMap = {};
    for (const p of processes) {
      if (!showKernel && (p.is_kernel || p.pid === 2 || p.ppid === 2)) {
        continue;
      }
      procMap[p.pid] = { ...p, children: [] };
    }

    const roots = [];
    for (const pid in procMap) {
      const p = procMap[pid];
      if (p.ppid <= 0 || !procMap[p.ppid]) {
        roots.push(p);
      } else {
        procMap[p.ppid].children.push(p);
      }
    }

    function sortChildren(node) {
      node.children.sort((a, b) => a.pid - b.pid);
      for (const child of node.children) {
        sortChildren(child);
      }
    }

    for (const r of roots) {
      sortChildren(r);
    }

    return roots.sort((a, b) => a.pid - b.pid);
  }

  function getSnapshot(showKernel = false) {
    const procs = generateProcesses();
    const tree = buildTree(procs, showKernel);
    
    let running = 0, stopped = 0, zombies = 0, sleeping = 0, kernelCount = 0;
    for (const p of procs) {
      if (p.state === "R") running++;
      else if (p.state === "T") stopped++;
      else if (p.state === "Z") zombies++;
      else sleeping++;

      if (p.is_kernel || p.pid === 2 || p.ppid === 2) kernelCount++;
    }

    return {
      timestamp: Date.now() / 1000,
      mode: "simulated_linux",
      os: "Ubuntu 24.04 LTS (x86_64)",
      total: procs.length,
      running,
      stopped,
      zombies,
      sleeping,
      kernel_threads: kernelCount,
      show_kernel: showKernel,
      processes: procs,
      tree
    };
  }

  function spawnZombie() {
    const newPid = 4000 + (dynamicZombies.length + 1) * 10;
    dynamicZombies.push({
      pid: newPid,
      ppid: 1585,
      name: `zombie_leak_${dynamicZombies.length + 1}`,
      state: "Z",
      threads: 0,
      rss: 0,
      vsize: 0,
      is_kernel: false
    });
    return newPid;
  }

  function clearZombies() {
    dynamicZombies = [];
  }

  return {
    getSnapshot,
    spawnZombie,
    clearZombies
  };
})();
