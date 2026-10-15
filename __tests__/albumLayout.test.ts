import {
  ALBUM_GAP,
  ALBUM_INNER_RADIUS as inner,
  ALBUM_OUTER_RADIUS as outer,
  getAlbumFrame,
  getAlbumLayout,
  getTileBorderRadius,
  getTileCorners,
} from '../src/helpers/albumLayout';

describe('getAlbumLayout', () => {
  it('lays out 1 item full width', () => {
    const layout = getAlbumLayout(1);
    expect(layout).toMatchObject({ kind: 'full', visible: 1, hidden: 0, columns: [1], rows: [1] });
    expect(layout.placements).toEqual([{ column: 0, row: 0, columnSpan: 1, rowSpan: 1 }]);
  });

  it('lays out 2 items side by side', () => {
    const layout = getAlbumLayout(2);
    expect(layout).toMatchObject({ kind: 'pair', visible: 2, hidden: 0, columns: [1, 1] });
    expect(layout.placements.map((p) => p.column)).toEqual([0, 1]);
  });

  it('lays out 3 items as one large cell and two stacked', () => {
    const layout = getAlbumLayout(3);
    expect(layout).toMatchObject({ kind: 'hero', visible: 3, hidden: 0, columns: [2, 1] });
    expect(layout.placements[0]).toMatchObject({ column: 0, row: 0, rowSpan: 2 });
    expect(layout.placements[1]).toMatchObject({ column: 1, row: 0 });
    expect(layout.placements[2]).toMatchObject({ column: 1, row: 1 });
  });

  it('lays out 4 items as a 2 x 2 grid', () => {
    const layout = getAlbumLayout(4);
    expect(layout).toMatchObject({ kind: 'quad', visible: 4, hidden: 0 });
    expect(layout.placements).toHaveLength(4);
  });

  it('shows four cells and counts the rest for 5+ items', () => {
    expect(getAlbumLayout(5)).toMatchObject({ kind: 'quad', visible: 4, hidden: 1 });
    expect(getAlbumLayout(10)).toMatchObject({ kind: 'quad', visible: 4, hidden: 6 });
  });

  it('never hands out shared placement objects', () => {
    const first = getAlbumLayout(4);
    first.placements[0]!.column = 9;
    first.columns[0] = 9;
    expect(getAlbumLayout(4).placements[0]!.column).toBe(0);
    expect(getAlbumLayout(4).columns[0]).toBe(1);
  });

  it('treats nonsense counts as a single item', () => {
    expect(getAlbumLayout(0).visible).toBe(1);
    expect(getAlbumLayout(Number.NaN).visible).toBe(1);
  });
});

describe('getAlbumFrame', () => {
  it('fills the width with one 4:3 tile for a single item', () => {
    const frame = getAlbumFrame(getAlbumLayout(1), 240);
    expect(frame).toMatchObject({ width: 240, height: 180 });
    expect(frame.tiles[0]).toMatchObject({ position: 'absolute', left: 0, top: 0, width: 240, height: 180 });
  });

  it('splits a pair around the gap', () => {
    const frame = getAlbumFrame(getAlbumLayout(2), 243);
    expect(frame.height).toBe(122);
    const [a, b] = frame.tiles;
    expect(a!.left).toBe(0);
    expect(Number(a!.width) + ALBUM_GAP + Number(b!.width)).toBeGreaterThanOrEqual(242);
    expect(b!.left).toBe(Math.round(120 + ALBUM_GAP));
  });

  it('makes the hero tile twice the width and as tall as both stacked tiles', () => {
    const frame = getAlbumFrame(getAlbumLayout(3), 243);
    const [hero, top, bottom] = frame.tiles;
    expect(top!.left).toBe(bottom!.left);
    expect(bottom!.top).toBeGreaterThan(Number(top!.top) + Number(top!.height) - 1);
    expect(hero!.height).toBe(frame.height);
    expect(Number(hero!.width)).toBeGreaterThan(Number(top!.width) * 1.9);
  });

  it('draws a 2 x 2 quad and the same four tiles for +N', () => {
    const quad = getAlbumFrame(getAlbumLayout(4), 240);
    expect(quad.height).toBe(240);
    expect(quad.tiles).toHaveLength(4);
    expect(getAlbumFrame(getAlbumLayout(7), 240)).toEqual(quad);
  });
});

describe('album tile corners', () => {
  const radii = (count: number) => {
    const layout = getAlbumLayout(count);
    return layout.placements.map((_, position) => {
      const r = getTileBorderRadius(layout, position);
      return [
        r.borderTopLeftRadius,
        r.borderTopRightRadius,
        r.borderBottomRightRadius,
        r.borderBottomLeftRadius,
      ];
    });
  };

  it('rounds only the outer corners of a 2-up pair', () => {
    expect(radii(2)).toEqual([
      [outer, inner, inner, outer],
      [inner, outer, outer, inner],
    ]);
  });

  it('rounds only the bubble corners of the 3-up hero layout', () => {
    expect(radii(3)).toEqual([
      [outer, inner, inner, outer],
      [inner, outer, inner, inner],
      [inner, inner, outer, inner],
    ]);
  });

  it('rounds exactly one outer corner per tile of the 2 x 2 quad', () => {
    expect(radii(4)).toEqual([
      [outer, inner, inner, inner],
      [inner, outer, inner, inner],
      [inner, inner, inner, outer],
      [inner, inner, outer, inner],
    ]);
    expect(radii(6)).toEqual(radii(4));
  });

  it('gives the full-width single tile all four outer corners', () => {
    expect(radii(1)).toEqual([[outer, outer, outer, outer]]);
  });

  it('reports no outer corner for a position outside the layout', () => {
    expect(getTileCorners(getAlbumLayout(2), 5)).toEqual({
      topLeft: false,
      topRight: false,
      bottomRight: false,
      bottomLeft: false,
    });
  });
});
