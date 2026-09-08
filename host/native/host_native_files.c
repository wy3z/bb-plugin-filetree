#define NAPI_VERSION 8
#define _GNU_SOURCE
#define _DARWIN_C_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <node_api.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <sys/param.h>
#include <sys/syslimits.h>
#endif

#ifdef __linux__
#include <sys/syscall.h>
#ifndef __NR_openat2
#define __NR_openat2 437
#endif
#ifndef RESOLVE_NO_MAGICLINKS
#define RESOLVE_NO_MAGICLINKS 0x02u
#endif
#ifndef RESOLVE_NO_SYMLINKS
#define RESOLVE_NO_SYMLINKS 0x04u
#endif
#ifndef RESOLVE_BENEATH
#define RESOLVE_BENEATH 0x08u
#endif
struct bb_open_how {
  uint64_t flags;
  uint64_t mode;
  uint64_t resolve;
};
#endif

extern char **environ;

#define DIR_SLOTS 256
#define GIT_SLOTS 64

typedef struct {
  int used;
  DIR *dir;
} DirSlot;

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  int slot;
  uint64_t generation;
  int dirfd;
  char *file;
  char **argv;
  int argc;
  char **envp;
  int envc;
  int timeout_ms;
  size_t max_bytes;
  atomic_int cancelled;
  atomic_int pid;
  int code;
  unsigned char *stdout_buf;
  size_t stdout_len;
  unsigned char *stderr_buf;
  size_t stderr_len;
  int error_errno;
  char error_msg[160];
  bool failed;
  bool cancelled_result;
} GitRequest;

static DirSlot dir_slots[DIR_SLOTS];
static GitRequest *git_slots[GIT_SLOTS];
static pthread_mutex_t git_lock = PTHREAD_MUTEX_INITIALIZER;
static atomic_uint_fast64_t git_generation = 1;

static const char *errno_code(int err) {
  switch (err) {
    case ENOENT:
      return "ENOENT";
    case ENOTDIR:
      return "ENOTDIR";
    case ELOOP:
      return "ELOOP";
#ifdef EMLINK
    case EMLINK:
      return "EMLINK";
#endif
    case EINVAL:
      return "EINVAL";
    case EACCES:
      return "EACCES";
    case EPERM:
      return "EPERM";
    case EMFILE:
      return "EMFILE";
    case ENFILE:
      return "ENFILE";
    case ENOTSUP:
      return "ENOTSUP";
#ifdef EOPNOTSUPP
#if EOPNOTSUPP != ENOTSUP
    case EOPNOTSUPP:
      return "ENOTSUP";
#endif
#endif
    default:
      return "EIO";
  }
}

static napi_value throw_errno(napi_env env, const char *syscall, int err) {
  char message[256];
  snprintf(message, sizeof(message), "%s: %s", syscall, strerror(err));
  napi_value code_val;
  napi_value message_val;
  napi_value error;
  napi_create_string_utf8(env, errno_code(err), NAPI_AUTO_LENGTH, &code_val);
  napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &message_val);
  napi_create_error(env, code_val, message_val, &error);
  napi_set_named_property(env, error, "code", code_val);
  napi_throw(env, error);
  return NULL;
}

static bool valid_component(const char *name) {
  if (name == NULL || name[0] == '\0') return false;
  if (name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0'))) {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)name; *cursor != 0;
       cursor += 1) {
    if (*cursor == '/' || *cursor == '\\') return false;
  }
  return true;
}

static int get_fd_arg(napi_env env, napi_value value, int *fd) {
  int64_t parsed = 0;
  if (napi_get_value_int64(env, value, &parsed) != napi_ok) return -1;
  if (parsed < 0 || parsed > INT32_MAX) {
    throw_errno(env, "fd", EINVAL);
    return -1;
  }
  *fd = (int)parsed;
  return 0;
}

static int dup_cloexec(int fd) {
  int duped = fcntl(fd, F_DUPFD_CLOEXEC, 0);
  if (duped >= 0) return duped;
  duped = dup(fd);
  if (duped < 0) return -1;
  fcntl(duped, F_SETFD, FD_CLOEXEC);
  return duped;
}

