package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// newTestAPIServerConfig returns an apiServerConfig with every path field
// pointed at a fresh temp directory, ready for a test to override whichever
// fields it cares about.
func newTestAPIServerConfig(t *testing.T) apiServerConfig {
	t.Helper()
	return apiServerConfig{
		StatPath:      t.TempDir(),
		SharePath:     t.TempDir(),
		HomePath:      t.TempDir(),
		ProfilePath:   filepath.Join(t.TempDir(), "profiles.json"),
		OwnershipPath: filepath.Join(t.TempDir(), "ownership.json"),
		QuotaPath:     filepath.Join(t.TempDir(), "quotas.json"),
	}
}

func newTestServer(t *testing.T, admin bool) (*apiServer, *httptest.Server, string) {
	server, fileBrowser, profilePath, _ := newTestServerWithOwnership(t, admin)
	return server, fileBrowser, profilePath
}

func newTestServerWithOwnership(t *testing.T, admin bool) (*apiServer, *httptest.Server, string, string) {
	t.Helper()
	fileBrowser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "auth=valid" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		id := r.URL.Query().Get("id")
		user := fileBrowserUser{ID: 2, Username: "login-handle"}
		user.Permissions.Admin = admin
		if id == "3" {
			user.ID = 3
			user.Username = "other-login"
		}
		writeJSON(w, http.StatusOK, user)
	}))
	t.Cleanup(fileBrowser.Close)
	cfg := newTestAPIServerConfig(t)
	profilePath := cfg.ProfilePath
	ownershipPath := cfg.OwnershipPath
	cfg.FileBrowserURL = fileBrowser.URL
	cfg.Client = fileBrowser.Client()
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return server, fileBrowser, profilePath, ownershipPath
}

func newTestServerWithOnlyOfficeURL(t *testing.T, onlyOfficeURL string) *apiServer {
	t.Helper()
	fileBrowser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fileBrowserUser{ID: 2, Username: "login-handle"})
	}))
	t.Cleanup(fileBrowser.Close)
	cfg := newTestAPIServerConfig(t)
	cfg.FileBrowserURL = fileBrowser.URL
	cfg.OnlyOfficeURL = onlyOfficeURL
	cfg.Client = fileBrowser.Client()
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return server
}

// writeFile writes a `size`-byte file at dir/rel, creating any parent
// directories it needs. Shared by usage/quota/gate tests that need real
// on-disk fixtures for directorySize to walk.
func writeFile(t *testing.T, dir, rel string, size int) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, make([]byte, size), 0o600); err != nil {
		t.Fatal(err)
	}
}

// recordedRequest captures everything about a request fakeFileBrowser
// forwarded on to its generic handler (i.e. anything other than
// /api/users), so gate tests can assert the gate forwarded a request
// byte-for-byte.
type recordedRequest struct {
	Method   string
	RawQuery string
	Header   http.Header
	Body     []byte
}

// fakeFileBrowser is a richer stand-in for FileBrowser Quantum than the
// simple identity-only httptest servers above: it answers `/api/users?id=self`
// and `/api/users` (admin listing) from configurable state, requires
// `Cookie: auth=valid` like the real thing, and records every other request
// (method, raw query, headers, body) under a mutex before answering `200 {}`
// — used by the gate tests to prove requests reach FBQ unchanged.
type fakeFileBrowser struct {
	mu       sync.Mutex
	server   *httptest.Server
	self     fileBrowserUser
	users    []fileBrowserUser
	requests []recordedRequest
	down     bool
}

func newFakeFileBrowser(t *testing.T, self fileBrowserUser) *fakeFileBrowser {
	t.Helper()
	f := &fakeFileBrowser{self: self, users: []fileBrowserUser{self}}
	f.server = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeFileBrowser) handle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Cookie") != "auth=valid" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	down := f.down
	f.mu.Unlock()
	if down {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	if r.URL.Path == "/api/users" {
		if r.URL.Query().Get("id") == "self" {
			writeJSON(w, http.StatusOK, f.self)
			return
		}
		f.mu.Lock()
		users := f.users
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, users)
		return
	}

	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.requests = append(f.requests, recordedRequest{
		Method:   r.Method,
		RawQuery: r.URL.RawQuery,
		Header:   r.Header.Clone(),
		Body:     body,
	})
	f.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{})
}

