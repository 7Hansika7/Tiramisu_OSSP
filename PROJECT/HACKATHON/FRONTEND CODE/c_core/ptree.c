/*
 * Linux Process Tree Visualizer
 * -----------------------------
 * Reads /proc, builds the parent-child hierarchy of running processes
 * and displays it as a colored tree that refreshes in real time.
 *
 * Compile : gcc -Wall -Wextra -O2 -o ptree ptree.c
 * Run     : ./ptree            live view (kernel threads hidden)
 *           ./ptree --all      include kernel threads
 *           ./ptree --once     print one snapshot and exit
 *           ./ptree --help     show usage
 */

#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <dirent.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_PROCESSES   20000
#define NAME_SIZE       256
#define REFRESH_SECONDS 3

#define COLOR_RESET  "\033[0m"
#define COLOR_GREEN  "\033[32m"
#define COLOR_YELLOW "\033[33m"
#define COLOR_RED    "\033[31m"

typedef struct {
    int  pid;
    int  ppid;
    char name[NAME_SIZE];
    char state;
    bool printed;
} Process;

static Process processes[MAX_PROCESSES];
static int process_count = 0;

static volatile sig_atomic_t running = 1;
static bool once = false;         /* --once : single snapshot */
static bool show_kernel = false;  /* --all  : include kernel threads */

/* ---------- signal handling (Ctrl+C / kill) ---------- */

static void handle_signal(int signal_number)
{
    (void)signal_number;
    running = 0;
}

/* ---------- helpers ---------- */

static int compare_processes(const void *a, const void *b)
{
    const Process *x = a;
    const Process *y = b;

    if (x->pid < y->pid) return -1;
    if (x->pid > y->pid) return 1;
    return 0;
}

static int find_process(int pid)
{
    for (int i = 0; i < process_count; i++) {
        if (processes[i].pid == pid)
            return i;
    }
    return -1;
}

/* R = green, T = yellow (stopped), Z = red (zombie) */
static const char *state_color(char state)
{
    switch (state) {
        case 'R': return COLOR_GREEN;
        case 'T': return COLOR_YELLOW;
        case 'Z': return COLOR_RED;
        default:  return COLOR_RESET;
    }
}

static void print_process(const Process *p)
{
    printf("%s (PID: %d, PPID: %d, State: %s%c%s)\n",
           p->name, p->pid, p->ppid,
           state_color(p->state), p->state, COLOR_RESET);
}

/* ---------- reading /proc ---------- */

/* Parse /proc/<pid>/stat -> name, state, ppid */
static bool read_process(const char *directory_name, Process *p)
{
    char path[64];
    char buffer[4096];

    snprintf(path, sizeof(path), "/proc/%s/stat", directory_name);

    FILE *file = fopen(path, "r");
    if (file == NULL)
        return false;   /* process may have exited meanwhile */

    if (fgets(buffer, sizeof(buffer), file) == NULL) {
        fclose(file);
        return false;
    }
    fclose(file);

    /* Name is inside ( ) and may itself contain brackets,
       so use the FIRST '(' and the LAST ')'. */
    char *left  = strchr(buffer, '(');
    char *right = strrchr(buffer, ')');

    if (left == NULL || right == NULL || right <= left)
        return false;

    long pid = strtol(directory_name, NULL, 10);
    if (pid <= 0 || pid > 2147483647L)
        return false;

    size_t length = (size_t)(right - left - 1);
    if (length >= sizeof(p->name))
        length = sizeof(p->name) - 1;

    memcpy(p->name, left + 1, length);
    p->name[length] = '\0';

    if (sscanf(right + 1, " %c %d", &p->state, &p->ppid) != 2)
        return false;

    p->pid = (int)pid;
    p->printed = false;
    return true;
}

static void scan_processes(void)
{
    process_count = 0;

    DIR *proc = opendir("/proc");
    if (proc == NULL) {
        perror("Cannot open /proc");
        return;
    }

    struct dirent *entry;

    while ((entry = readdir(proc)) != NULL) {
        /* only folders whose whole name is a number are processes */
        bool numeric = isdigit((unsigned char)entry->d_name[0]);
        for (const char *s = entry->d_name; numeric && *s; s++) {
            if (!isdigit((unsigned char)*s))
                numeric = false;
        }

        if (!numeric || process_count >= MAX_PROCESSES)
            continue;

        Process p;
        if (!read_process(entry->d_name, &p))
            continue;

        /* hide kernel threads (kthreadd = PID 2 and its children) */
        if (!show_kernel && (p.pid == 2 || p.ppid == 2))
            continue;

        processes[process_count++] = p;
    }

    closedir(proc);

    qsort(processes, process_count, sizeof(Process), compare_processes);
}

