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
	server, err := newAPIServer(t.TempDir(), profilePath, fileBrowser.URL, fileBrowser.Client())
	if err != nil {
		t.Fatal(err)
	}
	return server, fileBrowser, profilePath
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

	reloaded, err := newAPIServer(t.TempDir(), profilePath, fileBrowser.URL, fileBrowser.Client())
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
