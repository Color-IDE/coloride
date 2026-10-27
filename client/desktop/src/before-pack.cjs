module.exports = async context => {
  // Native ML wheels and CPython must be built on the target platform/arch.
  const arch = { 0: 'ia32', 1: 'x64', 2: 'arm', 3: 'arm64', 4: 'universal' }[context.arch];
  if (context.electronPlatformName !== process.platform || arch !== process.arch) {
    throw new Error('Build the bundled voice runtime on a runner matching the target platform and architecture.');
  }
  await (await import('./agent-runtime/build.mjs')).default();
  require('../../../tooling/build/build-voice-runtime.cjs').buildVoiceRuntime();
};
