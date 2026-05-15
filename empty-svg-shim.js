// React-aware shim for `react-native-svg` used by the testbed (where
// the icons are visible but the SVG primitives don't render).
//
// The generic `empty-shim.js` Proxy was breaking here: React reads
// `Component.prototype.isReactComponent` to decide class-vs-function,
// the Proxy returns truthy for ANY property, so React treats every
// SVG primitive (Svg, Path, Circle, ...) as a class component and
// runs `validateClassInstance` — which warns about every typo/legacy
// API at once because the Proxy answers truthy to every lookup. End
// result: dozens of spurious "componentShouldUpdate / contextType /
// componentDidUnmount / ..." warnings per icon.
//
// Here we export plain function components that return null. JSX
// (<Path .../>, etc.) renders nothing and React skips the class
// validator entirely.

const React = require('react');

const noopComponent = (name) => {
  const C = (_props) => null;
  C.displayName = name;
  return C;
};

const Svg = noopComponent('Svg');
const Circle = noopComponent('Circle');
const ClipPath = noopComponent('ClipPath');
const Defs = noopComponent('Defs');
const Ellipse = noopComponent('Ellipse');
const ForeignObject = noopComponent('ForeignObject');
const G = noopComponent('G');
const Image = noopComponent('SvgImage');
const Line = noopComponent('Line');
const LinearGradient = noopComponent('LinearGradient');
const Marker = noopComponent('Marker');
const Mask = noopComponent('Mask');
const Path = noopComponent('Path');
const Pattern = noopComponent('Pattern');
const Polygon = noopComponent('Polygon');
const Polyline = noopComponent('Polyline');
const RadialGradient = noopComponent('RadialGradient');
const Rect = noopComponent('Rect');
const Stop = noopComponent('Stop');
const Symbol = noopComponent('Symbol');
const SvgText = noopComponent('SvgText');
const TSpan = noopComponent('TSpan');
const TextPath = noopComponent('TextPath');
const Use = noopComponent('Use');

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  ForeignObject,
  G,
  Image,
  Line,
  LinearGradient,
  Marker,
  Mask,
  Path,
  Pattern,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Symbol,
  Text: SvgText,
  TSpan,
  TextPath,
  Use,
};
// React is required to keep the module graph honest even though we
// don't reference it directly above — this prevents tree-shaking from
// dropping it in environments that do dead-code elimination.
void React;
