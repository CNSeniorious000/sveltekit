export function load() {
  const failed = Promise.reject(new Error('Streamed failure'));
  // Handle the server promise; the browser receives a separate revived promise.
  void failed.catch(() => {});
  return { failed };
}