static int open_beneath(int dirfd, const char *name, int flags) {
  int open_flags = flags | O_CLOEXEC | O_NOFOLLOW;
#ifdef __linux__
  struct bb_open_how how;
  memset(&how, 0, sizeof(how));
  how.flags = (uint64_t)(unsigned int)open_flags;
  how.resolve = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS;
  int fd = (int)syscall(__NR_openat2, dirfd, name, &how, sizeof(how));
  if (fd >= 0 || (errno != ENOSYS && errno != EINVAL)) return fd;
#endif
  return openat(dirfd, name, open_flags);
}

static int make_pipe(int fds[2]) {
#ifdef __linux__
  return pipe2(fds, O_CLOEXEC);
#else
  if (pipe(fds) != 0) return -1;
  fcntl(fds[0], F_SETFD, FD_CLOEXEC);
  fcntl(fds[1], F_SETFD, FD_CLOEXEC);
  return 0;
#endif
}

static int add_fchdir(posix_spawn_file_actions_t *actions, int dirfd) {
  return posix_spawn_file_actions_addfchdir_np(actions, dirfd);
}

static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 2) {
    napi_throw_type_error(env, NULL, "open(path, flags)");
    return NULL;
  }
  size_t path_len = 0;
  if (napi_get_value_string_utf8(env, args[0], NULL, 0, &path_len) != napi_ok) {
    napi_throw_type_error(env, NULL, "path must be a string");
    return NULL;
  }
  char *path = malloc(path_len + 1);
  if (path == NULL) return throw_errno(env, "open", ENOMEM);
  if (napi_get_value_string_utf8(env, args[0], path, path_len + 1, &path_len) !=
      napi_ok) {
    free(path);
    napi_throw_type_error(env, NULL, "path must be a string");
    return NULL;
  }
  int64_t flags = 0;
  if (napi_get_value_int64(env, args[1], &flags) != napi_ok) {
    free(path);
    napi_throw_type_error(env, NULL, "flags must be a number");
    return NULL;
  }
  int fd = open(path, (int)flags | O_CLOEXEC);
  int err = errno;
  free(path);
  if (fd < 0) return throw_errno(env, "open", err);
  napi_value result;
  napi_create_int32(env, fd, &result);
  return result;
}

static napi_value Openat(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 3) {
    napi_throw_type_error(env, NULL, "openat(dirfd, name, flags)");
    return NULL;
  }
  int dirfd = 0;
  if (get_fd_arg(env, args[0], &dirfd) != 0) return NULL;
  size_t name_len = 0;
  if (napi_get_value_string_utf8(env, args[1], NULL, 0, &name_len) != napi_ok) {
    napi_throw_type_error(env, NULL, "name must be a string");
    return NULL;
  }
  char *name = malloc(name_len + 1);
  if (name == NULL) return throw_errno(env, "openat", ENOMEM);
  if (napi_get_value_string_utf8(env, args[1], name, name_len + 1, &name_len) !=
      napi_ok) {
    free(name);
    napi_throw_type_error(env, NULL, "name must be a string");
    return NULL;
  }
  int64_t flags = 0;
  if (napi_get_value_int64(env, args[2], &flags) != napi_ok) {
    free(name);
    napi_throw_type_error(env, NULL, "flags must be a number");
    return NULL;
  }
  if (!valid_component(name)) {
    free(name);
    return throw_errno(env, "openat", EINVAL);
  }
  int fd = open_beneath(dirfd, name, (int)flags);
  int err = errno;
  free(name);
  if (fd < 0) return throw_errno(env, "openat", err);
  napi_value result;
  napi_create_int32(env, fd, &result);
  return result;
}

static napi_value Dup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "dup(fd)");
    return NULL;
  }
  int fd = 0;
  if (get_fd_arg(env, args[0], &fd) != 0) return NULL;
  int duped = dup_cloexec(fd);
  if (duped < 0) return throw_errno(env, "dup", errno);
  napi_value result;
  napi_create_int32(env, duped, &result);
  return result;
}

static napi_value CloseFd(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "close(fd)");
    return NULL;
  }
  int fd = 0;
  if (get_fd_arg(env, args[0], &fd) != 0) return NULL;
  if (close(fd) != 0) return throw_errno(env, "close", errno);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value CanonicalPath(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "canonicalPath(fd)");
    return NULL;
  }
  int fd = 0;
  if (get_fd_arg(env, args[0], &fd) != 0) return NULL;
#ifdef __APPLE__
  char path[MAXPATHLEN];
  if (fcntl(fd, F_GETPATH, path) != 0) return throw_errno(env, "F_GETPATH", errno);
