// Deploy-time values. server.mjs answers /env.js from its environment variables (set TOKEN_CA on Railway), and the
// landing page reads it from the proxy origin in config.js, so one variable updates every deployment.
// This file is the fallback when no server answers. TOKEN_CA empty shows "Coming soon".
export const TOKEN_CA = "";
