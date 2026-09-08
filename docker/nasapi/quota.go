package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// quotaRecord is the admin-set storage limit for one user's private drive.
type quotaRecord struct {
	LimitBytes int64 `json:"limitBytes"`
}

type quotaFile struct {
	Version int                    `json:"version"`
	Quotas  map[string]quotaRecord `json:"quotas"`
}

// quotaStore is a small JSON-file-backed store mapping FileBrowser uid to a
// quotaRecord, mirroring profileStore's locking and atomic-write pattern
// exactly. A uid with no record is not tracked as "unlimited" — callers
// treat an absent record as 0 bytes allowed (fail closed).
type quotaStore struct {
	mu     sync.RWMutex
	path   string
	quotas map[string]quotaRecord
}

func newQuotaStore(path string) (*quotaStore, error) {
	store := &quotaStore{path: path, quotas: make(map[string]quotaRecord)}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read quotas: %w", err)
	}

	var payload quotaFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("decode quotas: %w", err)
	}
	if payload.Quotas != nil {
		store.quotas = payload.Quotas
	}
	return store, nil
}

func (s *quotaStore) get(uid string) (quotaRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.quotas[uid]
	return value, ok
}

func (s *quotaStore) all() map[string]quotaRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]quotaRecord, len(s.quotas))
	for uid, value := range s.quotas {
		result[uid] = value
	}
	return result
}

func (s *quotaStore) set(uid string, limit int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.quotas[uid]
	s.quotas[uid] = quotaRecord{LimitBytes: limit}
	if err := s.saveLocked(); err != nil {
		if existed {
			s.quotas[uid] = previous
		} else {
			delete(s.quotas, uid)
		}
		return err
	}
	return nil
}

func (s *quotaStore) delete(uid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.quotas[uid]
	if !existed {
		return nil
	}
	delete(s.quotas, uid)
	if err := s.saveLocked(); err != nil {
		s.quotas[uid] = previous
		return err
	}
	return nil
}

func (s *quotaStore) saveLocked() error {
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create quota directory: %w", err)
	}
	payload, err := json.MarshalIndent(quotaFile{Version: 1, Quotas: s.quotas}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode quotas: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "quotas-*.tmp")
	if err != nil {
		return fmt.Errorf("create quota temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure quota temp file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write quotas: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync quotas: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close quotas: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace quotas: %w", err)
	}
	return nil
}

// quotaResponse is the shape returned both by GET /quota (self) and, keyed
// by uid, inside GET /quotas (admin listing).
type quotaResponse struct {
	HasDrive   bool  `json:"hasDrive"`
	Unlimited  bool  `json:"unlimited"`
	LimitBytes int64 `json:"limitBytes"`
	UsedBytes  int64 `json:"usedBytes"`
}

// homeDirFor resolves a user's private-drive directory from their FBQ
// "home" scope. The scope value is the entire isolation boundary (FBQ
// itself enforces it on every resource endpoint); the prefix check here is
// defense in depth, not the primary containment mechanism.
func (s *apiServer) homeDirFor(user fileBrowserUser) (string, bool) {
	scope, ok := user.scopeFor("home")
	if !ok {
		return "", false
	}
	dir := filepath.Join(s.homePath, filepath.Clean("/"+scope))
	if !strings.HasPrefix(dir+"/", s.homePath+"/") {
		return "", false
	}
	return dir, true
}

// quotaFor computes the quota/usage view for one user: admins are always
// unlimited (usedBytes is the whole home tree's size); a non-admin with no
// home scope has no drive at all; a non-admin with a home scope but no
// admin-set quota record has limitBytes 0 (fail closed, not unlimited).
func (s *apiServer) quotaFor(user fileBrowserUser) quotaResponse {
	if user.Permissions.Admin {
		used, err := directorySize(s.homePath)
		if err != nil {
			log.Printf("compute home directory size for admin usage: %v", err)
		}
		return quotaResponse{HasDrive: true, Unlimited: true, UsedBytes: used}
	}
	dir, ok := s.homeDirFor(user)
	if !ok {
		return quotaResponse{}
	}
	record, _ := s.quotas.get(strconv.Itoa(user.ID))
	used, err := directorySize(dir)
	if err != nil {
		log.Printf("compute usage for uid %d: %v", user.ID, err)
	}
	return quotaResponse{HasDrive: true, Unlimited: false, LimitBytes: record.LimitBytes, UsedBytes: used}
}

func (s *apiServer) handleQuota(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.quotaFor(user))
}

func (s *apiServer) handleQuotas(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}
	users, status, err := s.fetchUsers(r)
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	quotas := make(map[string]quotaResponse, len(users))
	for _, user := range users {
		quotas[strconv.Itoa(user.ID)] = s.quotaFor(user)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"quotas": quotas})
}

func (s *apiServer) handleQuotaByUID(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	uid, err := canonicalUID(strings.TrimPrefix(r.URL.Path, "/quotas/"))
	if err != nil {
		http.Error(w, "Invalid UID.", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPut:
		if _, status, err := s.fetchUser(r, uid); err != nil {
			writeUpstreamError(w, status, err)
			return
		}
		limit, ok := decodeQuotaLimit(w, r)
		if !ok {
			return
		}
		if err := s.quotas.set(uid, limit); err != nil {
			log.Printf("save quota for uid %s: %v", uid, err)
			http.Error(w, "Could not save quota.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"uid": uid, "limitBytes": limit})
	case http.MethodDelete:
		if err := s.quotas.delete(uid); err != nil {
			log.Printf("delete quota for uid %s: %v", uid, err)
			http.Error(w, "Could not delete quota.", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		methodNotAllowed(w, http.MethodPut, http.MethodDelete)
	}
}

func decodeQuotaLimit(w http.ResponseWriter, r *http.Request) (int64, bool) {
	var body struct {
		LimitBytes int64 `json:"limitBytes"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		http.Error(w, "Invalid quota payload.", http.StatusBadRequest)
		return 0, false
	}
	if body.LimitBytes < 0 {
		http.Error(w, "limitBytes must be zero or greater.", http.StatusBadRequest)
		return 0, false
	}
	return body.LimitBytes, true
}

// fetchUsers lists every FileBrowser user, forwarding the calling admin's
// own auth headers — never a client-supplied identity — exactly like
// fetchUser does for a single user.
func (s *apiServer) fetchUsers(r *http.Request) ([]fileBrowserUser, int, error) {
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, s.fileBrowserURL+"/api/users", nil)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	for _, header := range []string{"Cookie", "Authorization", "X-Auth"} {
		if value := r.Header.Get(header); value != "" {
			request.Header.Set(header, value)
		}
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("list users from FileBrowser: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, response.StatusCode, fmt.Errorf("FileBrowser returned %s", response.Status)
	}
	var users []fileBrowserUser
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&users); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("decode FileBrowser users: %w", err)
	}
	return users, http.StatusOK, nil
}
