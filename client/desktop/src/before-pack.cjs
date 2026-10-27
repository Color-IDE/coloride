module.exports = async () => {
  await (await import('./agent-runtime/build.mjs')).default();
};
