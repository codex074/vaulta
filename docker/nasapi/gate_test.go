package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// unsizedReader wraps an io.Reader in a type httptest.NewRequest doesn't
// special-case, so the resulting request's ContentLength is left unknown
// (-1) — used to simulate a client that never sent Content-Length.
type unsizedReader struct{ *strings.Reader }

func newUnsizedBody(body string) *unsizedReader {
	return &unsizedReader{strings.NewReader(body)}
}

// newGateTestServer builds an apiServer wired to a fakeFileBrowser whose
// self identity is `user`, with a quota record seeded for that user unless
// quotaBytes is negative (meaning: leave no record at all).
func newGateTestServer(t *testing.T, user fileBrowserUser, quotaBytes int64) (*apiServer, *fakeFileBrowser, string) {
	t.Helper()
	fb := newFakeFileBrowser(t, user)
	cfg := newTestAPIServerConfig(t)
	homePath := cfg.HomePath
	cfg.FileBrowserURL = fb.URL()
	cfg.Client = fb.server.Client()
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if quotaBytes >= 0 {
		if err := server.quotas.set(strconv.Itoa(user.ID), quotaBytes); err != nil {
			t.Fatal(err)
		}
	}
	return server, fb, homePath
}

func gateRequest(t *testing.T, handler http.Handler, method, target string, body interface{ Len() int }, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == nil {
		req = httptest.NewRequest(method, target, nil)
	} else if reader, ok := body.(*strings.Reader); ok {
		req = httptest.NewRequest(method, target, reader)
	} else if unsized, ok := body.(*unsizedReader); ok {
		req = httptest.NewRequest(method, target, unsized)
	} else {
		t.Fatalf("unsupported body type %T", body)
	}
	req.Header.Set("Cookie", "auth=valid")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func nonAdminHomeUser(id int, username string) fileBrowserUser {
	return fileBrowserUser{
		ID:       id,
		Username: username,
		Scopes: []userScope{
			{Name: "share", Scope: "/"},
			{Name: "home", Scope: "/" + username},
		},
	}
}

func adminUser(id int, username string) fileBrowserUser {
	u := fileBrowserUser{ID: id, Username: username, Scopes: []userScope{{Name: "share", Scope: "/"}, {Name: "home", Scope: "/"}}}
	u.Permissions.Admin = true
	return u
}

func TestGateSharePassthroughIsUntouchedWithNoIdentityLookup(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 1000)

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=share&path=%2Fnotes.txt", strings.NewReader("hello world"),
		map[string]string{"Content-Length": "11"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if fb.userLookupCount() != 0 {
		t.Fatalf("expected zero /api/users calls for a share request, got %d", fb.userLookupCount())
	}
	recorded := fb.recorded()
	if len(recorded) != 1 {
		t.Fatalf("expected exactly one forwarded request, got %d", len(recorded))
	}
	if recorded[0].RawQuery != "source=share&path=%2Fnotes.txt" {
		t.Fatalf("query changed: %q", recorded[0].RawQuery)
	}
	if string(recorded[0].Body) != "hello world" {
		t.Fatalf("body changed: %q", recorded[0].Body)
	}
}

func TestGateHomeUploadUnderLimitForwards(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 1000)

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fa.bin", strings.NewReader("hello"), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 1 {
		t.Fatalf("expected the upload to be forwarded")
	}
}

func TestGateHomeUploadOverLimitRejectsAndReleases(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 10)

	body := strings.Repeat("x", 100)
	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fbig.bin", strings.NewReader(body), nil)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil || !strings.Contains(payload.Message, "Storage quota exceeded") {
		t.Fatalf("unexpected body: %s", w.Body.String())
	}
	if len(fb.recorded()) != 0 {
		t.Fatalf("expected nothing forwarded to FBQ for a rejected upload")
	}

	// The reservation from the rejected attempt must have been released: a
	// second, equally-sized-but-still-over-limit attempt fails the same way
	// rather than compounding.
	w2 := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fbig2.bin", strings.NewReader(body), nil)
	if w2.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("second attempt status = %d", w2.Code)
	}
}

func TestGateMkdirOverLimitStillSucceeds(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, homePath := newGateTestServer(t, user, 10)
	writeFile(t, homePath, "alice/existing.bin", 20) // already over the 10-byte limit

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fnewfolder&isDir=true", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 1 {
		t.Fatalf("expected the mkdir to be forwarded despite being over limit")
	}
}

func TestGateUploadWithoutLengthReturns411(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, _, _ := newGateTestServer(t, user, 1000)

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fa.bin", newUnsizedBody("hello"), nil)
	if w.Code != http.StatusLengthRequired {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGateAdminBypassesQuotaEntirely(t *testing.T) {
	admin := adminUser(1, "root")
	server, fb, _ := newGateTestServer(t, admin, -1) // no quota record for admin

	body := strings.Repeat("x", 10_000)
	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fbig.bin", strings.NewReader(body), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 1 {
		t.Fatalf("expected the admin's upload to be forwarded")
	}
}

func TestGateHomeScopeWithNoQuotaRecordRejectsAnyWrite(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, -1) // no record at all

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fa.bin", strings.NewReader("x"), nil)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 0 {
		t.Fatalf("expected nothing forwarded")
	}
}

