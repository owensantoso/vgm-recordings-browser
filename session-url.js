(function exposeSessionUrl(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SessionUrl = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSessionUrl() {
  function sessionFromHref(href) {
    return new URL(href).searchParams.get("session") || "all";
  }

  function validSession(requested, values) {
    return values.includes(requested) ? requested : "all";
  }

  function pathForSession(href, sessionId) {
    const url = new URL(href);
    if (!sessionId || sessionId === "all") url.searchParams.delete("session");
    else url.searchParams.set("session", sessionId);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function pathForFile(href, hash) {
    const url = new URL(href);
    url.hash = hash;
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function reconcileSelection(visibleFiles, selectedFile, hasHash) {
    const resolved = visibleFiles.includes(selectedFile) ? selectedFile : visibleFiles[0] || "";
    return {
      selectedFile: resolved,
      syncHash: Boolean(hasHash && resolved && resolved !== selectedFile),
    };
  }

  return { pathForFile, pathForSession, reconcileSelection, sessionFromHref, validSession };
});
