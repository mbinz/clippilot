export class UnionFind {
  private parent: Map<number, number> = new Map();
  private rank: Map<number, number> = new Map();

  makeSet(x: number): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: number): number {
    if (!this.parent.has(x)) {
      this.makeSet(x);
    }
    let root = x;
    while (this.parent.get(root)! !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let current = x;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX)!;
    const rankY = this.rank.get(rootY)!;

    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }

  clusters(): Map<number, number[]> {
    const result = new Map<number, number[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      let group = result.get(root);
      if (!group) {
        group = [];
        result.set(root, group);
      }
      group.push(x);
    }
    return result;
  }
}
