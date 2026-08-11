// Shared in-flight request cap for every parallelized fetch in this CLI.

/**
 * Do not call `mapWithConcurrency` from inside a task already running under
 * `mapWithConcurrency` against the same semaphore — a task holds its slot for
 * its whole duration, so nesting can exhaust the pool and deadlock.
 */
export const CONCURRENCY = 8;

/** FIFO counting semaphore: `acquire()` waits for a free slot, `release()` frees one. */
export function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  function acquire() {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  }

  return { acquire, release };
}

const defaultSemaphore = createSemaphore(CONCURRENCY);

/**
 * `defaultSemaphore` is shared process-wide so the cap holds across call sites
 * — which is also why calls must not be nested, see CONCURRENCY.
 */
export async function mapWithConcurrency(items, task, { semaphore = defaultSemaphore } = {}) {
  return Promise.all(
    items.map(async (item, i) => {
      await semaphore.acquire();
      try {
        return await task(item, i);
      } finally {
        semaphore.release();
      }
    })
  );
}
