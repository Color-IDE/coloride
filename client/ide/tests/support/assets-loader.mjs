// Node does not render styles or images. Keep asset imports scoped to unit tests.
export async function load(url, context, nextLoad) {
  if (/\.(css|svg|png|jpe?g|woff2?)(\?.*)?$/.test(url)) {
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
  }
  return nextLoad(url, context);
}
