/*
 * Linux Process Tree Visualizer - JSON & Tree Exporter
 * ---------------------------------------------------
 * Extends the core ptree.c implementation to output formatted JSON
 * for frontend dashboards and web interfaces.
 */

#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <dirent.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_PROCESSES   20000
#define NAME_SIZE       256

typedef struct {
    int  pid;
    int  ppid;
    char name[NAME_SIZE];
    char state;
    long utime;
    long stime;
    long rss;
    long vsize;
    int  num_threads;
    bool printed;
} Process;

static Process processes[MAX_PROCESSES];
static int process_count = 0;
static bool show_kernel = false;

static int compare_processes(const void *a, const void *b)
{
    const Process *x = a;
    const Process *y = b;
    if (x->pid < y->pid) return -1;
    if (x->pid > y->pid) return 1;
    return 0;
}

static void escape_json_string(const char *src, char *dest, size_t dest_size)
{
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0' && j + 2 < dest_size; i++) {
        if (src[i] == '"' || src[i] == '\\') {
            dest[j++] = '\\';
            dest[j++] = src[i];
        } else if (src[i] == '\n') {
            dest[j++] = '\\';
            dest[j++] = 'n';
        } else if (src[i] == '\t') {
            dest[j++] = '\\';
            dest[j++] = 't';
        } else if ((unsigned char)src[i] >= 32 && (unsigned char)src[i] < 127) {
            dest[j++] = src[i];
        }
    }
    dest[j] = '\0';
}

static bool read_process(const char *directory_name, Process *p)
{
    char path[64];
    char buffer[4096];

    snprintf(path, sizeof(path), "/proc/%s/stat", directory_name);

    FILE *file = fopen(path, "r");
    if (file == NULL)
        return false;

    if (fgets(buffer, sizeof(buffer), file) == NULL) {
        fclose(file);
        return false;
    }
    fclose(file);

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

    p->pid = (int)pid;
    p->printed = false;
    p->utime = 0;
    p->stime = 0;
    p->rss = 0;
    p->vsize = 0;
    p->num_threads = 1;

    /* Parse state, ppid and additional fields from stat */
    int parsed = sscanf(right + 1, " %c %d %*d %*d %*d %*d %*u %*u %*u %*u %*u %ld %ld %*d %*d %*d %*d %d %*d %*u %ld %ld",
                        &p->state, &p->ppid, &p->utime, &p->stime, &p->num_threads, &p->vsize, &p->rss);

    if (parsed < 2)
        return false;

    return true;
}

static void scan_processes(void)
{
    process_count = 0;

    DIR *proc = opendir("/proc");
    if (proc == NULL) {
        return;
    }

    struct dirent *entry;
    while ((entry = readdir(proc)) != NULL) {
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

        if (!show_kernel && (p.pid == 2 || p.ppid == 2))
            continue;

        processes[process_count++] = p;
    }

    closedir(proc);
    qsort(processes, process_count, sizeof(Process), compare_processes);
}

static void print_node_json(int index, bool is_first)
{
    char safe_name[NAME_SIZE * 2];
    escape_json_string(processes[index].name, safe_name, sizeof(safe_name));

    if (!is_first) printf(",\n");

    printf("    {\n");
    printf("      \"pid\": %d,\n", processes[index].pid);
    printf("      \"ppid\": %d,\n", processes[index].ppid);
    printf("      \"name\": \"%s\",\n", safe_name);
    printf("      \"state\": \"%c\",\n", processes[index].state);
    printf("      \"threads\": %d,\n", processes[index].num_threads);
    printf("      \"vsize\": %ld,\n", processes[index].vsize);
    printf("      \"rss\": %ld,\n", processes[index].rss);
    printf("      \"is_kernel\": %s\n", (processes[index].pid == 2 || processes[index].ppid == 2) ? "true" : "false");
    printf("    }");
}

int main(int argc, char **argv)
{
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--all") == 0) {
            show_kernel = true;
        }
    }

    scan_processes();

    int running_cnt = 0, stopped_cnt = 0, zombie_cnt = 0, sleeping_cnt = 0;
    for (int i = 0; i < process_count; i++) {
        if (processes[i].state == 'R') running_cnt++;
        else if (processes[i].state == 'T') stopped_cnt++;
        else if (processes[i].state == 'Z') zombie_cnt++;
        else sleeping_cnt++;
    }

    printf("{\n");
    printf("  \"timestamp\": %ld,\n", (long)time(NULL));
    printf("  \"total\": %d,\n", process_count);
    printf("  \"running\": %d,\n", running_cnt);
    printf("  \"stopped\": %d,\n", stopped_cnt);
    printf("  \"zombies\": %d,\n", zombie_cnt);
    printf("  \"sleeping\": %d,\n", sleeping_cnt);
    printf("  \"processes\": [\n");

    for (int i = 0; i < process_count; i++) {
        print_node_json(i, i == 0);
    }

    printf("\n  ]\n");
    printf("}\n");

    return 0;
}
