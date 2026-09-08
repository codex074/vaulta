package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// newResourcesProxy builds the reverse proxy the gate forwards every
// request through. It streams (FlushInterval: -1, no read/write timeout on
// its own transport) and uses FBQ's default Director, so headers/cookies
// pass through untouched — the gate only ever decides *whether* and *when*
// to forward, never how.
func newResourcesProxy(fileBrowserURL string, transport http.RoundTripper) (*httputil.ReverseProxy, error) {
	target, err := url.Parse(fileBrowserURL)
	if err != nil {
		return nil, fmt.Errorf("parse FileBrowser URL: %w", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = transport
	proxy.FlushInterval = -1
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("resources gate: proxy error: %v", err)
		writeMessage(w, http.StatusBadGateway, "File service unavailable.")
	}
	return proxy, nil
}

// statusRecorder captures the status code ultimately written to the client
// — whether that came from a normal proxied response or the proxy's own
// ErrorHandler (both write through the same http.ResponseWriter passed to
// ServeHTTP) — without any shared, per-proxy mutable state that concurrent
// requests could race on.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rec *statusRecorder) WriteHeader(status int) {
	if rec.status == 0 {
		rec.status = status
	}
	rec.ResponseWriter.WriteHeader(status)
}

func (rec *statusRecorder) Write(b []byte) (int, error) {
	if rec.status == 0 {
		rec.status = http.StatusOK
	}
	return rec.ResponseWriter.Write(b)
}

// forward proxies the request to FBQ unchanged and, once the response has
// been written, calls onDone (if non-nil) with the status code the client
// actually received.
func (s *apiServer) forward(w http.ResponseWriter, r *http.Request, onDone func(status int)) {
	rec := &statusRecorder{ResponseWriter: w}
	s.proxy.ServeHTTP(rec, r)
	if onDone != nil {
		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		onDone(status)
	}
}

func writeMessage(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

func writeQuotaExceeded(w http.ResponseWriter, used, limit, need int64) {
	writeMessage(w, http.StatusRequestEntityTooLarge, fmt.Sprintf(
		"Storage quota exceeded: %d of %d bytes used, this write needs %d more.", used, limit, need))
}

// handleResourcesGate is registered at /api/resources, mirroring FBQ's own
// route exactly. Only the three write verbs get gate logic; everything
// else (GET listing/download/preview/search, and any other method) is a
// plain, untouched forward.
func (s *apiServer) handleResourcesGate(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.gateUpload(w, r)
	case http.MethodPatch:
		s.gateTransfer(w, r)
	case http.MethodDelete:
		s.gateDelete(w, r)
	default:
		s.forward(w, r, nil)
	}
}

// gateUpload handles POST (upload/mkdir). A request whose target isn't the
// home drive is forwarded untouched, with no identity lookup at all — the
// gate genuinely doesn't care about it. A home-drive request is sized,
// reserved against the actor's quota, and only forwarded if it fits.
func (s *apiServer) gateUpload(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("source") != "home" {
		s.forward(w, r, nil)
		return
	}

	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	if user.Permissions.Admin {
		s.forward(w, r, nil)
		return
	}
	dir, ok := s.homeDirFor(user)
	if !ok {
		writeMessage(w, http.StatusForbidden, "No private drive assigned.")
		return
	}

	need, ok := uploadNeed(r)
	if !ok {
		writeMessage(w, http.StatusLengthRequired, "Content-Length required.")
		return
	}

	record, _ := s.quotas.get(strconv.Itoa(user.ID))
	release, ok, err := s.usage.reserve(dir, need, record.LimitBytes)
	if err != nil {
		log.Printf("reserve quota for uid %d: %v", user.ID, err)
		writeMessage(w, http.StatusBadGateway, "File service unavailable.")
		return
	}
	if !ok {
		io.Copy(io.Discard, r.Body)
		used, _ := s.usage.used(dir)
		writeQuotaExceeded(w, used, record.LimitBytes, need)
		return
	}
	s.forward(w, r, func(status int) {
		release(status < 300)
	})
}