#else
  char link[64];
  char path[PATH_MAX];
  snprintf(link, sizeof(link), "/proc/self/fd/%d", fd);
  ssize_t length = readlink(link, path, sizeof(path) - 1);
  if (length < 0) return throw_errno(env, "readlink", errno);
  path[length] = '\0';
#endif
  napi_value result;
  napi_create_string_utf8(env, path, NAPI_AUTO_LENGTH, &result);
  return result;
}

static int next_dir_slot(void) {
  for (int index = 0; index < DIR_SLOTS; index += 1) {
    if (!dir_slots[index].used) return index;
  }
  return -1;
}

static napi_value DirOpen(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "dirOpen(fd)");
    return NULL;
  }
  int fd = 0;
  if (get_fd_arg(env, args[0], &fd) != 0) return NULL;
  int slot = next_dir_slot();
  if (slot < 0) return throw_errno(env, "dirOpen", EMFILE);
  int directory_fd = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (directory_fd < 0) return throw_errno(env, "openat", errno);
  DIR *dir = fdopendir(directory_fd);
  if (dir == NULL) {
    int err = errno;
    close(directory_fd);
    return throw_errno(env, "fdopendir", err);
  }
  dir_slots[slot].used = 1;
  dir_slots[slot].dir = dir;
  napi_value result;
  napi_create_int32(env, slot, &result);
  return result;
}

static void fill_dirent_types(int dirfd, struct dirent *entry, bool *is_file,
                              bool *is_directory, bool *is_symlink) {
  *is_file = false;
  *is_directory = false;
  *is_symlink = false;
#ifdef DT_LNK
  if (entry->d_type == DT_LNK) {
    *is_symlink = true;
    return;
  }
  if (entry->d_type == DT_DIR) {
    *is_directory = true;
    return;
  }
  if (entry->d_type == DT_REG) {
    *is_file = true;
    return;
  }
  if (entry->d_type != DT_UNKNOWN) return;
#endif
  struct stat st;
  if (fstatat(dirfd, entry->d_name, &st, AT_SYMLINK_NOFOLLOW) != 0) return;
  if (S_ISLNK(st.st_mode)) {
    *is_symlink = true;
    return;
  }
  if (S_ISDIR(st.st_mode)) {
    *is_directory = true;
    return;
  }
  if (S_ISREG(st.st_mode)) *is_file = true;
}

static napi_value DirRead(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "dirRead(dirId)");
    return NULL;
  }
  int dir_id = 0;
  if (get_fd_arg(env, args[0], &dir_id) != 0) return NULL;
  if (dir_id < 0 || dir_id >= DIR_SLOTS || !dir_slots[dir_id].used ||
      dir_slots[dir_id].dir == NULL) {
    return throw_errno(env, "dirRead", EINVAL);
  }
  DIR *dir = dir_slots[dir_id].dir;
  int directory_fd = dirfd(dir);
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(dir);
    if (entry == NULL) {
      if (errno != 0) return throw_errno(env, "readdir", errno);
      napi_value null_value;
      napi_get_null(env, &null_value);
      return null_value;
    }
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    bool is_file = false;
    bool is_directory = false;
    bool is_symlink = false;
    fill_dirent_types(directory_fd, entry, &is_file, &is_directory, &is_symlink);
    napi_value result;
    napi_value name;
    napi_value is_file_val;
    napi_value is_directory_val;
    napi_value is_symlink_val;
    napi_create_object(env, &result);
    napi_create_string_utf8(env, entry->d_name, NAPI_AUTO_LENGTH, &name);
    napi_get_boolean(env, is_file, &is_file_val);
    napi_get_boolean(env, is_directory, &is_directory_val);
    napi_get_boolean(env, is_symlink, &is_symlink_val);
    napi_set_named_property(env, result, "name", name);
    napi_set_named_property(env, result, "isFile", is_file_val);
    napi_set_named_property(env, result, "isDirectory", is_directory_val);
    napi_set_named_property(env, result, "isSymbolicLink", is_symlink_val);
    return result;
  }
}