func (f *fakeFileBrowser) URL() string { return f.server.URL }

func (f *fakeFileBrowser) setUsers(users []fileBrowserUser) {
	f.mu.Lock()
	f.users = users
	f.mu.Unlock()
}

func (f *fakeFileBrowser) setDown(down bool) {
	f.mu.Lock()
	f.down = down
	f.mu.Unlock()
}

func (f *fakeFileBrowser) recorded() []recordedRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]recordedRequest, len(f.requests))
	copy(out, f.requests)
	return out
}

func request(t *testing.T, handler http.Handler, method, path, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if authenticated {
		r.Header.Set("Cookie", "auth=valid")
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func decodeProfile(t *testing.T, recorder *httptest.ResponseRecorder) profileResponse {
	t.Helper()
	var result profileResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestProfileDefaultsToLoginHandleAndUsesNumericUID(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodGet, "/profile", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	profile := decodeProfile(t, w)
	if profile.UID != "2" || profile.Username != "login-handle" || profile.DisplayName != "login-handle" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
}

func TestProfileUpdatePersistsByUID(t *testing.T) {
	server, fileBrowser, profilePath := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPut, "/profile", `{"displayName":"  New Name  "}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := decodeProfile(t, w).DisplayName; got != "New Name" {
		t.Fatalf("display name = %q", got)
	}

	reloadCfg := newTestAPIServerConfig(t)
	reloadCfg.ProfilePath = profilePath
	reloadCfg.FileBrowserURL = fileBrowser.URL
	reloadCfg.Client = fileBrowser.Client()
	reloaded, err := newAPIServer(reloadCfg)
	if err != nil {
		t.Fatal(err)
	}
	w = request(t, reloaded.handler(), http.MethodGet, "/profile", "", true)
	if got := decodeProfile(t, w).DisplayName; got != "New Name" {
		t.Fatalf("persisted display name = %q", got)
	}
}

func TestProfileUpdateRequiresAuthentication(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPut, "/profile", `{"displayName":"New Name"}`, false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestProfileRejectsInvalidDisplayNames(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	for _, name := range []string{"   ", strings.Repeat("x", maxDisplayNameRunes+1), "bad\u0007name"} {
		body, _ := json.Marshal(profile{DisplayName: name})
		w := request(t, server.handler(), http.MethodPut, "/profile", string(body), true)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("name %q: status = %d", name, w.Code)
		}
	}
}

func TestAdminCanManageProfilesByUID(t *testing.T) {
	server, _, _ := newTestServer(t, true)
	w := request(t, server.handler(), http.MethodPut, "/profiles/3", `{"displayName":"Other Person"}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body = %s", w.Code, w.Body.String())
	}
	w = request(t, server.handler(), http.MethodGet, "/profiles", "", true)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"3":{"displayName":"Other Person"}`) {
		t.Fatalf("GET status = %d, body = %s", w.Code, w.Body.String())
	}
	w = request(t, server.handler(), http.MethodDelete, "/profiles/3", "", true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d", w.Code)
	}
}

func decodeOwnership(t *testing.T, recorder *httptest.ResponseRecorder) ownership {
	t.Helper()
	var result ownership
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func decodeLookup(t *testing.T, recorder *httptest.ResponseRecorder) map[string]ownership {
	t.Helper()
	var result struct {
		Records map[string]ownership `json:"records"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Records
}

func TestOwnershipStampUsesAuthenticatedCaller(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/photos/a.jpg"}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	record := decodeOwnership(t, w)
	if record.UploadedByUID != "2" || record.UploadedByUsername != "login-handle" {
		t.Fatalf("unexpected ownership record: %#v", record)
	}
}

func TestOwnershipStampRequiresAuthentication(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/photos/a.jpg"}`, false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestOwnershipLookupReturnsOnlyKnownPaths(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/photos/a.jpg"}`, true)
	w := request(t, server.handler(), http.MethodPost, "/ownership/lookup", `{"paths":["/photos/a.jpg","/photos/b.jpg"]}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	records := decodeLookup(t, w)
	if _, ok := records["/photos/a.jpg"]; !ok {
		t.Fatalf("expected record for known path, got %#v", records)
	}
	if _, ok := records["/photos/b.jpg"]; ok {
		t.Fatalf("unexpected record for unknown path: %#v", records)
	}
}

func TestOwnershipMoveRelocatesRecord(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/photos/a.jpg"}`, true)
	w := request(t, server.handler(), http.MethodPost, "/ownership/move", `{"from":"/photos/a.jpg","to":"/.trash/1__a.jpg"}`, true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	lookup := request(t, server.handler(), http.MethodPost, "/ownership/lookup", `{"paths":["/photos/a.jpg","/.trash/1__a.jpg"]}`, true)
	records := decodeLookup(t, lookup)
	if _, ok := records["/photos/a.jpg"]; ok {
		t.Fatalf("expected old path to be cleared, got %#v", records)
	}
	if record, ok := records["/.trash/1__a.jpg"]; !ok || record.UploadedByUsername != "login-handle" {
		t.Fatalf("expected record carried to new path, got %#v", records)
	}
}

func TestOwnershipMoveRelocatesDescendantsOfAMovedFolder(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/Photos/a.jpg"}`, true)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/Photos/Sub/b.jpg"}`, true)
	w := request(t, server.handler(), http.MethodPost, "/ownership/move", `{"from":"/Photos","to":"/Albums/Photos"}`, true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	lookup := request(t, server.handler(), http.MethodPost, "/ownership/lookup",
		`{"paths":["/Photos/a.jpg","/Photos/Sub/b.jpg","/Albums/Photos/a.jpg","/Albums/Photos/Sub/b.jpg"]}`, true)
	records := decodeLookup(t, lookup)
	if len(records) != 2 {
		t.Fatalf("expected only the two relocated records, got %#v", records)
	}
	if _, ok := records["/Albums/Photos/a.jpg"]; !ok {
		t.Fatalf("expected direct child relocated, got %#v", records)
	}
	if _, ok := records["/Albums/Photos/Sub/b.jpg"]; !ok {
		t.Fatalf("expected nested descendant relocated, got %#v", records)
	}
}

func TestOwnershipMoveDoesNotRelocateAnUnrelatedPathWithASharedPrefix(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/PhotosOld/a.jpg"}`, true)
	request(t, server.handler(), http.MethodPost, "/ownership/move", `{"from":"/Photos","to":"/Albums/Photos"}`, true)
	lookup := request(t, server.handler(), http.MethodPost, "/ownership/lookup", `{"paths":["/PhotosOld/a.jpg"]}`, true)
	if records := decodeLookup(t, lookup); len(records) != 1 {
		t.Fatalf("expected unrelated sibling path untouched, got %#v", records)
	}
}

