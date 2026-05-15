// No-op module used by metro to stand in for optional native deps that
// the source tree references but the testbed never actually invokes
// (image-crop-picker, document-picker, etc.). Exporting a Proxy means
// `default` access and method calls won't throw on require, only when
// actually invoked.
const noop = () => undefined;
const handler = {
  get(_target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return new Proxy(noop, handler);
    if (prop === Symbol.toPrimitive) return () => '';
    return new Proxy(noop, handler);
  },
};
module.exports = new Proxy(noop, handler);