/* ---------- tree printing ---------- */

static int count_children(int pid)
{
    int count = 0;

    for (int i = 0; i < process_count; i++) {
        if (processes[i].ppid == pid && !processes[i].printed)
            count++;
    }

    return count;
}

static void print_node(int index, const char *prefix,
                       bool is_last, bool is_root, int depth)
{
    if (depth > 1000 || processes[index].printed)
        return;

    processes[index].printed = true;

    if (is_root) {
        print_process(&processes[index]);
    } else {
        printf("%s%s ", prefix,
               is_last ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500");
        print_process(&processes[index]);
    }

    int remaining = count_children(processes[index].pid);

    char next_prefix[4096];

    if (is_root) {
        next_prefix[0] = '\0';
    } else {
        snprintf(next_prefix, sizeof(next_prefix), "%s%s", prefix,
                 is_last ? "    " : "\u2502   ");
    }

    for (int i = 0; i < process_count; i++) {
        if (processes[i].ppid != processes[index].pid ||
            processes[i].printed)
            continue;

        remaining--;
        print_node(i, next_prefix, remaining == 0, false, depth + 1);
    }
}

static void display_tree(void)
{
    int zombies = 0, stopped = 0, running_count = 0;

    for (int i = 0; i < process_count; i++) {
        if (processes[i].state == 'Z') zombies++;
        if (processes[i].state == 'T') stopped++;
        if (processes[i].state == 'R') running_count++;
    }

    if (!once)
        printf("\033[2J\033[H");   /* clear screen */

    printf("============================================\n");
    printf("       LINUX PROCESS TREE VISUALIZER\n");
    printf("============================================\n");
    if (once)
        printf("Mode             : single snapshot\n");
    else
        printf("Refresh interval : %d seconds\n", REFRESH_SECONDS);
    printf("Kernel threads   : %s\n", show_kernel ? "shown" : "hidden (use --all)");
    printf("Processes found  : %d\n", process_count);
    printf("Running: %d | Stopped: %d | Zombies: %d\n",
           running_count, stopped, zombies);
    printf("Legend: %sR=running%s  %sT=stopped%s  %sZ=zombie%s\n",
           COLOR_GREEN, COLOR_RESET,
           COLOR_YELLOW, COLOR_RESET,
           COLOR_RED, COLOR_RESET);
    printf("============================================\n\n");

    /* roots = processes whose parent is missing (e.g. PID 1) */
    for (int i = 0; i < process_count; i++) {
        if (processes[i].printed)
            continue;

        if (processes[i].ppid <= 0 || find_process(processes[i].ppid) == -1)
            print_node(i, "", true, true, 0);
    }

    /* safety net: anything left over (should not normally happen) */
    for (int i = 0; i < process_count; i++) {
        if (!processes[i].printed)
            print_node(i, "", true, true, 0);
    }

    if (!once)
        printf("\nPress Ctrl+C to exit.\n");
    fflush(stdout);
}

/* ---------- main ---------- */

static void print_usage(const char *program)
{
    printf("Usage: %s [--all] [--once] [--help]\n", program);
    printf("  --all   include kernel threads\n");
    printf("  --once  print one snapshot and exit\n");
    printf("  --help  show this message\n");
}

int main(int argc, char **argv)
{
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--once") == 0) {
            once = true;
        } else if (strcmp(argv[i], "--all") == 0) {
            show_kernel = true;
        } else if (strcmp(argv[i], "--help") == 0) {
            print_usage(argv[0]);
            return 0;
        } else {
            fprintf(stderr, "Unknown option: %s\n", argv[i]);
            print_usage(argv[0]);
            return 1;
        }
    }

    struct sigaction action = {0};
    action.sa_handler = handle_signal;
    sigemptyset(&action.sa_mask);
    sigaction(SIGINT, &action, NULL);
    sigaction(SIGTERM, &action, NULL);

    while (running) {
        scan_processes();
        display_tree();

        if (once)
            break;

        struct timespec delay = { .tv_sec = REFRESH_SECONDS, .tv_nsec = 0 };

        /* nanosleep returns -1 if interrupted; it resumes with the
           remaining time unless we are asked to stop */
        while (running && nanosleep(&delay, &delay) == -1) {
        }
    }

    if (!once)
        printf("\nProcess Tree Visualizer stopped.\n");
    return 0;
}