static napi_value DirClose(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "dirClose(dirId)");
    return NULL;
  }
  int dir_id = 0;
  if (get_fd_arg(env, args[0], &dir_id) != 0) return NULL;
  if (dir_id < 0 || dir_id >= DIR_SLOTS || !dir_slots[dir_id].used) {
    return throw_errno(env, "dirClose", EINVAL);
  }
  if (dir_slots[dir_id].dir != NULL) closedir(dir_slots[dir_id].dir);
  dir_slots[dir_id].dir = NULL;
  dir_slots[dir_id].used = 0;
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static void free_argv(char **argv, int argc) {
  if (argv == NULL) return;
  for (int index = 0; index < argc; index += 1) free(argv[index]);
  free(argv);
}

static void free_git_request(GitRequest *request) {
  if (request == NULL) return;
  if (request->dirfd >= 0) close(request->dirfd);
  free(request->file);
  free_argv(request->argv, request->argc);
  free_argv(request->envp, request->envc);
  free(request->stdout_buf);
  free(request->stderr_buf);
  free(request);
}

static int is_git_env_pair(const char *pair) {
  return strncmp(pair, "GIT_", 4) == 0;
}

static char **scrub_git_env(char **input, int inputc, int *outc) {
  static const char *fixed[] = {
      "GIT_CONFIG=/dev/null",
      "GIT_CONFIG_GLOBAL=/dev/null",
      "GIT_CONFIG_SYSTEM=/dev/null",
      "GIT_CONFIG_NOSYSTEM=1",
  };
  int fixed_count = (int)(sizeof(fixed) / sizeof(fixed[0]));
  int kept = fixed_count;
  for (int index = 0; index < inputc; index += 1) {
    if (input[index] != NULL && !is_git_env_pair(input[index])) kept += 1;
  }
  char **envp = calloc((size_t)kept + 1, sizeof(char *));
  if (envp == NULL) return NULL;
  int count = 0;
  for (int index = 0; index < fixed_count; index += 1) {
    envp[count] = strdup(fixed[index]);
    if (envp[count] == NULL) {
      free_argv(envp, count);
      return NULL;
    }
    count += 1;
  }
  for (int index = 0; index < inputc; index += 1) {
    if (input[index] == NULL || is_git_env_pair(input[index])) continue;
    envp[count] = strdup(input[index]);
    if (envp[count] == NULL) {
      free_argv(envp, count);
      return NULL;
    }
    count += 1;
  }
  *outc = count;
  return envp;
}

static uint64_t git_token(int slot, uint64_t generation) {
  return (generation << 8) | (uint64_t)(unsigned int)slot;
}

static int git_token_slot(uint64_t token) { return (int)(token & 0xffu); }

static uint64_t git_token_generation(uint64_t token) { return token >> 8; }

static int append_chunk(unsigned char **buffer, size_t *length, const void *data,
                        size_t amount, size_t max_bytes) {
  if (*length + amount > max_bytes) return -1;
  unsigned char *next = realloc(*buffer, *length + amount);
  if (next == NULL) return -1;
  memcpy(next + *length, data, amount);
  *buffer = next;
  *length += amount;
  return 0;
}

