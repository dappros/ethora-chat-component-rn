import type { ViewStyle } from 'react-native';

/**
 * Geometry for a multi-media album bubble. Pure numbers and RN style objects,
 * so AlbumGrid stays a dumb renderer and the rules are testable without a
 * renderer.
 *
 *   1 item   full width, 4:3
 *   2 items  side by side, 2:1 (square cells)
 *   3 items  one large cell on the left, two stacked on the right
 *   4 items  2 x 2
 *   5+ items 2 x 2 showing the first four, the last cell carries "+N"
 */

/** Gap between neighbouring tiles. */
export const ALBUM_GAP = 3;
/** Radius of a tile corner that sits on the bubble's own corner. */
export const ALBUM_OUTER_RADIUS = 10;
/** Radius of every other tile corner, the ones that face a neighbour. */
export const ALBUM_INNER_RADIUS = 3;

export interface AlbumCellPlacement {
  /** 0-based grid column and row of the tile's top-left cell. */
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

export type AlbumKind = 'full' | 'pair' | 'hero' | 'quad';

export interface AlbumLayout {
  kind: AlbumKind;
  /** Number of tiles actually drawn. */
  visible: number;
  /** Items folded into the "+N" overlay on the last visible tile. */
  hidden: number;
  /** Relative width of each grid column. */
  columns: number[];
  /** Relative height of each grid row. */
  rows: number[];
  /** Width divided by height of the whole grid. */
  aspectRatio: number;
  /** One entry per visible tile, in order. */
  placements: AlbumCellPlacement[];
}

const cell = (
  column: number,
  row: number,
  rowSpan = 1
): AlbumCellPlacement => ({ column, row, columnSpan: 1, rowSpan });

const LAYOUTS: Record<AlbumKind, Omit<AlbumLayout, 'visible' | 'hidden'>> = {
  full: {
    kind: 'full',
    columns: [1],
    rows: [1],
    aspectRatio: 4 / 3,
    placements: [cell(0, 0)],
  },
  pair: {
    kind: 'pair',
    columns: [1, 1],
    rows: [1],
    aspectRatio: 2,
    placements: [cell(0, 0), cell(1, 0)],
  },
  hero: {
    kind: 'hero',
    columns: [2, 1],
    rows: [1, 1],
    aspectRatio: 4 / 3,
    placements: [cell(0, 0, 2), cell(1, 0), cell(1, 1)],
  },
  quad: {
    kind: 'quad',
    columns: [1, 1],
    rows: [1, 1],
    aspectRatio: 1,
    placements: [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)],
  },
};

/** Layout for `count` media tiles. Counts below 1 are treated as 1. */
export const getAlbumLayout = (count: number): AlbumLayout => {
  const total = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  const kind: AlbumKind =
    total === 1 ? 'full' : total === 2 ? 'pair' : total === 3 ? 'hero' : 'quad';
  const base = LAYOUTS[kind];
  const visible = base.placements.length;
  return {
    ...base,
    columns: [...base.columns],
    rows: [...base.rows],
    placements: base.placements.map((placement) => ({ ...placement })),
    visible,
    hidden: Math.max(0, total - visible),
  };
};

/** Splits `total` across weighted tracks, leaving `gap` between neighbours. */
const trackSizes = (weights: number[], total: number, gap: number): number[] => {
  const room = total - gap * (weights.length - 1);
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  return weights.map((weight) => (room * weight) / sum);
};

export interface AlbumFrame {
  width: number;
  height: number;
  /** One absolutely positioned style per visible tile, in order. */
  tiles: ViewStyle[];
}

/** Pixel frame of the grid and of every tile for a grid `width` wide. */
export const getAlbumFrame = (layout: AlbumLayout, width: number): AlbumFrame => {
  const height = Math.round(width / layout.aspectRatio);
  const colWidths = trackSizes(layout.columns, width, ALBUM_GAP);
  const rowHeights = trackSizes(layout.rows, height, ALBUM_GAP);
  const offset = (sizes: number[], index: number) =>
    sizes.slice(0, index).reduce((acc, size) => acc + size + ALBUM_GAP, 0);
  const span = (sizes: number[], index: number, count: number) =>
    sizes.slice(index, index + count).reduce((acc, size) => acc + size, 0) +
    ALBUM_GAP * (count - 1);

  return {
    width,
    height,
    tiles: layout.placements.map((placement, position) => ({
      position: 'absolute',
      left: Math.round(offset(colWidths, placement.column)),
      top: Math.round(offset(rowHeights, placement.row)),
      width: Math.round(span(colWidths, placement.column, placement.columnSpan)),
      height: Math.round(span(rowHeights, placement.row, placement.rowSpan)),
      overflow: 'hidden',
      ...getTileBorderRadius(layout, position),
    })),
  };
};

/**
 * Which corners of one tile lie on the bubble's outer edge. Only those get
 * the large radius; corners that face a neighbour get the small inner one.
 */
export interface TileCorners {
  topLeft: boolean;
  topRight: boolean;
  bottomRight: boolean;
  bottomLeft: boolean;
}

const corners = (
  topLeft: boolean,
  topRight: boolean,
  bottomRight: boolean,
  bottomLeft: boolean
): TileCorners => ({ topLeft, topRight, bottomRight, bottomLeft });

const OUTER_CORNERS: Record<AlbumKind, TileCorners[]> = {
  full: [corners(true, true, true, true)],
  pair: [corners(true, false, false, true), corners(false, true, true, false)],
  // Hero: the tall left cell owns both left corners; the right column owns
  // its top-right and bottom-right corners respectively.
  hero: [
    corners(true, false, false, true),
    corners(false, true, false, false),
    corners(false, false, true, false),
  ],
  quad: [
    corners(true, false, false, false),
    corners(false, true, false, false),
    corners(false, false, false, true),
    corners(false, false, true, false),
  ],
};

/** Outer-corner flags for the tile at `position` (0-based) of `layout`. */
export const getTileCorners = (
  layout: AlbumLayout,
  position: number
): TileCorners => {
  const found = OUTER_CORNERS[layout.kind][position];
  return found ? { ...found } : corners(false, false, false, false);
};

/** The four border radii of one tile, as RN style props. */
export const getTileBorderRadius = (
  layout: AlbumLayout,
  position: number
): Pick<
  ViewStyle,
  | 'borderTopLeftRadius'
  | 'borderTopRightRadius'
  | 'borderBottomRightRadius'
  | 'borderBottomLeftRadius'
> => {
  const c = getTileCorners(layout, position);
  const radius = (outer: boolean) =>
    outer ? ALBUM_OUTER_RADIUS : ALBUM_INNER_RADIUS;
  return {
    borderTopLeftRadius: radius(c.topLeft),
    borderTopRightRadius: radius(c.topRight),
    borderBottomRightRadius: radius(c.bottomRight),
    borderBottomLeftRadius: radius(c.bottomLeft),
  };
};
