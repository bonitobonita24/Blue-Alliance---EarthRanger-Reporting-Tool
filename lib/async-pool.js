export async function asyncPool(limit, items, worker, { swallowErrors = false } = {}) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        if (swallowErrors) results[i] = err;
        else throw err;
      }
    }
  }

  const runners = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < n; i++) runners.push(runner());
  await Promise.all(runners);
  return results;
}
