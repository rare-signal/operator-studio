// Registers the server-only/client-only stub loader. Used as a
// `node --import` preamble for the MCP server and probe scripts so
// library code that imports `server-only` can run in plain Node.
import { register } from "node:module"

register("./tsx-loader.mjs", import.meta.url)
