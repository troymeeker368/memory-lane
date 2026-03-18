const EMPTY_SERVER_ONLY_MODULE_URL = "data:text/javascript,export default {};";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: EMPTY_SERVER_ONLY_MODULE_URL,
      shortCircuit: true
    };
  }

  return nextResolve(specifier, context);
}