func TestOwnershipMoveIsNoOpWhenRecordMissing(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPost, "/ownership/move", `{"from":"/nope.jpg","to":"/still-nope.jpg"}`, true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestOwnershipLookupRequiresAuthentication(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPost, "/ownership/lookup", `{"paths":["/a.jpg"]}`, false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestOwnershipMoveRequiresAuthentication(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodPost, "/ownership/move", `{"from":"/a.jpg","to":"/b.jpg"}`, false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestOwnershipDeleteRequiresAuthentication(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	w := request(t, server.handler(), http.MethodDelete, "/ownership?path=/a.jpg", "", false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestOwnershipDeleteRemovesRecord(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/photos/a.jpg"}`, true)
	w := request(t, server.handler(), http.MethodDelete, "/ownership?path=/photos/a.jpg", "", true)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	lookup := request(t, server.handler(), http.MethodPost, "/ownership/lookup", `{"paths":["/photos/a.jpg"]}`, true)
	if records := decodeLookup(t, lookup); len(records) != 0 {
		t.Fatalf("expected record deleted, got %#v", records)
	}
}

func TestOwnershipPersistsAcrossRestart(t *testing.T) {
	server, fileBrowser, _, ownershipPath := newTestServerWithOwnership(t, false)
	request(t, server.handler(), http.MethodPost, "/ownership", `{"path":"/photos/a.jpg"}`, true)

	reloadCfg := newTestAPIServerConfig(t)
	reloadCfg.OwnershipPath = ownershipPath
	reloadCfg.FileBrowserURL = fileBrowser.URL
	reloadCfg.Client = fileBrowser.Client()
	reloaded, err := newAPIServer(reloadCfg)
	if err != nil {
		t.Fatal(err)
	}
	w := request(t, reloaded.handler(), http.MethodPost, "/ownership/lookup", `{"paths":["/photos/a.jpg"]}`, true)
	records := decodeLookup(t, w)
	if _, ok := records["/photos/a.jpg"]; !ok {
		t.Fatalf("expected ownership to persist, got %#v", records)
	}
}

func TestNonAdminCannotListOrEditOtherProfiles(t *testing.T) {
	server, _, _ := newTestServer(t, false)
	for _, test := range []struct{ method, path, body string }{
		{http.MethodGet, "/profiles", ""},
		{http.MethodPut, "/profiles/3", `{"displayName":"Other Person"}`},
		{http.MethodDelete, "/profiles/3", ""},
	} {
		w := request(t, server.handler(), test.method, test.path, test.body, true)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s %s: status = %d", test.method, test.path, w.Code)
		}
	}
}

func TestConfigReturnsConfiguredOnlyOfficeURL(t *testing.T) {
	server := newTestServerWithOnlyOfficeURL(t, "https://office.codex074.com")
	w := request(t, server.handler(), http.MethodGet, "/config", "", false)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if w.Body.String() != `{"onlyOfficeUrl":"https://office.codex074.com"}`+"\n" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestConfigReturnsEmptyOnlyOfficeURLWhenUnset(t *testing.T) {
	server := newTestServerWithOnlyOfficeURL(t, "")
	w := request(t, server.handler(), http.MethodGet, "/config", "", false)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if w.Body.String() != `{"onlyOfficeUrl":""}`+"\n" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestConfigRejectsNonGet(t *testing.T) {
	server := newTestServerWithOnlyOfficeURL(t, "https://office.codex074.com")
	w := request(t, server.handler(), http.MethodPost, "/config", "", false)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestFileBrowserUserScopeForFindsAndMisses(t *testing.T) {
	user := fileBrowserUser{Scopes: []userScope{
		{Name: "share", Scope: "/"},
		{Name: "home", Scope: "/alice"},
	}}
	if scope, ok := user.scopeFor("home"); !ok || scope != "/alice" {
		t.Fatalf("scopeFor(home) = %q, %v", scope, ok)
	}
	if scope, ok := user.scopeFor("share"); !ok || scope != "/" {
		t.Fatalf("scopeFor(share) = %q, %v", scope, ok)
	}
	if _, ok := user.scopeFor("nope"); ok {
		t.Fatalf("expected no scope for an unknown source")
	}
}

func TestNewAPIServerBuildsWithAllFieldsPopulated(t *testing.T) {
	cfg := newTestAPIServerConfig(t)
	cfg.FileBrowserURL = "http://127.0.0.1:0"
	cfg.OnlyOfficeURL = "https://office.example"
	cfg.Client = &http.Client{}
	cfg.ProxyTransport = http.DefaultTransport
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if server == nil {
		t.Fatal("expected a non-nil server")
	}
}

func TestNewAPIServerFailsCleanlyOnMalformedQuotaPath(t *testing.T) {
	cfg := newTestAPIServerConfig(t)
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// blocker is a regular file, not a directory, so a QuotaPath nested
	// under it can never be prepared.
	cfg.QuotaPath = filepath.Join(blocker, "quotas.json")
	if _, err := newAPIServer(cfg); err == nil {
		t.Fatal("expected an error for a malformed quota path")
	}
}
