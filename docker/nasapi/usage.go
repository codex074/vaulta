package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// directorySize sums the logical size of every regular file under root
// (including hidden directories such as .trash). Symlinks are never
// followed — neither their own reparse-point size nor their target's size
// counts against the owner's quota. A root that doesn't exist yet (a user
// with a scope but who has never written anything) counts as zero bytes
// used, not an error.
func directorySize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		total += info.Size()
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	return total, nil
}

// scopeUsage is the cached usage state for one directory (one user's home
// scope). `used` is the last computed on-disk size; `reserved` is bytes
// claimed by in-flight writes that haven't been confirmed on disk yet, so
// two concurrent uploads that would individually fit can't both succeed and
// jointly overshoot the limit.
type scopeUsage struct {
	mu         sync.Mutex
	used       int64
	reserved   int64
	computedAt time.Time
	stale      bool
}

// usageTracker caches per-directory disk usage with a TTL, and serializes
// reserve/release around each directory's own lock so concurrent writes to
// the same drive can't race each other past the quota.
type usageTracker struct {
	mu     sync.Mutex
	ttl    time.Duration
	now    func() time.Time
	scopes map[string]*scopeUsage
}

func newUsageTracker(ttl time.Duration) *usageTracker {
	return &usageTracker{
		ttl:    ttl,
		now:    time.Now,
		scopes: make(map[string]*scopeUsage),
	}
}

func (t *usageTracker) scopeFor(dir string) *scopeUsage {
	t.mu.Lock()
	defer t.mu.Unlock()
	scope, ok := t.scopes[dir]
	if !ok {
		scope = &scopeUsage{stale: true}
		t.scopes[dir] = scope
	}
	return scope
}

// refreshLocked recomputes `used` from disk if the cached value is stale or
// has outlived the TTL. Caller must already hold scope.mu.
func (t *usageTracker) refreshLocked(dir string, scope *scopeUsage) error {
	if !scope.stale && t.now().Sub(scope.computedAt) < t.ttl {
		return nil
	}
	used, err := directorySize(dir)
	if err != nil {
		return err
	}
	scope.used = used
	scope.computedAt = t.now()
	scope.stale = false
	return nil
}

func (t *usageTracker) used(dir string) (int64, error) {
	scope := t.scopeFor(dir)
	scope.mu.Lock()
	defer scope.mu.Unlock()
	if err := t.refreshLocked(dir, scope); err != nil {
		return 0, err
	}
	return scope.used, nil
}

// reserve claims `need` bytes of `dir`'s quota (`limit`), refreshing the
// cached usage first if it's stale or expired. need == 0 always succeeds
// (e.g. an mkdir must still work even if an admin has since lowered the
// limit below current usage). On success, the caller must call the returned
// release exactly once: release(true) folds `need` into `used` without a
// re-walk; release(false) returns the reservation.
func (t *usageTracker) reserve(dir string, need, limit int64) (release func(committed bool), ok bool, err error) {
	scope := t.scopeFor(dir)
	scope.mu.Lock()
	defer scope.mu.Unlock()
	if err := t.refreshLocked(dir, scope); err != nil {
		return nil, false, err
	}
	if need != 0 && scope.used+scope.reserved+need > limit {
		return nil, false, nil
	}
	scope.reserved += need
	var released bool
	release = func(committed bool) {
		scope.mu.Lock()
		defer scope.mu.Unlock()
		if released {
			return
		}
		released = true
		scope.reserved -= need
		if committed {
			scope.used += need
		}
	}
	return release, true, nil
}

// invalidate forces the next used/reserve call on dir to recompute from
// disk, even if the TTL hasn't expired yet — used after a PATCH/DELETE that
// changed a home drive's contents.
func (t *usageTracker) invalidate(dir string) {
	scope := t.scopeFor(dir)
	scope.mu.Lock()
	defer scope.mu.Unlock()
	scope.stale = true
}
