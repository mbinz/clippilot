import { describe, it, expect } from 'vitest';
import { UnionFind } from '../../../../src/core/similarity/union-find.js';

describe('UnionFind', () => {
  it('creates isolated sets', () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(2);
    uf.makeSet(3);

    expect(uf.connected(1, 2)).toBe(false);
    expect(uf.connected(2, 3)).toBe(false);
  });

  it('unions two elements', () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(2);
    uf.union(1, 2);

    expect(uf.connected(1, 2)).toBe(true);
  });

  it('handles transitive unions', () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(2);
    uf.makeSet(3);
    uf.union(1, 2);
    uf.union(2, 3);

    expect(uf.connected(1, 3)).toBe(true);
  });

  it('union is idempotent', () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(2);
    uf.union(1, 2);
    uf.union(1, 2);
    uf.union(2, 1);

    expect(uf.connected(1, 2)).toBe(true);
    const clusters = uf.clusters();
    // Should still be one cluster with two members
    let total = 0;
    for (const members of clusters.values()) {
      total += members.length;
    }
    expect(total).toBe(2);
  });

  it('extracts clusters correctly', () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(2);
    uf.makeSet(3);
    uf.makeSet(4);
    uf.union(1, 2);
    uf.union(3, 4);

    const clusters = uf.clusters();
    expect(clusters.size).toBe(2);

    const sizes = [...clusters.values()].map((m) => m.length).sort();
    expect(sizes).toEqual([2, 2]);
  });

  it('handles singletons in clusters', () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(2);
    uf.makeSet(3);
    uf.union(1, 2);

    const clusters = uf.clusters();
    expect(clusters.size).toBe(2);
    const sizes = [...clusters.values()].map((m) => m.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('auto-creates sets on find', () => {
    const uf = new UnionFind();
    const root = uf.find(42);
    expect(root).toBe(42);
  });

  it('auto-creates sets on union', () => {
    const uf = new UnionFind();
    uf.union(10, 20);
    expect(uf.connected(10, 20)).toBe(true);
  });
});
