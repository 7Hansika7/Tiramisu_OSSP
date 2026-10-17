CC = gcc
CFLAGS = -Wall -Wextra -O2 -D_POSIX_C_SOURCE=200809L

TARGETS = ptree ptree_json

all: $(TARGETS)

ptree: ptree.c
	$(CC) $(CFLAGS) -o ptree ptree.c

ptree_json: ptree_json.c
	$(CC) $(CFLAGS) -o ptree_json ptree_json.c

clean:
	rm -f $(TARGETS) *.o

.PHONY: all clean
