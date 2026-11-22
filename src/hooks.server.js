// Keep this synthetic error message visible in both dev and preview.
export function handleError({ error }) {
  return { message: error.message };
}
