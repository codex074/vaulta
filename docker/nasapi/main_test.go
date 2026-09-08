package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

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
	profilePath := filepath.Join(t.TempDir(), "profiles.json")
	ownershipPath := filepath.Join(t.TempDir(), "ownership.json")
	server, err := newAPIServer(t.TempDir(), profilePath, ownershipPath, fileBrowser.URL, "", fileBrowser.Client())
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
	server, err := newAPIServer(
		t.TempDir(),
		filepath.Join(t.TempDir(), "profiles.json"),
		filepath.Join(t.TempDir(), "ownership.json"),
		fileBrowser.URL,
		onlyOfficeURL,
		fileBrowser.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return server
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

	reloaded, err := newAPIServer(t.TempDir(), profilePath, filepath.Join(t.TempDir(), "ownership.json"), fileBrowser.URL, "", fileBrowser.Client())
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

	reloaded, err := newAPIServer(t.TempDir(), filepath.Join(t.TempDir(), "profiles.json"), ownershipPath, fileBrowser.URL, "", fileBrowser.Client())
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