func TestGateNoHomeScopeReturns403(t *testing.T) {
	user := fileBrowserUser{ID: 5, Username: "carol", Scopes: []userScope{{Name: "share", Scope: "/"}}}
	server, _, _ := newGateTestServer(t, user, 1000)

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fa.bin", strings.NewReader("x"), nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGateIdentityFailureReturns502ButShareStillWorks(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 1000)
	fb.setIdentityDown(true)

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fa.bin", strings.NewReader("x"), nil)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("home status = %d, body = %s", w.Code, w.Body.String())
	}

	w2 := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=share&path=%2Fb.txt", strings.NewReader("hello"),
		map[string]string{"Content-Length": "5"})
	if w2.Code != http.StatusOK {
		t.Fatalf("share status = %d, body = %s", w2.Code, w2.Body.String())
	}
}

func TestGateFBQDownReturns502(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 1000)
	fb.server.Close()

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fa.bin", strings.NewReader("x"), nil)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGateConcurrentUploadsExactlyOneRejected(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, _, _ := newGateTestServer(t, user, 1000)

	body := strings.Repeat("x", 600) // two of these (1200) exceed the 1000-byte limit
	var wg sync.WaitGroup
	codes := make([]int, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			w := gateRequest(t, server.handler(), http.MethodPost,
				"/api/resources?source=home&path=%2Ff"+strconv.Itoa(i)+".bin", strings.NewReader(body), nil)
			codes[i] = w.Code
		}(i)
	}
	close(start)
	wg.Wait()

	ok, rejected := 0, 0
	for _, code := range codes {
		switch code {
		case http.StatusOK:
			ok++
		case http.StatusRequestEntityTooLarge:
			rejected++
		default:
			t.Fatalf("unexpected status %d", code)
		}
	}
	if ok != 1 || rejected != 1 {
		t.Fatalf("expected exactly one success and one rejection, got ok=%d rejected=%d", ok, rejected)
	}
}

