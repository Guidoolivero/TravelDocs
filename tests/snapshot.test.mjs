import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotChanged } from '../public/js/snapshot.mjs';

describe('snapshotChanged', () => {
  it('la primera lista siempre dispara render', () => {
    const { fp, changed } = snapshotChanged(null, [
      { id: 'a', updatedAt: { seconds: 1, nanoseconds: 0 } }
    ]);
    assert.equal(changed, true);
    assert.equal(fp, 'a:1.0');
  });

  it('la misma lista no dispara otro render', () => {
    const docs = [{ id: 'a', updatedAt: { seconds: 1, nanoseconds: 2 } }];
    const first = snapshotChanged(null, docs);
    const second = snapshotChanged(first.fp, docs);
    assert.equal(second.changed, false);
    assert.equal(second.fp, first.fp);
  });

  it('un updatedAt distinto dispara render', () => {
    const first = snapshotChanged(null, [
      { id: 'a', updatedAt: { seconds: 1, nanoseconds: 0 } }
    ]);
    const second = snapshotChanged(first.fp, [
      { id: 'a', updatedAt: { seconds: 2, nanoseconds: 0 } }
    ]);
    assert.equal(second.changed, true);
  });
});
