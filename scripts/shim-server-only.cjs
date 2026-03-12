const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (
    request === "server-only" ||
    request.endsWith("\\server-only\\index.js") ||
    request.endsWith("/server-only/index.js")
  ) {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
