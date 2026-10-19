/**
 * Runs `worker` over `items` with at most `concurrency` in flight, starting no new item once
 * `shouldStop()` is true. Items are taken in order. Never rejects on a worker error: workers are
 * expected to handle their own failures (an escaped error is swallowed so one item cannot stop the pool).
 * Resolves with the number of items that were started.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false
): Promise<number> {
  let next = 0
  const lane = async () => {
    while (!shouldStop()) {
      const index = next++
      if (index >= items.length) return
      try {
        await worker(items[index])
      } catch {
        // handled by the worker; keep the pool alive
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane))
  return Math.min(next, items.length)
}
