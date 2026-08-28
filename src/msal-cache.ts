import { randomUUID } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { getTokenCachePath } from "./config.js";

const CACHE_PATH = getTokenCachePath();
const CACHE_LOCK_PATH = `${CACHE_PATH}.lock`;
const CACHE_LOCK_OWNER_PATH = join(CACHE_LOCK_PATH, "owner");
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 30000;

type CacheLock = {
  owner: string;
};

function createLockOwner(): string {
  return `${process.pid}.${Date.now()}.${randomUUID()}`;
}

function parseOwnerPid(owner: string): number | undefined {
  const pid = Number(owner.split(".", 1)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Drop a lock left behind by a process that died mid-write.
 * Returns true when the lock is gone (never held, or just cleared).
 */
async function removeStaleCacheLockIfOrphaned(): Promise<boolean> {
  let stat: Stats;

  try {
    stat = await fs.stat(CACHE_LOCK_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }

  if (Date.now() - stat.mtimeMs <= STALE_LOCK_MS) {
    return false;
  }

  let owner: string | undefined;
  try {
    owner = await fs.readFile(CACHE_LOCK_OWNER_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const ownerPid = owner ? parseOwnerPid(owner) : undefined;
  if (ownerPid && isProcessAlive(ownerPid)) {
    return false;
  }

  await fs.rm(CACHE_LOCK_PATH, { recursive: true, force: true });
  return true;
}

/**
 * Take the cross-process cache lock. `mkdir` is atomic on every platform we
 * support, so the directory itself is the lock; the owner file inside it
 * identifies the holder so nobody releases someone else's lock.
 */
async function acquireCacheLock(): Promise<CacheLock> {
  const startedAt = Date.now();
  const owner = createLockOwner();

  await fs.mkdir(dirname(CACHE_PATH), { recursive: true });

  while (true) {
    try {
      await fs.mkdir(CACHE_LOCK_PATH);
      try {
        await fs.writeFile(CACHE_LOCK_OWNER_PATH, owner, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await fs.rm(CACHE_LOCK_PATH, { recursive: true, force: true });
        throw error;
      }
      return { owner };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") {
        throw error;
      }

      if (await removeStaleCacheLockIfOrphaned()) {
        continue;
      }

      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for token cache lock: ${CACHE_LOCK_PATH}`);
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
}

async function releaseCacheLock(lock: CacheLock): Promise<void> {
  let owner: string;

  try {
    owner = await fs.readFile(CACHE_LOCK_OWNER_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (owner === lock.owner) {
    await fs.rm(CACHE_LOCK_PATH, { recursive: true, force: true });
  }
}

/**
 * Run `operation` under the cache lock. If the lock cannot be taken the
 * operation still runs, unlocked: a wedged lock file must never be able to
 * lock the user out of Teams, and unsynchronised access is what the plain
 * file cache did anyway.
 */
async function withCacheLock<T>(operation: () => Promise<T>): Promise<T> {
  let lock: CacheLock | undefined;

  try {
    lock = await acquireCacheLock();
  } catch (error) {
    console.error("Warning: Proceeding without token cache lock:", error);
  }

  try {
    return await operation();
  } finally {
    if (lock) {
      try {
        await releaseCacheLock(lock);
      } catch (error) {
        console.error("Warning: Could not release token cache lock:", error);
      }
    }
  }
}

/** Move an unreadable cache aside so the next sign-in starts from a clean file. */
async function quarantineInvalidCache(): Promise<string | undefined> {
  const quarantinePath = `${CACHE_PATH}.corrupt.${Date.now()}.${process.pid}`;
  try {
    await fs.rename(CACHE_PATH, quarantinePath);
    return quarantinePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Warning: Could not quarantine invalid token cache:", error);
    }
    return undefined;
  }
}

/**
 * Write via a temp file + rename so a reader never observes a half-written
 * cache: rename is atomic, so the cache is either the old file or the new one.
 */
async function writeCacheAtomically(data: string): Promise<void> {
  const tmpPath = join(
    dirname(CACHE_PATH),
    `.${basename(CACHE_PATH)}.${process.pid}.${Date.now()}.tmp`
  );

  // mode 0o600 = owner-only read/write; chmod is a no-op on Windows but
  // narrows perms on POSIX systems where the cache contains refresh tokens.
  await fs.writeFile(tmpPath, data, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.chmod(tmpPath, 0o600);
  } catch {
    // chmod unsupported (Windows) — writeFile mode was a best-effort hint
  }
  await fs.rename(tmpPath, CACHE_PATH);
}

/**
 * Custom file-based cache plugin for MSAL Node
 * Stores tokens (including refresh tokens) in a JSON file
 *
 * Reads and writes are serialised across processes, so parallel teams-mcp
 * instances sharing one cache cannot tear each other's writes.
 */
export const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    await withCacheLock(async () => {
      let data: string;

      try {
        data = await fs.readFile(CACHE_PATH, "utf8");
      } catch (error) {
        // File doesn't exist - start with empty cache
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("Warning: Could not read token cache:", error);
        }
        return;
      }

      try {
        cacheContext.tokenCache.deserialize(data);
      } catch {
        const quarantinePath = await quarantineInvalidCache();
        if (quarantinePath) {
          console.error("Warning: Token cache is invalid; moved aside:", quarantinePath);
        }
      }
    });
  },

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      await withCacheLock(async () => {
        try {
          const data = cacheContext.tokenCache.serialize();
          await writeCacheAtomically(data);
        } catch (error) {
          console.error("Warning: Could not write token cache:", error);
        }
      });
    }
  },
};

export { CACHE_PATH };
