package main

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestQuotaStoreSetGetDelete(t *testing.T) {
	store, err := newQuotaStore(filepath.Join(t.TempDir(), "quotas.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := store.get("1"); ok {
		t.Fatalf("expected no record before set")
	}
	if err := store.set("1", 1024); err != nil {
		t.Fatal(err)
	}
	record, ok := store.get("1")
	if !ok || record.LimitBytes != 1024 {
		t.Fatalf("get(1) = %#v, %v", record, ok)
	}
	if err := store.delete("1"); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.get("1"); ok {
		t.Fatalf("expected record removed after delete")
	}
}

func TestQuotaStoreAllReturnsACopy(t *testing.T) {
	store, err := newQuotaStore(filepath.Join(t.TempDir(), "quotas.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.set("1", 100); err != nil {
		t.Fatal(err)
	}
	if err := store.set("2", 200); err != nil {
		t.Fatal(err)
	}
	all := store.all()
	if len(all) != 2 || all["1"].LimitBytes != 100 || all["2"].LimitBytes != 200 {
		t.Fatalf("all() = %#v", all)
	}
	all["1"] = quotaRecord{LimitBytes: 999}
	if record, _ := store.get("1"); record.LimitBytes != 100 {
		t.Fatalf("mutating all()'s result affected the store: %#v", record)
	}
}

func TestQuotaStoreMissingFileStartsEmpty(t *testing.T) {
	store, err := newQuotaStore(filepath.Join(t.TempDir(), "missing-dir", "quotas.json"))
	if err != nil {
		t.Fatal(err)
	}
	if all := store.all(); len(all) != 0 {
		t.Fatalf("expected an empty store, got %#v", all)
	}
}

func TestQuotaStorePersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "quotas.json")
	store, err := newQuotaStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.set("7", 2048); err != nil {
		t.Fatal(err)
	}

	reloaded, err := newQuotaStore(path)
	if err != nil {
		t.Fatal(err)
	}
	record, ok := reloaded.get("7")
	if !ok || record.LimitBytes != 2048 {
		t.Fatalf("reloaded get(7) = %#v, %v", record, ok)
	}
}

func TestQuotaStoreFailsCleanlyOnMalformedPath(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := newQuotaStore(filepath.Join(blocker, "quotas.json")); err == nil {
		t.Fatal("expected an error when a path component is a regular file")
	}
}

func TestQuotaStoreConcurrentSetGetIsRaceFree(t *testing.T) {
	store, err := newQuotaStore(filepath.Join(t.TempDir(), "quotas.json"))
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func(n int) {
			defer wg.Done()
			store.set("1", int64(n))
		}(i)
		go func() {
			defer wg.Done()
			store.get("1")
		}()
	}
	wg.Wait()
}
