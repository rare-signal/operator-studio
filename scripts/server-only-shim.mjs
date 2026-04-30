// Empty CJS-friendly stub. The real `server-only` package throws on
// import outside Next's RSC context; for plain Node scripts (the MCP
// server, the integrity checker, etc.) we want a no-op so library
// code that defensively imports it can still be loaded.
export {}