// uploadNeed determines how many bytes an upload/mkdir request needs to
// reserve. isDir=true (mkdir) always needs 0 — that must succeed even if an
// admin has since lowered the limit below current usage. A non-dir request
// needs a known length: Content-Length when present, or FBQ's own chunked-
// upload X-File-Total-Size header when this is chunk 0 (or unchunked).
// Anything else has no reliable size to reserve against, so ok is false.
func uploadNeed(r *http.Request) (need int64, ok bool) {
	if r.URL.Query().Get("isDir") == "true" {
		return 0, true
	}
	if r.ContentLength >= 0 {
		return r.ContentLength, true
	}
	chunkOffset := r.Header.Get("X-File-Chunk-Offset")
	if chunkOffset != "" && chunkOffset != "0" {
		return 0, false
	}
	totalSize := r.Header.Get("X-File-Total-Size")
	if totalSize == "" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(totalSize, 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

type transferItem struct {
	FromSource string `json:"fromSource"`
	FromPath   string `json:"fromPath"`
	ToSource   string `json:"toSource"`
	ToPath     string `json:"toPath"`
}

type transferRequest struct {
	Items  []transferItem `json:"items"`
	Action string         `json:"action"`
}

// gateTransfer handles PATCH (move/copy). It always reads the body to see
// which items involve the home drive, but only performs an identity lookup
// once it knows at least one item does — a PATCH that never touches home
// (e.g. a plain share-to-share move) is forwarded with no identity lookup
// at all, same as a share POST. The body reaches FBQ byte-for-byte
// unchanged regardless.
func (s *apiServer) gateTransfer(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	buf, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	var payload transferRequest
	if err := json.Unmarshal(buf, &payload); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	// Re-supply the body unchanged so FBQ receives exactly what the client sent.
	r.Body = io.NopCloser(bytes.NewReader(buf))
	r.ContentLength = int64(len(buf))

	touchesHome := false
	for _, item := range payload.Items {
		if item.FromSource == "home" || item.ToSource == "home" {
			touchesHome = true
			break
		}
	}
	if !touchesHome {
		s.forward(w, r, nil)
		return
	}

	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	if user.Permissions.Admin {
		s.forward(w, r, nil)
		return
	}

	homeDir, hasHome := s.homeDirFor(user)
	var need int64
	for _, item := range payload.Items {
		if containsDotDot(item.FromPath) || containsDotDot(item.ToPath) {
			http.Error(w, "Invalid path.", http.StatusBadRequest)
			return
		}
		if item.FromSource == "home" || item.ToSource == "home" {
			if !hasHome {
				writeMessage(w, http.StatusForbidden, "No private drive assigned.")
				return
			}
		}
		if item.FromSource == "home" {
			if _, ok := withinRoot(homeDir, item.FromPath); !ok {
				http.Error(w, "Invalid path.", http.StatusBadRequest)
				return
			}
		}
		if item.ToSource == "home" {
			if _, ok := withinRoot(homeDir, item.ToPath); !ok {
				http.Error(w, "Invalid path.", http.StatusBadRequest)
				return
			}
		}

		// Only items landing in home via a copy, or a move whose source
		// isn't already home, actually add new bytes to home — a
		// home-internal move stays inside the same limit.
		if item.ToSource != "home" || !(payload.Action == "copy" || item.FromSource != "home") {
			continue
		}
		var root string
		switch item.FromSource {
		case "share":
			scope, ok := user.scopeFor("share")
			if !ok {
				writeMessage(w, http.StatusForbidden, "No access to the source drive.")
				return
			}
			root = filepath.Join(s.sharePath, filepath.Clean("/"+scope))
		case "home":
			root = homeDir
		default:
			http.Error(w, "Invalid source.", http.StatusBadRequest)
			return
		}
		abs, ok := withinRoot(root, item.FromPath)
		if !ok {
			http.Error(w, "Invalid path.", http.StatusBadRequest)
			return
		}
		size, err := itemSize(abs)
		if err != nil {
			log.Printf("size item %s: %v", abs, err)
			writeMessage(w, http.StatusBadGateway, "File service unavailable.")
			return
		}
		need += size
	}

	if need == 0 {
		s.forward(w, r, func(status int) {
			if status < 300 && hasHome {
				s.usage.invalidate(homeDir)
			}
		})
		return
	}

	record, _ := s.quotas.get(strconv.Itoa(user.ID))
	release, ok, err := s.usage.reserve(homeDir, need, record.LimitBytes)
	if err != nil {
		log.Printf("reserve quota for uid %d: %v", user.ID, err)
		writeMessage(w, http.StatusBadGateway, "File service unavailable.")
		return
	}
	if !ok {
		used, _ := s.usage.used(homeDir)
		writeQuotaExceeded(w, used, record.LimitBytes, need)
		return
	}
	s.forward(w, r, func(status int) {
		committed := status < 300
		release(committed)
		if committed {
			s.usage.invalidate(homeDir)
		}
	})
}

// gateDelete forwards unconditionally, then (best-effort, after the
// response) invalidates the actor's cached home usage if the delete
// targeted the home drive, so the next quota read reflects the freed
// space instead of a stale, higher number.
func (s *apiServer) gateDelete(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	s.forward(w, r, func(status int) {
		if status >= 300 || source != "home" {
			return
		}
		user, _, err := s.fetchUser(r, "self")
		if err != nil {
			return
		}
		if dir, ok := s.homeDirFor(user); ok {
			s.usage.invalidate(dir)
		}
	})
}

// withinRoot joins itemPath onto root the same way FBQ resolves scoped
// paths (Clean rooted at "/", which already makes a ".." escape
// unreachable) and re-asserts that with a prefix check, as defense in
// depth.
func withinRoot(root, itemPath string) (string, bool) {
	abs := filepath.Join(root, filepath.Clean("/"+itemPath))
	if !strings.HasPrefix(abs+"/", root+"/") {
		return "", false
	}
	return abs, true
}

func containsDotDot(path string) bool {
	for _, part := range strings.Split(path, "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

func itemSize(path string) (int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	if info.IsDir() {
		return directorySize(path)
	}
	return info.Size(), nil
}
