export function wrap(fn) {
  return async (args) => {
    try {
      const result = await fn(args || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: String((e && e.message) || e) }] };
    }
  };
}
