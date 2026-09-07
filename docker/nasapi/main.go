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
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxDisplayNameRunes = 64

type storageResponse struct {
	UsedBytes  uint64 `json:"usedBytes"`
	TotalBytes uint64 `json:"totalBytes"`
}

type fileBrowserUser struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	Permissions struct {
		Admin bool `json:"admin"`
	} `json:"permissions"`
}

type profile struct {
	DisplayName string `json:"displayName"`
}

type profileResponse struct {
	UID         string `json:"uid"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type profileFile struct {
	Version  int                `json:"version"`
	Profiles map[string]profile `json:"profiles"`
}

type profileStore struct {
	mu       sync.RWMutex
	path     string
	profiles map[string]profile
}

func newProfileStore(path string) (*profileStore, error) {
	store := &profileStore{path: path, profiles: make(map[string]profile)}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}

	var payload profileFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("decode profiles: %w", err)
	}
	if payload.Profiles != nil {
		store.profiles = payload.Profiles
	}
	return store, nil
}

func (s *profileStore) get(uid string) (profile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.profiles[uid]
	return value, ok
}

func (s *profileStore) all() map[string]profile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]profile, len(s.profiles))
	for uid, value := range s.profiles {
		result[uid] = value
	}
	return result
}

func (s *profileStore) set(uid, displayName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.profiles[uid]
	s.profiles[uid] = profile{DisplayName: displayName}
	if err := s.saveLocked(); err != nil {
		if existed {
			s.profiles[uid] = previous
		} else {
			delete(s.profiles, uid)
		}
		return err
	}
	return nil
}

func (s *profileStore) delete(uid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.profiles[uid]
	delete(s.profiles, uid)
	if err := s.saveLocked(); err != nil {
		if existed {
			s.profiles[uid] = previous
		}
		return err
	}
	return nil
}

func (s *profileStore) saveLocked() error {
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create profile directory: %w", err)
	}
	payload, err := json.MarshalIndent(profileFile{Version: 1, Profiles: s.profiles}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode profiles: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "profiles-*.tmp")
	if err != nil {
		return fmt.Errorf("create profile temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure profile temp file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write profiles: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync profiles: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close profiles: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace profiles: %w", err)
	}
	return nil
}

type apiServer struct {
	statPath       string
	fileBrowserURL string
	client         *http.Client
	profiles       *profileStore
}

func newAPIServer(statPath, profilePath, fileBrowserURL string, client *http.Client) (*apiServer, error) {
	store, err := newProfileStore(profilePath)
	if err != nil {
		return nil, err
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &apiServer{
		statPath:       statPath,
		fileBrowserURL: strings.TrimRight(fileBrowserURL, "/"),
		client:         client,
		profiles:       store,
	}, nil
}

func (s *apiServer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/storage", s.handleStorage)
	mux.HandleFunc("/profile", s.handleMyProfile)
	mux.HandleFunc("/profiles", s.handleProfiles)
	mux.HandleFunc("/profiles/", s.handleProfileByUID)
	return mux
}

func (s *apiServer) handleStorage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(s.statPath, &stat); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	writeJSON(w, http.StatusOK, storageResponse{UsedBytes: total - free, TotalBytes: total})
}

func (s *apiServer) handleMyProfile(w http.ResponseWriter, r *http.Request) {
	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	uid := strconv.Itoa(user.ID)

	switch r.Method {
	case http.MethodGet:
		displayName := user.Username
		if saved, ok := s.profiles.get(uid); ok {
			displayName = saved.DisplayName
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, profileResponse{UID: uid, Username: user.Username, DisplayName: displayName})
	case http.MethodPut:
		displayName, ok := decodeDisplayName(w, r)
		if !ok {
			return
		}
		if err := s.profiles.set(uid, displayName); err != nil {
			log.Printf("save profile for uid %s: %v", uid, err)
			http.Error(w, "Could not save profile.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, profileResponse{UID: uid, Username: user.Username, DisplayName: displayName})
	default:
		methodNotAllowed(w, http.MethodGet, http.MethodPut)
	}
}

func (s *apiServer) handleProfiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"profiles": s.profiles.all()})
}

func (s *apiServer) handleProfileByUID(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	uid, err := canonicalUID(strings.TrimPrefix(r.URL.Path, "/profiles/"))
	if err != nil {
		http.Error(w, "Invalid UID.", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPut:
		target, status, err := s.fetchUser(r, uid)
		if err != nil {
			writeUpstreamError(w, status, err)
			return
		}
		displayName, ok := decodeDisplayName(w, r)
		if !ok {
			return
		}
		if err := s.profiles.set(uid, displayName); err != nil {
			log.Printf("save profile for uid %s: %v", uid, err)
			http.Error(w, "Could not save profile.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, profileResponse{UID: uid, Username: target.Username, DisplayName: displayName})
	case http.MethodDelete:
		if err := s.profiles.delete(uid); err != nil {
			log.Printf("delete profile for uid %s: %v", uid, err)
			http.Error(w, "Could not delete profile.", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		methodNotAllowed(w, http.MethodPut, http.MethodDelete)
	}
}

func (s *apiServer) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return false
	}
	if !user.Permissions.Admin {
		http.Error(w, "Administrator access required.", http.StatusForbidden)
		return false
	}
	return true
}

func (s *apiServer) fetchUser(r *http.Request, id string) (fileBrowserUser, int, error) {
	var user fileBrowserUser
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, s.fileBrowserURL+"/api/users?id="+id, nil)
	if err != nil {
		return user, http.StatusBadGateway, err
	}
	for _, header := range []string{"Cookie", "Authorization", "X-Auth"} {
		if value := r.Header.Get(header); value != "" {
			request.Header.Set(header, value)
		}
	}
	response, err := s.client.Do(request)
	if err != nil {
		return user, http.StatusBadGateway, fmt.Errorf("authenticate with FileBrowser: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return user, response.StatusCode, fmt.Errorf("FileBrowser returned %s", response.Status)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&user); err != nil {
		return user, http.StatusBadGateway, fmt.Errorf("decode FileBrowser user: %w", err)
	}
	if user.ID <= 0 {
		return user, http.StatusBadGateway, errors.New("FileBrowser returned an invalid user ID")
	}
	return user, http.StatusOK, nil
}

func decodeDisplayName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var payload profile
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, "Invalid profile payload.", http.StatusBadRequest)
		return "", false
	}
	displayName, err := validateDisplayName(payload.DisplayName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return "", false
	}
	return displayName, true
}

func validateDisplayName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("Display name is required.")
	}
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxDisplayNameRunes {
		return "", fmt.Errorf("Display name must be at most %d characters.", maxDisplayNameRunes)
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return "", errors.New("Display name contains unsupported characters.")
		}
	}
	return value, nil
}

func canonicalUID(value string) (string, error) {
	id, err := strconv.Atoi(value)
	if err != nil || id <= 0 {
		return "", errors.New("invalid UID")
	}
	return strconv.Itoa(id), nil
}

func writeUpstreamError(w http.ResponseWriter, status int, err error) {
	if status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound {
		http.Error(w, http.StatusText(status), status)
		return
	}
	log.Printf("FileBrowser identity lookup failed: %v", err)
	http.Error(w, "Identity service unavailable.", http.StatusBadGateway)
}

func methodNotAllowed(w http.ResponseWriter, methods ...string) {
	w.Header().Set("Allow", strings.Join(methods, ", "))
	http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func main() {
	statPath := envOrDefault("NASAPI_STAT_PATH", "/srv/share")
	dataPath := envOrDefault("NASAPI_DATA_PATH", "/var/lib/vaulta")
	fileBrowserURL := envOrDefault("NASAPI_FILEBROWSER_URL", "http://127.0.0.1:30334")
	port := envOrDefault("NASAPI_PORT", "9190")

	server, err := newAPIServer(statPath, filepath.Join(dataPath, "profiles.json"), fileBrowserURL, nil)
	if err != nil {
		log.Fatal(err)
	}

	addr := "127.0.0.1:" + port
	log.Printf("nasapi listening on %s, stat path %s, profile path %s", addr, statPath, dataPath)
	log.Fatal(http.ListenAndServe(addr, server.handler()))
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
