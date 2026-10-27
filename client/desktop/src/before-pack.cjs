module.exports = async () => {
  require('../../../tooling/build/collect-licenses.cjs')();
  await (await import('./agent-runtime/build.mjs')).default();
};
