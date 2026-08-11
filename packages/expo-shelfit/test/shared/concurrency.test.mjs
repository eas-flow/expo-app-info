import { describe, expect, it } from 'vitest';
import { createSemaphore, mapWithConcurrency } from '../../src/shared/concurrency.mjs';

describe('mapWithConcurrency', () => {
  it('never runs more than the semaphore limit tasks at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const semaphore = createSemaphore(2);

    await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return item * 2;
      },
      { semaphore }
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('preserves result order matching input order regardless of completion order', async () => {
    const delays = [30, 10, 20, 0];
    const results = await mapWithConcurrency(
      delays,
      async (delay, i) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return i;
      },
      { semaphore: createSemaphore(4) }
    );
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('handles an empty items array', async () => {
    const results = await mapWithConcurrency([], async () => 1, { semaphore: createSemaphore(4) });
    expect(results).toEqual([]);
  });

  it('shares one semaphore across independent (non-nested) calls, so combined in-flight count never exceeds its limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const semaphore = createSemaphore(3);

    const track = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    };

    await mapWithConcurrency([1, 2, 3, 4], () => track(), { semaphore });
    await mapWithConcurrency([1, 2, 3, 4], () => track(), { semaphore });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('releases the token when a task throws, so later tasks are not deadlocked', async () => {
    const semaphore = createSemaphore(1);

    await expect(
      mapWithConcurrency(
        [1, 2],
        async (item) => {
          if (item === 1) throw new Error('boom');
          return item;
        },
        { semaphore }
      )
    ).rejects.toThrow('boom');

    await semaphore.acquire();
    semaphore.release();
  });

  it('grants slots in FIFO order — whoever acquired first runs first', async () => {
    const semaphore = createSemaphore(1);
    const order = [];

    await mapWithConcurrency(
      [1, 2, 3],
      async (item) => {
        order.push(item);
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      { semaphore }
    );

    expect(order).toEqual([1, 2, 3]);
  });
});

describe('createSemaphore', () => {
  it('lets up to `limit` acquires resolve immediately', async () => {
    const semaphore = createSemaphore(2);
    let resolved = 0;
    semaphore.acquire().then(() => resolved++);
    semaphore.acquire().then(() => resolved++);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(2);
  });

  it('queues an acquire beyond the limit until a release frees a slot', async () => {
    const semaphore = createSemaphore(1);
    let secondResolved = false;

    await semaphore.acquire();
    const second = semaphore.acquire().then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    expect(secondResolved).toBe(false);

    semaphore.release();
    await second;
    expect(secondResolved).toBe(true);
  });
});