static int64_t monotonic_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void git_execute(napi_env env, void *data) {
  (void)env;
  GitRequest *request = data;
  int stdout_pipe[2] = {-1, -1};
  int stderr_pipe[2] = {-1, -1};
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attrs;
  bool actions_inited = false;
  bool attrs_inited = false;
  pid_t spawned = 0;
  if (atomic_load(&request->cancelled)) {
    request->cancelled_result = true;
    return;
  }
  if (make_pipe(stdout_pipe) != 0 || make_pipe(stderr_pipe) != 0) {
    request->failed = true;
    request->error_errno = errno;
    snprintf(request->error_msg, sizeof(request->error_msg), "pipe");
    goto cleanup;
  }
  fcntl(stdout_pipe[0], F_SETFL, O_NONBLOCK);
  fcntl(stderr_pipe[0], F_SETFL, O_NONBLOCK);
  if (posix_spawn_file_actions_init(&actions) != 0) {
    request->failed = true;
    request->error_errno = errno;
    snprintf(request->error_msg, sizeof(request->error_msg), "posix_spawn_file_actions_init");
    goto cleanup;
  }
  actions_inited = true;
  if (posix_spawnattr_init(&attrs) != 0) {
    request->failed = true;
    request->error_errno = errno;
    snprintf(request->error_msg, sizeof(request->error_msg), "posix_spawnattr_init");
    goto cleanup;
  }
  attrs_inited = true;
  posix_spawnattr_setflags(&attrs, POSIX_SPAWN_SETPGROUP);
  posix_spawnattr_setpgroup(&attrs, 0);
  if (posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null",
                                       O_RDONLY, 0) != 0 ||
      posix_spawn_file_actions_adddup2(&actions, stdout_pipe[1],
                                       STDOUT_FILENO) != 0 ||
      posix_spawn_file_actions_adddup2(&actions, stderr_pipe[1],
                                       STDERR_FILENO) != 0 ||
      posix_spawn_file_actions_addclose(&actions, stdout_pipe[0]) != 0 ||
      posix_spawn_file_actions_addclose(&actions, stderr_pipe[0]) != 0 ||
      posix_spawn_file_actions_addclose(&actions, stdout_pipe[1]) != 0 ||
      posix_spawn_file_actions_addclose(&actions, stderr_pipe[1]) != 0 ||
      add_fchdir(&actions, request->dirfd) != 0) {
    request->failed = true;
    request->error_errno = errno != 0 ? errno : ENOTSUP;
    snprintf(request->error_msg, sizeof(request->error_msg), "posix_spawn_file_actions");
    goto cleanup;
  }
  char **envp = request->envp != NULL ? request->envp : environ;
  int spawn_err =
      strchr(request->file, '/') == NULL
          ? posix_spawnp(&spawned, request->file, &actions, &attrs,
                         request->argv, envp)
          : posix_spawn(&spawned, request->file, &actions, &attrs,
                        request->argv, envp);
  if (spawn_err != 0) {
    request->failed = true;
    request->error_errno = spawn_err;
    snprintf(request->error_msg, sizeof(request->error_msg), "posix_spawn");
    goto cleanup;
  }
  atomic_store(&request->pid, spawned);
  close(stdout_pipe[1]);
  stdout_pipe[1] = -1;
  close(stderr_pipe[1]);
  stderr_pipe[1] = -1;
  if (atomic_load(&request->cancelled)) {
    killpg(spawned, SIGKILL);
  }
  int64_t deadline = monotonic_ms() + request->timeout_ms;
  bool stdout_open = true;
  bool stderr_open = true;
  while (stdout_open || stderr_open) {
    if (atomic_load(&request->cancelled)) {
      killpg(spawned, SIGKILL);
      request->cancelled_result = true;
      break;
    }
    int64_t remaining = deadline - monotonic_ms();
    if (remaining <= 0) {
      killpg(spawned, SIGKILL);
      request->failed = true;
      request->error_errno = ETIMEDOUT;
      snprintf(request->error_msg, sizeof(request->error_msg), "git status timed out");
      break;
    }
    struct pollfd fds[2];
    nfds_t count = 0;
    int stdout_index = -1;
    int stderr_index = -1;
    if (stdout_open) {
      stdout_index = (int)count;
      fds[count].fd = stdout_pipe[0];
      fds[count].events = POLLIN;
      fds[count].revents = 0;
      count += 1;
    }
    if (stderr_open) {
      stderr_index = (int)count;
      fds[count].fd = stderr_pipe[0];
      fds[count].events = POLLIN;
      fds[count].revents = 0;
      count += 1;
    }
    int ready = poll(fds, count, remaining > 1000 ? 1000 : (int)remaining);
    if (ready < 0) {
      if (errno == EINTR) continue;
      request->failed = true;
      request->error_errno = errno;
      snprintf(request->error_msg, sizeof(request->error_msg), "poll");
      killpg(spawned, SIGKILL);
      break;
    }
    unsigned char chunk[8192];
    if (stdout_index >= 0 &&
        (fds[stdout_index].revents & (POLLIN | POLLHUP | POLLERR)) != 0) {
      for (;;) {
        ssize_t n = read(stdout_pipe[0], chunk, sizeof(chunk));
        if (n > 0) {
          if (append_chunk(&request->stdout_buf, &request->stdout_len, chunk,
                           (size_t)n, request->max_bytes) != 0) {
            request->failed = true;
            request->error_errno = EFBIG;
            snprintf(request->error_msg, sizeof(request->error_msg),
                     "Git output exceeded the Native Files limit");
            killpg(spawned, SIGKILL);
            stdout_open = false;
            stderr_open = false;
            break;
          }
          continue;
        }
        if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
          stdout_open = false;
        }
        break;
      }
    }
    if (stderr_index >= 0 &&
        (fds[stderr_index].revents & (POLLIN | POLLHUP | POLLERR)) != 0) {
      for (;;) {
        ssize_t n = read(stderr_pipe[0], chunk, sizeof(chunk));
        if (n > 0) {
          if (append_chunk(&request->stderr_buf, &request->stderr_len, chunk,
                           (size_t)n, request->max_bytes) != 0) {
            request->failed = true;
            request->error_errno = EFBIG;
            snprintf(request->error_msg, sizeof(request->error_msg),
                     "Git output exceeded the Native Files limit");
            killpg(spawned, SIGKILL);
            stdout_open = false;
            stderr_open = false;
            break;
          }
          continue;
        }
        if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
          stderr_open = false;
        }
        break;
      }
    }
  }
  int status = 0;
  while (waitpid(spawned, &status, 0) < 0) {
    if (errno != EINTR) {
      request->failed = true;
      request->error_errno = errno;
      snprintf(request->error_msg, sizeof(request->error_msg), "waitpid");
      goto cleanup;
    }
  }
  if (WIFEXITED(status)) request->code = WEXITSTATUS(status);
  else if (WIFSIGNALED(status)) request->code = 128 + WTERMSIG(status);
  else request->code = 1;
  if (atomic_load(&request->cancelled)) request->cancelled_result = true;

