package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

// newQuotaTestServer builds an apiServer wired to a fakeFileBrowser whose
// self identity is `self`, with HomePath pointed at a fresh temp directory.
func newQuotaTestServer(t *testing.T, self fileBrowserUser) (*apiServer, *fakeFileBrowser, string) {
	t.Helper()
	fb := newFakeFileBrowser(t, self)
	cfg := newTestAPIServerConfig(t)
	homePath := cfg.HomePath
	cfg.FileBrowserURL = fb.URL()
	cfg.Client = fb.server.Client()
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return server, fb, homePath
}

func TestGetQuotaAdminIsUnlimited(t *testing.T) {
	admin := fileBrowserUser{ID: 1, Username: "root"}
	admin.Permissions.Admin = true
	server, _, homePath := newQuotaTestServer(t, admin)
	writeFile(t, homePath, "someone/file.bin", 500)

	w := request(t, server.handler(), http.MethodGet, "/quota", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got quotaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.HasDrive || !got.Unlimited || got.UsedBytes != 500 {
		t.Fatalf("got %#v", got)
	}
}

func TestGetQuotaNonAdminWithRecord(t *testing.T) {
	user := fileBrowserUser{ID: 5, Username: "alice", Scopes: []userScope{{Name: "home", Scope: "/alice"}}}
	server, _, homePath := newQuotaTestServer(t, user)
	writeFile(t, homePath, "alice/photo.bin", 300)
	if err := server.quotas.set("5", 1000); err != nil {
		t.Fatal(err)
	}

	w := request(t, server.handler(), http.MethodGet, "/quota", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got quotaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.HasDrive || got.Unlimited || got.LimitBytes != 1000 || got.UsedBytes != 300 {
		t.Fatalf("got %#v", got)
	}
}

func TestGetQuotaNonAdminWithScopeButNoRecordIsZeroLimit(t *testing.T) {
	user := fileBrowserUser{ID: 6, Username: "bob", Scopes: []userScope{{Name: "home", Scope: "/bob"}}}
	server, _, _ := newQuotaTestServer(t, user)

	w := request(t, server.handler(), http.MethodGet, "/quota", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got quotaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.HasDrive || got.Unlimited || got.LimitBytes != 0 {
		t.Fatalf("got %#v, want limitBytes 0 (fail closed, not unlimited)", got)
	}
}

func TestGetQuotaNonAdminWithNoHomeScope(t *testing.T) {
	user := fileBrowserUser{ID: 7, Username: "carol", Scopes: []userScope{{Name: "share", Scope: "/"}}}
	server, _, _ := newQuotaTestServer(t, user)

	w := request(t, server.handler(), http.MethodGet, "/quota", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got quotaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.HasDrive || got.Unlimited || got.LimitBytes != 0 || got.UsedBytes != 0 {
		t.Fatalf("got %#v, want all zero/false for a user with no home scope", got)
	}
}

func TestQuotasEndpointsRequireAdmin(t *testing.T) {
	user := fileBrowserUser{ID: 8, Username: "dave", Scopes: []userScope{{Name: "home", Scope: "/dave"}}}
	server, _, _ := newQuotaTestServer(t, user)

	for _, test := range []struct{ method, path, body string }{
		{http.MethodGet, "/quotas", ""},
		{http.MethodPut, "/quotas/8", `{"limitBytes":100}`},
		{http.MethodDelete, "/quotas/8", ""},
	} {
		w := request(t, server.handler(), test.method, test.path, test.body, true)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s %s: status = %d, body = %s", test.method, test.path, w.Code, w.Body.String())
		}
	}
}

func TestPutQuotaRejectsInvalidPayloads(t *testing.T) {
	admin := fileBrowserUser{ID: 1, Username: "root"}
	admin.Permissions.Admin = true
	server, _, _ := newQuotaTestServer(t, admin)

	for _, test := range []struct {
		name string
		body string
	}{
		{"negative", `{"limitBytes":-1}`},
		{"non-integer", `{"limitBytes":5.5}`},
		{"unknown field", `{"limitBytes":100,"bogus":true}`},
	} {
		w := request(t, server.handler(), http.MethodPut, "/quotas/1", test.body, true)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, body = %s", test.name, w.Code, w.Body.String())
		}
	}
}

func TestPutQuotaPersistsAcrossReload(t *testing.T) {
	admin := fileBrowserUser{ID: 1, Username: "root"}
	admin.Permissions.Admin = true
	fb := newFakeFileBrowser(t, admin)
	fb.setUsers([]fileBrowserUser{admin, {ID: 5, Username: "alice"}})
	cfg := newTestAPIServerConfig(t)
	quotaPath := cfg.QuotaPath
	cfg.FileBrowserURL = fb.URL()
	cfg.Client = fb.server.Client()
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatal(err)
	}

	w := request(t, server.handler(), http.MethodPut, "/quotas/5", `{"limitBytes":4096}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	reloadCfg := cfg
	reloadCfg.QuotaPath = quotaPath
	reloaded, err := newAPIServer(reloadCfg)
	if err != nil {
		t.Fatal(err)
	}
	record, ok := reloaded.quotas.get("5")
	if !ok || record.LimitBytes != 4096 {
		t.Fatalf("reloaded record = %#v, %v", record, ok)
	}
}

func TestDeleteQuotaReturnsNoContent(t *testing.T) {
	admin := fileBrowserUser{ID: 1, Username: "root"}
	admin.Permissions.Admin = true
	server, _, _ := newQuotaTestServer(t, admin)
	if err := server.quotas.set("9", 100); err != nil {
		t.Fatal(err)
	}
	w := request(t, server.handler(), http.MethodDelete, "/quotas/9", "", true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if _, ok := server.quotas.get("9"); ok {
		t.Fatalf("expected quota record removed")
	}
}

func TestGetQuotasComputesUsedFromDiskForEveryUser(t *testing.T) {
	admin := fileBrowserUser{ID: 1, Username: "root"}
	admin.Permissions.Admin = true
	alice := fileBrowserUser{ID: 5, Username: "alice", Scopes: []userScope{{Name: "home", Scope: "/alice"}}}
	server, fb, homePath := newQuotaTestServer(t, admin)
	fb.setUsers([]fileBrowserUser{admin, alice})
	writeFile(t, homePath, "alice/a.bin", 700)
	if err := server.quotas.set("5", 2000); err != nil {
		t.Fatal(err)
	}

	w := request(t, server.handler(), http.MethodGet, "/quotas", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got struct {
		Quotas map[string]quotaResponse `json:"quotas"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	alice5, ok := got.Quotas["5"]
	if !ok || alice5.UsedBytes != 700 || alice5.LimitBytes != 2000 {
		t.Fatalf("quotas[5] = %#v, %v", alice5, ok)
	}
}

func TestHomeDirForRejectsAScopeThatWouldEscapeHomePath(t *testing.T) {
	admin := fileBrowserUser{ID: 1, Username: "root"}
	admin.Permissions.Admin = true
	server, _, _ := newQuotaTestServer(t, admin)
	user := fileBrowserUser{ID: 5, Scopes: []userScope{{Name: "home", Scope: "/../../etc"}}}
	dir, ok := server.homeDirFor(user)
	if !ok {
		return
	}
	if strings.HasPrefix(dir, "/etc") {
		t.Fatalf("homeDirFor escaped homePath: %s", dir)
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