func TestGateCommittedUploadDoesNotRewalk(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, _, homePath := newGateTestServer(t, user, 1000)
	writeFile(t, homePath, "alice/existing.bin", 100)

	w := gateRequest(t, server.handler(), http.MethodPost,
		"/api/resources?source=home&path=%2Fnew.bin", strings.NewReader(strings.Repeat("y", 50)), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	// A rewalk after this point would see the extra file below; the cached
	// `used` must reflect only the committed reservation, not a rewalk.
	writeFile(t, homePath, "alice/extra.bin", 900)
	used, err := server.usage.used(filepath.Join(homePath, "alice"))
	if err != nil {
		t.Fatal(err)
	}
	if used != 150 {
		t.Fatalf("used = %d, want 150 (100 initial + 50 committed, no rewalk)", used)
	}
}

func TestGateDeleteOnHomeInvalidatesCache(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, _, homePath := newGateTestServer(t, user, 1000)
	dir := filepath.Join(homePath, "alice")
	writeFile(t, dir, "a.bin", 100)
	if _, err := server.usage.used(dir); err != nil { // populate the cache
		t.Fatal(err)
	}

	w := gateRequest(t, server.handler(), http.MethodDelete, "/api/resources?source=home&path=%2Fa.bin", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	scope := server.usage.scopeFor(dir)
	if !scope.stale {
		t.Fatalf("expected the DELETE to invalidate the cached usage for %s", dir)
	}
}

func TestGatePatchCopyShareToHomeSizedFromDiskAndRejectsOverLimit(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 50)
	sharePath := server.sharePath
	writeFile(t, sharePath, "shared/report.bin", 100)

	body := `{"action":"copy","items":[{"fromSource":"share","fromPath":"/shared/report.bin","toSource":"home","toPath":"/report.bin"}]}`
	w := gateRequest(t, server.handler(), http.MethodPatch, "/api/resources", strings.NewReader(body), nil)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 0 {
		t.Fatalf("expected nothing forwarded for a rejected PATCH")
	}
}

func TestGatePatchCopyShareToHomeUnderLimitForwardsBodyUnchanged(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 1000)
	writeFile(t, server.sharePath, "shared/report.bin", 100)

	body := `{"action":"copy","items":[{"fromSource":"share","fromPath":"/shared/report.bin","toSource":"home","toPath":"/report.bin"}]}`
	w := gateRequest(t, server.handler(), http.MethodPatch, "/api/resources", strings.NewReader(body), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	recorded := fb.recorded()
	if len(recorded) != 1 {
		t.Fatalf("expected exactly one forwarded PATCH, got %d", len(recorded))
	}
	if string(recorded[0].Body) != body {
		t.Fatalf("body changed: got %q, want %q", recorded[0].Body, body)
	}
}

func TestGatePatchMoveHomeToShareInvalidatesHomeCache(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, _, homePath := newGateTestServer(t, user, 1000)
	dir := filepath.Join(homePath, "alice")
	writeFile(t, dir, "a.bin", 100)
	if _, err := server.usage.used(dir); err != nil {
		t.Fatal(err)
	}

	body := `{"action":"move","items":[{"fromSource":"home","fromPath":"/a.bin","toSource":"share","toPath":"/a.bin"}]}`
	w := gateRequest(t, server.handler(), http.MethodPatch, "/api/resources", strings.NewReader(body), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	scope := server.usage.scopeFor(dir)
	if !scope.stale {
		t.Fatalf("expected a home->share move to invalidate the home dir's cache")
	}
}

func TestGatePatchHomeToHomeMoveIsNotQuotaChecked(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, homePath := newGateTestServer(t, user, 10) // tiny limit
	writeFile(t, homePath, "alice/a.bin", 1000)            // already far over limit

	body := `{"action":"move","items":[{"fromSource":"home","fromPath":"/a.bin","toSource":"home","toPath":"/b.bin"}]}`
	w := gateRequest(t, server.handler(), http.MethodPatch, "/api/resources", strings.NewReader(body), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 1 {
		t.Fatalf("expected the home->home move to be forwarded despite being over limit")
	}
}

func TestGatePatchSharePassthroughHasNoIdentityLookup(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, fb, _ := newGateTestServer(t, user, 1000)

	body := `{"action":"move","items":[{"fromSource":"share","fromPath":"/a.bin","toSource":"share","toPath":"/b.bin"}]}`
	w := gateRequest(t, server.handler(), http.MethodPatch, "/api/resources", strings.NewReader(body), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if fb.userLookupCount() != 0 {
		t.Fatalf("expected zero /api/users calls for a share-only PATCH, got %d", fb.userLookupCount())
	}
}

// Chunk 0 announces the whole file; an oversized file must be refused
// before a single byte lands in the temp file.
func TestGateChunkZeroOverTotalRejectsBeforeForwarding(t *testing.T) {
	server, fb, _ := newGateTestServer(t, nonAdminHomeUser(7, "alice"), 500)
	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "0", "X-File-Total-Size": "1000"})
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 0 {
		t.Fatalf("FBQ received %d uploads, want 0", len(fb.recorded()))
	}
}

func TestGateChunkZeroWithinTotalForwardsAndReservesChunkLength(t *testing.T) {
	server, fb, _ := newGateTestServer(t, nonAdminHomeUser(7, "alice"), 500)
	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "0", "X-File-Total-Size": "400"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 1 {
		t.Fatalf("FBQ received %d uploads, want 1", len(fb.recorded()))
	}
}

func TestGateLaterChunkIsNotPrechecked(t *testing.T) {
	server, fb, _ := newGateTestServer(t, nonAdminHomeUser(7, "alice"), 500)
	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "490", "X-File-Total-Size": "1000"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (only the 10-byte chunk is reserved); body %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 1 {
		t.Fatalf("FBQ received %d uploads, want 1", len(fb.recorded()))
	}
}

// TestGateChunkZeroOverflowSafePrecheckRejects guards against `used + total`
// overflowing int64 and wrapping negative, which would slip a wildly
// oversized announced total past the precheck. math.MaxInt64 plus any
// nonzero `used` overflows; the safe form (`total > limit - used`) never
// adds two potentially-huge values together.
func TestGateChunkZeroOverflowSafePrecheckRejects(t *testing.T) {
	user := nonAdminHomeUser(7, "alice")
	server, fb, homePath := newGateTestServer(t, user, 500)
	writeFile(t, homePath, "alice/existing.bin", 1) // used > 0, so used+total can overflow

	w := gateRequest(t, server.handler(), http.MethodPost, "/api/resources?path=%2Fbig.bin&source=home&override=false",
		strings.NewReader("0123456789"), map[string]string{"X-File-Chunk-Offset": "0", "X-File-Total-Size": strconv.FormatInt(math.MaxInt64, 10)})
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (overflow must not bypass the precheck); body %s", w.Code, w.Body.String())
	}
	if len(fb.recorded()) != 0 {
		t.Fatalf("FBQ received %d uploads, want 0", len(fb.recorded()))
	}
}

func TestGatePatchRejectsDotDotInPaths(t *testing.T) {
	user := nonAdminHomeUser(5, "alice")
	server, _, _ := newGateTestServer(t, user, 1000)

	for _, body := range []string{
		`{"action":"move","items":[{"fromSource":"home","fromPath":"/../etc/passwd","toSource":"home","toPath":"/b.bin"}]}`,
		`{"action":"move","items":[{"fromSource":"home","fromPath":"/a.bin","toSource":"home","toPath":"/../etc/passwd"}]}`,
	} {
		w := gateRequest(t, server.handler(), http.MethodPatch, "/api/resources", strings.NewReader(body), nil)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, w.Code)
		}
	}
}
