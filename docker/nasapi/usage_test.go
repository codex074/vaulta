package main

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestDirectorySizeSumsNestedFilesIncludingTrash(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.bin", 100)
	writeFile(t, dir, "sub/b.bin", 250)
	writeFile(t, dir, ".trash/old.bin", 50)
	size, err := directorySize(dir)
	if err != nil {
		t.Fatal(err)
	}
	if size != 400 {
		t.Fatalf("size = %d, want 400", size)
	}
}

func TestDirectorySizeSkipsSymlinks(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "real.bin", 100)
	if err := os.Symlink(filepath.Join(dir, "real.bin"), filepath.Join(dir, "link.bin")); err != nil {
		t.Skipf("symlinks not supported in this environment: %v", err)
	}
	size, err := directorySize(dir)
	if err != nil {
		t.Fatal(err)
	}
	if size != 100 {
		t.Fatalf("size = %d, want 100 (symlink must not be counted)", size)
	}
}

func TestDirectorySizeMissingRootIsZeroNotError(t *testing.T) {
	size, err := directorySize(filepath.Join(t.TempDir(), "does-not-exist"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if size != 0 {
		t.Fatalf("size = %d, want 0", size)
	}
}

func TestUsageTrackerReserveUnderLimitSucceeds(t *testing.T) {
	dir := t.TempDir()
	tracker := newUsageTracker(time.Minute)
	release, ok, err := tracker.reserve(dir, 500, 1000)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	release(false)
}

func TestUsageTrackerReserveOverLimitFails(t *testing.T) {
	dir := t.TempDir()
	tracker := newUsageTracker(time.Minute)
	_, ok, err := tracker.reserve(dir, 1500, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatalf("expected reservation over the limit to be rejected")
	}
}

func TestUsageTrackerReserveZeroNeedAlwaysSucceeds(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "big.bin", 2000) // already over the limit below
	tracker := newUsageTracker(time.Minute)
	release, ok, err := tracker.reserve(dir, 0, 1000)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v (need==0 must always succeed, e.g. for mkdir)", ok, err)
	}
	release(true)
}

func TestUsageTrackerReleaseFalseReturnsTheReservation(t *testing.T) {
	dir := t.TempDir()
	tracker := newUsageTracker(time.Minute)
	release, ok, err := tracker.reserve(dir, 500, 1000)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	release(false)
	// If the first reservation weren't fully released, a same-size second
	// reservation against the same limit would fail.
	release2, ok2, err2 := tracker.reserve(dir, 500, 1000)
	if err2 != nil || !ok2 {
		t.Fatalf("second reservation: ok=%v err=%v", ok2, err2)
	}
	release2(false)
	used, err := tracker.used(dir)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used = %d, want 0 (release(false) must not touch used)", used)
	}
}

func TestUsageTrackerReserveConcurrentOnlyOneWins(t *testing.T) {
	dir := t.TempDir()
	tracker := newUsageTracker(time.Minute)
	var wg sync.WaitGroup
	results := make([]bool, 2)
	errs := make([]error, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, ok, err := tracker.reserve(dir, 600, 1000)
			results[i] = ok
			errs[i] = err
		}(i)
	}
	close(start)
	wg.Wait()

	oks := 0
	for i, ok := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if ok {
			oks++
		}
	}
	if oks != 1 {
		t.Fatalf("expected exactly one reservation to win, got %d", oks)
	}
}

func TestUsageTrackerCommitDoesNotRewalk(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.bin", 100)
	tracker := newUsageTracker(time.Minute)
	release, ok, err := tracker.reserve(dir, 50, 1000)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	// A rewalk after this point would see 1000 bytes on disk; a commit that
	// merely folds the reservation into `used` must not.
	writeFile(t, dir, "b.bin", 900)
	release(true)
	used, err := tracker.used(dir)
	if err != nil {
		t.Fatal(err)
	}
	if used != 150 {
		t.Fatalf("used = %d, want 150 (100 initial + 50 committed, no rewalk)", used)
	}
}

func TestUsageTrackerInvalidateForcesRewalkWithinTTL(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.bin", 100)
	tracker := newUsageTracker(time.Minute)
	if used, err := tracker.used(dir); err != nil || used != 100 {
		t.Fatalf("used=%d err=%v", used, err)
	}
	writeFile(t, dir, "b.bin", 200)
	if used, err := tracker.used(dir); err != nil || used != 100 {
		t.Fatalf("expected cached value 100 within TTL, got used=%d err=%v", used, err)
	}
	tracker.invalidate(dir)
	if used, err := tracker.used(dir); err != nil || used != 300 {
		t.Fatalf("expected invalidate to force a rewalk to 300, got used=%d err=%v", used, err)
	}
}

func TestUsageTrackerTTLExpiryTriggersRewalk(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.bin", 100)
	tracker := newUsageTracker(30 * time.Second)
	clock := time.Now()
	tracker.now = func() time.Time { return clock }

	if used, err := tracker.used(dir); err != nil || used != 100 {
		t.Fatalf("used=%d err=%v", used, err)
	}
	writeFile(t, dir, "b.bin", 200)
	clock = clock.Add(31 * time.Second)
	if used, err := tracker.used(dir); err != nil || used != 300 {
		t.Fatalf("expected TTL expiry to trigger a rewalk to 300, got used=%d err=%v", used, err)
	}
}