cleanup:
  if (stdout_pipe[0] >= 0) close(stdout_pipe[0]);
  if (stdout_pipe[1] >= 0) close(stdout_pipe[1]);
  if (stderr_pipe[0] >= 0) close(stderr_pipe[0]);
  if (stderr_pipe[1] >= 0) close(stderr_pipe[1]);
  if (actions_inited) posix_spawn_file_actions_destroy(&actions);
  if (attrs_inited) posix_spawnattr_destroy(&attrs);
}

static void git_complete(napi_env env, napi_status status, void *data) {
  GitRequest *request = data;
  napi_deferred deferred = request->deferred;
  napi_async_work work = request->work;
  pthread_mutex_lock(&git_lock);
  if (request->slot >= 0 && request->slot < GIT_SLOTS &&
      git_slots[request->slot] == request) {
    git_slots[request->slot] = NULL;
  }
  pthread_mutex_unlock(&git_lock);
  if (status != napi_ok) {
    napi_value error;
    napi_create_string_utf8(env, "Git worker cancelled", NAPI_AUTO_LENGTH, &error);
    napi_value thrown;
    napi_create_error(env, NULL, error, &thrown);
    napi_reject_deferred(env, deferred, thrown);
  } else if (request->cancelled_result) {
    napi_value code_val;
    napi_value message_val;
    napi_value error;
    napi_create_string_utf8(env, "ABORT", NAPI_AUTO_LENGTH, &code_val);
    napi_create_string_utf8(env, "Git operation cancelled", NAPI_AUTO_LENGTH,
                            &message_val);
    napi_create_error(env, code_val, message_val, &error);
    napi_set_named_property(env, error, "code", code_val);
    napi_reject_deferred(env, deferred, error);
  } else if (request->failed) {
    napi_value thrown = throw_errno(env, request->error_msg,
                                    request->error_errno != 0
                                        ? request->error_errno
                                        : EIO);
    (void)thrown;
    napi_value pending;
    napi_get_and_clear_last_exception(env, &pending);
    napi_reject_deferred(env, deferred, pending);
  } else {
    napi_value result;
    napi_value code;
    napi_value stdout_val;
    napi_value stderr_val;
    napi_create_object(env, &result);
    napi_create_int32(env, request->code, &code);
    void *stdout_copy = NULL;
    void *stderr_copy = NULL;
    const unsigned char empty[1] = {0};
    napi_create_buffer_copy(env, request->stdout_len,
                            request->stdout_buf ? request->stdout_buf : empty,
                            &stdout_copy, &stdout_val);
    napi_create_buffer_copy(env, request->stderr_len,
                            request->stderr_buf ? request->stderr_buf : empty,
                            &stderr_copy, &stderr_val);
    napi_set_named_property(env, result, "code", code);
    napi_set_named_property(env, result, "stdout", stdout_val);
    napi_set_named_property(env, result, "stderr", stderr_val);
    napi_resolve_deferred(env, deferred, result);
  }
  napi_delete_async_work(env, work);
  request->work = NULL;
  request->deferred = NULL;
  free_git_request(request);
}

static napi_value CancelGit(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, NULL, "cancelGit(id)");
    return NULL;
  }
  int64_t token = 0;
  if (napi_get_value_int64(env, args[0], &token) != napi_ok || token < 0) {
    napi_throw_type_error(env, NULL, "cancelGit(id)");
    return NULL;
  }
  int slot = git_token_slot((uint64_t)token);
  uint64_t generation = git_token_generation((uint64_t)token);
  pid_t pid = 0;
  pthread_mutex_lock(&git_lock);
  if (slot >= 0 && slot < GIT_SLOTS && git_slots[slot] != NULL &&
      git_slots[slot]->generation == generation) {
    atomic_store(&git_slots[slot]->cancelled, 1);
    pid = atomic_load(&git_slots[slot]->pid);
  }
  pthread_mutex_unlock(&git_lock);
  if (pid > 0) killpg(pid, SIGKILL);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value GitStatusAt(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value args[6];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 5) {
    napi_throw_type_error(
        env, NULL,
        "gitStatusAt(dirfd, file, args, timeoutMs, maxBytes, env)");
    return NULL;
  }
  GitRequest *request = calloc(1, sizeof(*request));
  if (request == NULL) return throw_errno(env, "gitStatusAt", ENOMEM);
  request->dirfd = -1;
  request->slot = -1;
  if (get_fd_arg(env, args[0], &request->dirfd) != 0) {
    request->dirfd = -1;
    free_git_request(request);
    return NULL;
  }
  int duped = dup_cloexec(request->dirfd);
  if (duped < 0) {
    request->dirfd = -1;
    int err = errno;
    free_git_request(request);
    return throw_errno(env, "dup", err);
  }
  request->dirfd = duped;
  size_t file_len = 0;
  if (napi_get_value_string_utf8(env, args[1], NULL, 0, &file_len) != napi_ok) {
    free_git_request(request);
    napi_throw_type_error(env, NULL, "file must be a string");
    return NULL;
  }
  request->file = malloc(file_len + 1);
  if (request->file == NULL) {
    free_git_request(request);
    return throw_errno(env, "gitStatusAt", ENOMEM);
  }
  napi_get_value_string_utf8(env, args[1], request->file, file_len + 1, &file_len);
  bool is_array = false;
  napi_is_array(env, args[2], &is_array);
  if (!is_array) {
    free_git_request(request);
    napi_throw_type_error(env, NULL, "args must be an array");
    return NULL;
  }
  uint32_t arg_count = 0;
  napi_get_array_length(env, args[2], &arg_count);
  request->argc = (int)arg_count + 1;
  request->argv = calloc((size_t)request->argc + 1, sizeof(char *));
  if (request->argv == NULL) {
    free_git_request(request);
    return throw_errno(env, "gitStatusAt", ENOMEM);
  }
  request->argv[0] = strdup(request->file);
  if (request->argv[0] == NULL) {
    free_git_request(request);
    return throw_errno(env, "gitStatusAt", ENOMEM);
  }
  for (uint32_t index = 0; index < arg_count; index += 1) {
    napi_value item;
    napi_get_element(env, args[2], index, &item);
    size_t item_len = 0;
    napi_get_value_string_utf8(env, item, NULL, 0, &item_len);
    request->argv[index + 1] = malloc(item_len + 1);
    if (request->argv[index + 1] == NULL) {
      free_git_request(request);
      return throw_errno(env, "gitStatusAt", ENOMEM);
    }
    napi_get_value_string_utf8(env, item, request->argv[index + 1], item_len + 1,
                               &item_len);
  }
  int64_t timeout_ms = 0;
  int64_t max_bytes = 0;
  napi_get_value_int64(env, args[3], &timeout_ms);
  napi_get_value_int64(env, args[4], &max_bytes);
  if (timeout_ms <= 0 || max_bytes <= 0) {
    free_git_request(request);
    return throw_errno(env, "gitStatusAt", EINVAL);
  }
  request->timeout_ms = (int)timeout_ms;
  request->max_bytes = (size_t)max_bytes;
  char **input_env = NULL;
  int input_envc = 0;
  if (argc >= 6) {
    bool env_is_array = false;
    napi_is_array(env, args[5], &env_is_array);
    if (!env_is_array) {
      free_git_request(request);
      napi_throw_type_error(env, NULL, "env must be an array");
      return NULL;
    }
    uint32_t env_count = 0;
    napi_get_array_length(env, args[5], &env_count);
    input_envc = (int)env_count;
    input_env = calloc((size_t)input_envc + 1, sizeof(char *));
    if (input_env == NULL) {
      free_git_request(request);
      return throw_errno(env, "gitStatusAt", ENOMEM);
    }
    for (uint32_t index = 0; index < env_count; index += 1) {
      napi_value item;
      napi_get_element(env, args[5], index, &item);
      size_t item_len = 0;
      napi_get_value_string_utf8(env, item, NULL, 0, &item_len);
      input_env[index] = malloc(item_len + 1);
      if (input_env[index] == NULL) {
        free_argv(input_env, (int)index);
        free_git_request(request);
        return throw_errno(env, "gitStatusAt", ENOMEM);
      }
      napi_get_value_string_utf8(env, item, input_env[index], item_len + 1,
                                 &item_len);
    }
  }
  request->envp = scrub_git_env(input_env, input_envc, &request->envc);
  free_argv(input_env, input_envc);
  if (request->envp == NULL) {
    free_git_request(request);
    return throw_errno(env, "gitStatusAt", ENOMEM);
  }
  pthread_mutex_lock(&git_lock);
  int slot = -1;
  for (int index = 0; index < GIT_SLOTS; index += 1) {
    if (git_slots[index] == NULL) {
      slot = index;
      break;
    }
  }
  if (slot < 0) {
    pthread_mutex_unlock(&git_lock);
    free_git_request(request);
    return throw_errno(env, "gitStatusAt", EMFILE);
  }
  request->slot = slot;
  request->generation = atomic_fetch_add(&git_generation, 1);
  git_slots[slot] = request;
  pthread_mutex_unlock(&git_lock);
  napi_value promise;
  if (napi_create_promise(env, &request->deferred, &promise) != napi_ok) {
    pthread_mutex_lock(&git_lock);
    git_slots[slot] = NULL;
    pthread_mutex_unlock(&git_lock);
    free_git_request(request);
    napi_throw_error(env, NULL, "Failed to create git promise");
    return NULL;
  }
  napi_value work_name;
  napi_create_string_utf8(env, "host_native_files.gitStatusAt", NAPI_AUTO_LENGTH,
                          &work_name);
  if (napi_create_async_work(env, NULL, work_name, git_execute, git_complete,
                             request, &request->work) != napi_ok ||
      napi_queue_async_work(env, request->work) != napi_ok) {
    pthread_mutex_lock(&git_lock);
    git_slots[slot] = NULL;
    pthread_mutex_unlock(&git_lock);
    napi_value error;
    napi_create_string_utf8(env, "Failed to queue git work", NAPI_AUTO_LENGTH,
                            &error);
    napi_value thrown;
    napi_create_error(env, NULL, error, &thrown);
    napi_reject_deferred(env, request->deferred, thrown);
    free_git_request(request);
    return NULL;
  }
  napi_value result;
  napi_value id_val;
  napi_create_object(env, &result);
  napi_create_int64(env, (int64_t)git_token(slot, request->generation), &id_val);
  napi_set_named_property(env, result, "id", id_val);
  napi_set_named_property(env, result, "promise", promise);
  return result;
}

static napi_value SupportsOpenat2(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
#ifdef __linux__
  napi_get_boolean(env, true, &result);
#else
  napi_get_boolean(env, false, &result);
#endif
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  struct {
    const char *name;
    napi_callback callback;
  } functions[] = {
      {"open", Open},
      {"openat", Openat},
      {"dup", Dup},
      {"close", CloseFd},
      {"canonicalPath", CanonicalPath},
      {"dirOpen", DirOpen},
      {"dirRead", DirRead},
      {"dirClose", DirClose},
      {"gitStatusAt", GitStatusAt},
      {"cancelGit", CancelGit},
      {"supportsOpenat2", SupportsOpenat2},
  };
  for (size_t index = 0; index < sizeof(functions) / sizeof(functions[0]);
       index += 1) {
    napi_value fn;
    napi_create_function(env, functions[index].name, NAPI_AUTO_LENGTH,
                         functions[index].callback, NULL, &fn);
    napi_set_named_property(env, exports, functions[index].name, fn);
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
